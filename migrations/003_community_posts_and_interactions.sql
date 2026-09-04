-- Migration 003: Góc Tự Học Số - Bài viết, Đính kèm Google Drive/Video, Like và Bình luận

CREATE TABLE IF NOT EXISTS community_posts (
  id BIGSERIAL PRIMARY KEY,
  author_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('school', 'institute', 'faculty', 'clan')),
  scope_id VARCHAR(50),
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_post_likes (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_post_likes_post_mssv_unique UNIQUE (post_id, mssv)
);

CREATE TABLE IF NOT EXISTS community_post_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES community_post_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS community_posts_scope_idx
  ON community_posts (scope, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS community_posts_created_at_idx
  ON community_posts (created_at DESC);

CREATE INDEX IF NOT EXISTS community_posts_author_idx
  ON community_posts (author_mssv);

CREATE INDEX IF NOT EXISTS community_post_likes_post_idx
  ON community_post_likes (post_id);

CREATE INDEX IF NOT EXISTS community_post_comments_post_idx
  ON community_post_comments (post_id, created_at ASC);

CREATE INDEX IF NOT EXISTS community_post_comments_parent_idx
  ON community_post_comments (parent_id)
  WHERE parent_id IS NOT NULL;
