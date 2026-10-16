/**
 * Test 2 endpoint Admin kho ODP:
 *   - GET  /api/admin/dashboard/odp-sync  → lần chạy gần nhất + counts
 *   - POST /api/admin/dashboard/odp-sync  → OdpSyncService.sync({ triggerSource:'manual' })
 *   - thiếu quyền admin → 403 (qua requireAdmin), route phải nằm SAU guard
 *   - /admin có khối "Kho ODP" + admin.js gọi API mới
 *
 * Chạy trên database test cô lập; tự bỏ qua nếu chưa cấu hình DATABASE_URL.
 * Chỉ đọc/ghi bảng odp_sync_runs (qua id đã seed rồi xoá lại) và system_roles
 * của MSSV test — không đụng dữ liệu thật.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query } from '../src/db/database.js';
import { OdpSyncService } from '../src/services/odp-sync.service.js';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NONADMIN_MSSV = 'TEST_ODP_NONADMIN';
const NONADMIN_TOKEN = 'odp-admin-nonadmin-token';

const originalSync = OdpSyncService.sync;
let seededRunId = null;
let failed = 0;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

try {
  await query('DELETE FROM system_roles WHERE mssv = $1', [NONADMIN_MSSV]);

  await check('GET odp-sync trả lần chạy gần nhất kèm counts', async () => {
    const seeded = await query(
      `INSERT INTO odp_sync_runs (status, trigger_source, started_at, finished_at, counts, error)
       VALUES ('success', 'scheduler', NOW() - INTERVAL '1 minute', NOW(), $1::jsonb, NULL)
       RETURNING id`,
      [JSON.stringify({ sinh_vien: 3, tbhk: 2 })]
    );
    seededRunId = seeded.rows[0].id;

    const res = response();
    await AdminDashboardController.getOdpSync({}, res);
    assert.equal(res.statusCode, 200, 'GET phải trả 200');
    assert.equal(res.body.result, true, 'result phải true');

    const latest = res.body.data.latest_run;
    assert.ok(latest, 'phải trả latest_run');
    assert.equal(String(latest.id), String(seededRunId), 'phải trả đúng run gần nhất');
    assert.equal(latest.status, 'success');
    assert.equal(latest.trigger_source, 'scheduler');
    assert.equal(latest.counts.sinh_vien, 3, 'counts.sinh_vien phải khớp');
    assert.equal(latest.counts.tbhk, 2, 'counts.tbhk phải khớp');
  });

  await check('POST odp-sync gọi OdpSyncService.sync với triggerSource=manual', async () => {
    let received = null;
    OdpSyncService.sync = async (options) => {
      received = options;
      return { skipped: false, runId: 987654, counts: { sinh_vien: 5 }, errors: [], status: 'success' };
    };

    const res = response();
    await AdminDashboardController.runOdpSync({}, res);
    assert.equal(res.statusCode, 200, 'POST phải trả 200');
    assert.equal(res.body.result, true);
    assert.equal(received && received.triggerSource, 'manual', 'phải gọi sync với triggerSource manual');
    assert.equal(res.body.data.runId, 987654, 'phải trả nguyên kết quả sync');
  });

  await check('thiếu quyền admin → 403, không gọi next', async () => {
    process.env.ADMIN_DASHBOARD_KEY = 'odp-admin-test-key';
    process.env.SYSTEM_OWNER_MSSV = 'TEST_ODP_OWNER';
    BduIdentityService.register(NONADMIN_TOKEN, NONADMIN_MSSV, { expiresIn: 600 });

    let nextCalled = false;
    const res = response();
    await AdminDashboardController.requireAdmin(
      { headers: { authorization: `Bearer ${NONADMIN_TOKEN}` }, socket: {} },
      res,
      () => { nextCalled = true; }
    );
    assert.equal(res.statusCode, 403, 'non-admin phải bị chặn 403');
    assert.equal(res.body.result, false);
    assert.equal(nextCalled, false, 'không được gọi next cho non-admin');
  });

  await check('route odp-sync nằm SAU guard requireAdmin + /admin có khối Kho ODP', async () => {
    const source = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
    const guardPos = source.indexOf("router.use('/admin/dashboard'");
    const getPos = source.indexOf("router.get('/admin/dashboard/odp-sync'");
    const postPos = source.indexOf("router.post('/admin/dashboard/odp-sync'");
    assert.ok(guardPos !== -1 && getPos !== -1 && postPos !== -1, 'thiếu route odp-sync trong admin.routes.js');
    assert.ok(getPos > guardPos, 'GET odp-sync phải nằm SAU guard requireAdmin');
    assert.ok(postPos > guardPos, 'POST odp-sync phải nằm SAU guard requireAdmin');

    const html = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/admin/admin.js'), 'utf8');
    for (const id of ['odp-sync-state', 'odp-sync-counts-body', 'btn-odp-sync-run']) {
      assert.ok(html.includes(id), `thiếu phần tử #${id} trong /admin`);
    }
    assert.ok(js.includes('/api/admin/dashboard/odp-sync'), 'admin.js chưa gọi API odp-sync');
  });
} finally {
  OdpSyncService.sync = originalSync;
  if (seededRunId !== null) {
    await query('DELETE FROM odp_sync_runs WHERE id = $1', [seededRunId]).catch(() => {});
  }
  await closeDatabase();
}

if (failed > 0) {
  console.log(`✗ Admin ODP API: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin ODP API: toàn bộ ca đạt.');
}
