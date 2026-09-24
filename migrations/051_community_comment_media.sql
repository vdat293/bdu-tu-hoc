-- Migration 051: Bình luận Confession có thể đính kèm ảnh/GIF tải lên R2.
--
-- attachments dùng JSONB giống community_posts.attachments để tái sử dụng
-- chung bộ validate/render; mỗi phần tử ảnh có dạng:
--   { "type": "image", "url": "...", "key": "comments/2026/09/...", ... }

ALTER TABLE community_post_comments
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
