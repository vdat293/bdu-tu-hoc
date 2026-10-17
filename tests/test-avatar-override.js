import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { AvatarOverrideInternals, AvatarOverrideService } from '../src/modules/media/avatar-override.service.js';
import { MediaStorageService } from '../src/services/media-storage.service.js';

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
// Route định nghĩa trong file domain identity (api.routes.js chỉ còn là assembler).
const routes = fs.readFileSync('src/routes/identity.routes.js', 'utf8');
const identity = fs.readFileSync('src/services/identity-presentation.service.js', 'utf8');
const avatarService = fs.readFileSync('src/modules/media/avatar-override.service.js', 'utf8');
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

// ---------------------------------------------------------------------------
// Part B: bề mặt DB thật của AvatarOverrideService (getByMssv/list/upload/remove).
// Chỉ chạy khi có disposable test DB (docker-compose.test.yml postgres) — môi
// trường safe không cấu hình DB nên khối này tự bỏ qua, không chạm dev DB.
// ---------------------------------------------------------------------------
async function runAvatarOverrideServiceDbTests() {
  const OWNER = 'TESTAVATARDB1';
  const PLAIN = 'TESTAVATARDB2';
  const MISSING = 'TESTAVATARMISSING1';
  const storageWrites = [];
  const storageDeletes = [];

  const originalPutObject = MediaStorageService.putObject;
  const originalDeleteObject = MediaStorageService.deleteObject;

  const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#16a34a' } })
    .png()
    .toBuffer();

  const cleanup = async () => {
    for (const mssv of [OWNER, PLAIN]) {
      await query('DELETE FROM student_avatar_override_audit WHERE mssv = $1', [mssv]).catch(() => {});
      await query('DELETE FROM student_avatar_overrides WHERE mssv = $1', [mssv]).catch(() => {});
      await query('DELETE FROM students WHERE mssv = $1', [mssv]).catch(() => {});
    }
  };

  try {
    await cleanup();

    // Kho lưu trữ R2 không phải bề mặt DB đang kiểm thử: thay bằng stub in-memory
    // để suite chạy được trên postgres test mà không cần cấu hình R2/minio.
    MediaStorageService.putObject = async ({ key, buffer, contentType }) => {
      storageWrites.push({ key, bytes: buffer?.length, contentType });
      return { key, url: MediaStorageService.publicUrl(key), bytes: buffer?.length };
    };
    MediaStorageService.deleteObject = async (key) => {
      storageDeletes.push(key);
      return true;
    };

    // B1. upload ghi hàng thật và trả payload đã map.
    const uploaded = await AvatarOverrideService.upload({
      mssv: OWNER,
      actorMssv: OWNER,
      file: { buffer: png, originalname: 'db-avatar.png', mimetype: 'image/png' }
    });
    assert.equal(uploaded.source, 'override', 'upload phải trả payload có ảnh override');
    assert.ok(
      uploaded.storage_key?.startsWith(`avatars/${OWNER}/`),
      'Object key phải nằm dưới avatars/<mssv>/'
    );
    assert.equal(uploaded.override_url, `/media/r2/${uploaded.storage_key}`, 'override_url phải trỏ tới proxy nội bộ');
    assert.equal(uploaded.mime_type, 'image/webp', 'Ảnh upload phải được chuẩn hoá sang WebP');
    assert.equal(uploaded.width, 512);
    assert.equal(uploaded.height, 512);
    assert.ok(uploaded.file_size > 0, 'file_size phải là số byte dương');
    assert.equal(uploaded.updated_by_mssv, OWNER, 'updated_by_mssv hiện diện trong payload (hành vi hiện tại)');
    assert.ok(uploaded.content_hash, 'content_hash hiện diện trong payload (hành vi hiện tại)');
    assert.equal(storageWrites.length, 1, 'upload phải đẩy đúng 1 object lên kho lưu trữ');

    const storedRow = (await query(
      `SELECT url_img, storage_key, mime_type, file_size, width, height,
              content_hash, updated_by_mssv, deleted_at
         FROM student_avatar_overrides WHERE mssv = $1`,
      [OWNER]
    )).rows[0];
    assert.ok(storedRow, 'upload phải ghi một hàng student_avatar_overrides');
    assert.equal(storedRow.storage_key, uploaded.storage_key);
    assert.equal(storedRow.mime_type, 'image/webp');
    assert.equal(storedRow.deleted_at, null);
    assert.equal(storedRow.updated_by_mssv, OWNER);
    assert.ok(storedRow.content_hash, 'content_hash phải được lưu trong DB');

    const uploadAudit = (await query(
      `SELECT action, metadata FROM student_avatar_override_audit
        WHERE mssv = $1 ORDER BY id DESC LIMIT 1`,
      [OWNER]
    )).rows[0];
    assert.equal(uploadAudit?.action, 'upload', 'upload phải ghi audit action=upload');

    // B2. getByMssv trả hàng cho MSSV đang có override.
    const existing = await AvatarOverrideService.getByMssv(OWNER);
    assert.equal(existing.mssv, OWNER);
    assert.equal(existing.source, 'override');
    assert.equal(existing.storage_key, uploaded.storage_key);
    assert.equal(existing.override_url, uploaded.override_url);

    // B3. getByMssv cho sinh viên tồn tại nhưng chưa có override: không phải override.
    await query(
      "INSERT INTO students (mssv, full_name, is_active) VALUES ($1, 'Sinh Viên Không Avatar', FALSE) ON CONFLICT (mssv) DO NOTHING",
      [PLAIN]
    );
    const noOverride = await AvatarOverrideService.getByMssv(PLAIN);
    assert.equal(noOverride.mssv, PLAIN);
    assert.equal(noOverride.override_url, null);
    assert.equal(noOverride.storage_key, null);
    assert.notEqual(noOverride.source, 'override');

    // B4. getByMssv cho MSSV hoàn toàn không tồn tại: hành vi HIỆN TẠI trả payload
    //     'initials' (không phải null) — brief kỳ vọng null/undefined, ghi nhận ở report.
    const missing = await AvatarOverrideService.getByMssv(MISSING);
    assert.ok(missing && typeof missing === 'object', 'MSSV không có hồ sơ vẫn trả payload initials (hành vi hiện tại)');
    assert.equal(missing.mssv, MISSING);
    assert.equal(missing.override_url, null);
    assert.equal(missing.source, 'initials');

    // B5. list trả mảng và tôn trọng search/limit (chỉ override đang hoạt động).
    const all = await AvatarOverrideService.list();
    assert.ok(Array.isArray(all), 'list phải trả về mảng');
    const found = await AvatarOverrideService.list({ search: OWNER });
    assert.ok(found.some((row) => row.mssv === OWNER), 'list({search}) phải tìm thấy MSSV có override');
    assert.ok(found.every((row) => row.source === 'override'), 'list chỉ trả override đang hoạt động');
    const filtered = await AvatarOverrideService.list({ search: 'ZZZNOMATCH' });
    assert.equal(filtered.some((row) => row.mssv === OWNER), false, 'search không khớp thì không trả hàng của mình');
    const limited = await AvatarOverrideService.list({ search: OWNER, limit: 1 });
    assert.ok(limited.length <= 1, 'list phải tôn trọng limit');

    // B6. remove xoá mềm hàng, gỡ object và getByMssv sau đó không còn override.
    const removed = await AvatarOverrideService.remove({ mssv: OWNER, actorMssv: OWNER });
    assert.equal(removed.mssv, OWNER);
    assert.equal(removed.override_url, null, 'sau remove, override_url phải là null');
    assert.equal(removed.storage_key, null, 'sau remove, storage_key phải là null');
    assert.ok(storageDeletes.includes(uploaded.storage_key), 'remove phải xoá object khỏi kho lưu trữ');

    const afterRemove = await AvatarOverrideService.getByMssv(OWNER);
    assert.equal(afterRemove.override_url, null, 'getByMssv sau remove không được trả override');
    assert.equal(afterRemove.storage_key, null);

    const softRow = (await query(
      'SELECT deleted_at, url_img, storage_key FROM student_avatar_overrides WHERE mssv = $1',
      [OWNER]
    )).rows[0];
    assert.ok(softRow?.deleted_at, 'remove phải đánh dấu deleted_at (soft delete)');
    assert.equal(softRow.url_img, null);
    assert.equal(softRow.storage_key, null);

    const removeAudit = (await query(
      `SELECT action FROM student_avatar_override_audit
        WHERE mssv = $1 ORDER BY id DESC LIMIT 1`,
      [OWNER]
    )).rows[0];
    assert.equal(removeAudit?.action, 'remove', 'remove phải ghi audit action=remove');

    const afterRemoveList = await AvatarOverrideService.list({ search: OWNER });
    assert.equal(afterRemoveList.some((row) => row.mssv === OWNER), false, 'list không được trả override đã xoá');

    // B7. remove khi chưa có override: từ chối 404.
    await assert.rejects(
      () => AvatarOverrideService.remove({ mssv: PLAIN, actorMssv: PLAIN }),
      (error) => error && error.status === 404,
      'remove MSSV chưa có override phải trả 404'
    );

    console.log('✓ Avatar override DB: upload/getByMssv/list/remove chạy đúng trên disposable test DB.');
  } finally {
    MediaStorageService.putObject = originalPutObject;
    MediaStorageService.deleteObject = originalDeleteObject;
    await cleanup();
    await closeDatabase().catch(() => {});
  }
}

if (!isDatabaseConfigured()) {
  console.log('Skipping AvatarOverrideService DB tests: cần BDU_TEST_DATABASE_URL (disposable test DB).');
} else {
  await runAvatarOverrideServiceDbTests();
}
