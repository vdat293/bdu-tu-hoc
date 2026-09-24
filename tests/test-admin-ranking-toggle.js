/**
 * Test công tắc đồng bộ xếp hạng trong /admin:
 * - API GET/PUT /api/admin/dashboard/ranking-sync (gọi handler trực tiếp)
 * - RankingSchedulerService.isEnabled tôn trọng công tắc admin + env cứng
 * - /api/rankings/status trả sync_enabled theo trạng thái hiệu lực
 * - Retention chỉ giữ 3 run gần nhất, đánh dấu run "running" bỏ dở
 *
 * Chạy trên database dev/test; tự bỏ qua nếu chưa cấu hình DATABASE_URL.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transaction, closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { SystemSettingsService } from '../src/services/system-settings.service.js';
import { RankingSchedulerService } from '../src/services/ranking-scheduler.service.js';
import { AcademicRankingService, AcademicRankingInternals } from '../src/services/academic-ranking.service.js';
import { AdminDashboardController } from '../src/controllers/admin-dashboard.controller.js';
import { ApiController } from '../src/controllers/api.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

const SETTING_KEY = 'ranking_sync';

if (!isDatabaseConfigured()) {
  console.log('⚠ Bỏ qua test công tắc ranking: chưa cấu hình DATABASE_URL.');
  process.exit(0);
}

const database = await query('SELECT current_database() AS name');
console.log(`→ Database: ${database.rows[0]?.name || 'unknown'}`);

const table = await query("SELECT to_regclass('public.system_settings') AS name");
assert.ok(table.rows[0]?.name, 'Thiếu bảng system_settings — chạy `npm run db:migrate` trước.');

function mockRes() {
  const captured = { statusCode: 200, payload: null };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(payload) {
      captured.payload = payload;
      return captured;
    }
  };
  return { res, captured };
}

async function inRollbackTransaction(work) {
  const rollback = new Error('__rollback__');
  try {
    await transaction(async (client) => {
      await work(client);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

console.log('--- Testing Admin ranking sync toggle ---');

// 0. Route đã đăng ký + UI /admin có đủ phần tử
console.log('0. Kiểm tra route và giao diện /admin...');
const routesSource = fs.readFileSync(new URL('../src/routes/api.routes.js', import.meta.url), 'utf8');
assert.match(routesSource, /router\.get\('\/admin\/dashboard\/ranking-sync'/);
assert.match(routesSource, /router\.put\('\/admin\/dashboard\/ranking-sync'/);
const adminHtml = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
for (const id of [
  'ranking-sync-toggle',
  'ranking-sync-state',
  'ranking-sync-last',
  'ranking-sync-next'
]) {
  assert.ok(adminHtml.includes(id), `Thiếu phần tử #${id} trong /admin`);
}
assert.ok(adminJs.includes('/api/admin/dashboard/ranking-sync'), 'admin.js chưa gọi API công tắc');
console.log('✓ route + giao diện /admin đầy đủ');

// 1. Mặc định bật khi chưa có cấu hình
console.log('1. GET mặc định phải bật...');
process.env.RANKING_SYNC_ENABLED = 'true';
process.env.ADMIN_DASHBOARD_KEY = 'test-admin-key';
const previousSetting = await query('SELECT value, updated_by FROM system_settings WHERE key = $1', [SETTING_KEY]);
await query('DELETE FROM system_settings WHERE key = $1', [SETTING_KEY]);
SystemSettingsService.invalidate(SETTING_KEY);

const adminReq = (body = null) => ({
  headers: { 'x-admin-key': 'test-admin-key' },
  identityAdminMssv: 'TESTADMIN',
  body
});

let out = mockRes();
await AdminDashboardController.getRankingSync(adminReq(), out.res);
assert.equal(out.captured.statusCode, 200);
assert.equal(out.captured.payload.data.enabled, true);
assert.equal(out.captured.payload.data.env_enabled, true);
assert.equal(out.captured.payload.data.effective_enabled, true);
assert.equal(await RankingSchedulerService.isEnabled(), true);
console.log('✓ mặc định bật');

// 2. Tắt qua /admin: lưu DB + scheduler + status sinh viên
console.log('2. PUT tắt công tắc...');
out = mockRes();
await AdminDashboardController.updateRankingSync(adminReq({ enabled: false }), out.res);
assert.equal(out.captured.statusCode, 200);
assert.equal(out.captured.payload.data.enabled, false);
assert.equal(out.captured.payload.data.effective_enabled, false);
assert.equal(out.captured.payload.data.setting_updated_by, 'TESTADMIN');

const stored = await query('SELECT value, updated_by FROM system_settings WHERE key = $1', [SETTING_KEY]);
assert.equal(stored.rows[0].value.enabled, false);
assert.equal(stored.rows[0].updated_by, 'TESTADMIN');
assert.equal(await RankingSchedulerService.isEnabled(), false);

BduIdentityService.register('ranking-toggle-token', '24050001', { expiresIn: 60 });
out = mockRes();
await ApiController.getAcademicRankingStatus(
  { headers: { authorization: 'Bearer ranking-toggle-token' } },
  out.res
);
assert.equal(out.captured.payload.data.sync_enabled, false, 'status sinh viên phải phản ánh công tắc');
console.log('✓ tắt công tắc có hiệu lực tức thì');

// 3. Payload sai bị từ chối
console.log('3. PUT payload không hợp lệ...');
out = mockRes();
await AdminDashboardController.updateRankingSync(adminReq({ enabled: 'no' }), out.res);
assert.equal(out.captured.statusCode, 400);
assert.equal(out.captured.payload.result, false);
console.log('✓ payload sai trả 400');

// 4. Env cứng thắng công tắc admin
console.log('4. RANKING_SYNC_ENABLED=false phải khoá cứng...');
out = mockRes();
await AdminDashboardController.updateRankingSync(adminReq({ enabled: true }), out.res);
assert.equal(out.captured.payload.data.enabled, true);
process.env.RANKING_SYNC_ENABLED = 'false';
assert.equal(await RankingSchedulerService.isEnabled(), false);
out = mockRes();
await AdminDashboardController.getRankingSync(adminReq(), out.res);
assert.equal(out.captured.payload.data.effective_enabled, false);
assert.equal(out.captured.payload.data.env_enabled, false);
process.env.RANKING_SYNC_ENABLED = 'true';
console.log('✓ env cứng thắng công tắc admin');

// 5. Retention: chỉ giữ 3 run gần nhất (rollback để không đụng dữ liệu dev)
console.log('5. Retention giữ 3 run...');
assert.equal(AcademicRankingInternals.retentionKeepCount('abc'), 3);
assert.equal(AcademicRankingInternals.retentionKeepCount('0'), 3);
assert.equal(AcademicRankingInternals.retentionKeepCount('5'), 5);

await inRollbackTransaction(async (client) => {
  const seeded = await client.query('INSERT INTO academic_ranking_sync_runs (status, trigger_source, started_at) VALUES '
    + "('succeeded', 'scheduler', NOW() - INTERVAL '4 days'),"
    + "('succeeded', 'scheduler', NOW() - INTERVAL '3 days'),"
    + "('succeeded', 'scheduler', NOW() - INTERVAL '2 days'),"
    + "('succeeded', 'scheduler', NOW() - INTERVAL '1 day'),"
    + "('succeeded', 'scheduler', NOW()) RETURNING id");
  const oldestRunId = seeded.rows[0].id;
  await client.query(
    "INSERT INTO academic_rankings (sync_run_id, mssv, rankings) VALUES ($1, 'TESTSV01', '{}'::jsonb)",
    [oldestRunId]
  );

  const expectedKept = await client.query(
    'SELECT id FROM academic_ranking_sync_runs ORDER BY started_at DESC, id DESC LIMIT 3'
  );
  const before = await client.query('SELECT count(*)::int AS count FROM academic_ranking_sync_runs');
  const result = await AcademicRankingInternals.pruneOldRuns(3, client);
  assert.equal(result.keep, 3);
  assert.equal(result.deleted, before.rows[0].count - 3, 'phải xoá hết run cũ hơn, chỉ giữ 3');

  const remaining = await client.query('SELECT id FROM academic_ranking_sync_runs');
  assert.deepEqual(
    new Set(remaining.rows.map((row) => String(row.id))),
    new Set(expectedKept.rows.map((row) => String(row.id))),
    'phải giữ đúng 3 run mới nhất'
  );
  const cascade = await client.query(
    'SELECT count(*)::int AS count FROM academic_rankings WHERE sync_run_id = $1',
    [oldestRunId]
  );
  assert.equal(cascade.rows[0].count, 0, 'dữ liệu xếp hạng của run bị xoá phải cascade');
});
console.log('✓ retention giữ đúng 3 run + cascade dữ liệu');

// 5b. Env RANKING_SNAPSHOT_RETENTION_RUNS ghi đè số run giữ lại
process.env.RANKING_SNAPSHOT_RETENTION_RUNS = '2';
await inRollbackTransaction(async (client) => {
  await client.query('INSERT INTO academic_ranking_sync_runs (status, trigger_source, started_at) VALUES '
    + "('succeeded', 'scheduler', NOW() - INTERVAL '3 days'),"
    + "('succeeded', 'scheduler', NOW() - INTERVAL '2 days'),"
    + "('succeeded', 'scheduler', NOW() - INTERVAL '1 day')");
  const result = await AcademicRankingInternals.pruneOldRuns(null, client);
  assert.equal(result.keep, 2, 'phải đọc env RANKING_SNAPSHOT_RETENTION_RUNS');
  const remaining = await client.query('SELECT count(*)::int AS count FROM academic_ranking_sync_runs');
  assert.equal(remaining.rows[0].count, 2);
});
delete process.env.RANKING_SNAPSHOT_RETENTION_RUNS;
console.log('✓ env retention hoạt động');

// 6. Run "running" bỏ dở quá 6 giờ bị đánh dấu thất bại, run mới thì không
console.log('6. Dọn run treo...');
await inRollbackTransaction(async (client) => {
  const stale = await client.query(
    "INSERT INTO academic_ranking_sync_runs (status, trigger_source, started_at) "
    + "VALUES ('running', 'scheduler', NOW() - INTERVAL '10 hours') RETURNING id"
  );
  const fresh = await client.query(
    "INSERT INTO academic_ranking_sync_runs (status, trigger_source, started_at) "
    + "VALUES ('running', 'scheduler', NOW() - INTERVAL '1 hour') RETURNING id"
  );
  const marked = await AcademicRankingInternals.markStaleRuns(client);
  assert.ok(marked >= 1);
  const rows = await client.query(
    'SELECT id, status FROM academic_ranking_sync_runs WHERE id = ANY($1::bigint[])',
    [[stale.rows[0].id, fresh.rows[0].id]]
  );
  const byId = new Map(rows.rows.map((row) => [String(row.id), row.status]));
  assert.equal(byId.get(String(stale.rows[0].id)), 'failed');
  assert.equal(byId.get(String(fresh.rows[0].id)), 'running', 'run mới chưa quá hạn không được đụng');
});
console.log('✓ run treo được đánh dấu thất bại, run mới giữ nguyên');

// Khôi phục cấu hình cũ (nếu môi trường dev có sẵn)
if (previousSetting.rows.length) {
  await query(`
    INSERT INTO system_settings (key, value, updated_at, updated_by)
    VALUES ($1, $2::jsonb, NOW(), $3)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
  `, [
    SETTING_KEY,
    JSON.stringify(previousSetting.rows[0].value),
    previousSetting.rows[0].updated_by
  ]);
} else {
  await query('DELETE FROM system_settings WHERE key = $1', [SETTING_KEY]);
}
SystemSettingsService.invalidate(SETTING_KEY);

await closeDatabase();
console.log('✓ Admin ranking sync toggle: tất cả test PASS');
