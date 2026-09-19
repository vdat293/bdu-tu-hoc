-- Migration 036: Discord OAuth2 1-click (cho người không rành công nghệ).
-- Không cần gõ mã 6 số hay slash command: bấm Kết nối → Authorize → xong.

-- State chống CSRF khi đổi code lấy discord user id. Hết hạn 10 phút.
CREATE TABLE IF NOT EXISTS discord_oauth_states (
  state TEXT PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_notification_prefs
  ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Tin chào sau khi link thành công (bot DM 1 lần để user biết kênh sống).
-- Danh sách type phải là superset mới nhất: migration chạy lại mỗi lần deploy.
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_type_check CHECK (type IN (
    'schedule_reminder', 'exam_reminder',
    'daily_morning', 'daily_noon', 'sleep_reminder',
    'mention', 'reply', 'welcome', 'broadcast'
  ));
