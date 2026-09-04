-- Migration 008: Bản tin nhóm FB, ghim thông báo và phân loại tài liệu CLB

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'discussion';

CREATE INDEX IF NOT EXISTS community_posts_clan_pinned_idx
  ON community_posts (scope, scope_id, is_pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS community_posts_category_idx
  ON community_posts (category);
