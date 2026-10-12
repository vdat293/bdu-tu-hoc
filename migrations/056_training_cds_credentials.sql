-- Mật khẩu app BDU Student (CDS) để đồng bộ tiêu chí 6.16 / danh sách sự kiện.
-- Mã hóa AES-256-GCM ở application layer (dùng chung NOTIFICATION_ENCRYPTION_KEY).
-- Không bao giờ trả mật khẩu về client; chỉ xóa khi người dùng bấm "Xoá đồng bộ".
CREATE TABLE IF NOT EXISTS training_cds_credentials (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  enc_password TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
