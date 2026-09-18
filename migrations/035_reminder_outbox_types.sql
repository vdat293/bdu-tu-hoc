-- Migration 035: mở rộng outbox cho nhắc lịch hằng ngày + push tag.
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_type_check CHECK (type IN (
    'schedule_reminder', 'exam_reminder',
    'daily_morning', 'daily_noon', 'sleep_reminder',
    'mention', 'reply'
  ));
