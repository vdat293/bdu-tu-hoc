-- Migration 071: lưu log/kết quả lượt auto đăng ký để phục hồi sau khi F5
-- hoặc server restart.
-- enrollment_runs trước đây chỉ có summary; logs/error giúp trang Đăng ký dựng
-- lại đúng những gì đã xảy ra kể cả khi run không còn trong RAM.
-- Idempotent: chạy lại toàn bộ file an toàn.

ALTER TABLE enrollment_runs
  ADD COLUMN IF NOT EXISTS logs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error TEXT;
