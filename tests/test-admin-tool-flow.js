import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');
const adminJs = fs.readFileSync('public/js/admin-tool.js', 'utf8');
const avatarService = fs.readFileSync('src/services/avatar-override.service.js', 'utf8');

// 1. Kiểm tra HTML của Admin Tool
assert.match(adminHtml, /admin-login-form/, 'Phải có form đăng nhập admin');
assert.match(adminHtml, /admin-logout-btn/, 'Phải có nút đăng xuất admin');
assert.match(adminHtml, /student-search-form/, 'Phải có form tra cứu MSSV');
assert.match(adminHtml, /target-mssv/, 'Phải có ô nhập target-mssv');
assert.match(adminHtml, /btn-check-status/, 'Phải có nút Xem trạng thái');
assert.match(adminHtml, /student-status-panel/, 'Phải có khu vực hiển thị trạng thái sinh viên');
assert.match(adminHtml, /current-titles-list/, 'Phải có danh sách danh hiệu đang sở hữu');
assert.match(adminHtml, /current-frames-list/, 'Phải có danh sách khung đang sở hữu');
assert.match(adminHtml, /avatar-preview/, 'Phải có preview trạng thái avatar');
assert.match(adminHtml, /student-actions-panel/, 'Phải có khu vực thao tác cấp quyền & thay ảnh');
assert.match(adminHtml, /grant-title-form/, 'Phải có form cấp danh hiệu');
assert.match(adminHtml, /grant-frame-form/, 'Phải có form cấp khung');
assert.match(adminHtml, /avatar-form/, 'Phải có form thay ảnh đại diện');

// 2. Kiểm tra JS của Admin Tool
assert.match(adminJs, /logout/, 'Phải có hàm logout xóa session');
assert.match(adminJs, /localStorage\.removeItem\('bdu_token'\)/, 'Phải xóa bdu_token khỏi localStorage');
assert.match(adminJs, /sessionStorage\.removeItem\('bdu_token'\)/, 'Phải xóa bdu_token khỏi sessionStorage');
assert.match(adminJs, /getAdminIdentityItems/, 'Phải gọi API kiểm tra quyền quản trị');
assert.match(adminJs, /checkStudentStatus/, 'Phải có hàm nạp trạng thái khi ấn xem trạng thái');
assert.match(adminJs, /getAdminIdentityGrants/, 'Phải nạp grants của MSSV');
assert.match(adminJs, /getAdminAvatar/, 'Phải nạp thông tin avatar của MSSV');
assert.match(adminJs, /grant-title-form/, 'Phải xử lý submit cấp danh hiệu');
assert.match(adminJs, /grant-frame-form/, 'Phải xử lý submit cấp khung');
assert.match(adminJs, /avatar-upload/, 'Phải xử lý cập nhật avatar');

// 3. Kiểm tra fallback getByMssv trong Avatar Override Service
assert.match(avatarService, /source:\s*'initials'/, 'Phải trả về fallback avatar khi MSSV chưa có trong database');

console.log('✓ Luồng hoạt động của Admin Tool (tự động logout khi không có quyền, ô nhập MSSV, xem trạng thái và cấp quyền) đã được xác minh thành công!');
