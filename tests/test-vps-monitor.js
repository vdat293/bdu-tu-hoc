import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VpsMonitorService,
  evaluateVpsAlerts,
  parseProcMeminfo
} from '../src/modules/admin/vps-monitor.service.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

check('parseProcMeminfo tính đúng RAM used, available, cache và Swap từ Ubuntu /proc/meminfo', () => {
  const sample = [
    'MemTotal:        3961112 kB',
    'MemFree:         1160552 kB',
    'MemAvailable:    2560248 kB',
    'Buffers:          131324 kB',
    'Cached:          1395724 kB',
    'SwapTotal:       1969148 kB',
    'SwapFree:        1919564 kB',
    'SReclaimable:     313184 kB'
  ].join('\n');

  const parsed = parseProcMeminfo(sample);
  assert.equal(parsed.totalMb, 3868);
  assert.equal(parsed.availableMb, 2500);
  assert.equal(parsed.usedMb, 1368);
  assert.equal(parsed.buffersMb, 128);
  assert.equal(parsed.cachedMb, 1669);
  assert.equal(parsed.swapTotalMb, 1923);
  assert.equal(parsed.swapUsedMb, 48);
  assert.equal(parsed.usedPct, 35.4);
});

check('evaluateVpsAlerts phát hiện đĩa đầy, không báo giả container backup Exited (0), và bắt container unhealthy', () => {
  const alerts = evaluateVpsAlerts({
    disk: { root: { usedGb: 25, totalGb: 33, availGb: 6.5, usedPct: 80 } },
    memory: { usedMb: 1368, totalMb: 3868, availableMb: 2500, usedPct: 35.4, swapTotalMb: 1922, swapPct: 2.5 },
    docker: {
      containers: [
        { name: 'bdu-tu-hoc-app', state: 'running', status: 'Up 1 hour (healthy)', health: 'healthy' },
        { name: 'bdu-tu-hoc-db-backup', state: 'exited', status: 'Exited (0) 1 hour ago', health: '' },
        { name: 'bdu-tu-hoc-bot', state: 'running', status: 'Up 1 hour (unhealthy)', health: 'unhealthy' }
      ]
    },
    services: { caddy: 'active', docker: 'active', certDaysRemaining: 45 },
    nodeRuntime: { heapUsedMb: 50, heapLimitMb: 2048, heapUsedPctOfLimit: 2.4 },
    isStale: false
  });

  assert.equal(alerts.some((a) => a.id === 'disk-warning' && a.severity === 'warning'), true);
  assert.equal(alerts.some((a) => a.id.includes('bdu-tu-hoc-db-backup')), false);
  assert.equal(alerts.some((a) => a.id === 'container-unhealthy-bdu-tu-hoc-bot' && a.severity === 'critical'), true);
});

await checkAsync('VpsMonitorService.getSnapshot đọc đúng host-agent snapshot.json và ghép thống kê PostgreSQL', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-vps-mon-'));
  const snapFile = path.join(tmpDir, 'snapshot.json');
  try {
    fs.writeFileSync(snapFile, JSON.stringify({
      collectedAt: new Date().toISOString(),
      host: { hostname: 'bdu-prod', os: 'Ubuntu 24.04 LTS', kernel: '6.8.0', arch: 'x86_64', uptimeSeconds: 9999 },
      cpu: { model: 'Intel Xeon', cores: 2, usagePct: 14.5, loadAvg: [0.1, 0.2, 0.3] },
      memory: { totalMb: 3868, usedMb: 1368, freeMb: 1133, availableMb: 2500, buffersMb: 128, cachedMb: 1669, usedPct: 35.4, swapTotalMb: 1922, swapUsedMb: 48, swapFreeMb: 1874, swapPct: 2.5 },
      disk: { root: { filesystem: '/dev/vda', mount: '/', totalGb: 33, usedGb: 25, availGb: 6.5, usedPct: 80 }, dataDirs: [] },
      docker: {
        containers: [{ name: 'bdu-tu-hoc-app', state: 'running', status: 'Up 1h (healthy)', health: 'healthy', cpuPct: 0.2, memUsedMb: 98.8, memPct: 2.55 }],
        storage: [{ type: 'Build Cache', total: 90, active: 0, size: '11.29GB', reclaimable: '3.2GB' }]
      },
      services: { caddy: 'active', docker: 'active', fail2ban: 'active', certDaysRemaining: 120 },
      topProcesses: [{ pid: 100, command: 'postgres', memPct: 3.6, cpuPct: 0.1, rssMb: 140 }],
      history: [{ at: new Date().toISOString(), cpuPct: 14.5, ramUsedPct: 35.4, ramUsedMb: 1368, swapUsedMb: 48, load1: 0.1 }]
    }), 'utf8');

    const mockRunner = async (sql) => {
      if (/pg_database_size/i.test(sql)) {
        return { rows: [{ db_name: 'bdu_hub', size_bytes: 104_857_600, cache_hit_ratio: 99.4 }] };
      }
      if (/pg_stat_activity/i.test(sql)) {
        return { rows: [{ total_conns: 8, active_conns: 2, idle_conns: 6 }] };
      }
      return {
        rows: [{ table_name: 'traffic_logs', total_bytes: 20_971_520, live_rows: 12000, dead_rows: 12 }]
      };
    };

    const res = await VpsMonitorService.getSnapshot({ snapshotPath: snapFile }, mockRunner);
    assert.equal(res.source, 'host-agent');
    assert.equal(res.host.hostname, 'bdu-prod');
    assert.equal(res.memory.totalMb, 3868);
    assert.equal(res.docker.containers[0].name, 'bdu-tu-hoc-app');
    assert.equal(res.database.databaseName, 'bdu_hub');
    assert.equal(res.database.topTables[0].tableName, 'traffic_logs');
    assert.ok(res.nodeRuntime.rssMb > 0);
    assert.ok(Array.isArray(res.nodeRuntime.heapSpaces));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await checkAsync('VpsMonitorService.getSnapshot fallback về node-runtime khi chưa có snapshot file', async () => {
  const res = await VpsMonitorService.getSnapshot({ snapshotPath: path.join(os.tmpdir(), 'does-not-exist-vps.json') });
  assert.equal(res.source, 'node-runtime');
  assert.ok(res.memory.totalMb > 0);
  assert.ok(res.nodeRuntime.heapLimitMb > 0);
  assert.equal(res.docker, null);
});

if (failed > 0) {
  console.log(`✗ VPS monitor: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ VPS monitor: toàn bộ ca đạt.');
}
