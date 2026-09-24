-- Lưu câu trả lời bài tập chính để server chấm lại (không tin điểm client
-- khai) và khôi phục đúng các câu đã làm khi bấm "Làm tiếp".
-- migrate.js replays migration files, so every statement must be idempotent.

ALTER TABLE grammar_progress
  ADD COLUMN IF NOT EXISTS responses JSONB NOT NULL DEFAULT '[]'::jsonb;
