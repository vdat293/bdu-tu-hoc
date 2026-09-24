/**
 * Dọn ảnh R2 của bài viết đã bị xoá sau một thời gian giữ lại (mặc định 7 ngày).
 *
 * - Khi bài viết bị soft delete, `CommunityService.deletePost` gọi
 *   `enqueuePostMedia(client, postId, attachments)` trong cùng transaction để
 *   ghi các object key vào `media_cleanup_queue` với `delete_after = NOW() + N ngày`.
 * - Service này chạy định kỳ, xoá các object tới hạn qua MediaStorageService.
 *   Lỗi tạm thời được đẩy lùi 1 giờ và tăng `attempts` để thử lại.
 */

import { isDatabaseConfigured, query } from '../db/database.js';
import { MediaStorageService } from './media-storage.service.js';
import { MediaUploadService } from './media-upload.service.js';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_INTERVAL_MINUTES = 60;
const RETRY_DELAY_SQL = "INTERVAL '1 hour'";
const BATCH_SIZE = 100;

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function retentionMs() {
  return envNumber('MEDIA_POST_DELETE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
}

function intervalMs() {
  return Math.max(5, envNumber('MEDIA_CLEANUP_INTERVAL_MINUTES', DEFAULT_INTERVAL_MINUTES)) * 60 * 1000;
}

/**
 * Các object key ảnh thuộc bài viết (bỏ qua ảnh legacy không có key như
 * fb-import, và chỉ nhận key do luồng bài viết tạo).
 */
export function postMediaKeys(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter(MediaUploadService.isImageAttachment)
    .map((item) => item?.key)
    .filter((key) => typeof key === 'string' && key.startsWith('posts/'));
}

async function enqueuePostMedia(client, postId, attachments) {
  const keys = postMediaKeys(attachments);
  if (keys.length === 0) return 0;
  let queued = 0;
  for (const key of keys) {
    const result = await client.query(`
      INSERT INTO media_cleanup_queue (object_key, delete_after, reason, source_type, source_id)
      VALUES ($1, NOW() + ($2::bigint * INTERVAL '1 millisecond'), 'post_deleted', 'post', $3)
      ON CONFLICT DO NOTHING;
    `, [key, retentionMs(), postId]);
    queued += result.rowCount || 0;
  }
  return queued;
}

/**
 * Ảnh có thể được gắn lại vào bài/bình luận khác (client gửi cùng URL/key).
 * Trước khi xoá phải chắc rằng không còn nội dung chưa xoá nào tham chiếu tới.
 */
async function isKeyStillReferenced(key) {
  const result = await query(`
    SELECT (
      EXISTS (
        SELECT 1 FROM community_posts
        WHERE deleted_at IS NULL
          AND attachments @> jsonb_build_array(jsonb_build_object('key', $1::text))
      )
      OR EXISTS (
        SELECT 1 FROM community_post_comments
        WHERE deleted_at IS NULL
          AND attachments @> jsonb_build_array(jsonb_build_object('key', $1::text))
      )
    ) AS referenced;
  `, [key]);
  return Boolean(result.rows[0]?.referenced);
}

async function runOnce({ now = new Date(), batch = BATCH_SIZE } = {}) {
  if (!isDatabaseConfigured() || !MediaStorageService.isConfigured()) {
    return { deleted: 0, failed: 0, skipped: 0, disabled: true };
  }
  const due = await query(`
    SELECT id, object_key
    FROM media_cleanup_queue
    WHERE deleted_at IS NULL AND delete_after <= $1
    ORDER BY delete_after ASC
    LIMIT $2;
  `, [now.toISOString(), Math.max(1, Math.min(500, Number(batch) || BATCH_SIZE))]);

  let deleted = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due.rows) {
    let referenced = true;
    try {
      referenced = await isKeyStillReferenced(row.object_key);
    } catch (error) {
      // Không kiểm tra được thì lùi lại 1 giờ, tuyệt đối không xoá nhầm.
      await query(`
        UPDATE media_cleanup_queue
        SET attempts = attempts + 1, last_error = 'reference_check_failed', delete_after = NOW() + ${RETRY_DELAY_SQL}
        WHERE id = $1;
      `, [row.id]);
      failed += 1;
      continue;
    }

    if (referenced) {
      await query(`
        UPDATE media_cleanup_queue
        SET deleted_at = NOW(), last_error = 'still_referenced'
        WHERE id = $1;
      `, [row.id]);
      skipped += 1;
      continue;
    }

    const ok = await MediaStorageService.deleteObject(row.object_key);
    if (ok) {
      await query('UPDATE media_cleanup_queue SET deleted_at = NOW() WHERE id = $1', [row.id]);
      deleted += 1;
    } else {
      await query(`
        UPDATE media_cleanup_queue
        SET attempts = attempts + 1, last_error = 'delete_failed', delete_after = NOW() + ${RETRY_DELAY_SQL}
        WHERE id = $1;
      `, [row.id]);
      failed += 1;
    }
  }
  return { deleted, failed, skipped };
}

export const MediaCleanupService = {
  retentionMs,
  intervalMs,
  postMediaKeys,
  enqueuePostMedia,
  runOnce,

  start() {
    if (!isDatabaseConfigured()) return;
    const run = () => {
      this.runOnce()
        .then((result) => {
          if (result.deleted || result.failed) {
            console.log(`[media-cleanup] Đã xoá ${result.deleted} ảnh, ${result.failed} lỗi sẽ thử lại.`);
          }
        })
        .catch((error) => console.warn('[media-cleanup] Lỗi dọn ảnh:', error.message));
    };
    run();
    this.timer = setInterval(run, intervalMs());
    this.timer.unref?.();
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
};

export const MediaCleanupInternals = {
  retentionMs,
  intervalMs,
  postMediaKeys,
  enqueuePostMedia
};
