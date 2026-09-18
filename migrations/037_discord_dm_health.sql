-- Migration 037: theo dõi DM Discord bị chặn (vd: không chung server).
-- Khi bot gửi rớt với lỗi 50007/no-mutual-guilds, poller đánh dấu để web
-- hiện hướng dẫn mở kênh (DM bot 1 lần / vào server) thay vì im lặng.
ALTER TABLE student_notification_prefs
  ADD COLUMN IF NOT EXISTS discord_dm_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discord_dm_error TEXT;
