import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import { isDatabaseConfigured, query } from '../../db/database.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { TrafficService } from '../../services/traffic.service.js';
import { InteractionTelemetryService } from './interaction-telemetry.service.js';

const SAMPLE_INTERVAL_MS = 10_000;
const HISTORY_LIMIT = 60;
const STALE_SNAPSHOT_SECONDS = 60;

const CURATED_COMMANDS = [
  {
    id: 'docker-ps',
    label: 'Xem trạng thái container',
    description: 'Kiểm tra container đang chạy, healthcheck và port trên VPS.',
    command: 'cd /opt/bdu-tu-hoc && docker compose ps'
  },
  {
    id: 'disk-df',
    label: 'Kiểm tra dung lượng đĩa & Docker',
    description: 'Xem phân bổ 33GB SSD gốc và dung lượng Docker có thể giải phóng.',
    command: 'df -h / && docker system df'
  },
  {
    id: 'docker-prune-cache',
    label: 'Dọn Docker build cache dư thừa',
    description: 'An toàn: chỉ xóa build cache không còn dùng, không đụng volume database.',
    command: 'docker builder prune -f && docker image prune -f'
  },
  {
    id: 'app-logs',
    label: 'Xem 100 dòng log mới nhất của bdu-hub',
    description: 'Theo dõi log runtime Node.js của container production.',
    command: 'cd /opt/bdu-tu-hoc && docker compose logs --tail=100 bdu-hub'
  },
  {
    id: 'caddy-status',
    label: 'Kiểm tra reverse proxy Caddy & TLS',
    description: 'Xem trạng thái dịch vụ HTTPS trước cổng 3000.',
    command: 'systemctl status caddy --no-pager -n 20'
  }
];

let loopMonitor = null;
try {
  loopMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopMonitor.enable();
} catch {
  loopMonitor = null;
}

let sampleTimer = null;
let runtimeHistory = [];
let prevCpuTimes = null;

function round(val, digits = 1) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

export function formatBytesMb(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return round(b / (1024 * 1024), 1);
}

export function parseProcMeminfo(rawText = '') {
  const kv = {};
  for (const line of String(rawText || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)\s*kB/);
    if (match) kv[match[1]] = Number(match[2]);
  }

  const totalKb = kv.MemTotal || 0;
  const freeKb = kv.MemFree || 0;
  const availKb = kv.MemAvailable ?? freeKb;
  const buffersKb = kv.Buffers || 0;
  const cachedKb = (kv.Cached || 0) + (kv.SReclaimable || 0);
  const usedKb = Math.max(0, totalKb - availKb);

  const swapTotalKb = kv.SwapTotal || 0;
  const swapFreeKb = kv.SwapFree || 0;
  const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);

  return {
    totalMb: Math.round(totalKb / 1024),
    usedMb: Math.round(usedKb / 1024),
    freeMb: Math.round(freeKb / 1024),
    availableMb: Math.round(availKb / 1024),
    buffersMb: Math.round(buffersKb / 1024),
    cachedMb: Math.round(cachedKb / 1024),
    usedPct: totalKb > 0 ? round((usedKb / totalKb) * 100, 1) : 0,
    swapTotalMb: Math.round(swapTotalKb / 1024),
    swapUsedMb: Math.round(swapUsedKb / 1024),
    swapFreeMb: Math.round(swapFreeKb / 1024),
    swapPct: swapTotalKb > 0 ? round((swapUsedKb / swapTotalKb) * 100, 1) : 0
  };
}

function sampleCpuUsagePct() {
  try {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const t = cpu.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.irq + t.idle;
    }
    let usagePct = 0;
    if (prevCpuTimes && total > prevCpuTimes.total) {
      const dTotal = total - prevCpuTimes.total;
      const dIdle = idle - prevCpuTimes.idle;
      usagePct = round(Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)), 1);
    }
    prevCpuTimes = { idle, total };
    return usagePct;
  } catch {
    return 0;
  }
}

