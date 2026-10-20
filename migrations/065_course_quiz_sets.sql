-- Migration 065: Bộ đề trắc nghiệm theo phần trong Không gian môn học.
-- Thay hoàn toàn cơ chế quiz-post cũ (064):
--   * xóa dữ liệu quiz test cũ,
--   * bỏ bảng course_quiz_progress/course_quizzes cũ,
--   * thu CHECK course_posts.kind về 4 loại cũ,
--   * tạo course_quiz_sets + course_quiz_progress mới.
-- Idempotent: runner có thể chạy lại toàn bộ file mà không lỗi.

-- §3.1: dọn quiz-post cũ (feature chưa deploy, chỉ có dữ liệu test).
DELETE FROM course_posts WHERE kind = 'quiz';

DROP TABLE IF EXISTS course_quiz_progress;
DROP TABLE IF EXISTS course_quizzes;

ALTER TABLE course_posts DROP CONSTRAINT IF EXISTS course_posts_kind_check;
ALTER TABLE course_posts
  ADD CONSTRAINT course_posts_kind_check
  CHECK (kind IN ('request', 'document', 'video', 'link'));

-- Kiểm tra part_sizes: mảng 1..20 số nguyên dương, mỗi phần ≤ max, tổng = question_count.
-- Dùng hàm IMMUTABLE vì CHECK của PostgreSQL không cho subquery trực tiếp.
CREATE OR REPLACE FUNCTION course_quiz_set_part_sizes_valid(
  sizes JSONB,
  expected_question_count INTEGER,
  max_per_part INTEGER
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(sizes) <> 'array' THEN false
    WHEN jsonb_array_length(sizes) NOT BETWEEN 1 AND 20 THEN false
    WHEN jsonb_path_exists(
      sizes,
      '$[*] ? (@.type() != "number" || @ != @.floor() || @ < 1 || @ > $max)',
      jsonb_build_object('max', max_per_part)
    ) THEN false
    ELSE (
      SELECT COALESCE(SUM((elem #>> '{}')::numeric), 0)
      FROM jsonb_array_elements(sizes) AS elem
    ) = expected_question_count
  END;
$$;

-- §3.2: bộ đề của môn học. questions là snapshot đã chuẩn hóa, có partIndex.
CREATE TABLE IF NOT EXISTS course_quiz_sets (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  source_files JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_files) = 'array'),
  questions JSONB NOT NULL
    CHECK (jsonb_typeof(questions) = 'array'),
  part_sizes JSONB NOT NULL
    CHECK (jsonb_typeof(part_sizes) = 'array'),
  part_count SMALLINT NOT NULL CHECK (part_count BETWEEN 1 AND 20),
  question_count SMALLINT NOT NULL CHECK (question_count BETWEEN 1 AND 500),
  max_questions_per_part SMALLINT NOT NULL CHECK (max_questions_per_part BETWEEN 5 AND 25),
  minutes_per_part INTEGER NOT NULL CHECK (minutes_per_part BETWEEN 5 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_quiz_sets_question_count_matches
    CHECK (
      CASE
        WHEN jsonb_typeof(questions) = 'array'
          THEN question_count = jsonb_array_length(questions)
        ELSE false
      END
    ),
  CONSTRAINT course_quiz_sets_part_count_matches
    CHECK (
      CASE
        WHEN jsonb_typeof(part_sizes) = 'array'
          THEN part_count = jsonb_array_length(part_sizes)
        ELSE false
      END
    ),
  CONSTRAINT course_quiz_sets_part_sizes_valid
    CHECK (course_quiz_set_part_sizes_valid(part_sizes, question_count, max_questions_per_part))
);

CREATE INDEX IF NOT EXISTS course_quiz_sets_course_idx
  ON course_quiz_sets (course_id, created_at DESC);

CREATE INDEX IF NOT EXISTS course_quiz_sets_author_idx
  ON course_quiz_sets (author_mssv, created_at DESC);

-- §3.3: tiến độ theo từng sinh viên × bộ đề × phần × chế độ.
CREATE TABLE IF NOT EXISTS course_quiz_progress (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  set_id BIGINT NOT NULL REFERENCES course_quiz_sets(id) ON DELETE CASCADE,
  part_index SMALLINT NOT NULL CHECK (part_index BETWEEN 0 AND 19),
  mode TEXT NOT NULL CHECK (mode IN ('review', 'test')),
  started_at TIMESTAMPTZ,
  answered SMALLINT NOT NULL DEFAULT 0 CHECK (answered BETWEEN 0 AND 25),
  correct_count SMALLINT NOT NULL DEFAULT 0 CHECK (correct_count BETWEEN 0 AND 25),
  total_count SMALLINT NOT NULL DEFAULT 0 CHECK (total_count BETWEEN 0 AND 25),
  best_correct SMALLINT CHECK (best_correct IS NULL OR best_correct BETWEEN 0 AND 25),
  best_total SMALLINT CHECK (best_total IS NULL OR best_total BETWEEN 0 AND 25),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  responses JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(responses) = 'array'),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, set_id, part_index, mode),
  CONSTRAINT course_quiz_progress_correct_range
    CHECK (correct_count BETWEEN 0 AND answered),
  CONSTRAINT course_quiz_progress_best_range
    CHECK (best_correct IS NULL OR best_total IS NULL OR best_correct BETWEEN 0 AND best_total),
  CONSTRAINT course_quiz_progress_responses_count
    CHECK (
      CASE
        WHEN jsonb_typeof(responses) = 'array'
          THEN jsonb_array_length(responses) <= 25
        ELSE false
      END
    )
);

CREATE INDEX IF NOT EXISTS course_quiz_progress_mssv_idx
  ON course_quiz_progress (mssv, updated_at DESC);

CREATE INDEX IF NOT EXISTS course_quiz_progress_set_idx
  ON course_quiz_progress (set_id, part_index);
