import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BroadcastService, buildBroadcastKey, normalizeBroadcastText, BROADCAST_MAX_TEXT } from '../src/services/broadcast.service.js';

console.log('🧪 Kiểm tra broadcast thông báo cập nhật...');

// 1. Chuẩn hóa nội dung: rỗng -> lỗi, cắt khoảng trắng, chặn quá dài
assert.throws(() => normalizeBroadcastText(''), /không được để trống/);
assert.throws(() => normalizeBroadcastText('   \n  '), /không được để trống/);
assert.throws(() => normalizeBroadcastText('x'.repeat(BROADCAST_MAX_TEXT + 1)), /tối đa/);
assert.equal(normalizeBroadcastText('  Xin chào\r\nBản cập nhật  '), 'Xin chào\nBản cập nhật');
assert.equal(normalizeBroadcastText('x'.repeat(BROADCAST_MAX_TEXT)).length, BROADCAST_MAX_TEXT);

// 2. Khoá chống trùng: làm sạch ký tự lạ, mặc định theo ISO timestamp
assert.equal(buildBroadcastKey('broadcast 2026/09/19 #1'), 'broadcast-2026-09-19--1');
assert.match(buildBroadcastKey(''), /^broadcast-\d{4}-\d{2}-\d{2}T/);
assert.ok(buildBroadcastKey('x'.repeat(200)).length <= 80);

// 3. Migration: type 'broadcast' phải nằm trong superset của mọi file ràng buộc
for (const file of ['035_reminder_outbox_types.sql', '036_discord_oauth.sql', '041_outbox_broadcast_type.sql']) {
  const sql = fs.readFileSync(`migrations/${file}`, 'utf8');
  assert.match(sql, /'broadcast'/, `${file} thiếu type broadcast trong superset`);
}

// 4. Service dùng chung cho CLI + API, không seed dữ liệu trong migration
const service = fs.readFileSync('src/services/broadcast.service.js', 'utf8');
assert.match(service, /notification_outbox/, 'Service phải ghi vào notification_outbox');
assert.match(service, /ON CONFLICT \(mssv, channel, occurrence_key, remind_offset\) DO NOTHING/, 'Thiếu chống gửi trùng');
assert.match(service, /notify_discord = TRUE AND p\.unsubscribed_at IS NULL/, 'Thiếu điều kiện người nhận opt-in');

// 5. API + route có kiểm tra quyền identity admin
const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
assert.match(routes, /router\.get\('\/admin\/broadcast', ApiController\.requireIdentityAdmin/, 'Thiếu route GET /admin/broadcast có kiểm quyền');
assert.match(routes, /router\.post\('\/admin\/broadcast', ApiController\.requireIdentityAdmin/, 'Thiếu route POST /admin/broadcast có kiểm quyền');
const controller = fs.readFileSync('src/controllers/api.controller.js', 'utf8');
assert.match(controller, /async getAdminBroadcast\(/, 'Thiếu controller getAdminBroadcast');
assert.match(controller, /async sendAdminBroadcast\(/, 'Thiếu controller sendAdminBroadcast');

// 6. Admin Tool: form gửi thông báo + gọi API
const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');
assert.match(adminHtml, /id="broadcast-form"/, 'Admin Tool thiếu form broadcast');
assert.match(adminHtml, /id="broadcast-text"/, 'Admin Tool thiếu ô nhập nội dung');
assert.match(adminHtml, /id="broadcast-recipients"/, 'Admin Tool thiếu số người nhận');
assert.match(adminHtml, /id="broadcast-history"/, 'Admin Tool thiếu lịch sử gửi');
const adminJs = fs.readFileSync('public/js/admin-tool.js', 'utf8');
assert.match(adminJs, /getAdminBroadcast/, 'Admin Tool phải nạp thông tin broadcast');
assert.match(adminJs, /sendAdminBroadcast/, 'Admin Tool phải gọi API gửi broadcast');
assert.match(adminJs, /BROADCAST_TEMPLATE/, 'Admin Tool thiếu mẫu thông báo cập nhật');
const apiJs = fs.readFileSync('public/js/api.js', 'utf8');
assert.match(apiJs, /async getAdminBroadcast\(/, 'api.js thiếu getAdminBroadcast');
assert.match(apiJs, /async sendAdminBroadcast\(/, 'api.js thiếu sendAdminBroadcast');

// 7. CLI dùng service dùng chung và cập nhật mẫu tin mới
const cli = fs.readFileSync('scripts/discord-broadcast.js', 'utf8');
assert.match(cli, /BroadcastService/, 'CLI phải dùng BroadcastService');
assert.match(cli, /Luyện ngữ pháp/, 'Mẫu tin phải nhắc bản cập nhật luyện ngữ pháp');

// 8. getRecipients không ném lỗi khi chưa cấu hình DB (trả 0)
const originalUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
const recipients = await BroadcastService.getRecipients();
assert.deepEqual(recipients, { discord: 0 });
if (originalUrl) process.env.DATABASE_URL = originalUrl;

console.log('✅ Broadcast Discord + Admin Tool OK (chống trùng, phân quyền, mẫu tin cập nhật)');
