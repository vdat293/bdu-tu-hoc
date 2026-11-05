-- Migration 072: lưu đầy đủ trạng thái lượt auto đăng ký để phục hồi sau
-- restart/tắt web, và lưu mật khẩu BDU đã mã hoá theo từng lượt chạy.
-- Mật khẩu KHÔNG nằm trong enrollment_runs; chỉ nằm trong bảng credential
-- riêng và bị xoá ngay khi lượt chạy kết thúc.
-- Idempotent: chạy lại toàn bộ file an toàn.

ALTER TABLE enrollment_runs
  ADD COLUMN IF NOT EXISTS results JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS restart_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS enrollment_run_credentials (
  run_id       UUID PRIMARY KEY REFERENCES enrollment_runs(id) ON DELETE CASCADE,
  mssv         VARCHAR(32) NOT NULL,
  enc_password TEXT NOT NULL,
  iv           TEXT NOT NULL,
  auth_tag     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enrollment_run_credentials_mssv_idx
  ON enrollment_run_credentials (mssv);
