-- Migration 069: Auto đăng ký môn học BDU.
-- enrollment_priorities: danh sách môn/nhóm-tổ ưu tiên của từng sinh viên.
-- enrollment_runs: lịch sử các lượt auto-run (audit, không chứa token).
-- Idempotent: chạy lại toàn bộ file an toàn; không FK cứng ngoài students(mssv).

CREATE TABLE IF NOT EXISTS enrollment_priorities (
  mssv        VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  ma_mon      VARCHAR(32) NOT NULL,
  ten_mon     TEXT        NOT NULL DEFAULT '',
  so_tc       NUMERIC(4,1),
  id_to_hoc   VARCHAR(40) NOT NULL,
  nhom_to     VARCHAR(16),
  lop         TEXT,
  thu_tu      INTEGER     NOT NULL,
  loai        TEXT        NOT NULL DEFAULT 'chinh'
              CHECK (loai IN ('chinh','du_phong')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, id_to_hoc)
);

CREATE INDEX IF NOT EXISTS enrollment_priorities_mssv_idx
  ON enrollment_priorities (mssv, thu_tu);

CREATE TABLE IF NOT EXISTS enrollment_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mssv         VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('scheduled','running','done','failed','stopped')),
  trigger_at   TIMESTAMPTZ,
  snapshot     JSONB NOT NULL,
  summary      JSONB,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enrollment_runs_mssv_idx
  ON enrollment_runs (mssv, created_at DESC);
