-- Migration 064: Bài trắc nghiệm trong Kho Tài Liệu môn học
-- Thêm loại bài 'quiz' vào course_posts, bảng snapshot câu hỏi course_quizzes
-- và bảng tiến độ làm bài course_quiz_progress. Idempotent: chạy lại an toàn mỗi deploy.
-- Không seed dữ liệu; không backfill bài đăng cũ.

-- §3.1: mở rộng CHECK(kind) của course_posts thêm 'quiz'.
-- Chỉ xóa CHECK danh sách kind (tên cố định hoặc định nghĩa dạng
-- "kind IN (...)" / "kind = ANY (ARRAY[...])") rồi thêm lại với tên cố định,
-- để chạy lại nhiều lần không bị lỗi "constraint does not exist / already exists".
-- Tuyệt đối không dùng mẫu LIKE rộng khớp mọi định nghĩa chứa 'kind': nó cũng khớp
-- CHECK ẩn danh của migration 007 ("NOT is_anonymous OR kind = 'request'")
-- và sẽ xóa mất bất biến đó.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'course_posts'::regclass
      AND contype = 'c'
      AND (
        conname = 'course_posts_kind_check'
        OR pg_get_constraintdef(oid) ~ 'kind\s+IN\s*\('
        OR pg_get_constraintdef(oid) ~ 'kind\s*=\s*ANY\s*\(\s*ARRAY'
      )
  LOOP
    EXECUTE format('ALTER TABLE course_posts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE course_posts
  ADD CONSTRAINT course_posts_kind_check
  CHECK (kind IN ('request', 'document', 'video', 'link', 'quiz'));

-- §3.2: snapshot câu hỏi của mỗi bài quiz (1-1 với course_posts.kind = 'quiz').
CREATE TABLE IF NOT EXISTS course_quizzes (
  post_id BIGINT PRIMARY KEY REFERENCES course_posts(id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  question_count SMALLINT NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  time_limit_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (time_limit_seconds = 0 OR time_limit_seconds BETWEEN 30 AND 14400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_quizzes_question_count_matches
    CHECK (
      CASE
        WHEN jsonb_typeof(questions) = 'array'
          THEN question_count = jsonb_array_length(questions)
        ELSE false
      END
    )
);

-- §3.3: tiến độ làm bài từng sinh viên cho từng bài quiz.
CREATE TABLE IF NOT EXISTS course_quiz_progress (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  answered SMALLINT NOT NULL DEFAULT 0 CHECK (answered BETWEEN 0 AND 100),
  correct_count SMALLINT NOT NULL DEFAULT 0,
  total_count SMALLINT NOT NULL DEFAULT 0 CHECK (total_count BETWEEN 0 AND 100),
  best_correct SMALLINT,
  best_total SMALLINT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  responses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(responses) = 'array'),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, post_id),
  CONSTRAINT course_quiz_progress_correct_range
    CHECK (correct_count BETWEEN 0 AND answered),
  CONSTRAINT course_quiz_progress_best_range
    CHECK (best_correct IS NULL OR best_total IS NULL OR best_correct BETWEEN 0 AND best_total)
);

CREATE INDEX IF NOT EXISTS course_quiz_progress_mssv_idx
  ON course_quiz_progress (mssv, updated_at DESC);

CREATE INDEX IF NOT EXISTS course_quiz_progress_post_idx
  ON course_quiz_progress (post_id);
