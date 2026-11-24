/**
 * Test hợp đồng UI khóa dịch vụ theo nhóm, ranking-sync, ODP và TTCDS trong OperationsPage.jsx.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/OperationsPage.jsx'), 'utf8');
const adminApiJs = fs.readFileSync(path.join(ROOT, 'client/src/admin/api/adminApi.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'src/routes/admin.routes.js'), 'utf8');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error?.message || error}`);
  }
}

check('OperationsPage có vùng danh sách khóa dịch vụ và nối tới service-lock PUT', () => {
  assert.ok(opsJsx.includes('id="service-lock-list"'), 'OperationsPage thiếu #service-lock-list');
  assert.match(adminApiJs, /\/api\/admin\/dashboard\/service-lock/, 'adminApi.js thiếu endpoint service-lock');
  assert.match(adminApiJs, /updateServiceLock[\s\S]*method:\s*'PUT'/, "updateServiceLock phải dùng method PUT");
  assert.match(opsJsx, /handleToggleServiceLock[\s\S]*\{ group, locked: nextLocked, title, message \}/, 'Phải gửi group/locked/title/message');
});

check('luồng bật khóa hỏi confirm() chỉ trong nhánh bật khóa và giữ catalog sau PUT', () => {
  assert.match(opsJsx, /if\s*\(\s*nextLocked\s*\)[\s\S]{0,180}window\.confirm\(/, 'confirm() chỉ được chạy khi nextLocked true');
  assert.match(opsJsx, /prev\?\.catalog/, 'Phải giữ catalog từ GET khi merge kết quả PUT');
});

check('route backend service-lock đã đăng ký GET/PUT', () => {
  assert.match(adminRoutes, /router\.get\('\/admin\/dashboard\/service-lock'/);
  assert.match(adminRoutes, /router\.put\('\/admin\/dashboard\/service-lock'/);
});

if (failed > 0) {
  console.log(`✗ Admin service-lock UI: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin service-lock UI: toàn bộ ca đạt.');
}
