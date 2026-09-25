/**
 * Phần dùng chung cho hệ thống backup DB định kỳ (db-backup*.js).
 *
 * Nguyên tắc bất di bất dịch ở đây:
 * - Bucket backup PHẢI riêng (`BACKUP_R2_BUCKET`). Không bao giờ dùng chung
 *   bucket media (`R2_BUCKET`) để tránh rotate vô tình xoá ảnh/bài viết.
 * - Object backup chỉ được xoá khi key khớp `db/...` pattern do chính script này
 *   sinh ra. Key lạ (do người dùng tự đẩy lên) luôn được bỏ qua.
 * - Không bao giờ log connection string, mật khẩu, PGPASSWORD hay
 *   R2 secret key. Mọi dòng log đi qua `redactForLog`.
 */

import { execFile } from 'node:child_process';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

/** Tiền tố duy nhất được phép liệt kê/ghi/xoá. */
export const BACKUP_KEY_PREFIX = 'db/';

/** Format manifest phải khớp 1:1 với scripts/db-dump.js và db-restore.js. */
export const MANIFEST_FORMAT = 'bdu-postgres-dump';
export const MANIFEST_VERSION = 1;

/**
 * Key backup hợp lệ: db/YYYY/MM/<YYYYMMDD>T<HHMMSS>Z-<sha8>.dump
 * (và bản manifest tương ứng). Siết chặt để rotate chỉ chạm vào object
 * do script backup tạo ra.
 */
export const DUMP_KEY_PATTERN = /^db\/\d{4}\/\d{2}\/\d{8}T\d{6}Z-[0-9a-f]{8}\.dump$/;
export const MANIFEST_KEY_PATTERN = /^db\/\d{4}\/\d{2}\/\d{8}T\d{6}Z-[0-9a-f]{8}\.dump\.manifest\.json$/;

/** Host được phép chạy restore drill (xem db-backup-verify.js). */
export const DRILL_LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'postgres']);

const CONNECTION_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

export function envValue(name) {
  return String(process.env[name] || '').trim();
}

