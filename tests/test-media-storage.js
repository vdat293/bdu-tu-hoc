import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MediaStorageService, MediaStorageInternals } from '../src/services/media-storage.service.js';
import { MediaUploadService } from '../src/services/media-upload.service.js';

// 1. URL/key thuộc hệ thống (proxy nội bộ) và chặn URL ngoài.
process.env.R2_MEDIA_PROXY_PATH = '/media/r2';
delete process.env.R2_PUBLIC_BASE_URL;

assert.equal(
  MediaStorageService.publicUrl('posts/2026/09/abc.webp'),
  '/media/r2/posts/2026/09/abc.webp'
);
assert.equal(MediaStorageService.publicUrl('../etc/passwd'), null);
assert.equal(MediaStorageService.normalizeKey('/avatars/24050126/a.webp'), 'avatars/24050126/a.webp');
assert.equal(MediaStorageService.normalizeKey('avatars/../../etc/passwd'), null);

const builtKey = MediaStorageService.buildKey('comments', '.gif');
assert.match(builtKey, /^comments\/\d{4}\/\d{2}\/[a-f0-9]{32}\.gif$/);

assert.equal(
  MediaStorageInternals.mediaKeyFromUrl('/media/r2/posts/2026/09/abc.webp', { allowedPrefixes: ['posts/'] }),
  'posts/2026/09/abc.webp'
);
assert.equal(MediaStorageInternals.mediaKeyFromUrl('https://evil.example.com/x.webp'), null);
assert.equal(
  MediaStorageInternals.mediaKeyFromUrl('/media/r2/avatars/24050126/a.webp', { allowedPrefixes: ['posts/', 'comments/'] }),
  null,
  'Ảnh bài viết không được trỏ vào prefix avatar'
);

// 2. Khi có custom domain/R2.dev, URL mới dùng host đó và vẫn phải khớp host.
process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.test/';
assert.equal(
  MediaStorageService.publicUrl('posts/2026/09/abc.webp'),
  'https://cdn.example.test/posts/2026/09/abc.webp'
);
assert.equal(
  MediaStorageInternals.mediaKeyFromUrl('https://cdn.example.test/posts/2026/09/abc.webp', { allowedPrefixes: ['posts/'] }),
  'posts/2026/09/abc.webp'
);
assert.equal(
  MediaStorageInternals.mediaKeyFromUrl('https://cdn.evil.test/posts/2026/09/abc.webp', { allowedPrefixes: ['posts/'] }),
  null
);
delete process.env.R2_PUBLIC_BASE_URL;

// 3. Chuẩn hoá attachment ảnh do client gửi lên.
const sanitized = MediaUploadService.sanitizeImageAttachment({
  type: 'image',
  url: '/media/r2/posts/2026/09/abc.webp',
  width: '800',
  height: 600,
  bytes: 12345,
  mime: 'image/webp'
});
assert.ok(sanitized, 'Ảnh thuộc R2 phải được chấp nhận');
assert.equal(sanitized.key, 'posts/2026/09/abc.webp');
assert.equal(sanitized.url, '/media/r2/posts/2026/09/abc.webp');
assert.equal(sanitized.width, 800);
assert.equal(MediaUploadService.sanitizeImageAttachment({ type: 'image', url: 'https://images.example.com/p.png' }), null);
assert.equal(MediaUploadService.sanitizeImageAttachment({ type: 'image', url: '/media/r2/avatars/24050126/a.webp' }), null);

// Ảnh legacy nhập từ Facebook (cùng origin) vẫn giữ được khi sửa bài cũ.
const legacy = MediaUploadService.sanitizeLegacyImageAttachment({ type: 'image', url: '/media/fb-import/10/0.jpg', title: 'Ảnh' });
assert.ok(legacy, 'Ảnh fb-import phải được chấp nhận');
assert.equal(legacy.url, '/media/fb-import/10/0.jpg');
assert.equal(legacy.key, null);
assert.equal(MediaUploadService.sanitizeLegacyImageAttachment({ type: 'image', url: 'https://evil.example.com/a.jpg' }), null);
assert.equal(MediaUploadService.sanitizeLegacyImageAttachment({ type: 'image', url: '/media/../etc/passwd' }), null);

// 4. Xử lý ảnh: ảnh tĩnh resize + WebP, GIF giữ nguyên animation.
const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#0ea5e9' } }).png().toBuffer();
const still = await MediaUploadService.processImageBuffer(png);
assert.equal(still.contentType, 'image/webp');
assert.ok(still.width <= 1600 && still.height <= 1600, 'Ảnh tĩnh phải được resize về tối đa 1600px');
assert.equal(still.animated, false);

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const animated = await MediaUploadService.processImageBuffer(gif);
assert.equal(animated.contentType, 'image/gif');
assert.equal(animated.buffer.length, gif.length, 'GIF phải được giữ nguyên byte-for-byte');
assert.equal(animated.animated, true);

await assert.rejects(
  MediaUploadService.processImageBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
  /không phải ảnh hợp lệ/
);

console.log('✓ Media storage: whitelist host R2, chống URL ngoài, resize ảnh tĩnh và giữ nguyên GIF.');
