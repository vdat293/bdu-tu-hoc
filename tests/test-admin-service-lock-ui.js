/**
 * Test UI công tắc khóa dịch vụ bảo trì trong site tĩnh /admin (Task 8).
 *
 * Thuần đọc file bằng fs.readFileSync + assert.match nên KHÔNG cần DB và chạy
 * trần được:
 *   node tests/test-admin-service-lock-ui.js
 *
 * Vì sao test tĩnh: /admin là HTML/JS thuần (không phải React), không có sẵn môi
 * trường DOM để render; Task 9 mới nghiệm thu tay trên trình duyệt. Ở đây chỉ
 * chốt các "hợp đồng" tối thiểu: markup đủ id, JS gọi đúng API và có confirm()
 * khi bật khóa, và route backend đã đăng ký.
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

check('markup /admin có đủ phần tử công tắc khóa dịch vụ', () => {
  for (const id of [
    'service-lock-toggle',
    'service-lock-title',
    'service-lock-message',
    'service-lock-state'
  ]) {
    assert.ok(indexHtml.includes(id), `Thiếu phần tử #${id} trong public/admin/index.html`);
  }
});

check('admin.js gọi đúng API service-lock bằng PUT', () => {
  assert.match(
    adminJs,
    /\/api\/admin\/dashboard\/service-lock/,
    'admin.js chưa gọi API /api/admin/dashboard/service-lock'
  );
  assert.match(adminJs, /method:\s*'PUT'/, "admin.js chưa dùng method: 'PUT'");
});

check('luồng bật khóa hỏi confirm() trước khi gửi', () => {
  const start = adminJs.indexOf('serviceLockToggle.addEventListener');
  assert.ok(start !== -1, 'admin.js thiếu listener cho #service-lock-toggle');
  // Lấy đoạn xử lý ngay sau listener để chắc confirm() nằm trong luồng công tắc
  // này chứ không phải nơi khác trong file.
  const flow = adminJs.slice(start, start + 2000);
  assert.match(flow, /confirm\(/, 'luồng công tắc khóa phải gọi confirm()');
  // confirm() chỉ được chạy khi chuyển sang trạng thái khóa; đọc biến boolean
  // (locked) làm điều kiện để tránh hỏi xác nhận cả khi mở khóa.
  assert.match(
    flow,
    /if\s*\(\s*\w*[Ll]ocked\w*\s*\)[\s\S]*confirm\(/,
    'confirm() phải nằm trong nhánh bật khóa'
  );
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
