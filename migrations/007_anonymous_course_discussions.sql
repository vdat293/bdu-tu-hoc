-- Migration 007: Chỉ bài luận bàn được phép ẩn danh; tài liệu luôn công khai danh tính.

ALTER TABLE course_posts
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'course_posts_anonymous_discussion_only_check'
  ) THEN
    ALTER TABLE course_posts
      ADD CONSTRAINT course_posts_anonymous_discussion_only_check
      CHECK (NOT is_anonymous OR kind = 'request');
  END IF;
END $$;
