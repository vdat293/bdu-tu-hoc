/**
 * Xử lý & tải ảnh người dùng lên R2 (avatar dùng service riêng).
 *
 * - Ảnh tĩnh JPG/PNG/WebP: tự xoay theo EXIF, resize tối đa 1600px cạnh dài,
 *   chuyển WebP q82 để tiết kiệm dung lượng.
 * - GIF: giữ nguyên file gốc để còn animation; chỉ kiểm tra magic bytes,
 *   kích thước khung và số frame.
 * - Mọi attachment ảnh trong bài viết/bình luận phải trỏ đúng host R2 của hệ
 *   thống (whitelist prefix posts/…, comments/…), chặn nhúng ảnh ngoài.
 */

import sharp from 'sharp';
import { MediaStorageService, mediaKeyFromUrl, normalizeMediaKey } from './media-storage.service.js';

const STILL_FORMATS = new Set(['jpeg', 'png', 'webp']);
const ALLOWED_IMAGE_PREFIXES = ['posts/', 'comments/'];
export const MAX_POST_IMAGES = 5;
export const MAX_COMMENT_IMAGES = 3;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function imageMaxBytes() {
  return Math.trunc(envNumber('MEDIA_IMAGE_MAX_MB', 8) * 1024 * 1024);
}

function gifMaxBytes() {
  return Math.trunc(envNumber('MEDIA_GIF_MAX_MB', 8) * 1024 * 1024);
}

function maxPixels() {
  return Math.trunc(envNumber('MEDIA_IMAGE_MAX_PIXELS', 25_000_000));
}

function maxGifFrames() {
  return Math.trunc(envNumber('MEDIA_GIF_MAX_FRAMES', 300));
}

export function sniffImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Kiểm tra buffer và trả về descriptor thống nhất cho cả ảnh tĩnh lẫn GIF.
 * Không cần database/R2 nên unit test được trực tiếp.
 */
export async function processImageBuffer(buffer) {
  if (!buffer?.length) throw httpError('Vui lòng chọn file ảnh.');
  const format = sniffImageFormat(buffer);
  if (!format) throw httpError('File tải lên không phải ảnh hợp lệ (chỉ nhận JPG, PNG, WebP, GIF).');

  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: maxPixels() }).metadata();
  } catch {
    throw httpError('File tải lên không phải ảnh hợp lệ hoặc ảnh bị hỏng.');
  }
  if (!metadata?.format) throw httpError('File tải lên không phải ảnh hợp lệ.');

  if (format === 'gif' || metadata.format === 'gif') {
    if (buffer.length > gifMaxBytes()) {
      throw httpError(`GIF vượt quá ${Math.round(gifMaxBytes() / 1024 / 1024)}MB cho phép.`, 413);
    }
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const pages = Math.max(1, Number(metadata.pages || 1));
    if (!width || !height) throw httpError('Không đọc được kích thước GIF.');
    if (width * height > maxPixels()) throw httpError('GIF có kích thước khung quá lớn.');
    if (pages > maxGifFrames()) throw httpError(`GIF vượt quá ${maxGifFrames()} frame cho phép.`);
    return {
      buffer,
      format: 'gif',
      contentType: 'image/gif',
      extension: '.gif',
      width,
      height,
      pages,
      bytes: buffer.length,
      animated: true
    };
  }

  if (!STILL_FORMATS.has(metadata.format)) {
    throw httpError('Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.');
  }
  if (buffer.length > imageMaxBytes()) {
    throw httpError(`Ảnh vượt quá ${Math.round(imageMaxBytes() / 1024 / 1024)}MB cho phép.`, 413);
  }
  const processed = await sharp(buffer, { failOn: 'error', limitInputPixels: maxPixels() })
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: processed.data,
    format: 'webp',
    contentType: 'image/webp',
    extension: '.webp',
    width: processed.info.width,
    height: processed.info.height,
    pages: 1,
    bytes: processed.data.length,
    animated: false
  };
}

// ---------------------------------------------------------------------------
// Throttle upload theo MSSV (bộ đếm trong bộ nhớ, đủ cho 1 instance Node).
// ---------------------------------------------------------------------------
const uploadWindows = new Map();

