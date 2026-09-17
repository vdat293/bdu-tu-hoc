-- Migration 031: Tag user active (@MSSV) + notifications cho Confession.
--
-- community_posts.id và community_post_comments.id đều là BIGINT (BIGSERIAL)
-- nên mọi FK ở đây dùng BIGINT cho khớp kiểu.
-- UNIQUE ... NULLS NOT DISTINCT yêu cầu Postgres >= 15 (hiện tại chạy PG16).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Mỗi dòng ghi nhận một lượt tag @MSSV trong bài hoặc bình luận confession.
CREATE TABLE IF NOT EXISTS confession_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id BIGINT REFERENCES community_post_comments(id) ON DELETE CASCADE,
  mentioned_mssv VARCHAR(32) NOT NULL,
  mentioned_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (post_id, comment_id, mentioned_mssv)
);

-- Thông báo cho người được tag (mention) hoặc được trả lời (reply).
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_mssv VARCHAR(32) NOT NULL,
  actor_mssv VARCHAR(32) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mention', 'reply')),
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id BIGINT REFERENCES community_post_comments(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chống tạo trùng notification khi sync lại sau edit (để INSERT ... ON CONFLICT DO NOTHING có tác dụng).
-- comment_id NULL (mention ở bài viết) được quy về -1 vì id bình luận luôn > 0.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications (recipient_mssv, type, post_id, (COALESCE(comment_id, -1)), actor_mssv);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_mssv, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS confession_mentions_post_idx
  ON confession_mentions (post_id);

CREATE INDEX IF NOT EXISTS confession_mentions_mentioned_idx
  ON confession_mentions (mentioned_mssv);
