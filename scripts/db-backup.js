/**
 * Backup PostgreSQL định kỳ → Cloudflare R2.
 *
 * Cách dùng:
 *   node scripts/db-backup.js --reason manual
 *   node scripts/db-backup.js --output /mnt/backup/bdu.dump --reason pre-upgrade
 *   BACKUP_TARGET=production node scripts/db-backup.js --allow-production
 *
 * Nguyên tắc:
 * - CHỈ dùng `BACKUP_DATABASE_URL` (role backup chỉ đọc). Tuyệt đối không
 *   dùng `DATABASE_URL` của app, kể cả khi BACKUP_DATABASE_URL thiếu.
 * - `pg_dump --format=custom --compress=9` (binary: restore nhanh hơn plain).
 * - Ghi file tạm private 0600 → fsync → SHA-256 → manifest → rename atomic.
 * - Upload R2 với key có timestamp, không ghi đè object đã có.
 * - Verify bằng HeadObject sau khi upload; lệch size → fail, giữ bản local.
 * - R2 chưa cấu hình → vẫn tạo bản local, exit 0 với `uploaded: false`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import '../src/config/load-env.js';
import {
  findPostgresBinary,
  getPostgresConnectionArgs,
  getPostgresEnv,
  getSafeDatabaseTarget
} from './postgres-utils.js';
import {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  assertDedicatedBackupBucket,
  buildBackupKeys,
  createBackupS3Client,
  envValue,
  formatBytes,
  formatUtcStamp,
  getBackupStorageConfig,
  logError,
  logInfo,
  logWarn,
  redactForLog,
  runProcess
} from './db-backup-shared.js';

const SCOPE = 'db-backup';
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const REASON_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Chỉ chạy CLI khi file này là entrypoint (cho phép import để test logic). */
const isBackupEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(path.resolve(entry)) === normalize(fileURLToPath(import.meta.url));
})();

function printUsage() {
  console.log('======================================================');
  console.log('💾 BDU Tự Học - Backup Database lên Cloudflare R2');
  console.log('======================================================');
  console.log('Cách dùng:');
  console.log('  node scripts/db-backup.js --reason <label> [--output <path>] [--allow-production]');
  console.log('  node scripts/db-backup.js --pre-deploy      # deploy.sh dùng cờ này');
  console.log('');
  console.log('  --output <path>     Ghi bản local vào đường dẫn này và GIỮ LẠI sau upload.');
  console.log('                      Mặc định: data/backup-<timestamp>.dump (xoá sau khi verify R2 OK).');
  console.log('  --reason <label>    Nhãn lý do, ghi vào log + metadata của object R2.');
  console.log('                      Chỉ chấp nhận [A-Za-z0-9._:-], tối đa 64 ký tự.');
  console.log('  --allow-production  Cho phép host không phải local. Vẫn cần thêm');
  console.log('                      BDU_MAINTENANCE_ALLOW_PRODUCTION=1 trong môi trường.');
  console.log('');
  console.log('Biến môi trường cần thiết:');
  console.log('  BACKUP_DATABASE_URL     URL role backup chỉ đọc (BẮT BUỘC, không fallback).');
  console.log('  BACKUP_R2_BUCKET        Bucket R2 RIÊNG cho backup (bắt buộc khác R2_BUCKET).');
  console.log('  R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  console.log('  BACKUP_LOCAL_DIR        Thư mục local tạm (mặc định: data).');
  console.log('');
  console.log('Ví dụ trên VPS:');
  console.log('  BACKUP_ALLOW_PRODUCTION=1 node scripts/db-backup.js --reason daily');
  console.log('======================================================');
}

function parseCli(argv) {
  const options = { output: null, reason: null, allowProduction: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--allow-production') {
      options.allowProduction = true;
    } else if (arg === '--pre-deploy') {
      // deploy/deploy.sh gọi cờ này trước khi chạy migration. Tồn tại như một
      // alias thật (không phải suy ra từ --reason) để deploy không phải dò
      // --help rồi đoán xem script có hỗ trợ không.
      options.reason = 'pre-deploy';
    } else if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output cần một đường dẫn hợp lệ.');
      options.output = value;
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      if (!options.output) throw new Error('--output cần một đường dẫn hợp lệ.');
    } else if (arg === '--reason') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--reason cần một nhãn hợp lệ.');
      options.reason = value;
      index += 1;
    } else if (arg.startsWith('--reason=')) {
      options.reason = arg.slice('--reason='.length);
      if (!options.reason) throw new Error('--reason cần một nhãn hợp lệ.');
    } else {
      throw new Error(`Không hỗ trợ tham số: ${arg}`);
    }
  }
  if (options.reason && !REASON_PATTERN.test(options.reason)) {
    throw new Error(`--reason không hợp lệ: chỉ nhận [A-Za-z0-9._:-], tối đa 64 ký tự.`);
  }
  return options;
}

