-- Migration 076: User interaction events for Admin Product Analytics & Live Presence
CREATE TABLE IF NOT EXISTS user_interaction_events (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  client_id VARCHAR(64),
  mssv VARCHAR(32),
  full_name VARCHAR(255),
  event_type VARCHAR(32) NOT NULL,
  event_name VARCHAR(120) NOT NULL,
  feature_id VARCHAR(40) NOT NULL DEFAULT 'other',
  page_path VARCHAR(500) NOT NULL,
  page_title VARCHAR(200),
  target_label VARCHAR(200),
  target_id VARCHAR(120),
  target_tag VARCHAR(32),
  duration_ms INT,
  metadata_json JSONB,
  device_type VARCHAR(32) DEFAULT 'desktop',
  os VARCHAR(64) DEFAULT 'Unknown',
  browser VARCHAR(64) DEFAULT 'Unknown',
  viewport VARCHAR(32),
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uie_created_at
  ON user_interaction_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_uie_mssv_created
  ON user_interaction_events (mssv, created_at DESC)
  WHERE mssv IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uie_session_created
  ON user_interaction_events (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_uie_feature_created
  ON user_interaction_events (feature_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_uie_type_created
  ON user_interaction_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_uie_page_path
  ON user_interaction_events (page_path);
