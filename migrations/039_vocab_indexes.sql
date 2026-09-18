-- Migration 039: fix index vocab (theo audit).
-- GIN tsvector cũ không dùng được với ILIKE -> thay bằng pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DROP INDEX IF EXISTS vocab_words_term_idx;
CREATE INDEX IF NOT EXISTS vocab_words_term_trgm_idx ON vocab_words USING gin (term gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vocab_words_meaning_trgm_idx ON vocab_words USING gin (meaning_vi gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vocab_progress_word_idx ON vocab_progress (word_id);