function createPrivateTempFile(targetPath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${targetPath}.tmp-${process.pid}-${Date.now()}-${attempt}`;
    try {
      const descriptor = fs.openSync(candidate, 'wx', 0o600);
      fs.closeSync(descriptor);
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Không tạo được file backup tạm an toàn.');
}

function assertNotSymlink(targetPath) {
  for (const candidate of [targetPath, `${targetPath}.manifest.json`]) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Không ghi backup qua symlink: ${candidate}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function objectExists(client, bucket, key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

/**
 * Upload dump + manifest, rồi verify bằng HeadObject.
 * Ném lỗi nếu size trên R2 lệch manifest (giữ nguyên bản local).
 */
async function uploadAndVerify({ client, bucket, dumpKey, manifestKey, dumpFile, manifestFile, manifest, reason, target }) {
  const existing = await objectExists(client, bucket, dumpKey);
  if (existing) {
    logWarn(SCOPE, `Object ${dumpKey} đã tồn tại — bỏ qua upload để không ghi đè object cũ.`);
  } else {
    const dumpBody = fs.readFileSync(dumpFile);
    const manifestBody = fs.readFileSync(manifestFile);
    logInfo(SCOPE, `Đang upload ${formatBytes(dumpBody.length)} lên s3://${bucket}/${dumpKey}`);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: dumpKey,
      Body: dumpBody,
      ContentType: 'application/octet-stream',
      Metadata: { 'bdu-database': String(manifest.database).slice(0, 100), 'bdu-sha256': manifest.sha256, ...(reason ? { 'bdu-reason': reason } : {}) }
    }));
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: manifestBody,
      ContentType: 'application/json',
      Metadata: { 'bdu-sha256': manifest.sha256, ...(reason ? { 'bdu-reason': reason } : {}) }
    }));
  }

  const headDump = await objectExists(client, bucket, dumpKey);
  if (!headDump) throw new Error(`Verify thất bại: không tìm thấy ${dumpKey} trên R2.`);
  const remoteSize = Number(headDump.ContentLength ?? -1);
  if (remoteSize !== Number(manifest.size)) {
    throw new Error(`Verify thất bại: size trên R2 (${remoteSize}) khác manifest (${manifest.size}).`);
  }
  const headManifest = await objectExists(client, bucket, manifestKey);
  if (!headManifest) throw new Error(`Verify thất bại: không tìm thấy manifest ${manifestKey} trên R2.`);

  logInfo(SCOPE, `Verify OK: R2 size ${formatBytes(remoteSize)} khớp manifest, ETag ${redactForLog(headDump.ETag || 'n/a', [target.password])}.`);
  return { size: remoteSize };
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    printUsage();
    logError(SCOPE, error.message);
    process.exit(2);
  }
  if (options.help || process.argv.length <= 2) {
    printUsage();
    process.exit(2);
  }
  if (!options.reason) {
    printUsage();
    logError(SCOPE, 'Thiếu --reason. Backup không có nhãn lý do sẽ khó truy vết khi sự cố xảy ra.');
    process.exit(2);
  }

  // 1) Chỉ chấp nhận BACKUP_DATABASE_URL. Không có fallback về DATABASE_URL.
  const backupUrl = envValue('BACKUP_DATABASE_URL');
  if (!backupUrl) {
    logError(SCOPE, 'Thiếu BACKUP_DATABASE_URL. Backup bắt buộc dùng role chỉ đọc riêng; KHÔNG dùng DATABASE_URL của app.');
    process.exit(1);
  }

  let dbTarget;
  try {
    dbTarget = getSafeDatabaseTarget({ operation: 'dump', allowProduction: options.allowProduction, preferBackup: true });
  } catch (error) {
    logError(SCOPE, error.message);
    process.exit(1);
  }
  if (dbTarget.url !== backupUrl) {
    logError(SCOPE, 'Target phân giải được không phải BACKUP_DATABASE_URL (bị ghi đè bởi biến khác). Từ chối chạy backup.');
    process.exit(1);
  }

  const pgDumpBin = findPostgresBinary('pg_dump');
  if (!pgDumpBin) {
    logError(SCOPE, 'Không tìm thấy công cụ `pg_dump`. Cài postgresql-client (apt-get install -y postgresql-client).');
    process.exit(1);
  }

  // 2) Đường dẫn local: file tạm 0600 + rename atomic.
  const stamp = formatUtcStamp();
  const explicitOutput = Boolean(options.output);
  const localDir = options.output
    ? path.dirname(path.resolve(process.cwd(), options.output))
    : path.resolve(repoRoot, envValue('BACKUP_LOCAL_DIR') || 'data');
  const targetFile = options.output
    ? path.resolve(process.cwd(), options.output)
    : path.join(localDir, `backup-${stamp}.dump`);
  const manifestFile = `${targetFile}.manifest.json`;

  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  assertNotSymlink(targetFile);

  const tempFile = createPrivateTempFile(targetFile);
  const tempManifestFile = createPrivateTempFile(manifestFile);
  const cleanupTemp = () => {
    for (const candidate of [tempFile, tempManifestFile]) {
      try { fs.rmSync(candidate, { force: true }); } catch { /* bỏ qua */ }
    }
  };

  const storage = getBackupStorageConfig();
  let storageError = null;
  if (!storage.configured) {
    logWarn(SCOPE, `R2 chưa cấu hình (thiếu: ${storage.missing.join(', ')}). Sẽ tạo bản backup LOCAL và ghi uploaded=false.`);
  } else {
    try {
      assertDedicatedBackupBucket(storage);
    } catch (error) {
      storageError = error;
      logWarn(SCOPE, `${error.message} Bản backup local vẫn được tạo; bước upload sẽ bị từ chối.`);
    }
  }

  logInfo(SCOPE, `Bắt đầu backup (reason: ${options.reason})`);
  logInfo(SCOPE, `Database: ${dbTarget.database} — file local: ${targetFile}`);
  const startedAt = Date.now();

  const connectionArgs = getPostgresConnectionArgs(dbTarget, { allowProduction: options.allowProduction });
  const childEnv = { ...process.env, ...getPostgresEnv(dbTarget, { allowProduction: options.allowProduction }) };
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BACKUP_DATABASE_URL', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE']) {
    delete childEnv[key];
  }
  if (dbTarget.password) childEnv.PGPASSWORD = dbTarget.password;
  const secrets = [dbTarget.password, backupUrl];

  // 3) pg_dump: custom format + nén mạnh (restore nhanh hơn plain SQL).
  const dumpArgs = [
    ...connectionArgs,
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-privileges',
    `--file=${tempFile}`
  ];
  logInfo(SCOPE, `⏳ pg_dump --format=custom --compress=9 ...`);
  let dumpChild = null;
  const abortOnSignal = (signal) => {
    cleanupTemp();
    if (dumpChild) { try { dumpChild.kill(signal); } catch { /* bỏ qua */ } }
    logWarn(SCOPE, `Nhận ${signal}: dừng dump và xoá file tạm (không để lại backup dở dang).`);
    process.exit(130);
  };
  process.once('SIGINT', () => abortOnSignal('SIGINT'));
  process.once('SIGTERM', () => abortOnSignal('SIGTERM'));

  const dump = await runProcess(pgDumpBin, dumpArgs, {
    env: childEnv,
    timeoutMs: 60 * 60_000,
    onChild: (child) => { dumpChild = child; }
  });
  if (!dump.ok) {
    cleanupTemp();
    logError(SCOPE, `pg_dump thất bại (mã ${dump.code}).`);
    if (dump.stderr.trim()) logError(SCOPE, redactForLog(dump.stderr.trim(), secrets));
    if (dump.stdout.trim()) logError(SCOPE, redactForLog(dump.stdout.trim(), secrets));
    process.exit(1);
  }

  // 4) fsync → SHA-256 → manifest → rename atomic.
  let manifest;
  let dumpKey = null;
  let manifestKey = null;
  try {
    // Mở 'r+' (không phải 'r') vì fsync trên handle chỉ đọc sẽ EPERM trên Windows.
    const fd = fs.openSync(tempFile, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(tempFile, 0o600);
    const size = fs.statSync(tempFile).size;
    if (size <= 0) throw new Error('pg_dump tạo ra file rỗng.');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(tempFile)).digest('hex');
    const createdAt = new Date().toISOString();
    manifest = { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, database: dbTarget.database, createdAt, size, sha256: digest };
    fs.writeFileSync(tempManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const manifestFd = fs.openSync(tempManifestFile, 'r+');
    try { fs.fsyncSync(manifestFd); } finally { fs.closeSync(manifestFd); }
    fs.renameSync(tempFile, targetFile);
    fs.renameSync(tempManifestFile, manifestFile);
    ({ dumpKey, manifestKey } = buildBackupKeys(new Date(createdAt), digest));
    logInfo(SCOPE, `Backup local OK: ${formatBytes(size)} — SHA-256 ${digest}`);
  } catch (error) {
    cleanupTemp();
    logError(SCOPE, `Không hoàn tất được backup atomic: ${error.message}`);
    process.exit(1);
  }

  // 5) Upload + verify trên R2 (chỉ khi R2 cấu hình đủ và bucket riêng).
  let uploaded = false;
  let remoteVerified = false;
  const canUpload = storage.configured && !storageError;
  const summary = {
    reason: options.reason,
    database: manifest.database,
    createdAt: manifest.createdAt,
    size: manifest.size,
    sha256: manifest.sha256,
    localFile: targetFile,
    dumpKey,
    manifestKey,
    uploaded: false
  };

  if (!canUpload && !storage.configured) {
    // R2 chưa cấu hình: bản local vẫn có giá trị, exit 0 + uploaded=false.
    logWarn(SCOPE, `Bỏ qua upload R2 — bản backup LOCAL tại ${targetFile} vẫn có giá trị, hãy đồng bộ sang nơi khác.`);
  } else if (storageError) {
    // Bucket cấu hình sai (chung với media): backup KHÔNG nằm trên R2 -> fail loudly.
    logError(SCOPE, storageError.message);
    logError(SCOPE, `Bản backup LOCAL vẫn được giữ tại: ${targetFile}`);
    console.log(`BACKUP_SUMMARY ${JSON.stringify({ ...summary, uploaded: false, uploadError: true })}`);
    process.exit(1);
  } else {
    let client = null;
    try {
      client = createBackupS3Client(storage);
      await uploadAndVerify({
        client,
        bucket: storage.bucket,
        dumpKey,
        manifestKey,
        dumpFile: targetFile,
        manifestFile,
        manifest,
        reason: options.reason,
        target: dbTarget
      });
      uploaded = true;
      remoteVerified = true;
      logInfo(SCOPE, `✅ Đã lưu lên R2: s3://${storage.bucket}/${dumpKey}`);
    } catch (error) {
      logError(SCOPE, `Upload/verify R2 thất bại: ${redactForLog(error.message, secrets)}`);
      logError(SCOPE, `Bản backup LOCAL vẫn an toàn tại: ${targetFile}`);
      console.log(`BACKUP_SUMMARY ${JSON.stringify({ ...summary, uploaded: false, uploadError: true })}`);
      process.exit(1);
    } finally {
      if (client) { try { client.destroy(); } catch { /* bỏ qua */ } }
    }
  }

  // 6) Chỉ xoá bản local sau khi verify R2 thành công, trừ khi --output.
  if (!explicitOutput) {
    if (remoteVerified) {
      for (const candidate of [targetFile, manifestFile]) {
        try { fs.rmSync(candidate, { force: true }); } catch { /* bỏ qua */ }
      }
      logInfo(SCOPE, 'Đã xoá bản local sau khi verify R2 (giữ chính xác 1 bản trên R2).');
    } else {
      logWarn(SCOPE, `Giữ bản local vì R2 chưa xác minh được: ${targetFile}`);
    }
  } else {
    logInfo(SCOPE, `Giữ bản local theo yêu cầu --output: ${targetFile}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  summary.uploaded = uploaded;
  logInfo(SCOPE, `Hoàn tất sau ${elapsed}s — uploaded=${uploaded}`);
  console.log(`BACKUP_SUMMARY ${JSON.stringify(summary)}`);
  process.exit(0);
}

if (isBackupEntry) {
  main().catch((error) => {
    logError(SCOPE, redactForLog(error?.message || String(error), [envValue('BACKUP_DATABASE_URL')]));
    process.exit(1);
  });
}
