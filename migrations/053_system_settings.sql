-- Migration 053: Bảng cấu hình runtime cho Admin Dashboard.
-- Dùng cho các công tắc bật/tắt theo mùa (ví dụ ranking_sync) mà không cần
-- sửa .env hay restart server. Key là TEXT, value là JSONB tự do.
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
