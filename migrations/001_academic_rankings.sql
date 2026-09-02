CREATE TABLE IF NOT EXISTS academic_ranking_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduler', 'manual')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  target_nkhk INTEGER,
  current_activity_nkhk INTEGER,
  activity_terms INTEGER[] NOT NULL DEFAULT '{}',
  cohorts INTEGER[] NOT NULL DEFAULT '{}',
  student_count INTEGER NOT NULL DEFAULT 0,
  excluded_no_recent_activity_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS academic_rankings (
  sync_run_id BIGINT NOT NULL REFERENCES academic_ranking_sync_runs(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL,
  full_name TEXT,
  class_code TEXT,
  faculty_code TEXT,
  institute_code TEXT,
  cohort INTEGER,
  presence_status TEXT,
  semester_code INTEGER,
  semester_gpa_4 NUMERIC(5, 2),
  cumulative_gpa_4 NUMERIC(5, 2),
  cumulative_classification TEXT,
  semester_classification TEXT,
  semester_earned_credits NUMERIC(8, 2),
  cumulative_earned_credits NUMERIC(8, 2),
  cumulative_credit_source TEXT,
  rankings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sync_run_id, mssv)
);

CREATE INDEX IF NOT EXISTS academic_rankings_mssv_run_idx
  ON academic_rankings (mssv, sync_run_id DESC);

CREATE INDEX IF NOT EXISTS academic_ranking_sync_runs_success_idx
  ON academic_ranking_sync_runs (completed_at DESC)
  WHERE status = 'succeeded';