function readLocalMemory() {
  try {
    if (fs.existsSync('/proc/meminfo')) {
      return parseProcMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
    }
  } catch {
    // Fall back to os.* below
  }
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    totalMb: Math.round(totalBytes / (1024 * 1024)),
    usedMb: Math.round(usedBytes / (1024 * 1024)),
    freeMb: Math.round(freeBytes / (1024 * 1024)),
    availableMb: Math.round(freeBytes / (1024 * 1024)),
    buffersMb: 0,
    cachedMb: 0,
    usedPct: totalBytes > 0 ? round((usedBytes / totalBytes) * 100, 1) : 0,
    swapTotalMb: 0,
    swapUsedMb: 0,
    swapFreeMb: 0,
    swapPct: 0
  };
}

function readLocalDisk() {
  try {
    if (typeof fs.statfsSync === 'function') {
      const target = process.platform === 'win32' ? process.cwd() : '/';
      const st = fs.statfsSync(target);
      const bsize = Number(st.bsize) || 4096;
      const totalB = Number(st.blocks) * bsize;
      const availB = Number(st.bavail) * bsize;
      const usedB = Math.max(0, totalB - availB);
      const gb = 1024 ** 3;
      return {
        root: {
          filesystem: target,
          mount: target,
          totalGb: round(totalB / gb, 2),
          usedGb: round(usedB / gb, 2),
          availGb: round(availB / gb, 2),
          usedPct: totalB > 0 ? round((usedB / totalB) * 100, 1) : 0
        },
        dataDirs: []
      };
    }
  } catch {
    // Ignore disk stat failure
  }
  return {
    root: { filesystem: '--', mount: '/', totalGb: 0, usedGb: 0, availGb: 0, usedPct: 0 },
    dataDirs: []
  };
}

function readCgroupMemory() {
  try {
    const curPath = '/sys/fs/cgroup/memory.current';
    const maxPath = '/sys/fs/cgroup/memory.max';
    if (!fs.existsSync(curPath)) return { cgroupMemoryMb: null, cgroupLimitMb: null };
    const curBytes = Number(fs.readFileSync(curPath, 'utf8').trim());
    const maxRaw = fs.existsSync(maxPath) ? fs.readFileSync(maxPath, 'utf8').trim() : 'max';
    const maxBytes = maxRaw && maxRaw !== 'max' ? Number(maxRaw) : null;
    return {
      cgroupMemoryMb: Number.isFinite(curBytes) ? formatBytesMb(curBytes) : null,
      cgroupLimitMb: maxBytes && Number.isFinite(maxBytes) ? formatBytesMb(maxBytes) : null
    };
  } catch {
    return { cgroupMemoryMb: null, cgroupLimitMb: null };
  }
}

function collectNodeRuntime({ trafficQueueSize = 0, telemetryQueueSize = 0, onlineCount = 0 } = {}) {
  const mem = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();
  const heapLimitMb = formatBytesMb(heapStats.heap_size_limit);
  const heapUsedMb = formatBytesMb(mem.heapUsed);
  const heapTotalMb = formatBytesMb(mem.heapTotal);
  const { cgroupMemoryMb, cgroupLimitMb } = readCgroupMemory();

  const heapSpaces = v8.getHeapSpaceStatistics().map((s) => ({
    name: s.space_name,
    usedMb: formatBytesMb(s.space_used_size),
    sizeMb: formatBytesMb(s.space_size)
  })).filter((s) => s.sizeMb > 0);

  let eventLoopLagMs = 0;
  if (loopMonitor) {
    const meanNs = Number(loopMonitor.mean);
    eventLoopLagMs = Number.isFinite(meanNs) && meanNs > 0 ? round(meanNs / 1e6, 2) : 0;
  }

  return {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    rssMb: formatBytesMb(mem.rss),
    heapUsedMb,
    heapTotalMb,
    heapLimitMb,
    heapUsedPctOfLimit: heapLimitMb > 0 ? round((heapUsedMb / heapLimitMb) * 100, 1) : 0,
    externalMb: formatBytesMb(mem.external),
    arrayBuffersMb: formatBytesMb(mem.arrayBuffers || 0),
    heapSpaces,
    eventLoopLagMs,
    cgroupMemoryMb,
    cgroupLimitMb,
    realtime: CommunityRealtime.getStatus(),
    queues: {
      trafficQueueSize,
      telemetryQueueSize,
      onlineCount
    }
  };
}

