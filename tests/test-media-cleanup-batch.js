import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../src/config/load-env.js';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { MediaCleanupInternals, MediaCleanupService } from '../src/services/media-cleanup.service.js';
import { MediaStorageService } from '../src/services/media-storage.service.js';

// 1. Kiểm tra tầng mã nguồn: việc dò "còn tham chiếu" phải gom cả lô vào MỘT
//    truy vấn thay vì một truy vấn cho mỗi object key (N+1, tối đa BATCH_SIZE).
const source = fs.readFileSync('src/services/media-cleanup.service.js', 'utf8');
assert.match(source, /referencedKeys/, 'Phải có helper dò tham chiếu theo lô');
assert.match(source, /unnest\(\$1::text\[\]\)/, 'Truy vấn dò tham chiếu phải nhận cả mảng object key');
assert.doesNotMatch(source, /isKeyStillReferenced/, 'Không còn helper 1 truy vấn cho 1 key');
assert.match(source, /const BATCH_SIZE = 100;/, 'Giữ nguyên BATCH_SIZE = 100');

// 2. Integration thật với PostgreSQL (disposable test DB). R2 không cần: lớp
//    lưu trữ được stub để chỉ kiểm tra quyết định xoá/bỏ qua của hàng đợi.
if (!isDatabaseConfigured() || !process.env.BDU_TEST_MODE) {
  console.log('Skipping integration: cần disposable test DB (BDU_TEST_DATABASE_URL + BDU_TEST_MODE).');
  process.exit(0);
}

const RUN = Date.now().toString(36);
const AUTHOR = 'TESTBATCH1';
// delete_after đặt ở quá khứ xa để mọi bản ghi khác trong bảng (luôn >= NOW())
// không lọt vào lô của test này, nhờ đó đếm deleted/skipped/failed chính xác.
const DUE = '1999-01-01T00:00:00.000Z';
const NOW = '2000-01-01T00:00:00.000Z';
const key = (name) => `tests/batch/${RUN}/${name}.webp`;
const KEY_POST = key('post-ref');
const KEY_COMMENT = key('comment-ref');
const KEY_DELETED_POST = key('deleted-post-ref');
const KEY_FREE = key('free');
const KEY_FAIL = key('free-fail');

const postIds = [];
const commentIds = [];
const originalIsConfigured = MediaStorageService.isConfigured;
const originalDeleteObject = MediaStorageService.deleteObject;
const attempted = [];

async function insertQueueRow(objectKey) {
  await query(`
    INSERT INTO media_cleanup_queue (object_key, delete_after, reason, source_type, source_id)
    VALUES ($1, $2, 'post_deleted', 'test', NULL);
  `, [objectKey, DUE]);
}

async function insertPost(attachments, deleted = false) {
  const result = await query(`
    INSERT INTO community_posts (author_mssv, title, content, scope, category, attachments, deleted_at)
    VALUES ($1, 'batch cleanup test', '', 'school', 'confession', $2::jsonb, $3)
    RETURNING id;
  `, [AUTHOR, JSON.stringify(attachments), deleted ? new Date().toISOString() : null]);
  postIds.push(result.rows[0].id);
  return result.rows[0].id;
}

async function insertComment(postId, attachments) {
  const result = await query(`
    INSERT INTO community_post_comments (post_id, author_mssv, content, attachments)
    VALUES ($1, $2, 'batch cleanup comment', $3::jsonb)
    RETURNING id;
  `, [postId, AUTHOR, JSON.stringify(attachments)]);
  commentIds.push(result.rows[0].id);
  return result.rows[0].id;
}

const rowsFor = (keys) => query(`
  SELECT object_key, attempts, last_error, deleted_at, delete_after
  FROM media_cleanup_queue
  WHERE object_key = ANY($1::text[])
  ORDER BY object_key;
`, [keys]);

