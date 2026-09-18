-- Migration 035: mở rộng outbox cho nhắc lịch hằng ngày + push tag.
-- LƯU Ý: migrate.js chạy lại TOÀN BỘ file mỗi lần deploy, nên danh sách type
-- ở đây phải luôn là superset mới nhất (kẻo rớt khi đã có row type mới hơn).
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_type_check CHECK (type IN (
    'schedule_reminder', 'exam_reminder',
    'daily_morning', 'daily_noon', 'sleep_reminder',
    'mention', 'reply', 'welcome'
  ));