function recordRuntimePoint() {
  const cpuPct = sampleCpuUsagePct();
  const mem = readLocalMemory();
  const load = os.loadavg();
  runtimeHistory.push({
    at: new Date().toISOString(),
    cpuPct,
    ramUsedPct: mem.usedPct,
    ramUsedMb: mem.usedMb,
    swapUsedMb: mem.swapUsedMb,
    load1: round(load[0] || 0, 2)
  });
  if (runtimeHistory.length > HISTORY_LIMIT) {
    runtimeHistory = runtimeHistory.slice(-HISTORY_LIMIT);
  }
}

export function evaluateVpsAlerts(snapshot = {}) {
  const alerts = [];
  const diskPct = Number(snapshot.disk?.root?.usedPct || 0);
  if (diskPct >= 85) {
    alerts.push({
      id: 'disk-critical',
      severity: 'critical',
      title: `Ổ đĩa đầy ${diskPct}%`,
      message: `Còn trống ${snapshot.disk?.root?.availGb ?? 0} GB — nên dọn Docker build cache hoặc log ngay.`
    });
  } else if (diskPct >= 75) {
    alerts.push({
      id: 'disk-warning',
      severity: 'warning',
      title: `Ổ đĩa đạt ${diskPct}% (${snapshot.disk?.root?.usedGb ?? 0}/${snapshot.disk?.root?.totalGb ?? 0} GB)`,
      message: `Còn trống ${snapshot.disk?.root?.availGb ?? 0} GB. Kiểm tra mục lưu trữ Docker hoặc backup định kỳ.`
    });
  }

  const ramPct = Number(snapshot.memory?.usedPct || 0);
  if (ramPct >= 85) {
    alerts.push({
      id: 'ram-critical',
      severity: 'critical',
      title: `RAM máy chủ cao (${ramPct}%)`,
      message: `Đang dùng ${snapshot.memory?.usedMb ?? 0}/${snapshot.memory?.totalMb ?? 0} MB.`
    });
  } else if (ramPct >= 75) {
    alerts.push({
      id: 'ram-warning',
      severity: 'warning',
      title: `RAM máy chủ ở mức ${ramPct}%`,
      message: `Còn khả dụng ${snapshot.memory?.availableMb ?? 0} MB.`
    });
  }

  const swapTotal = Number(snapshot.memory?.swapTotalMb || 0);
  const swapPct = Number(snapshot.memory?.swapPct || 0);
  if (swapTotal > 0 && swapPct >= 50) {
    alerts.push({
      id: 'swap-warning',
      severity: 'warning',
      title: `Swap đang dùng ${swapPct}%`,
      message: `${snapshot.memory?.swapUsedMb ?? 0}/${swapTotal} MB Swap đang bị chiếm.`
    });
  }

  const containers = Array.isArray(snapshot.docker?.containers) ? snapshot.docker.containers : [];
  for (const c of containers) {
    const status = String(c.status || '');
    const state = String(c.state || '').toLowerCase();
    const isPlannedOneShotExit = String(c.name || '').includes('backup') && /exited\s*\(0\)/i.test(status);
    if (isPlannedOneShotExit) continue;
    if (state && state !== 'running') {
      alerts.push({
        id: `container-down-${c.name}`,
        severity: 'critical',
        title: `Container ${c.name} không chạy (${state})`,
        message: status || 'Kiểm tra trạng thái bằng docker compose ps.'
      });
    } else if (String(c.health || '').toLowerCase() === 'unhealthy') {
      alerts.push({
        id: `container-unhealthy-${c.name}`,
        severity: 'critical',
        title: `Container ${c.name} unhealthy`,
        message: status || 'Healthcheck đang thất bại.'
      });
    }
  }

  if (snapshot.services) {
    for (const svc of ['caddy', 'docker']) {
      const val = snapshot.services[svc];
      if (val && val !== 'active' && val !== 'unknown') {
        alerts.push({
          id: `service-${svc}`,
          severity: 'critical',
          title: `Dịch vụ ${svc} trạng thái "${val}"`,
          message: `Cần kiểm tra systemctl status ${svc}.`
        });
      }
    }
    const certDays = snapshot.services.certDaysRemaining;
    if (certDays !== null && certDays !== undefined && Number(certDays) < 14) {
      alerts.push({
        id: 'cert-expiry',
        severity: 'warning',
        title: `Chứng chỉ TLS sắp hết hạn (${certDays} ngày)`,
        message: 'Cần kiểm tra lại chứng chỉ Caddy origin trên VPS.'
      });
    }
  }

  const heapPct = Number(snapshot.nodeRuntime?.heapUsedPctOfLimit || 0);
  if (heapPct >= 80) {
    alerts.push({
      id: 'node-heap-high',
      severity: 'warning',
      title: `V8 Heap sử dụng cao (${heapPct}%)`,
      message: `${snapshot.nodeRuntime?.heapUsedMb ?? 0}/${snapshot.nodeRuntime?.heapLimitMb ?? 0} MB.`
    });
  }

  if (snapshot.isStale) {
    alerts.push({
      id: 'snapshot-stale',
      severity: 'warning',
      title: 'Dữ liệu từ bdu-vps-agent bị trễ',
      message: `Lần cập nhật cuối cách đây ${snapshot.snapshotAgeSeconds} giây.`
    });
  }

  return alerts;
}

