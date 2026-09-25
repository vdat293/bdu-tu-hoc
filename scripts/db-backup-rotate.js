/**
 * Xoá bản backup cũ trên R2 theo 3 tầng: daily / weekly / monthly.
 *
 * Cách dùng:
 *   node scripts/db-backup-rotate.js --dry-run   # chỉ xem, không xoá
 *   node scripts/db-backup-rotate.js             # áp dụng retention
 *
 * Cấu hình (env):
 *   BACKUP_RETENTION_DAILY    số bản mới nhất giữ lại   (mặc định 7)
 *   BACKUP_RETENTION_WEEKLY   số tuần giữ lại            (mặc định 4)
 *   BACKUP_RETENTION_MONTHLY  số tháng giữ lại           (mặc định 6)
 *   BACKUP_RETAIN_*           tên viết tắt tương đương (ưu tiên RETENTION_*)
 *   BACKUP_ROTATE_MAX_DELETE  trần số object xoá/lần (mặc định 1000)
 *
 * Hàng rào an toàn:
 * - Chỉ liệt kê dưới tiền tố `db/`, chỉ xoá key khớp đúng pattern do
 *   db-backup.js sinh ra. Object lạ (ảnh, file tay chứa) KHÔNG BAO GIỜ bị đụng.
 * - Luôn giữ lại ít nhất bản mới nhất; nếu kế hoạch xoá hết sẽ dừng lại.
 * - Có trần số object xoá mỗi lần để tránh xoá ồ ạt khi dữ liệu bị lệch.
 */

import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config/load-env.js';
import {
  assertDedicatedBackupBucket,
  createBackupS3Client,
  getBackupStorageConfig,
  listBackupObjects,
  logError,
  logInfo,
  logWarn,
  parseBackupKey,
  parseIntEnv
} from './db-backup-shared.js';

const SCOPE = 'db-backup-rotate';

/** Chỉ chạy CLI khi file này là entrypoint (cho phép import để test logic). */
export const isBackupRotateEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(path.resolve(entry)) === normalize(fileURLToPath(import.meta.url));
})();

function printUsage() {
  console.log('======================================================');
  console.log('🧹 BDU Tự Học - Retention backup R2 (daily/weekly/monthly)');
  console.log('======================================================');
  console.log('Cách dùng: node scripts/db-backup-rotate.js [--dry-run]');
  console.log('');
  console.log('  --dry-run   Chỉ liệt kê bản sẽ xoá, KHÔNG gọi DeleteObject.');
  console.log('');
  console.log('Env: BACKUP_R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,');
  console.log('     R2_ENDPOINT (hoặc R2_ACCOUNT_ID),');
  console.log('     BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY (mặc định 7/4/6).');
  console.log('======================================================');
}

