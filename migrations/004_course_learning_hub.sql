-- Migration 004: Kho học tập theo đúng học phần BDU của từng sinh viên.
-- Không seed dữ liệu: courses chỉ được tạo từ payload bảng điểm BDU đã xác minh.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS course_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS courses (
  id BIGSERIAL PRIMARY KEY,
  normalized_code VARCHAR(64) UNIQUE NOT NULL,
  display_code VARCHAR(64) NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_courses (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  semester_code VARCHAR(32) NOT NULL,
  semester_name TEXT,
  has_final_grade BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_courses_student_course_semester_unique
    UNIQUE (mssv, course_id, semester_code)
);

CREATE TABLE IF NOT EXISTS course_posts (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'document', 'video', 'link')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_courses_mssv_idx
  ON student_courses (mssv, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS student_courses_course_idx
  ON student_courses (course_id);

CREATE INDEX IF NOT EXISTS course_posts_course_idx
  ON course_posts (course_id, created_at DESC);

CREATE INDEX IF NOT EXISTS course_posts_author_idx
  ON course_posts (author_mssv, created_at DESC);