async function collectDatabaseStats(exec) {
  if (!exec) return null;
  try {
    const [dbRes, connRes, tablesRes] = await Promise.all([
      exec(`
        SELECT
          current_database() AS db_name,
          pg_database_size(current_database())::bigint AS size_bytes,
          COALESCE(
            ROUND((blks_hit::numeric * 100.0) / NULLIF(blks_hit + blks_read, 0), 2),
            100
          )::float AS cache_hit_ratio
        FROM pg_stat_database
        WHERE datname = current_database();
      `, []),
      exec(`
        SELECT
          COUNT(*)::int AS total_conns,
          COUNT(*) FILTER (WHERE state = 'active')::int AS active_conns,
          COUNT(*) FILTER (WHERE state = 'idle')::int AS idle_conns
        FROM pg_stat_activity
        WHERE datname = current_database();
      `, []),
      exec(`
        SELECT
          relname AS table_name,
          pg_total_relation_size(relid)::bigint AS total_bytes,
          COALESCE(n_live_tup, 0)::bigint AS live_rows,
          COALESCE(n_dead_tup, 0)::bigint AS dead_rows
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 8;
      `, [])
    ]);

    const dbRow = dbRes.rows?.[0] || {};
    const connRow = connRes.rows?.[0] || {};
    return {
      databaseName: dbRow.db_name || 'bdu_hub',
      sizeBytes: Number(dbRow.size_bytes || 0),
      sizeMb: formatBytesMb(dbRow.size_bytes || 0),
      cacheHitRatioPct: Number(dbRow.cache_hit_ratio ?? 100),
      connections: {
        total: Number(connRow.total_conns || 0),
        active: Number(connRow.active_conns || 0),
        idle: Number(connRow.idle_conns || 0)
      },
      topTables: (tablesRes.rows ?? []).map((r) => ({
        tableName: r.table_name,
        totalMb: formatBytesMb(r.total_bytes || 0),
        liveRows: Number(r.live_rows || 0),
        deadRows: Number(r.dead_rows || 0)
      }))
    };
  } catch (err) {
    console.warn('[VpsMonitor] Lỗi đọc thống kê PostgreSQL:', err.message);
    return null;
  }
}

