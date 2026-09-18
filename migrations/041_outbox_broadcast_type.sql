-- Migration 041: thêm type 'broadcast' cho thông báo cập nhật website gửi qua Discord DM.
-- LƯU Ý: migrate.js chạy lại toàn bộ file mỗi lần deploy, nên 035 (superset cũ)
-- chạy trước rồi file này chạy sau để khôi phục danh sách đầy đủ.
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_type_check CHECK (type IN (
    'schedule_reminder', 'exam_reminder',
    'daily_morning', 'daily_noon', 'sleep_reminder',
    'mention', 'reply', 'welcome', 'broadcast'
  ));
