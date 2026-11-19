INSERT INTO course_guide_configs (course_code, lesson_id, title, enabled, progress_version)
VALUES ('INF1003', 'bai-2', 'Bài 2 — Triển khai ứng dụng bằng key', TRUE, 'thi-gk-v1')
ON CONFLICT (course_code, lesson_id) DO NOTHING;

CREATE TABLE inf1003_deploy_keys (
  mssv TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  bucket TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE inf1003_deploy_jobs (
  id UUID PRIMARY KEY,
  mssv TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  bucket TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  app_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleanup_after TIMESTAMPTZ,
  cleanup_retry_at TIMESTAMPTZ,
  cleaned_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX inf1003_deploy_one_active_job_per_student
  ON inf1003_deploy_jobs (mssv) WHERE cleaned_at IS NULL;
CREATE INDEX inf1003_deploy_active_jobs
  ON inf1003_deploy_jobs (status, created_at) WHERE cleaned_at IS NULL;
CREATE INDEX inf1003_deploy_latest_student_job
  ON inf1003_deploy_jobs (mssv, created_at DESC);

CREATE TABLE inf1003_deploy_worker (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  installation_id UUID NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL
);
