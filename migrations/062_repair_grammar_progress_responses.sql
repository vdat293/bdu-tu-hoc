-- Migration 062: Repair the drifted object from migration 055 that 061 missed —
-- `grammar_progress.responses` is recorded as applied in the ledger but absent
-- in the database, so GET /api/grammar/lessons/:id fails with 42703
-- ("column responses does not exist") and the lesson page shows
-- "Không thể tải bài học".
--
-- Idempotent: migrate.js replays migration files, so the statement is conditional.

ALTER TABLE grammar_progress
  ADD COLUMN IF NOT EXISTS responses JSONB NOT NULL DEFAULT '[]'::jsonb;
