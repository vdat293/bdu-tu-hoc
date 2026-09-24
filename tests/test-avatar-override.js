import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { AvatarOverrideInternals } from '../src/services/avatar-override.service.js';

const source = await sharp({
  create: { width: 800, height: 400, channels: 3, background: '#2563eb' }
}).png().toBuffer();
const { processed } = await AvatarOverrideInternals.processAvatarBuffer(source);
const metadata = await sharp(processed.data).metadata();

assert.equal(metadata.format, 'webp');
assert.equal(metadata.width, 512);
assert.equal(metadata.height, 512);

// URL avatar đi qua tầng media R2: mặc định là proxy nội bộ, có CDN thì dùng CDN.
process.env.R2_MEDIA_PROXY_PATH = '/media/r2';
delete process.env.R2_PUBLIC_BASE_URL;
assert.equal(AvatarOverrideInternals.publicUrl('avatars/24050126-test.webp'), '/media/r2/avatars/24050126-test.webp');
process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.test';
assert.equal(AvatarOverrideInternals.publicUrl('avatars/24050126-test.webp'), 'https://cdn.example.test/avatars/24050126-test.webp');
delete process.env.R2_PUBLIC_BASE_URL;

await assert.rejects(
  AvatarOverrideInternals.processAvatarBuffer(Buffer.from('not-an-image')),
  /không phải ảnh hợp lệ/
);

const migration = fs.readFileSync('migrations/017_student_avatar_overrides.sql', 'utf8');
const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
const identity = fs.readFileSync('src/services/identity-presentation.service.js', 'utf8');
const avatarService = fs.readFileSync('src/services/avatar-override.service.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');

assert.match(migration, /student_avatar_overrides/);
assert.match(routes, /router\.post\('\/me\/avatar'/);
assert.doesNotMatch(routes, /router\.post\('\/admin\/avatars/);
assert.match(identity, /avatar_override_url\s*\|\|\s*row\.bdu_avatar_url/);
assert.match(avatarService, /MediaStorageService\.putObject/);
assert.doesNotMatch(avatarService, /fs\.writeFile|AVATAR_STORAGE_DIR/);
assert.doesNotMatch(adminHtml, /avatar-form/);
assert.match(adminHtml, /avatar-remove/);

console.log('✓ Avatar override: người dùng tự upload lên R2, resize WebP 512 và vẫn fallback ảnh BDU.');
