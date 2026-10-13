/**
 * Test UI danh sách công tắc khóa dịch vụ theo nhóm trong site tĩnh /admin
 * (Task 10 của kế hoạch khoa-dich-vu-theo-nhom).
 *
 * Thuần đọc file bằng fs.readFileSync + assert.match nên KHÔNG cần DB và chạy
 * trần được:
 *   node tests/test-admin-service-lock-ui.js
 * Nhớ chạy kèm env managed:
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
 *
 * Vì sao test tĩnh: /admin là HTML/JS thuần (không phải React), không có sẵn môi
 * trường DOM để render; nghiệm thu tay trên trình duyệt ở Task 11. Ở đây chỉ
 * chốt các "hợp đồng" tối thiểu: markup có vùng danh sách theo nhóm, JS gọi đúng
 * API PUT kèm group, có confirm() khi BẬT khóa, và route backend đã đăng ký.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const adminRoutes = fs.readFileSync(new URL('../src/routes/admin.routes.js', import.meta.url), 'utf8');

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

check('markup /admin có vùng danh sách công tắc khóa theo nhóm', () => {
  assert.ok(
    indexHtml.includes('id="service-lock-list"'),
    'Thiếu vùng #service-lock-list trong public/admin/index.html'
  );
});

check('admin.js gọi đúng API service-lock bằng PUT và gửi group', () => {
  assert.match(
    adminJs,
    /\/api\/admin\/dashboard\/service-lock/,
    'admin.js chưa gọi API /api/admin/dashboard/service-lock'
  );
  assert.match(adminJs, /method:\s*'PUT'/, "admin.js chưa dùng method: 'PUT'");
  assert.match(
    adminJs,
    /body:\s*JSON\.stringify\(\{[^}]*\bgroup\b/,
    'PUT service-lock phải gửi group trong body { group, locked, title, message }'
  );
});

check('luồng bật khóa theo nhóm hỏi confirm() trước khi gửi', () => {
  const start = adminJs.indexOf('function renderServiceLock');
  assert.ok(start !== -1, 'admin.js thiếu hàm renderServiceLock(data) dựng danh sách theo nhóm');
  // Lấy đoạn dựng danh sách + handler ngay sau hàm để chắc confirm() nằm trong
  // luồng công tắc theo nhóm chứ không phải nơi khác trong file.
  const flow = adminJs.slice(start, start + 12000);
  assert.match(flow, /confirm\(/, 'luồng công tắc khóa theo nhóm phải gọi confirm()');
  // confirm() chỉ được chạy khi chuyển sang trạng thái khóa; đọc biến boolean
  // (locked) làm điều kiện để tránh hỏi xác nhận cả khi mở khóa.
  assert.match(
    flow,
    /if\s*\(\s*locked\s*\)[\s\S]*confirm\(/,
    'confirm() phải nằm trong nhánh bật khóa (if (locked))'
  );
});

check('route backend service-lock đã đăng ký GET/PUT', () => {
  assert.match(adminRoutes, /router\.get\('\/admin\/dashboard\/service-lock'/);
  assert.match(adminRoutes, /router\.put\('\/admin\/dashboard\/service-lock'/);
});

check('renderServiceLock vẽ ngay sau PUT thiếu catalog (mượn catalog từ GET)', () => {
  // PUT chỉ trả { groups, updated_at, updated_by }; nếu render đòi catalog là
  // mảng cứng thì return sớm và dòng + tóm tắt đứng yên tới auto-refresh (~15s).
  const start = adminJs.indexOf('function renderServiceLock');
  assert.ok(start !== -1, 'admin.js thiếu hàm renderServiceLock(data)');
  const flow = adminJs.slice(start, start + 3000);
  assert.match(
    flow,
    /state\.serviceLock\?\.\bcatalog\b|state\.serviceLock\s*&&[\s\S]{0,120}\bcatalog\b/,
    'renderServiceLock phải mượn state.serviceLock.catalog khi data.catalog không phải mảng'
  );
});

if (failed > 0) {
  console.log(`✗ Admin service-lock UI theo nhóm: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin service-lock UI theo nhóm: toàn bộ ca đạt.');
}
