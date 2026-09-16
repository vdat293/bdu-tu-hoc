-- Migration 028: Traffic logs and analytics for Admin Dashboard
CREATE TABLE IF NOT EXISTS traffic_logs (
  id BIGSERIAL PRIMARY KEY,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code INT NOT NULL,
  response_time_ms NUMERIC(10, 2) NOT NULL DEFAULT 0,
  mssv VARCHAR(32),
  full_name VARCHAR(255),
  ip_address VARCHAR(64),
  user_agent TEXT,
  device_type VARCHAR(32) DEFAULT 'desktop',
  os VARCHAR(64) DEFAULT 'Unknown',
  browser VARCHAR(64) DEFAULT 'Unknown',
  referrer TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_logs_created_at ON traffic_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_logs_mssv ON traffic_logs (mssv) WHERE mssv IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffic_logs_status_code ON traffic_logs (status_code);
CREATE INDEX IF NOT EXISTS idx_traffic_logs_path ON traffic_logs (path);
CREATE INDEX IF NOT EXISTS idx_traffic_logs_ip ON traffic_logs (ip_address) WHERE ip_address IS NOT NULL;