function parseCli(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Không hỗ trợ tham số: ${arg}`);
  }
  return options;
}

/**
 * Đọc biến retention theo cả hai tên: BACKUP_RETENTION_* (tên đã ghi trong
 * .env.example) và BACKUP_RETAIN_* (tên rút gọn). Ưu tiên tên đầu.
 */
function retentionEnv(level, fallback) {
  const primary = parseIntEnv(`BACKUP_RETENTION_${level}`, null, { min: 0, max: 400 });
  if (primary !== null) return primary;
  return parseIntEnv(`BACKUP_RETAIN_${level}`, fallback, { min: 0, max: 400 });
}

function isoWeekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNumber);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Chọn bản giữ lại theo 3 tầng. Dumps phải đã sort giảm dần theo createdAt.
 * Trả về Set các key dump cần giữ.
 */
export function selectKeepSet(dumps, { daily, weekly, monthly }) {
  const keep = new Set();
  const buckets = { daily: [], weekly: [], monthly: [] };

  for (const dump of dumps.slice(0, daily)) {
    keep.add(dump.dumpKey);
    buckets.daily.push(dump);
  }

  const seenWeeks = new Set(buckets.daily.map((dump) => isoWeekKey(dump.createdAt)));
  for (const dump of dumps) {
    if (buckets.weekly.length >= weekly) break;
    if (keep.has(dump.dumpKey)) continue;
    const week = isoWeekKey(dump.createdAt);
    if (seenWeeks.has(week)) continue;
    seenWeeks.add(week);
    keep.add(dump.dumpKey);
    buckets.weekly.push(dump);
  }

  const seenMonths = new Set([...buckets.daily, ...buckets.weekly].map((dump) => monthKey(dump.createdAt)));
  for (const dump of dumps) {
    if (buckets.monthly.length >= monthly) break;
    if (keep.has(dump.dumpKey)) continue;
    const month = monthKey(dump.createdAt);
    if (seenMonths.has(month)) continue;
    seenMonths.add(month);
    keep.add(dump.dumpKey);
    buckets.monthly.push(dump);
  }

  return { keep, buckets };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const retain = {
    daily: retentionEnv('DAILY', 7),
    weekly: retentionEnv('WEEKLY', 4),
    monthly: retentionEnv('MONTHLY', 6)
  };
  const maxDelete = parseIntEnv('BACKUP_ROTATE_MAX_DELETE', 1000, { min: 1, max: 5000 });

  const storage = getBackupStorageConfig();
  if (!storage.configured) {
    logError(SCOPE, `R2 chưa cấu hình (thiếu: ${storage.missing.join(', ')}). Không có gì để rotate.`);
    process.exit(1);
  }
  assertDedicatedBackupBucket(storage);

  const client = createBackupS3Client(storage);
  try {
    const objects = await listBackupObjects(client, storage.bucket);
    const parsed = objects.map((object) => parseBackupKey(object.key)).filter(Boolean);
    const ignored = objects.length - parsed.length;
    const dumps = parsed
      .filter((entry) => entry.kind === 'dump' && entry.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt);
    const manifestKeys = new Set(parsed.filter((entry) => entry.kind === 'manifest').map((entry) => entry.manifestKey));

    if (dumps.length === 0) {
      logWarn(SCOPE, `Không tìm thấy bản backup nào dưới db/ trong bucket ${storage.bucket}.`);
      console.log(`ROTATE_SUMMARY ${JSON.stringify({ total: 0, kept: 0, deleted: 0, dryRun: options.dryRun })}`);
      process.exit(0);
    }

    const { keep, buckets } = selectKeepSet(dumps, retain);
    const expired = dumps.filter((dump) => !keep.has(dump.dumpKey));
    if (expired.length >= dumps.length) {
      logError(SCOPE, 'Kế hoạch retention xoá hết bản backup — dừng lại. Kiểm tra lại BACKUP_RETAIN_*.');
      process.exit(1);
    }
    if (expired.length > maxDelete) {
      logError(SCOPE, `Số bản cần xoá (${expired.length}) vượt trần BACKUP_ROTATE_MAX_DELETE=${maxDelete} — dừng lại để kiểm tra thủ công.`);
      process.exit(1);
    }

    logInfo(SCOPE, `Tổng ${dumps.length} bản (bỏ qua ${ignored} key không khớp pattern db/). Giữ: daily ${buckets.daily.length}, weekly ${buckets.weekly.length}, monthly ${buckets.monthly.length}.`);
    if (expired.length === 0) {
      logInfo(SCOPE, 'Không có bản nào quá hạn.');
      console.log(`ROTATE_SUMMARY ${JSON.stringify({ total: dumps.length, kept: keep.size, deleted: 0, dryRun: options.dryRun })}`);
      process.exit(0);
    }

    const toDelete = [];
    for (const dump of expired) {
      toDelete.push(dump.dumpKey);
      if (manifestKeys.has(dump.manifestKey)) toDelete.push(dump.manifestKey);
    }
    for (const key of toDelete) {
      logInfo(SCOPE, `${options.dryRun ? '[dry-run] sẽ xoá' : 'đang xoá'} ${key}`);
    }

    let deleted = 0;
    if (options.dryRun) {
      logInfo(SCOPE, `--dry-run: chưa xoá object nào (${toDelete.length} object).`);
    } else {
      for (const key of toDelete) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
          deleted += 1;
        } catch (error) {
          logError(SCOPE, `Không xoá được ${key}: ${error.message}. Bản backup vẫn còn nguyên.`);
        }
      }
      logInfo(SCOPE, `Đã xoá ${deleted}/${toDelete.length} object. Còn giữ ${dumps.length - expired.length} bản dump.`);
    }
    console.log(`ROTATE_SUMMARY ${JSON.stringify({ total: dumps.length, kept: keep.size, deleted, dryRun: options.dryRun })}`);
    process.exit(0);
  } finally {
    try { client.destroy(); } catch { /* bỏ qua */ }
  }
}

if (isBackupRotateEntry) {
  main().catch((error) => {
    logError(SCOPE, error?.message || String(error));
    process.exit(1);
  });
}
