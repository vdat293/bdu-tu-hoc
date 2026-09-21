-- Migration 047: richer API trace for admin logs (matched route pattern + sanitized query)
ALTER TABLE traffic_logs ADD COLUMN IF NOT EXISTS route VARCHAR(255);
ALTER TABLE traffic_logs ADD COLUMN IF NOT EXISTS query_json TEXT;

CREATE INDEX IF NOT EXISTS idx_traffic_logs_route ON traffic_logs (route);
CREATE INDEX IF NOT EXISTS idx_traffic_logs_mssv_created ON traffic_logs (mssv, created_at DESC) WHERE mssv IS NOT NULL;
