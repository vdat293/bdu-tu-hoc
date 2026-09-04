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
assert.equal(AvatarOverrideInternals.publicUrl('24050126-test.webp'), '/media/avatars/24050126-test.webp');
await assert.rejects(
  AvatarOverrideInternals.processAvatarBuffer(Buffer.from('not-an-image')),
  /không phải ảnh hợp lệ/
);

const migration = fs.readFileSync('migrations/017_student_avatar_overrides.sql', 'utf8');
const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
const identity = fs.readFileSync('src/services/identity-presentation.service.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');

assert.match(migration, /student_avatar_overrides/);
assert.match(routes, /admin\/avatars\/:mssv/);
assert.match(identity, /avatar_override_url\s*\|\|\s*row\.bdu_avatar_url/);
assert.match(adminHtml, /avatar-form/);

console.log('✓ Avatar override is resized to WebP and wired with BDU fallback.');
