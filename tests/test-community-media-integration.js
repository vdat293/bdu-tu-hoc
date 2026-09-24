import assert from 'node:assert/strict';
import '../src/config/load-env.js';
import sharp from 'sharp';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { CommunityService } from '../src/services/community.service.js';
import { MediaStorageService } from '../src/services/media-storage.service.js';
import { MediaUploadService } from '../src/services/media-upload.service.js';

// Kiểm thử tích hợp thật: PostgreSQL + Cloudflare R2.
// Tự bỏ qua khi thiếu cấu hình để không chặn môi trường dev/CI.
if (!isDatabaseConfigured() || !MediaStorageService.isConfigured()) {
  console.log('Skipping: cần DATABASE_URL và cấu hình R2 (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET).');
  process.exit(0);
}

const AUTHOR = 'TEST_MEDIA_AUTHOR';
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let postId = null;
const uploadedKeys = [];

try {
  await query(`
    INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [AUTHOR]);

  // 1. Upload ảnh tĩnh lên R2 (resize + WebP).
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#dc2626' } }).png().toBuffer();
  const image = await MediaUploadService.uploadImage({
    mssv: AUTHOR,
    file: { buffer: png, originalname: 'test.png', mimetype: 'image/png' },
    kind: 'post'
  });
  uploadedKeys.push(image.key);
  assert.equal(image.type, 'image');
  assert.equal(image.mime, 'image/webp');
  assert.ok(image.key.startsWith('posts/'), 'Ảnh bài viết phải nằm dưới prefix posts/');
  assert.equal(image.url, MediaStorageService.publicUrl(image.key));

  // 2. Bài viết chỉ có ảnh (không cần nội dung chữ).
  const post = await CommunityService.createPost({
    authorMssv: AUTHOR,
    title: 'Kiểm thử media',
    content: '',
    scope: 'school',
    category: 'confession',
    attachments: [image]
  });
  postId = String(post.id);
  assert.equal(post.attachments.length, 1);
  assert.equal(post.attachments[0].type, 'image');
  assert.equal(post.attachments[0].key, image.key);

  // 3. Ảnh từ host lạ bị từ chối.
  await assert.rejects(
    () => CommunityService.createPost({
      authorMssv: AUTHOR,
      title: 'Ảnh ngoài',
      content: '',
      scope: 'school',
      category: 'confession',
      attachments: [{ type: 'image', url: 'https://evil.example.com/a.png' }]
    }),
    (error) => error.status === 400
  );

  // 4. Bình luận chỉ có GIF, giữ animation.
  const gif = await MediaUploadService.uploadImage({
    mssv: AUTHOR,
    file: { buffer: GIF_1PX, originalname: 'vui.gif', mimetype: 'image/gif' },
    kind: 'comment'
  });
  uploadedKeys.push(gif.key);
  assert.ok(gif.key.startsWith('comments/'), 'GIF bình luận phải nằm dưới prefix comments/');
  assert.equal(gif.animated, true);

  const comment = await CommunityService.addComment({
    postId,
    authorMssv: AUTHOR,
    content: '',
    attachments: [gif]
  });
  assert.equal(comment.attachments.length, 1);
  assert.equal(comment.attachments[0].animated, true);

  // 5. Gỡ ảnh khỏi bình luận -> object R2 bị xoá thật.
  await CommunityService.editComment({
    postId,
    commentId: comment.id,
    requesterMssv: AUTHOR,
    content: 'đã gỡ ảnh',
    attachments: []
  });
  const stillThere = await MediaStorageService.getObject(gif.key).then(() => true).catch(() => false);
  assert.equal(stillThere, false, 'Object của ảnh bị gỡ phải được xoá khỏi R2');
  uploadedKeys.splice(uploadedKeys.indexOf(gif.key), 1);

  // 6. Avatar tự upload: ảnh cũ bị xoá khi thay, ảnh mới bị xoá khi gỡ.
  const { AvatarOverrideService } = await import('../src/services/avatar-override.service.js');
  const avatarMssv = 'TESTAVATAR01';
  const firstAvatar = await AvatarOverrideService.upload({
    mssv: avatarMssv,
    actorMssv: avatarMssv,
    file: { buffer: png, originalname: 'avatar-1.png', mimetype: 'image/png' }
  });
  assert.equal(firstAvatar.source, 'override');
  assert.ok(firstAvatar.storage_key.startsWith(`avatars/${avatarMssv}/`), 'Avatar phải nằm dưới prefix avatars/<mssv>/');
  assert.equal(firstAvatar.override_url, MediaStorageService.publicUrl(firstAvatar.storage_key));

  const secondAvatar = await AvatarOverrideService.upload({
    mssv: avatarMssv,
    actorMssv: avatarMssv,
    file: { buffer: png, originalname: 'avatar-2.png', mimetype: 'image/png' }
  });
  const firstAvatarGone = await MediaStorageService.getObject(firstAvatar.storage_key).then(() => true).catch(() => false);
  assert.equal(firstAvatarGone, false, 'Avatar cũ phải bị xoá khi thay ảnh mới');

  await AvatarOverrideService.remove({ mssv: avatarMssv, actorMssv: avatarMssv });
  const secondAvatarGone = await MediaStorageService.getObject(secondAvatar.storage_key).then(() => true).catch(() => false);
  assert.equal(secondAvatarGone, false, 'Avatar phải bị xoá khi người dùng gỡ ảnh');
  await query('DELETE FROM student_avatar_override_audit WHERE mssv = $1', [avatarMssv]).catch(() => {});
  await query('DELETE FROM student_avatar_overrides WHERE mssv = $1', [avatarMssv]).catch(() => {});
  await query('DELETE FROM students WHERE mssv = $1', [avatarMssv]).catch(() => {});

  console.log('✓ Integration media: bài viết ảnh + bình luận GIF lưu R2, chặn host lạ và dọn object khi gỡ ảnh.');
} finally {
  if (postId) await query('DELETE FROM community_posts WHERE id = $1', [postId]).catch(() => {});
  for (const key of uploadedKeys) await MediaStorageService.deleteObject(key).catch(() => {});
  await closeDatabase().catch(() => {});
  MediaStorageService.destroy();
}
