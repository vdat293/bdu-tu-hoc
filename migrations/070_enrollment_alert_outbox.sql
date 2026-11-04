-- Migration 070: thêm type 'enrollment_alert' cho cảnh báo auto đăng ký môn học.
-- Danh sách type phải là superset mới nhất (xem 035/036/041) vì migrate.js chạy
-- lại toàn bộ file mỗi lần deploy.

ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_type_check CHECK (type IN (
    'schedule_reminder', 'exam_reminder',
    'daily_morning', 'daily_noon', 'sleep_reminder',
    'mention', 'reply', 'welcome', 'broadcast',
    'enrollment_alert'
  ));
