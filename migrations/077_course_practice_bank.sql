-- Migration 077: Ngân hàng ôn tập trắc nghiệm độc lập theo môn (Claymorphism Practice Bank).
-- Tách biệt hoàn toàn với hệ thống Bộ đề trắc nghiệm (course_quiz_sets / course_quiz_progress).
-- Idempotent: có thể chạy lại an toàn mà không làm mất dữ liệu hay lỗi constraint.

CREATE TABLE IF NOT EXISTS course_practice_banks (
  id BIGSERIAL PRIMARY KEY,
  course_code VARCHAR(64) NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description TEXT NOT NULL DEFAULT '',
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(chapters) = 'array'),
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_practice_questions (
  id BIGSERIAL PRIMARY KEY,
  bank_id BIGINT NOT NULL REFERENCES course_practice_banks(id) ON DELETE CASCADE,
  external_id INTEGER NOT NULL CHECK (external_id > 0),
  chapter_index SMALLINT NOT NULL CHECK (chapter_index >= 1),
  chapter_title TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  correct_answer VARCHAR(4) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  explanation TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_id, external_id)
);

CREATE INDEX IF NOT EXISTS course_practice_questions_bank_chapter_idx
  ON course_practice_questions (bank_id, chapter_index, external_id);

CREATE TABLE IF NOT EXISTS course_practice_progress (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  bank_id BIGINT NOT NULL REFERENCES course_practice_banks(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES course_practice_questions(id) ON DELETE CASCADE,
  selected_answer VARCHAR(4) CHECK (selected_answer IS NULL OR selected_answer IN ('A', 'B', 'C', 'D')),
  is_correct BOOLEAN,
  is_bookmarked BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  last_answered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, question_id)
);

CREATE INDEX IF NOT EXISTS course_practice_progress_mssv_bank_idx
  ON course_practice_progress (mssv, bank_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS course_practice_exam_attempts (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  bank_id BIGINT NOT NULL REFERENCES course_practice_banks(id) ON DELETE CASCADE,
  mode VARCHAR(32) NOT NULL DEFAULT 'mock_exam',
  chapter_index SMALLINT,
  total_questions SMALLINT NOT NULL CHECK (total_questions > 0),
  correct_count SMALLINT NOT NULL CHECK (correct_count >= 0 AND correct_count <= total_questions),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS course_practice_exam_attempts_mssv_idx
  ON course_practice_exam_attempts (mssv, bank_id, created_at DESC);