export function envFlag(name, fallback = false) {
  const raw = envValue(name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

export function parseIntEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = envValue(name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} phải là số nguyên không âm (hiện tại: "${raw}").`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`${name} phải nằm trong khoảng ${min}..${max} (hiện tại: ${value}).`);
  }
  return value;
}

/** Timestamp UTC dạng `YYYYMMDDTHHMMSSZ` — dùng cho tên file lẫn object key. */
export function formatUtcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function logTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function logInfo(scope, message) {
  console.log(`[${logTimestamp()}] [${scope}] ${message}`);
}

export function logWarn(scope, message) {
  console.warn(`[${logTimestamp()}] [${scope}] ⚠️  ${message}`);
}

export function logError(scope, message) {
  console.error(`[${logTimestamp()}] [${scope}] ❌ ${message}`);
}

/**
 * Bỏ mọi bí mật khỏi text trước khi in ra log. Áp dụng cho cả output của
 * `pg_dump`/`pg_restore` (chúng có thể in ra chuỗi kết nối khi lỗi).
 */
export function redactForLog(text, secrets = []) {
  let safe = String(text ?? '');
  for (const secret of secrets) {
    const value = String(secret || '');
    if (value.length < 4) continue;
    safe = safe.split(value).join('***');
  }
  safe = safe.replace(CONNECTION_URL_PATTERN, 'postgres://***@<redacted>');
  return safe;
}

/** Chạy tiến trình con bằng execFile + mảng args (KHÔNG qua shell). */
export function runProcess(bin, args, { env, timeoutMs = 15 * 60_000, maxBuffer = 32 * 1024 * 1024, onChild } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { env, timeout: timeoutMs, maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          resolve({ ok: false, code: 1, stdout: stdout || '', stderr: stderr || '', failed: true, error });
          return;
        }
        const code = error ? Number(error.code) || 1 : 0;
        resolve({
          ok: code === 0,
          code,
          stdout: stdout || '',
          stderr: stderr || '',
          timedOut: Boolean(error?.killed),
          failed: Boolean(error)
        });
      }
    );
    if (typeof onChild === 'function' && child) onChild(child);
  });
}

/**
 * Cấu hình R2 riêng cho backup. Cùng tài khoản R2 là được, nhưng BUCKET
 * phải khác `R2_BUCKET` (bucket media).
 */
export function getBackupStorageConfig() {
  const accountId = envValue('R2_ACCOUNT_ID');
  const endpoint = envValue('R2_ENDPOINT')
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = envValue('BACKUP_R2_BUCKET');
  const accessKeyId = envValue('R2_ACCESS_KEY_ID');
  const secretAccessKey = envValue('R2_SECRET_ACCESS_KEY');
  const mediaBucket = envValue('R2_BUCKET');
  const missing = [];
  if (!endpoint) missing.push('R2_ENDPOINT hoặc R2_ACCOUNT_ID');
  if (!bucket) missing.push('BACKUP_R2_BUCKET');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  return { endpoint, bucket, accessKeyId, secretAccessKey, mediaBucket, missing, configured: missing.length === 0 };
}

/** Chặn cứng: bucket backup phải tồn tại và khác bucket media. */
export function assertDedicatedBackupBucket(config) {
  if (!config.bucket) {
    throw new Error('Thiếu BACKUP_R2_BUCKET. Backup phải nằm ở bucket RIÊNG, không dùng chung bucket media.');
  }
  if (config.mediaBucket && config.bucket === config.mediaBucket) {
    throw new Error('BACKUP_R2_BUCKET đang trỏ đúng bucket media (R2_BUCKET). Từ chối dùng chung bucket.');
  }
  return config;
}

export function createBackupS3Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });
}

/**
 * Phân tích key backup. Trả về null nếu key không khớp pattern chuẩn —
 * đây chính là hàng rào "không bao giờ xoá object lạ" của rotate/verify.
 */
export function parseBackupKey(key) {
  const raw = String(key || '');
  if (!raw.includes('..')) {
    const isDump = DUMP_KEY_PATTERN.test(raw);
    const isManifest = MANIFEST_KEY_PATTERN.test(raw);
    if (isDump || isManifest) {
      const base = isManifest ? raw.replace(/\.manifest\.json$/, '') : raw;
      const [, year, month, stamp, sha8] = base.match(/^db\/(\d{4})\/(\d{2})\/(\d{8}T\d{6}Z)-([0-9a-f]{8})\.dump$/) || [];
      const parsedDate = new Date(Date.UTC(
        Number(stamp?.slice(0, 4)),
        Number(stamp?.slice(4, 6)) - 1,
        Number(stamp?.slice(6, 8)),
        Number(stamp?.slice(9, 11)),
        Number(stamp?.slice(11, 13)),
        Number(stamp?.slice(13, 15))
      ));
      // Round-trip: key chứa ngày không tồn tại (vd tháng 13) sẽ bị loại.
      const createdAt = Number.isNaN(parsedDate.getTime()) || formatUtcStamp(parsedDate) !== stamp
        ? null
        : parsedDate;
      return {
        key: raw,
        dumpKey: base,
        manifestKey: `${base}.manifest.json`,
        kind: isManifest ? 'manifest' : 'dump',
        sha8,
        year,
        month,
        createdAt
      };
    }
  }
  return null;
}

/** Key mới cho một bản backup (timestamp + 8 ký tự đầu SHA-256). */
export function buildBackupKeys(createdAt, sha256) {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt || Date.now());
  const stamp = formatUtcStamp(date);
  const sha8 = String(sha256 || '').slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(sha8)) {
    throw new Error('Cần SHA-256 hợp lệ để sinh object key backup.');
  }
  const dumpKey = `${BACKUP_KEY_PREFIX}${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${stamp}-${sha8}.dump`;
  return { dumpKey, manifestKey: `${dumpKey}.manifest.json` };
}

/** Liệt kê toàn bộ object dưới tiền tố `db/` (có phân trang). */
export async function listBackupObjects(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: BACKUP_KEY_PREFIX,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    for (const item of page.Contents || []) {
      objects.push({ key: item.Key, size: Number(item.Size) || 0, lastModified: item.LastModified || null });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

export const BACKUP_MANIFEST_EXAMPLE = {
  format: MANIFEST_FORMAT,
  version: MANIFEST_VERSION,
  database: '<tên database>',
  createdAt: '<ISO-8601>',
  size: 12345,
  sha256: '<64 hex>'
};
