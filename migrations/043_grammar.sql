-- Migration 043: Luyện ngữ pháp (clone luyennguphap.com).
-- Nguồn: tool-crawl/crawl-nguphap/output/*/*_full.json (8 lộ trình, 3 nhóm, 246 bài).
-- Dữ liệu KHÔNG seed trong migration; nạp qua: npm run grammar:import
--
-- LƯU Ý: migrate.js chạy lại toàn bộ file mỗi lần deploy -> phải idempotent.

CREATE TABLE IF NOT EXISTS grammar_groups (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grammar_paths (
  id UUID PRIMARY KEY,
  group_id UUID REFERENCES grammar_groups(id) ON DELETE SET NULL,
  slug VARCHAR(128) NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  difficulty SMALLINT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  banner_label VARCHAR(32) NOT NULL DEFAULT '',
  badge_label VARCHAR(32) NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  lesson_count INTEGER NOT NULL DEFAULT 0,
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grammar_lessons (
  id UUID PRIMARY KEY,
  path_id UUID NOT NULL REFERENCES grammar_paths(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grammar_rules (
  id UUID PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grammar_exercises (
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

CREATE TABLE IF NOT EXISTS grammar_reading_exercises (
  id UUID PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  passage TEXT NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grammar_reading_questions (
  id UUID PRIMARY KEY,
  reading_id UUID NOT NULL REFERENCES grammar_reading_exercises(id) ON DELETE CASCADE,
  type VARCHAR(24) NOT NULL DEFAULT 'multiple_choice',
  question TEXT NOT NULL DEFAULT '',
  option_a TEXT NOT NULL DEFAULT '',
  option_b TEXT NOT NULL DEFAULT '',
  option_c TEXT NOT NULL DEFAULT '',
  option_d TEXT NOT NULL DEFAULT '',
  correct_answer TEXT NOT NULL DEFAULT '',
  correct_option CHAR(1) NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tiến độ học từng user theo bài (resume câu đang làm + thành tích cao nhất)
CREATE TABLE IF NOT EXISTS grammar_progress (
  mssv VARCHAR(32) NOT NULL,
  lesson_id UUID NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  answered SMALLINT NOT NULL DEFAULT 0,
  correct_count SMALLINT NOT NULL DEFAULT 0,
  total_count SMALLINT NOT NULL DEFAULT 0,
  best_correct SMALLINT,
  best_total SMALLINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, lesson_id)
);

CREATE INDEX IF NOT EXISTS grammar_paths_group_idx ON grammar_paths (group_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_lessons_path_idx ON grammar_lessons (path_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_rules_lesson_idx ON grammar_rules (lesson_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_exercises_lesson_idx ON grammar_exercises (lesson_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_reading_lesson_idx ON grammar_reading_exercises (lesson_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_reading_questions_idx ON grammar_reading_questions (reading_id, order_idx);
CREATE INDEX IF NOT EXISTS grammar_progress_mssv_idx ON grammar_progress (mssv, updated_at DESC);
CREATE INDEX IF NOT EXISTS grammar_progress_completed_idx ON grammar_progress (mssv, completed_at) WHERE completed_at IS NOT NULL;
