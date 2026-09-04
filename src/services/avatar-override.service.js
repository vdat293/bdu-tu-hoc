import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isDatabaseConfigured, query, transaction } from '../db/database.js';

const OUTPUT_SIZE = 512;
const DEFAULT_MAX_SIZE_MB = 3;
const ALLOWED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp']);

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function requireDatabase() {
  if (!isDatabaseConfigured()) throw httpError('Database chưa được cấu hình.', 503);
}

function storageDir() {
  return path.resolve(process.env.AVATAR_STORAGE_DIR || path.join(process.cwd(), 'data', 'avatars'));
}

function maxUploadBytes() {
  const mb = Math.max(1, Math.min(10, Number(process.env.AVATAR_MAX_SIZE_MB) || DEFAULT_MAX_SIZE_MB));
  return Math.trunc(mb * 1024 * 1024);
}

function publicUrl(storageKey) {
  return `/media/avatars/${encodeURIComponent(storageKey)}`;
}

async function ensureStorageDir() {
  await fs.mkdir(storageDir(), { recursive: true, mode: 0o750 });
}

async function safeUnlink(storageKey) {
  if (!storageKey || path.basename(storageKey) !== storageKey) return;
  await fs.unlink(path.join(storageDir(), storageKey)).catch((error) => {
    if (error.code !== 'ENOENT') console.warn('[AvatarOverride] Không thể xóa file cũ:', error.message);
  });
}

