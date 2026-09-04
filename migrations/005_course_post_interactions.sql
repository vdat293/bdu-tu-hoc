-- Migration 005: Tương tác cho bài luận bàn và tài liệu theo môn học.

ALTER TABLE course_posts
  ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS course_post_likes (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_post_likes_post_mssv_unique UNIQUE (post_id, mssv)
);

CREATE TABLE IF NOT EXISTS course_post_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  author_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES course_post_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS course_post_likes_post_idx
  ON course_post_likes (post_id);

CREATE INDEX IF NOT EXISTS course_post_comments_post_idx
  ON course_post_comments (post_id, created_at ASC);

CREATE INDEX IF NOT EXISTS course_post_comments_parent_idx
  ON course_post_comments (parent_id)
  WHERE parent_id IS NOT NULL;
