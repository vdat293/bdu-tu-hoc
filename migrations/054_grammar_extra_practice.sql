-- Supplemental grammar practice stays independent from the original lesson set.
-- migrate.js replays migration files, so every statement must be idempotent.

CREATE TABLE IF NOT EXISTS grammar_extra_exercises (
  id UUID PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  type VARCHAR(24) NOT NULL DEFAULT 'multiple_choice',
  question TEXT NOT NULL DEFAULT '',
  option_a TEXT NOT NULL DEFAULT '',
  option_b TEXT NOT NULL DEFAULT '',
  option_c TEXT NOT NULL DEFAULT '',
  option_d TEXT NOT NULL DEFAULT '',
  correct_answer TEXT NOT NULL DEFAULT '',
  correct_option CHAR(1) NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS grammar_extra_exercises_lesson_idx
  ON grammar_extra_exercises (lesson_id, order_idx, id);

CREATE TABLE IF NOT EXISTS grammar_extra_progress (
  mssv VARCHAR(32) NOT NULL,
  lesson_id UUID NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  answered SMALLINT NOT NULL DEFAULT 0,
  correct_count SMALLINT NOT NULL DEFAULT 0,
  total_count SMALLINT NOT NULL DEFAULT 0,
  best_correct SMALLINT,
  best_total SMALLINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, lesson_id)
);

ALTER TABLE grammar_extra_progress
  ADD COLUMN IF NOT EXISTS responses JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS grammar_extra_progress_mssv_idx
  ON grammar_extra_progress (mssv, updated_at DESC);