async function processAvatarBuffer(buffer) {
  let inputMetadata;
  try {
    inputMetadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 25_000_000 }).metadata();
  } catch {
    throw httpError('File tải lên không phải ảnh hợp lệ.');
  }
  if (!ALLOWED_INPUT_FORMATS.has(inputMetadata.format)) {
    throw httpError('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
  }
  const processed = await sharp(buffer, { failOn: 'error', limitInputPixels: 25_000_000 })
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'centre', withoutEnlargement: false })
    .webp({ quality: 86, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { inputMetadata, processed };
}

function mapRow(row) {
  if (!row) return null;
  const overrideUrl = row.deleted_at ? null : (row.url_img || null);
  const bduUrl = row.bdu_avatar_url || null;
  return {
    mssv: row.mssv,
    name: row.full_name || row.mssv,
    override_url: overrideUrl,
    bdu_url: bduUrl,
    resolved_url: overrideUrl || bduUrl,
    source: overrideUrl ? 'override' : (bduUrl ? 'bdu' : 'initials'),
    storage_key: row.deleted_at ? null : (row.storage_key || null),
    original_filename: row.original_filename || null,
    mime_type: row.mime_type || null,
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    content_hash: row.content_hash || null,
    updated_by_mssv: row.updated_by_mssv || null,
    updated_at: row.updated_at || null
  };
}

export const AvatarOverrideService = {
  getStorageDir: storageDir,
  getMaxUploadBytes: maxUploadBytes,

  async ensureStorage() {
    await ensureStorageDir();
    return storageDir();
  },

  async getByMssv(mssv) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    if (!/^[A-Z0-9]{6,32}$/.test(cleanMssv)) throw httpError('MSSV không hợp lệ.');
    const result = await query(`
      SELECT students.mssv, students.full_name, students.avatar_url AS bdu_avatar_url,
             overrides.url_img, overrides.storage_key, overrides.original_filename,
             overrides.mime_type, overrides.file_size, overrides.width, overrides.height,
             overrides.content_hash, overrides.updated_by_mssv, overrides.updated_at,
             overrides.deleted_at
      FROM students
      LEFT JOIN student_avatar_overrides overrides
        ON overrides.mssv = students.mssv AND overrides.deleted_at IS NULL
      WHERE students.mssv = $1;
    `, [cleanMssv]);
    if (!result.rowCount) {
      return {
        mssv: cleanMssv,
        name: cleanMssv,
        override_url: null,
        bdu_url: null,
        resolved_url: null,
        source: 'initials',
        storage_key: null,
        original_filename: null,
        mime_type: null,
        file_size: null,
        width: null,
        height: null,
        content_hash: null,
        updated_by_mssv: null,
        updated_at: null
      };
    }
    return mapRow(result.rows[0]);
  },

  async list({ search = '', limit = 100 } = {}) {
    requireDatabase();
    const queryText = String(search || '').trim();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const result = await query(`
      SELECT students.mssv, students.full_name, students.avatar_url AS bdu_avatar_url,
             overrides.url_img, overrides.storage_key, overrides.original_filename,
             overrides.mime_type, overrides.file_size, overrides.width, overrides.height,
             overrides.content_hash, overrides.updated_by_mssv, overrides.updated_at,
             overrides.deleted_at
      FROM student_avatar_overrides overrides
      JOIN students ON students.mssv = overrides.mssv
      WHERE overrides.deleted_at IS NULL
        AND NULLIF(overrides.url_img, '') IS NOT NULL
        AND ($1::text = '' OR students.mssv ILIKE '%' || $1 || '%' OR students.full_name ILIKE '%' || $1 || '%')
      ORDER BY overrides.updated_at DESC
      LIMIT $2;
    `, [queryText, safeLimit]);
    return result.rows.map(mapRow);
  },

  async upload({ mssv, actorMssv, file }) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanActor = normalizeMssv(actorMssv);
    if (!/^[A-Z0-9]{6,32}$/.test(cleanMssv)) throw httpError('MSSV không hợp lệ.');
    if (!cleanActor) throw httpError('Thiếu người cập nhật ảnh.', 401);
    if (!file?.buffer?.length) throw httpError('Vui lòng chọn file ảnh.');
    if (file.buffer.length > maxUploadBytes()) throw httpError('Ảnh vượt quá dung lượng cho phép.', 413);

    const { inputMetadata, processed } = await processAvatarBuffer(file.buffer);
    const hash = crypto.createHash('sha256').update(processed.data).digest('hex');
    const storageKey = `${cleanMssv}-${hash.slice(0, 16)}-${Date.now()}.webp`;
    const finalPath = path.join(storageDir(), storageKey);
    const tempPath = path.join(storageDir(), `.${storageKey}.${crypto.randomUUID()}.tmp`);
    await ensureStorageDir();
    try {
      await fs.writeFile(tempPath, processed.data, { mode: 0o640 });
      await fs.rename(tempPath, finalPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw httpError(`Không thể lưu ảnh trên VPS: ${error.message}`, 500);
    }

    let previousStorageKey = null;
    try {
      await transaction(async (client) => {
        await client.query(`
          INSERT INTO students (mssv, full_name, is_active)
          VALUES ($1, '', FALSE)
          ON CONFLICT (mssv) DO NOTHING;
        `, [cleanMssv]);
        const previous = await client.query(
          'SELECT storage_key FROM student_avatar_overrides WHERE mssv = $1 FOR UPDATE',
          [cleanMssv]
        );
        previousStorageKey = previous.rows[0]?.storage_key || null;
        const urlImg = publicUrl(storageKey);
        await client.query(`
          INSERT INTO student_avatar_overrides (
            mssv, url_img, storage_key, original_filename, mime_type, file_size,
            width, height, content_hash, updated_by_mssv, deleted_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, $8, $9, NULL, NOW())
          ON CONFLICT (mssv) DO UPDATE SET
            url_img = EXCLUDED.url_img,
            storage_key = EXCLUDED.storage_key,
            original_filename = EXCLUDED.original_filename,
            mime_type = EXCLUDED.mime_type,
            file_size = EXCLUDED.file_size,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            content_hash = EXCLUDED.content_hash,
            updated_by_mssv = EXCLUDED.updated_by_mssv,
            deleted_at = NULL,
            updated_at = NOW();
        `, [
          cleanMssv,
          urlImg,
          storageKey,
          path.basename(String(file.originalname || 'avatar')),
          processed.data.length,
          processed.info.width,
          processed.info.height,
          hash,
          cleanActor
        ]);
        await client.query(`
          INSERT INTO student_avatar_override_audit
            (mssv, action, actor_mssv, url_img, storage_key, metadata)
          VALUES ($1, 'upload', $2, $3, $4, $5::jsonb);
        `, [cleanMssv, cleanActor, urlImg, storageKey, JSON.stringify({
          original_filename: path.basename(String(file.originalname || 'avatar')),
          input_format: inputMetadata.format,
          output_bytes: processed.data.length,
          width: processed.info.width,
          height: processed.info.height,
          content_hash: hash
        })]);
      });
    } catch (error) {
      await safeUnlink(storageKey);
      throw error;
    }

    if (previousStorageKey && previousStorageKey !== storageKey) await safeUnlink(previousStorageKey);
    return this.getByMssv(cleanMssv);
  },

  async remove({ mssv, actorMssv }) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanActor = normalizeMssv(actorMssv);
    if (!/^[A-Z0-9]{6,32}$/.test(cleanMssv)) throw httpError('MSSV không hợp lệ.');
    if (!cleanActor) throw httpError('Thiếu người xóa ảnh.', 401);
    let previousStorageKey = null;
    await transaction(async (client) => {
      const previous = await client.query(
        'SELECT storage_key, url_img FROM student_avatar_overrides WHERE mssv = $1 FOR UPDATE',
        [cleanMssv]
      );
      if (!previous.rowCount || !previous.rows[0].storage_key) throw httpError('MSSV này chưa có ảnh override.', 404);
      previousStorageKey = previous.rows[0].storage_key;
      await client.query(`
        UPDATE student_avatar_overrides
        SET url_img = NULL, storage_key = NULL, deleted_at = NOW(),
            updated_by_mssv = $2, updated_at = NOW()
        WHERE mssv = $1;
      `, [cleanMssv, cleanActor]);
      await client.query(`
        INSERT INTO student_avatar_override_audit
          (mssv, action, actor_mssv, url_img, storage_key)
        VALUES ($1, 'remove', $2, $3, $4);
      `, [cleanMssv, cleanActor, previous.rows[0].url_img, previousStorageKey]);
    });
    await safeUnlink(previousStorageKey);
    return this.getByMssv(cleanMssv);
  }
};

export const AvatarOverrideInternals = {
  ALLOWED_INPUT_FORMATS,
  OUTPUT_SIZE,
  maxUploadBytes,
  normalizeMssv,
  processAvatarBuffer,
  publicUrl
};
