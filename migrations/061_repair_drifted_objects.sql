-- Migration 061: Repair objects lost to migration drift, and drop redundant indexes.
--
-- Three tables created by already-applied migrations are missing from the
-- database (the ledger says they ran, the objects did not survive), and one
-- table that migration 057 was supposed to drop is still present. Also drop
-- the two redundant plain (non-unique) indexes whose UNIQUE counterparts
-- already cover their columns.
--
-- Idempotent: every statement is conditional, because migrate.js replays
-- this file on every start.

CREATE TABLE IF NOT EXISTS media_cleanup_queue (
  id BIGSERIAL PRIMARY KEY,
  object_key TEXT NOT NULL,
  delete_after TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT 'post_deleted',
  source_type TEXT,
  source_id BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS media_cleanup_queue_object_key_idx
  ON media_cleanup_queue (object_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS media_cleanup_queue_due_idx
  ON media_cleanup_queue (delete_after)
  WHERE deleted_at IS NULL;

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

DROP TABLE IF EXISTS training_cds_credentials;
DROP TABLE IF EXISTS email_verification_tokens;

DROP INDEX IF EXISTS clans_code_idx;
DROP INDEX IF EXISTS community_polls_post_id_idx;
