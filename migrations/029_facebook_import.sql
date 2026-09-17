-- Migration 029: Kéo bài viết từ nhóm Facebook (BDU Confessions) về bảng tin Confession
--
-- facebook_import_posts là sổ đăng ký idempotent: mỗi bài FB chỉ được nhập một lần,
-- giữ lại id bài gốc để đối chiếu khi người dùng báo trùng hoặc cần xóa.

CREATE TABLE IF NOT EXISTS facebook_import_posts (
  id BIGSERIAL PRIMARY KEY,
  fb_post_id VARCHAR(128) NOT NULL,
  fb_group_id VARCHAR(64),
  fb_author_key VARCHAR(128),
  fb_author_name TEXT,
  permalink TEXT,
  post_id BIGINT REFERENCES community_posts(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT facebook_import_posts_fb_post_id_unique UNIQUE (fb_post_id)
);

CREATE INDEX IF NOT EXISTS facebook_import_posts_post_idx
  ON facebook_import_posts (post_id);

CREATE INDEX IF NOT EXISTS facebook_import_posts_posted_at_idx
  ON facebook_import_posts (posted_at DESC NULLS LAST);

-- Nhật ký mỗi lần chạy để admin chẩn đoán khi cookie hết hạn hoặc feed đổi cấu trúc.
CREATE TABLE IF NOT EXISTS facebook_import_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'running',
  stories_seen INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS facebook_import_runs_started_at_idx
  ON facebook_import_runs (started_at DESC);

-- Nguồn bài viết: 'portal' (người dùng đăng) hoặc 'facebook' (nhập tự động).
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS source VARCHAR(24) NOT NULL DEFAULT 'portal';

CREATE INDEX IF NOT EXISTS community_posts_source_idx
  ON community_posts (source);

-- Ẩn danh giả lập cho tác giả Facebook: mỗi người một bút danh ổn định,
-- không thể truy ngược về tài khoản thật.
INSERT INTO students (mssv, full_name, is_active)
VALUES ('FACEBOOK_USER_GUEST', 'facebook_user_guest', FALSE)
ON CONFLICT (mssv) DO NOTHING;
