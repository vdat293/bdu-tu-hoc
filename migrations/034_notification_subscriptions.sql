-- Migration 034: Opt-in nhận nhắc lịch học qua Email/Discord.
--
-- Ràng buộc: mặc định TẮT. Chỉ khi user bấm bật + xác nhận (xac_nhan=true)
-- mới được snapshot lịch + lưu vault token. Mỗi lần đăng nhập sau đó
-- tự refresh snapshot + rotate token nếu consent còn hiệu lực.

CREATE TABLE IF NOT EXISTS student_notification_prefs (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  notify_discord BOOLEAN NOT NULL DEFAULT FALSE,
  email VARCHAR(255),
  email_verified_at TIMESTAMPTZ,
  discord_user_id VARCHAR(32),
  discord_verified_at TIMESTAMPTZ,
  -- VD: '{30,60}' = nhắc trước 30p và 60p. '{15,30,60,720}' thêm tối hôm trước.
  remind_offsets INT[] NOT NULL DEFAULT '{30,60}',
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  consent_at TIMESTAMPTZ,
  consent_version INT NOT NULL DEFAULT 1,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vault token BDU mã hóa (AES-256-GCM ở application layer).
-- Không bao giờ log giá trị này. Revoke khi user tắt hoặc gặp 401.
CREATE TABLE IF NOT EXISTS bdu_token_vault (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  enc_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot lịch học tại thời điểm user online (login / mở /schedule).
-- Cron nhắc lịch chỉ đọc bảng này, không gọi BDU trực tiếp mỗi lần nhắc.
CREATE TABLE IF NOT EXISTS schedule_snapshots (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  hoc_ky INT,
  occurrence_key TEXT NOT NULL,
  course_code VARCHAR(32),
  course_name TEXT,
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  room TEXT,
  lecturer TEXT,
  week_number INT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, occurrence_key)
);
CREATE INDEX IF NOT EXISTS schedule_snapshots_mssv_date_idx
  ON schedule_snapshots (mssv, date, start_time);

-- Hàng đợi gửi, dedupe 1 buổi học chỉ nhắc 1 lần / 1 kênh / 1 mốc.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mssv VARCHAR(32) NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'discord')),
  type TEXT NOT NULL DEFAULT 'schedule_reminder' CHECK (type IN ('schedule_reminder', 'exam_reminder')),
  occurrence_key TEXT NOT NULL,
  remind_offset INT NOT NULL DEFAULT 30,
  scheduled_for TIMESTAMPTZ NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_dedupe_idx
  ON notification_outbox (mssv, channel, occurrence_key, remind_offset);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox (status, scheduled_for) WHERE status = 'pending';

-- Mã link Discord 6 số, hết hạn 10 phút.
CREATE TABLE IF NOT EXISTS discord_link_codes (
  code VARCHAR(12) PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Token verify email, hết hạn 24h.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token TEXT PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