function readHostSnapshotFile(snapshotPath) {
  const target = snapshotPath || process.env.VPS_TELEMETRY_SNAPSHOT_PATH || path.resolve(process.cwd(), 'data', 'vps-telemetry', 'snapshot.json');
  try {
    if (!target || !fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export const VpsMonitorService = {
  start() {
    if (sampleTimer) return;
    recordRuntimePoint();
    sampleTimer = setInterval(recordRuntimePoint, SAMPLE_INTERVAL_MS);
    sampleTimer.unref?.();
  },

  stop() {
    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
  },

  async getSnapshot(options = {}, runner) {
    const exec = runner ?? (isDatabaseConfigured() ? query : null);
    const hostSnapshot = readHostSnapshotFile(options.snapshotPath);

    let trafficQueueSize = 0;
    try {
      const sysMetrics = await TrafficService.getSystemMetrics();
      trafficQueueSize = Number(sysMetrics?.bufferQueueSize || 0);
    } catch {
      trafficQueueSize = 0;
    }
    const telStats = InteractionTelemetryService.getBufferStats();
    const nodeRuntime = collectNodeRuntime({
      trafficQueueSize,
      telemetryQueueSize: Number(telStats?.queueSize || 0),
      onlineCount: Number(telStats?.onlineCount || 0)
    });

    const database = await collectDatabaseStats(exec);
    const source = hostSnapshot ? 'host-agent' : 'node-runtime';

    const collectedAt = hostSnapshot?.collectedAt || new Date().toISOString();
    const ageSec = hostSnapshot?.collectedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(hostSnapshot.collectedAt)) / 1000))
      : 0;
    const isStale = source === 'host-agent' && Number.isFinite(ageSec) && ageSec > STALE_SNAPSHOT_SECONDS;

    if (!hostSnapshot && runtimeHistory.length === 0) {
      recordRuntimePoint();
    }

    const cpuModel = os.cpus()?.[0]?.model || os.arch();
    const loadArr = os.loadavg().map((v) => round(v, 2));
    const latestRuntimePoint = runtimeHistory[runtimeHistory.length - 1];

    const payload = {
      source,
      collectedAt,
      snapshotAgeSeconds: ageSec,
      isStale,
      host: hostSnapshot?.host || {
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        kernel: os.release(),
        arch: os.arch(),
        uptimeSeconds: Math.floor(os.uptime())
      },
      cpu: hostSnapshot?.cpu || {
        model: cpuModel,
        cores: os.cpus()?.length || 1,
        usagePct: latestRuntimePoint?.cpuPct ?? 0,
        userPct: 0,
        systemPct: 0,
        iowaitPct: 0,
        loadAvg: loadArr
      },
      memory: hostSnapshot?.memory || readLocalMemory(),
      disk: hostSnapshot?.disk || readLocalDisk(),
      nodeRuntime,
      database,
      docker: hostSnapshot?.docker || null,
      services: hostSnapshot?.services || null,
      topProcesses: Array.isArray(hostSnapshot?.topProcesses) ? hostSnapshot.topProcesses : [],
      network: hostSnapshot?.network || null,
      history: Array.isArray(hostSnapshot?.history) && hostSnapshot.history.length > 0
        ? hostSnapshot.history
        : runtimeHistory.slice(),
      quickCommands: CURATED_COMMANDS
    };

    payload.alerts = evaluateVpsAlerts(payload);
    return payload;
  },

  async flushRuntimeBuffers() {
    let beforeTraffic = 0;
    try {
      const m = await TrafficService.getSystemMetrics();
      beforeTraffic = Number(m?.bufferQueueSize || 0);
    } catch {
      beforeTraffic = 0;
    }
    const beforeTelemetry = Number(InteractionTelemetryService.getBufferStats()?.queueSize || 0);

    await Promise.all([
      TrafficService.flush().catch((err) => console.error('[VpsMonitor] flush traffic failed:', err.message)),
      InteractionTelemetryService.flush().catch((err) => console.error('[VpsMonitor] flush telemetry failed:', err.message))
    ]);

    let afterTraffic = 0;
    try {
      const m = await TrafficService.getSystemMetrics();
      afterTraffic = Number(m?.bufferQueueSize || 0);
    } catch {
      afterTraffic = 0;
    }
    const afterTelemetry = Number(InteractionTelemetryService.getBufferStats()?.queueSize || 0);
    const mem = process.memoryUsage();

    return {
      before: { trafficQueueSize: beforeTraffic, telemetryQueueSize: beforeTelemetry },
      after: { trafficQueueSize: afterTraffic, telemetryQueueSize: afterTelemetry },
      memory: {
        rssMb: formatBytesMb(mem.rss),
        heapUsedMb: formatBytesMb(mem.heapUsed),
        heapTotalMb: formatBytesMb(mem.heapTotal)
      }
    };
  }
};