try {
  // Dọn tàn dư của các lần chạy trước trong cùng namespace test.
  await query("DELETE FROM media_cleanup_queue WHERE object_key LIKE 'tests/batch/%'");
  await query(`
    INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [AUTHOR]);

  const postId = await insertPost([{ type: 'image', key: KEY_POST, url: `https://cdn.test/${KEY_POST}` }]);
  await insertComment(postId, [{ type: 'image', key: KEY_COMMENT, url: `https://cdn.test/${KEY_COMMENT}` }]);
  await insertPost([{ type: 'image', key: KEY_DELETED_POST, url: `https://cdn.test/${KEY_DELETED_POST}` }], true);

  for (const objectKey of [KEY_POST, KEY_COMMENT, KEY_DELETED_POST, KEY_FREE, KEY_FAIL]) {
    await insertQueueRow(objectKey);
  }

  // 2a. Một lời gọi duy nhất cho cả lô: chỉ trả về key còn được nội dung chưa
  //     xoá tham chiếu (bài viết hoặc bình luận). Bài đã soft-delete không tính.
  const referenced = await MediaCleanupInternals.referencedKeys([KEY_POST, KEY_COMMENT, KEY_DELETED_POST, KEY_FREE, KEY_FAIL]);
  assert.deepEqual(
    [...referenced].sort(),
    [KEY_COMMENT, KEY_POST].sort(),
    'Chỉ key còn được bài/bình luận chưa xoá tham chiếu mới nằm trong kết quả'
  );

  const wideKeys = [KEY_POST, ...Array.from({ length: 99 }, (_, index) => key(`missing-${index}`))];
  const wideReferenced = await MediaCleanupInternals.referencedKeys(wideKeys);
  assert.deepEqual(
    [...wideReferenced],
    [KEY_POST],
    'Một lô 100 key vẫn cho kết quả đúng trong một lời gọi'
  );
  assert.equal((await MediaCleanupInternals.referencedKeys([])).size, 0, 'Lô rỗng không tham chiếu key nào');

  // 2b. runOnce quyết định per-row trên kết quả lô: referenced -> skip,
  //     unreferenced -> xoá (stub), xoá lỗi -> đẩy lùi 1 giờ.
  MediaStorageService.isConfigured = () => true;
  MediaStorageService.deleteObject = async (objectKey) => {
    attempted.push(objectKey);
    return objectKey !== KEY_FAIL;
  };

  const cleanup = await MediaCleanupService.runOnce({ now: new Date(NOW), batch: 100 });
  assert.equal(cleanup.deleted, 2, 'Chỉ xoá key không còn tham chiếu và xoá thành công');
  assert.equal(cleanup.skipped, 2, 'Bỏ qua key còn được tham chiếu');
  assert.equal(cleanup.failed, 1, 'Key xoá lỗi phải được đẩy lùi để thử lại');
  assert.deepEqual(
    [...attempted].sort(),
    [KEY_DELETED_POST, KEY_FREE, KEY_FAIL].sort(),
    'Không gọi xoá object cho key còn được tham chiếu'
  );

  const rows = await rowsFor([KEY_POST, KEY_COMMENT, KEY_DELETED_POST, KEY_FREE, KEY_FAIL]);
  const byKey = new Map(rows.rows.map((row) => [row.object_key, row]));

  assert.ok(byKey.get(KEY_POST).deleted_at, 'Key còn được bài viết dùng phải được đánh dấu đã xử lý (skip)');
  assert.equal(byKey.get(KEY_POST).last_error, 'still_referenced');
  assert.equal(byKey.get(KEY_POST).attempts, 0);

  assert.ok(byKey.get(KEY_COMMENT).deleted_at, 'Key còn được bình luận dùng phải được đánh dấu đã xử lý (skip)');
  assert.equal(byKey.get(KEY_COMMENT).last_error, 'still_referenced');

  assert.ok(byKey.get(KEY_DELETED_POST).deleted_at, 'Key chỉ còn bài đã soft-delete thì phải được xoá');
  assert.equal(byKey.get(KEY_DELETED_POST).last_error, null);

  assert.ok(byKey.get(KEY_FREE).deleted_at, 'Key không còn tham chiếu phải được xoá');
  assert.equal(byKey.get(KEY_FREE).last_error, null);

  assert.equal(byKey.get(KEY_FAIL).deleted_at, null, 'Key xoá lỗi phải nằm lại hàng đợi');
  assert.equal(byKey.get(KEY_FAIL).last_error, 'delete_failed');
  assert.equal(byKey.get(KEY_FAIL).attempts, 1);
  assert.ok(
    new Date(byKey.get(KEY_FAIL).delete_after).getTime() > Date.now(),
    'Key xoá lỗi phải được lùi lịch thử lại về tương lai'
  );

  console.log('✓ Media cleanup batch: dò tham chiếu một truy vấn cho cả lô, giữ nguyên quyết định skip/xoá/retry.');
} finally {
  MediaStorageService.isConfigured = originalIsConfigured;
  MediaStorageService.deleteObject = originalDeleteObject;
  await query("DELETE FROM media_cleanup_queue WHERE object_key LIKE 'tests/batch/%'").catch(() => {});
  for (const id of commentIds) await query('DELETE FROM community_post_comments WHERE id = $1', [id]).catch(() => {});
  for (const id of postIds) await query('DELETE FROM community_posts WHERE id = $1', [id]).catch(() => {});
  await query('DELETE FROM students WHERE mssv = $1', [AUTHOR]).catch(() => {});
  await closeDatabase().catch(() => {});
}
