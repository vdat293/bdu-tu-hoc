/**
 * Lưu trữ media trên Cloudflare R2 (S3-compatible).
 *
 * Quy ước:
 * - Node nhận file từ multer (memory) rồi đẩy thẳng lên R2, KHÔNG ghi file
 *   runtime xuống ổ đĩa/VPS nữa.
 * - URL trả về cho client:
 *   + Có R2_PUBLIC_BASE_URL (custom domain hoặc r2.dev) -> URL CDN tuyệt đối.
 *   + Chưa cấu hình -> đường dẫn nội bộ `${R2_MEDIA_PROXY_PATH}/<key>` do
 *     server stream từ R2 (route `/media/r2/*` trong server.js).
 *   Nhờ vậy đổi hạ tầng sau này chỉ cần set biến môi trường, không cần
 *   migrate lại database.
 * - Bucket để private; mọi lượt đọc public đều đi qua CDN/proxy có whitelist
 *   key nên không lộ object ngoài luồng.
 */

import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DEFAULT_PROXY_PATH = '/media/r2';

function envValue(name) {
  return String(process.env[name] || '').trim();
}

export function getMediaConfig() {
  const accountId = envValue('R2_ACCOUNT_ID');
  const endpoint = envValue('R2_ENDPOINT')
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const publicBaseUrl = envValue('R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
  const proxyPathRaw = envValue('R2_MEDIA_PROXY_PATH') || DEFAULT_PROXY_PATH;
  const proxyPath = `/${proxyPathRaw.replace(/^\/+|\/+$/g, '') || 'media/r2'}`;
  return {
    accountId,
    endpoint,
    bucket: envValue('R2_BUCKET'),
    accessKeyId: envValue('R2_ACCESS_KEY_ID'),
    secretAccessKey: envValue('R2_SECRET_ACCESS_KEY'),
    publicBaseUrl,
    proxyPath
  };
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isConfigured(config = getMediaConfig()) {
  return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey);
}

function assertConfigured() {
  if (isConfigured()) return;
  throw httpError(
    'Cloudflare R2 chưa được cấu hình. Đặt R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_BUCKET trong .env.',
    503
  );
}

let cachedClient = null;
let cachedClientSignature = '';

function destroy() {
  if (cachedClient) {
    try { cachedClient.destroy(); } catch { /* bỏ qua */ }
  }
  cachedClient = null;
  cachedClientSignature = '';
}

function getClient() {
  assertConfigured();
  const config = getMediaConfig();
  const signature = `${config.endpoint}|${config.accessKeyId}|${config.bucket}`;
  if (cachedClient && cachedClientSignature === signature) return cachedClient;
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  cachedClientSignature = signature;
  return cachedClient;
}

/**
 * Chuẩn hoá object key: bỏ dấu `/` đầu, chặn path traversal và ký tự lạ.
 */
export function normalizeMediaKey(key) {
  const clean = String(key || '').trim().replace(/^\/+/, '');
  if (!clean || clean.includes('..') || !KEY_PATTERN.test(clean)) return null;
  return clean;
}

export function buildMediaKey(prefix, extension) {
  const cleanPrefix = String(prefix || '').trim().replace(/^\/+|\/+$/g, '');
  if (!cleanPrefix || cleanPrefix.includes('..') || !KEY_PATTERN.test(cleanPrefix)) {
    throw httpError('Tiền tố lưu trữ không hợp lệ.', 500);
  }
  const cleanExtension = String(extension || '').startsWith('.') ? String(extension).toLowerCase() : `.${String(extension || '').toLowerCase()}`;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${cleanPrefix}/${year}/${month}/${id}${cleanExtension}`;
}

function publicUrl(key) {
  const cleanKey = normalizeMediaKey(key);
  if (!cleanKey) return null;
  const config = getMediaConfig();
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${cleanKey}`;
  return `${config.proxyPath}/${cleanKey}`;
}

/**
 * Nhận diện key từ URL do client gửi lên (URL CDN hoặc proxy nội bộ).
 * Chỉ chấp nhận đúng host/prefix của hệ thống, chặn nhét ảnh ngoài.
 */
export function mediaKeyFromUrl(url, { allowedPrefixes = null } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const config = getMediaConfig();
  let key = null;

  if (config.publicBaseUrl && raw.startsWith(`${config.publicBaseUrl}/`)) {
    try {
      const parsed = new URL(raw);
      const base = new URL(config.publicBaseUrl);
      if (parsed.host !== base.host || parsed.protocol !== base.protocol) return null;
    } catch {
      return null;
    }
    key = normalizeMediaKey(raw.slice(config.publicBaseUrl.length + 1));
  } else {
    try {
      const parsed = new URL(raw, 'http://internal.local');
      if (parsed.pathname.startsWith(`${config.proxyPath}/`)) {
        key = normalizeMediaKey(parsed.pathname.slice(config.proxyPath.length + 1));
      }
    } catch {
      return null;
    }
  }

  if (!key) return null;
  if (Array.isArray(allowedPrefixes) && allowedPrefixes.length > 0) {
    const allowed = allowedPrefixes.some((prefix) => key.startsWith(prefix));
    if (!allowed) return null;
  }
  return key;
}

async function putObject({ key, buffer, contentType, cacheControl = 'public, max-age=31536000, immutable' }) {
  assertConfigured();
  const cleanKey = normalizeMediaKey(key);
  if (!cleanKey) throw httpError('Key lưu trữ không hợp lệ.', 400);
  if (!buffer?.length) throw httpError('Không có dữ liệu để tải lên.', 400);
  const config = getMediaConfig();
  await getClient().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: cleanKey,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: cacheControl
  }));
  return { key: cleanKey, url: publicUrl(cleanKey), bytes: buffer.length };
}

/**
 * Xoá best-effort: lỗi mạng/R2 không được làm hỏng luồng chính (đổi avatar,
 * gỡ ảnh khỏi bài viết...). Object mồ côi sẽ được job dọn sau nếu cần.
 */
async function deleteObject(key) {
  const cleanKey = normalizeMediaKey(key);
  if (!cleanKey || !isConfigured()) return false;
  try {
    const config = getMediaConfig();
    await getClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: cleanKey }));
    return true;
  } catch (error) {
    console.warn(`[R2] Không thể xoá object "${cleanKey}":`, error.message);
    return false;
  }
}

async function getObject(key) {
  assertConfigured();
  const cleanKey = normalizeMediaKey(key);
  if (!cleanKey) throw httpError('Không tìm thấy ảnh.', 404);
  const config = getMediaConfig();
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket: config.bucket, Key: cleanKey }));
    return {
      body: result.Body,
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: result.ContentLength ?? null,
      etag: result.ETag || null
    };
  } catch (error) {
    if (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error?.name)) {
      throw httpError('Không tìm thấy ảnh.', 404);
    }
    throw error;
  }
}

export const MediaStorageService = {
  getConfig: getMediaConfig,
  isConfigured,
  assertConfigured,
  buildKey: buildMediaKey,
  normalizeKey: normalizeMediaKey,
  keyFromUrl: mediaKeyFromUrl,
  publicUrl,
  putObject,
  deleteObject,
  getObject,
  destroy
};

export const MediaStorageInternals = {
  KEY_PATTERN,
  normalizeMediaKey,
  publicUrl,
  mediaKeyFromUrl
};
