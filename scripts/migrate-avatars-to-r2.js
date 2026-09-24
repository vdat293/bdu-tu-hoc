/**
 * Migrate ảnh đại diện cũ trong volume `data/avatars` lên Cloudflare R2.
 *
 * Cách dùng:
 *   node scripts/migrate-avatars-to-r2.js           # xem trước (dry-run)
 *   node scripts/migrate-avatars-to-r2.js --apply   # upload + cập nhật DB
 *
 * Script chỉ đụng tới các bản ghi `student_avatar_overrides` có storage_key
 * trùng tên file cũ. File không có bản ghi DB sẽ được bỏ qua (không upload rác).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import '../src/config/load-env.js';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { MediaStorageService } from '../src/services/media-storage.service.js';

const apply = process.argv.slice(2).includes('--apply');
const storageDir = path.resolve(process.env.AVATAR_STORAGE_DIR || path.join(process.cwd(), 'data', 'avatars'));

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

async function main() {
  if (!MediaStorageService.isConfigured()) {
    throw new Error('R2 chưa được cấu hình. Kiểm tra R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET trong .env.');
  }
  if (!isDatabaseConfigured()) {
    throw new Error('Chưa cấu hình DATABASE_URL để đối chiếu storage_key.');
  }

  const entries = await fs.readdir(storageDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    console.log(`Không tìm thấy ảnh cũ trong ${storageDir}.`);
    return;
  }

  console.log(`${apply ? 'Migrate' : 'Dry-run'} ${files.length} file trong ${storageDir}`);
  let migrated = 0;
  let skipped = 0;

  for (const fileName of files) {
    const rows = (await query(
      'SELECT mssv FROM student_avatar_overrides WHERE storage_key = $1',
      [fileName]
    )).rows;

    if (rows.length === 0) {
      console.log(`• Bỏ qua ${fileName}: không còn bản ghi DB nào trỏ tới.`);
      skipped += 1;
      continue;
    }

    const mssv = rows[0].mssv;
    const key = `avatars/${mssv}/${fileName}`;
    const url = MediaStorageService.publicUrl(key);

    if (!apply) {
      console.log(`• Sẽ upload ${fileName} -> ${key}`);
      continue;
    }

    const buffer = await fs.readFile(path.join(storageDir, fileName));
    await MediaStorageService.putObject({
      key,
      buffer,
      contentType: CONTENT_TYPES[path.extname(fileName).toLowerCase()] || 'image/webp'
    });
    await query(`
      UPDATE student_avatar_overrides
      SET storage_key = $1, url_img = $2, updated_at = NOW()
      WHERE mssv = $3 AND storage_key = $4;
    `, [key, url, mssv, fileName]);
    console.log(`✓ ${fileName} -> ${key}`);
    migrated += 1;
  }

  if (apply) {
    console.log(`\nHoàn tất: ${migrated} ảnh đã lên R2, bỏ qua ${skipped} file.`);
    console.log('Kiểm tra vài MSSV trên web rồi có thể xoá volume data/avatars cũ.');
  } else {
    console.log(`\nDry-run: ${files.length} file, bỏ qua ${skipped}. Chạy lại với --apply để thực hiện.`);
  }
}

main()
  .catch((error) => {
    console.error(`Migrate avatar thất bại: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    MediaStorageService.destroy();
    await closeDatabase().catch(() => {});
  });
