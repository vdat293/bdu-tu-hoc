-- Migration 009: Hệ thống Bình Chọn (Polls) cho CLB / Nhóm Học Tập

CREATE TABLE IF NOT EXISTS community_polls (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE UNIQUE,
  question TEXT NOT NULL,
  is_multiple_choice BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_poll_options (
  id BIGSERIAL PRIMARY KEY,
  poll_id BIGINT NOT NULL REFERENCES community_polls(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS community_poll_votes (
  id BIGSERIAL PRIMARY KEY,
  poll_id BIGINT NOT NULL REFERENCES community_polls(id) ON DELETE CASCADE,
  option_id BIGINT NOT NULL REFERENCES community_poll_options(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_poll_votes_user_unique UNIQUE (poll_id, mssv)
);

-- Tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS community_polls_post_id_idx
  ON community_polls (post_id);

CREATE INDEX IF NOT EXISTS community_poll_options_poll_id_idx
  ON community_poll_options (poll_id);

CREATE INDEX IF NOT EXISTS community_poll_votes_poll_id_idx
  ON community_poll_votes (poll_id);

CREATE INDEX IF NOT EXISTS community_poll_votes_mssv_idx
  ON community_poll_votes (mssv);
