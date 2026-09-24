-- Migration 052: Hàng đợi xoá ảnh R2 sau khi bài viết bị xoá.
--
-- Bài viết dùng soft delete (deleted_at) để giữ tombstone/kiểm duyệt. Ảnh của
-- bài bị xoá không xoá ngay mà xếp vào hàng đợi này và sẽ được
-- MediaCleanupService dọn sau MEDIA_POST_DELETE_RETENTION_DAYS ngày (mặc định 7).

CREATE TABLE IF NOT EXISTS media_cleanup_queue (
  id BIGSERIAL PRIMARY KEY,
  object_key TEXT NOT NULL,
  delete_after TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT 'post_deleted',
  source_type TEXT,
  source_id BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Một object chỉ nằm trong hàng đợi một lần (cho tới khi được dọn xong).
CREATE UNIQUE INDEX IF NOT EXISTS media_cleanup_queue_object_key_idx
  ON media_cleanup_queue (object_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS media_cleanup_queue_due_idx
  ON media_cleanup_queue (delete_after)
  WHERE deleted_at IS NULL;
