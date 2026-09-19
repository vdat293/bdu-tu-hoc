/**
 * Enqueue thông báo broadcast (cập nhật website) vào notification_outbox.
 * Bot Discord (scripts/discord-bot.js) sẽ DM cho mọi user đã liên kết Discord,
 * đang bật nhận thông báo và chưa huỷ đăng ký.
 *
 * Chạy: node scripts/discord-broadcast.js "<nội dung>" [occurrence-key]
 *  - Bỏ trống nội dung để dùng mẫu cập nhật mặc định bên dưới.
 *  - occurrence-key mặc định: broadcast-<ISO timestamp> (mỗi lần chạy là một đợt).
 *
 * Trên VPS: docker compose exec -T bdu-hub node scripts/discord-broadcast.js
 */
import { closeDatabase, isDatabaseConfigured } from '../src/db/database.js';
import { BroadcastService, BROADCAST_MAX_TEXT } from '../src/services/broadcast.service.js';

const DEFAULT_TEXT = [
  '🎉 Website BDU Tự Học vừa có bản cập nhật mới!',
  '',
  '📘 Luyện ngữ pháp: 8 lộ trình (Ngữ pháp cơ bản, Grammar In Use, TOEIC cơ bản/500–700/700+, Destination B1/B2/C1&C2) — 246 bài học, hơn 10.400 câu hỏi kèm lý thuyết, đáp án và giải thích; có cả bài đọc hiểu TOEIC.',
  '🔁 Ôn tập từ vựng theo lịch: đánh dấu đã thuộc rồi ôn lại sau 1 ngày → 7 ngày → 30 ngày, kèm độ chính xác từng bộ từ.',
  '🎨 Giao diện mục Luyện từ vựng & Luyện ngữ pháp gọn gàng, dễ nhìn hơn.',
  '',
  'Mở mục "Luyện ngữ pháp" và "Luyện từ vựng" trên website nhé. Chúc bạn học tốt! 📚'
].join('\n');

const text = (process.argv[2] || DEFAULT_TEXT).slice(0, BROADCAST_MAX_TEXT);
const key = process.argv[3] || null;

if (!isDatabaseConfigured()) {
  console.error('Thiếu DATABASE_URL.');
  process.exit(1);
}

try {
  const recipients = await BroadcastService.getRecipients();
  console.log(`Người nhận hợp lệ: ${recipients.discord}`);

  const result = await BroadcastService.enqueue({ text, key, actor: 'cli' });
  console.log(`✓ Đã xếp hàng ${result.enqueued} tin nhắn (key: ${result.occurrence_key}). Bot sẽ gửi trong ~20 giây.`);
  console.log('--- Nội dung ---');
  console.log(text);
} catch (error) {
  console.error('Broadcast thất bại:', error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
