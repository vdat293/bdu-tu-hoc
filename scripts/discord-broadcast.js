/**
 * Enqueue thông báo broadcast (cập nhật website) vào notification_outbox.
 * Bot Discord (scripts/discord-bot.js) sẽ DM cho mọi user đã liên kết Discord,
 * đang bật nhận thông báo và chưa huỷ đăng ký.
 *
 * Chạy: node scripts/discord-broadcast.js "<nội dung>" [occurrence-key]
 *  - occurrence-key mặc định: broadcast-<YYYY-MM-DD> (chống gửi trùng trong ngày)
 */
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';

const DEFAULT_TEXT = [
  '🎉 Website BDU Tự Học vừa có bản cập nhật mới: Luyện từ vựng!',
  '',
  '• 15 bộ đề lớn (TOEIC, IELTS, Destination, 2800-3000 từ thông dụng...) — hơn 25.900 từ vựng',
  '• 4 chế độ học: Flashcard, Quiz (Từ→Nghĩa / Ngữ cảnh / Nghĩa→Từ), Typing, Ghép cặp',
  '• Theo dõi tiến độ theo từng bộ từ và từng theme',
  '• Mở tại mục "Luyện từ vựng" trên website',
  '',
  'Chúc bạn học tốt! 📚'
].join('\n');

const text = (process.argv[2] || DEFAULT_TEXT).slice(0, 3500);
const occurrenceKey = process.argv[3] || `broadcast-${new Date().toISOString().slice(0, 10)}`;

if (!isDatabaseConfigured()) {
  console.error('Thiếu DATABASE_URL.');
  process.exit(1);
}

const preview = await query(`
  SELECT COUNT(*)::int AS total
  FROM student_notification_prefs p
  WHERE p.discord_user_id IS NOT NULL AND p.notify_discord = TRUE AND p.unsubscribed_at IS NULL
`);
console.log(`Người nhận hợp lệ: ${preview.rows[0].total}`);

const result = await query(`
  INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
  SELECT p.mssv, 'discord', 'broadcast', $1, 0, NOW(), jsonb_build_object('text', $2::text), 'pending'
  FROM student_notification_prefs p
  WHERE p.discord_user_id IS NOT NULL AND p.notify_discord = TRUE AND p.unsubscribed_at IS NULL
  ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING
`, [occurrenceKey, text]);

console.log(`✓ Đã xếp hàng ${result.rowCount} tin nhắn (key: ${occurrenceKey}). Bot sẽ gửi trong ~20 giây.`);
console.log('--- Nội dung ---');
console.log(text);
await closeDatabase();
