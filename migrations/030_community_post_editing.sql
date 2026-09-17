-- Migration 030: Cho phép chỉnh sửa bài viết Confession (tác giả hoặc quản trị viên).
--
-- edited_at tách khỏi updated_at vì updated_at đổi cả khi like/bình luận; giao diện
-- chỉ hiển thị nhãn "Đã chỉnh sửa" khi nội dung bài viết thực sự được sửa.

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
