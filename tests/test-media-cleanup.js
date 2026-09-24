import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import '../src/config/load-env.js';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { CommunityService } from '../src/services/community.service.js';
import { MediaCleanupService } from '../src/services/media-cleanup.service.js';
import { MediaStorageService } from '../src/services/media-storage.service.js';
import { MediaUploadService } from '../src/services/media-upload.service.js';

// 1. Unit thuần: thời hạn giữ ảnh + lọc key ảnh bài viết.
const originalRetention = process.env.MEDIA_POST_DELETE_RETENTION_DAYS;
delete process.env.MEDIA_POST_DELETE_RETENTION_DAYS;
assert.equal(MediaCleanupService.retentionMs(), 7 * 24 * 60 * 60 * 1000, 'Mặc định giữ ảnh 7 ngày');
process.env.MEDIA_POST_DELETE_RETENTION_DAYS = '3';
assert.equal(MediaCleanupService.retentionMs(), 3 * 24 * 60 * 60 * 1000, 'Đọc được số ngày từ env');
if (originalRetention === undefined) delete process.env.MEDIA_POST_DELETE_RETENTION_DAYS;
else process.env.MEDIA_POST_DELETE_RETENTION_DAYS = originalRetention;

assert.deepEqual(
  MediaCleanupService.postMediaKeys([
    { type: 'image', key: 'posts/2026/09/a.webp' },
    { type: 'image', key: null },
    { type: 'link', url: 'https://example.com' },
    { type: 'image', key: 'avatars/2405/a.webp' }
  ]),
  ['posts/2026/09/a.webp'],
  'Chỉ xếp hàng đợi ảnh do bài viết tạo, bỏ ảnh legacy/avatar'
);

// 2. Source wiring.
const migration = fs.readFileSync('migrations/052_media_cleanup_queue.sql', 'utf8');
const communityService = fs.readFileSync('src/services/community.service.js', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
assert.match(migration, /media_cleanup_queue/, 'Phải có bảng hàng đợi dọn ảnh');
assert.match(communityService, /enqueuePostMedia/, 'deletePost phải xếp ảnh vào hàng đợi');
assert.match(serverJs, /MediaCleanupService\.start\(\)/, 'Server phải chạy scheduler dọn ảnh');
assert.match(serverJs, /MediaCleanupService\.stop\(\)/, 'Server phải dừng scheduler khi shutdown');

// 3. Integration thật với PostgreSQL + R2 (bỏ qua nếu thiếu cấu hình).
if (!isDatabaseConfigured() || !MediaStorageService.isConfigured()) {
  console.log('Skipping integration: cần DATABASE_URL và cấu hình R2.');
  process.exit(0);
}

const AUTHOR = 'TESTCLEANUP1';
const postIds = [];
const objectKeys = [];
const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

async function uploadImage(name, background) {
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background } }).png().toBuffer();
  const image = await MediaUploadService.uploadImage({
    mssv: AUTHOR,
    file: { buffer: png, originalname: name, mimetype: 'image/png' },
    kind: 'post'
  });
  objectKeys.push(image.key);
  return image;
}

async function createPostWith(attachments, title) {
  const post = await CommunityService.createPost({
    authorMssv: AUTHOR,
    title,
    content: '',
    scope: 'school',
    category: 'confession',
    attachments
  });
  postIds.push(String(post.id));
  return String(post.id);
}

const objectExists = (key) => MediaStorageService.getObject(key).then(() => true).catch(() => false);

try {
  await query(`
    INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [AUTHOR]);

  // 3a. Bài bị xoá: ảnh vào hàng đợi 7 ngày rồi được dọn khỏi R2.
  const image = await uploadImage('cleanup.png', '#7c3aed');
  const postId = await createPostWith([image], 'Kiểm thử dọn ảnh');
  await CommunityService.deletePost(postId, AUTHOR);

  const queued = (await query(
    'SELECT delete_after, deleted_at FROM media_cleanup_queue WHERE object_key = $1',
    [image.key]
  )).rows[0];
  assert.ok(queued, 'Ảnh của bài bị xoá phải nằm trong hàng đợi');
  const delayMs = new Date(queued.delete_after).getTime() - Date.now();
  assert.ok(
    delayMs > 6 * 24 * 60 * 60 * 1000 && delayMs < 7 * 24 * 60 * 60 * 1000 + 60_000,
    'Thời điểm xoá phải rơi vào khoảng 7 ngày kể từ lúc xoá bài'
  );

  const early = await MediaCleanupService.runOnce({ now: new Date() });
  assert.equal(early.deleted, 0, 'Chưa tới hạn thì không được xoá ảnh');
  assert.equal(await objectExists(image.key), true, 'Ảnh phải còn trong thời gian giữ');

  const cleanup = await MediaCleanupService.runOnce({ now: future });
  assert.ok(cleanup.deleted >= 1, 'Tới hạn thì MediaCleanupService phải xoá ảnh');
  assert.equal(await objectExists(image.key), false, 'Ảnh phải bị xoá khỏi R2 sau 7 ngày');
  const doneRow = (await query(
    'SELECT deleted_at FROM media_cleanup_queue WHERE object_key = $1',
    [image.key]
  )).rows[0];
  assert.ok(doneRow?.deleted_at, 'Hàng đợi phải đánh dấu đã xử lý');

  // 3b. Ảnh vẫn còn bài khác dùng: chưa xoá dù quá hạn; xoá nốt bài kia mới xoá ảnh.
  const shared = await uploadImage('shared.png', '#0ea5e9');
  const postA = await createPostWith([shared], 'Bài A dùng ảnh chung');
  await createPostWith([shared], 'Bài B dùng ảnh chung');
  await CommunityService.deletePost(postA, AUTHOR);

  const guarded = await MediaCleanupService.runOnce({ now: future });
  assert.ok(guarded.skipped >= 1, 'Ảnh còn bài khác dùng thì phải bỏ qua');
  assert.equal(await objectExists(shared.key), true, 'Không được xoá ảnh còn được tham chiếu');

  const keptRow = (await query(
    'SELECT last_error FROM media_cleanup_queue WHERE object_key = $1',
    [shared.key]
  )).rows[0];
  assert.equal(keptRow?.last_error, 'still_referenced');

  // Xoá bài còn lại rồi dọn lại: lúc này ảnh mới thực sự bị xoá.
  await CommunityService.deletePost(postIds[2], AUTHOR);
  await MediaCleanupService.runOnce({ now: future });
  assert.equal(await objectExists(shared.key), false, 'Hết tham chiếu thì ảnh phải bị xoá');

  console.log('✓ Media cleanup: ảnh bài viết bị xoá được dọn khỏi R2 sau đúng 7 ngày và không xoá nhầm ảnh còn dùng.');
} finally {
  for (const id of postIds) {
    await query('DELETE FROM media_cleanup_queue WHERE source_type = $1 AND source_id = $2', ['post', id]).catch(() => {});
    await query('DELETE FROM community_posts WHERE id = $1', [id]).catch(() => {});
  }
  await query('DELETE FROM students WHERE mssv = $1', [AUTHOR]).catch(() => {});
  for (const key of objectKeys) await MediaStorageService.deleteObject(key).catch(() => {});
  await closeDatabase().catch(() => {});
  MediaStorageService.destroy();
}