function assertUploadQuota(mssv) {
  const limit = Math.trunc(envNumber('MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR', 60));
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const key = String(mssv || '').toUpperCase();
  const recent = (uploadWindows.get(key) || []).filter((time) => time > oneHourAgo);
  if (recent.length >= limit) {
    throw httpError(`Bạn đã tải lên quá nhiều ảnh (${limit} ảnh/giờ). Vui lòng thử lại sau.`, 429);
  }
  recent.push(now);
  uploadWindows.set(key, recent);
  if (uploadWindows.size > 5000) {
    for (const [mapKey, times] of uploadWindows) {
      if (!times.some((time) => time > oneHourAgo)) uploadWindows.delete(mapKey);
    }
  }
}

function kindPrefix(kind) {
  return String(kind || '').trim().toLowerCase() === 'comment' ? 'comments' : 'posts';
}

/**
 * Tải một ảnh/GIF lên R2 và trả descriptor để client gắn vào attachments.
 */
async function uploadImage({ mssv, file, kind = 'post' }) {
  MediaStorageService.assertConfigured();
  const cleanMssv = String(mssv || '').trim().toUpperCase();
  if (!cleanMssv) throw httpError('Thiếu người tải ảnh.', 401);
  if (!file?.buffer?.length) throw httpError('Vui lòng chọn file ảnh.');

  const processed = await processImageBuffer(file.buffer);
  assertUploadQuota(cleanMssv);

  const key = MediaStorageService.buildKey(kindPrefix(kind), processed.extension);
  const stored = await MediaStorageService.putObject({
    key,
    buffer: processed.buffer,
    contentType: processed.contentType
  });

  return {
    type: 'image',
    url: stored.url,
    key: stored.key,
    width: processed.width,
    height: processed.height,
    bytes: stored.bytes,
    mime: processed.contentType,
    animated: processed.animated,
    original_filename: String(file.originalname || '').split(/[\\/]/).pop().slice(0, 180)
  };
}

export function isImageAttachment(item) {
  return Boolean(item && typeof item === 'object' && item.type === 'image');
}

/**
 * Chuẩn hoá một attachment ảnh do client gửi lên. Trả null nếu URL/key không
 * thuộc R2 của hệ thống (không cho nhúng ảnh từ host lạ).
 */
export function sanitizeImageAttachment(item) {
  if (!item || typeof item !== 'object') return null;
  let key = mediaKeyFromUrl(item.url, { allowedPrefixes: ALLOWED_IMAGE_PREFIXES });
  if (!key) {
    const rawKey = normalizeMediaKey(item.key);
    if (rawKey && ALLOWED_IMAGE_PREFIXES.some((prefix) => rawKey.startsWith(prefix))) key = rawKey;
  }
  if (!key) return null;
  const url = MediaStorageService.publicUrl(key);
  if (!url) return null;
  const cleanNumber = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : null);
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, 180) : '';
  return {
    type: 'image',
    url,
    key,
    title,
    width: cleanNumber(item.width),
    height: cleanNumber(item.height),
    bytes: cleanNumber(item.bytes),
    mime: typeof item.mime === 'string' && item.mime.startsWith('image/') ? item.mime.slice(0, 40) : null,
    animated: Boolean(item.animated)
  };
}

export function countImageAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).filter(isImageAttachment).length;
}

/**
 * Ảnh legacy nhập từ Facebook nằm ở `/media/fb-import/...` (cùng origin).
 * Khi sửa bài cũ, các ảnh này phải được giữ nguyên thay vì bị coi là URL lạ.
 */
export function sanitizeLegacyImageAttachment(item) {
  const url = String(item?.url || '').trim();
  if (!url.startsWith('/media/') || url.includes('..')) return null;
  const cleanNumber = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : null);
  return {
    type: 'image',
    url,
    key: null,
    title: typeof item.title === 'string' ? item.title.trim().slice(0, 180) : '',
    width: cleanNumber(item.width),
    height: cleanNumber(item.height),
    bytes: cleanNumber(item.bytes),
    mime: typeof item.mime === 'string' && item.mime.startsWith('image/') ? item.mime.slice(0, 40) : null,
    animated: Boolean(item.animated)
  };
}

export const MediaUploadService = {
  getMaxImageBytes: imageMaxBytes,
  getMaxGifBytes: gifMaxBytes,
  processImageBuffer,
  uploadImage,
  isImageAttachment,
  sanitizeImageAttachment,
  sanitizeLegacyImageAttachment,
  countImageAttachments,
  MAX_POST_IMAGES,
  MAX_COMMENT_IMAGES
};

export const MediaUploadInternals = {
  sniffImageFormat,
  processImageBuffer,
  sanitizeImageAttachment,
  assertUploadQuota,
  uploadWindows
};
