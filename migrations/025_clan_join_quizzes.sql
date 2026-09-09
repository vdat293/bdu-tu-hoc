-- Migration 025: Quiz xác minh trước khi gia nhập CLB.
-- correct_index/explanation chỉ được dùng nội bộ khi chấm; API GET không chọn các cột này.

CREATE TABLE IF NOT EXISTS clan_quizzes (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL UNIQUE REFERENCES clans(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_correct INTEGER NOT NULL DEFAULT 0 CHECK (min_correct >= 0),
  updated_by_mssv VARCHAR(32) REFERENCES students(mssv) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clan_quiz_questions (
  id BIGSERIAL PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES clan_quizzes(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL CHECK (question_order > 0),
  prompt TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
  explanation TEXT,
  UNIQUE (quiz_id, question_order)
);

CREATE TABLE IF NOT EXISTS clan_quiz_submissions (
  id BIGSERIAL PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES clan_quizzes(id) ON DELETE CASCADE,
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  join_request_id BIGINT NOT NULL UNIQUE REFERENCES clan_join_requests(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0),
  total INTEGER NOT NULL CHECK (total > 0),
  passed BOOLEAN NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clan_quiz_submission_answers (
  submission_id BIGINT NOT NULL REFERENCES clan_quiz_submissions(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES clan_quiz_questions(id) ON DELETE CASCADE,
  selected_index INTEGER NOT NULL CHECK (selected_index >= 0),
  is_correct BOOLEAN NOT NULL,
  PRIMARY KEY (submission_id, question_id)
);

CREATE INDEX IF NOT EXISTS clan_quiz_submissions_leader_idx
  ON clan_quiz_submissions (clan_id, submitted_at DESC);
