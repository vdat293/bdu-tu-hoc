-- Migration 066: Registry + tiến độ hướng dẫn học tập theo từng bước trong Không gian môn học.
-- Không FK cứng tới courses để tránh phụ thuộc sync bảng điểm.
-- Idempotent: runner có thể chạy lại toàn bộ file mà không lỗi.

CREATE TABLE IF NOT EXISTS course_guide_configs (
  course_code VARCHAR(64) NOT NULL,
  lesson_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  progress_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_code, lesson_id)
);

CREATE TABLE IF NOT EXISTS guide_step_progress (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  course_code VARCHAR(64) NOT NULL,
  lesson_id VARCHAR(64) NOT NULL,
  step_id VARCHAR(64) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  workdir TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, course_code, lesson_id, step_id)
);

CREATE INDEX IF NOT EXISTS guide_step_progress_mssv_idx
  ON guide_step_progress (mssv, updated_at DESC);

INSERT INTO course_guide_configs (course_code, lesson_id, title, enabled, progress_version)
VALUES ('INF1003', 'bai-1', 'Bài 1', TRUE, 'cmd-be-first-v4')
ON CONFLICT DO NOTHING;
