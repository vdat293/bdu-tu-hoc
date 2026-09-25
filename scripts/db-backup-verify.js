/**
 * RESTORE DRILL — bài toán thật của backup không phải "có file" mà là "restore được".
 *
 * Cách dùng:
 *   DRILL_DATABASE_URL=postgresql://bdu_admin:...@localhost:5432/postgres \
 *     node scripts/db-backup-verify.js
 *   node scripts/db-backup-verify.js --key db/2026/09/20260925T031700Z-a1b2c3d4.dump
 *
 * Luồng: tải bản daily mới nhất từ R2 → kiểm tra SHA-256 → `createdb` database
 * tạm `bdu_restore_drill` → `pg_restore` → `SELECT count(*)` trên các bảng cốt
 * lõi → `dropdb`. Exit 0 = drill pass.
 *
 * ⛔ CHẶN CỨNG: TUYỆT ĐỐI không restore vào database production.
 *   - host phải nằm trong allowlist local (127.0.0.1, ::1, localhost, postgres),
 *     hoặc phải có ALLOW_REMOTE_DRILL=1;
 *   - tên database drill LUÔN phải kết thúc bằng `_drill`;
 *   - tên drill không được trùng database của app (DATABASE_URL) hay database
 *     ghi trong manifest của bản backup.
 *   - Ngoài local còn phải bật thêm BDU_MAINTENANCE_ALLOW_PRODUCTION=1 (hàng rào
 *     dùng chung của scripts/postgres-utils.js — không nới lỏng).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import '../src/config/load-env.js';
import { assertSafeMaintenanceTarget, findPostgresBinary, getPostgresEnv } from './postgres-utils.js';
import {
  DRILL_LOCAL_HOSTS,
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  assertDedicatedBackupBucket,
  createBackupS3Client,
  envFlag,
  envValue,
  formatBytes,
  formatUtcStamp,
  getBackupStorageConfig,
  listBackupObjects,
  logError,
  logInfo,
  logWarn,
  parseBackupKey,
  redactForLog,
  runProcess
} from './db-backup-shared.js';

const SCOPE = 'db-backup-verify';
const CORE_TABLES = ['students', 'clans', 'community_posts'];
const SAFE_URL_QUERY_KEYS = new Set(['sslmode', 'connect_timeout', 'application_name']);

/** Chỉ chạy CLI khi file này là entrypoint (cho phép import để test logic). */
export const isBackupVerifyEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(path.resolve(entry)) === normalize(fileURLToPath(import.meta.url));
})();

class DrillError extends Error {}

function printUsage() {
  console.log('======================================================');
  console.log('🧪 BDU Tự Học - Restore Drill (tải từ R2 → restore → kiểm tra → drop)');
  console.log('======================================================');
  console.log('Cách dùng: node scripts/db-backup-verify.js [--key <objectKey>] [--keep]');
  console.log('');
  console.log('  --key <objectKey>  Chỉ định bản backup cụ thể (mặc định: bản mới nhất).');
  console.log('  --keep             Giữ file tải về + database drill (mặc định: xoá sau khi xong).');
  console.log('');
  console.log('Env: BACKUP_R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,');
  console.log('     R2_ENDPOINT (hoặc R2_ACCOUNT_ID),');
  console.log('     DRILL_DATABASE_URL  URL của role CÓ QUYỀN createdb (db quản trị),');
  console.log('     DRILL_DATABASE_NAME (mặc định bdu_restore_drill, bắt buộc đuôi _drill).');
  console.log('======================================================');
}

function parseCli(argv) {
  const options = { key: null, keep: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--key' || arg.startsWith('--key=')) {
      const value = arg === '--key' ? argv[index + 1] : arg.slice('--key='.length);
      if (!value || value.startsWith('--')) throw new DrillError('--key cần một object key hợp lệ.');
      options.key = value;
      if (arg === '--key') index += 1;
    } else {
      throw new DrillError(`Không hỗ trợ tham số: ${arg}`);
    }
  }
  return options;
}

/** Parse URL quản trị cho drill (không dùng chung DATABASE_URL của app). */
function parseDrillTarget() {
  const raw = envValue('DRILL_DATABASE_URL');
  if (!raw) {
    throw new DrillError('Thiếu DRILL_DATABASE_URL. Drill cần role có quyền createdb (không dùng DATABASE_URL của app).');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DrillError('DRILL_DATABASE_URL không phợp lệ.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new DrillError('DRILL_DATABASE_URL phải dùng postgres/postgresql.');
  }
  const query = Object.fromEntries(parsed.searchParams.entries());
  const unsafeKeys = Object.keys(query).filter((key) => !SAFE_URL_QUERY_KEYS.has(key));
  if (parsed.hash || unsafeKeys.length > 0) {
    throw new DrillError(`DRILL_DATABASE_URL chỉ được chứa sslmode/connect_timeout/application_name; phát hiện: ${unsafeKeys.join(', ') || 'fragment'}.`);
  }
  const host = (parsed.hostname || 'localhost').toLowerCase().replace(/^\[|\]$/g, '');
  const maintenanceDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
  return {
    url: raw,
    host,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    maintenanceDatabase,
    sslmode: query.sslmode || null,
    connectTimeout: query.connect_timeout || null,
    applicationName: query.application_name || null
  };
}

/** Chặn cứng: không bao giờ đụng tới database production. */
export function assertDrillTargetSafe({ target, drillDatabase, sourceDatabase }) {
  if (!DRILL_LOCAL_HOSTS.has(target.host)) {
    if (!envFlag('ALLOW_REMOTE_DRILL', false)) {
      throw new DrillError(
        `Host "${target.host}" không nằm trong allowlist local (${[...DRILL_LOCAL_HOSTS].join(', ')}). ` +
        'Drill từ xa phải đặt ALLOW_REMOTE_DRILL=1 và tên database kết thúc bằng _drill.'
      );
    }
    if (envValue('BDU_MAINTENANCE_ALLOW_PRODUCTION') !== '1') {
      throw new DrillError('Drill từ xa cần thêm BDU_MAINTENANCE_ALLOW_PRODUCTION=1 (hàng rào của postgres-utils).');
    }
  }
  if (!/_drill$/.test(drillDatabase)) {
    throw new DrillError(`Tên database drill "${drillDatabase}" bắt buộc kết thúc bằng _drill.`);
  }
  if (sourceDatabase && drillDatabase === sourceDatabase) {
    throw new DrillError(`Tên database drill "${drillDatabase}" trùng database nguồn của backup. Từ chối chạy.`);
  }
  const appUrl = envValue('DATABASE_URL');
  if (appUrl) {
    let appDatabase = '';
    try {
      appDatabase = decodeURIComponent(new URL(appUrl).pathname.replace(/^\//, ''));
    } catch {
      // DATABASE_URL không parse được thì bỏ qua so sánh (không log URL).
      appDatabase = '';
    }
    if (appDatabase && appDatabase === drillDatabase) {
      throw new DrillError(`Tên database drill "${drillDatabase}" trùng DATABASE_URL của app. Từ chối chạy.`);
    }
  }
  return { ...target, database: drillDatabase };
}

function requireBinaries(names) {
  const bins = {};
  for (const name of names) {
    const bin = findPostgresBinary(name);
    if (!bin) {
      throw new DrillError(`Không tìm thấy công cụ \`${name}\`. Cài postgresql-client (apt-get install -y postgresql-client).`);
    }
    bins[name] = bin;
  }
  return bins;
}

function buildChildEnv(target, allowProduction) {
  const env = { ...process.env, ...getPostgresEnv(target, { allowProduction }) };
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BACKUP_DATABASE_URL', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE']) {
    delete env[key];
  }
  if (target.password) env.PGPASSWORD = target.password;
  return env;
}

async function downloadTo(client, bucket, key, filePath) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new DrillError(`Object rỗng: ${key}`);
  await pipeline(result.Body, createWriteStream(filePath, { mode: 0o600, flags: 'wx' }));
  // Mở 'r+' (không phải 'r') vì fsync trên handle chỉ đọc sẽ EPERM trên Windows.
  const fd = fs.openSync(filePath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return fs.statSync(filePath).size;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const storage = getBackupStorageConfig();
  if (!storage.configured) {
    throw new DrillError(`R2 backup chưa cấu hình (thiếu: ${storage.missing.join(', ')}). Không có bản backup nào để drill.`);
  }
  assertDedicatedBackupBucket(storage);

  const target = parseDrillTarget();
  const drillDatabase = envValue('DRILL_DATABASE_NAME') || 'bdu_restore_drill';
  const isLocal = DRILL_LOCAL_HOSTS.has(target.host);
  const allowProduction = !isLocal;
  // Chặn cứng của riêng drill + hàng rào chung của postgres-utils (không nới lỏng).
  const guardTarget = assertDrillTargetSafe({ target, drillDatabase, sourceDatabase: null });
  const safeTarget = assertSafeMaintenanceTarget(guardTarget, { operation: 'dump', allowProduction });
  const bins = requireBinaries(['createdb', 'dropdb', 'pg_restore', 'psql']);

  const client = createBackupS3Client(storage);
  const stamp = formatUtcStamp();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `bdu-restore-drill-${stamp}-`));
  fs.chmodSync(workDir, 0o700);
  const dumpFile = path.join(workDir, 'restore-drill.dump');
  const manifestFile = path.join(workDir, 'restore-drill.dump.manifest.json');
  let created = false;
  let exitCode = 0;

  try {
    // 1) Chọn bản backup daily mới nhất (hoặc --key).
    let entry;
    if (options.key) {
      entry = parseBackupKey(options.key);
      if (!entry || entry.kind !== 'dump') {
        throw new DrillError(`--key không khớp pattern backup hợp lệ: ${options.key}`);
      }
    } else {
      const objects = await listBackupObjects(client, storage.bucket);
      const dumps = objects
        .map((object) => parseBackupKey(object.key))
        .filter((item) => item && item.kind === 'dump' && item.createdAt)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (dumps.length === 0) {
        throw new DrillError(`Không tìm thấy bản backup nào dưới db/ trong bucket ${storage.bucket}.`);
      }
      entry = dumps[0];
    }
    logInfo(SCOPE, `Drill bản backup: ${entry.key} (${entry.createdAt.toISOString()})`);

    // 2) Tải dump + manifest về thư mục tạm, kiểm tra SHA-256.
    await downloadTo(client, storage.bucket, entry.dumpKey, dumpFile);
    await downloadTo(client, storage.bucket, entry.manifestKey, manifestFile);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest?.format !== MANIFEST_FORMAT || manifest?.version !== MANIFEST_VERSION) {
      throw new DrillError('Manifest trên R2 không đúng format bdu-postgres-dump v1.');
    }
    if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))) {
      throw new DrillError('Manifest không có SHA-256 hợp lệ.');
    }
    const size = fs.statSync(dumpFile).size;
    if (Number(manifest.size) !== size) {
      throw new DrillError(`Size dump tải về (${size}) khác manifest (${manifest.size}).`);
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(dumpFile)).digest('hex');
    if (digest !== String(manifest.sha256).toLowerCase()) {
      throw new DrillError('SHA-256 dump tải về KHÔNG khớp manifest — bản backup trên R2 bị hỏng hoặc thay đổi.');
    }
    assertDrillTargetSafe({ target, drillDatabase, sourceDatabase: manifest.database });
    logInfo(SCOPE, `SHA-256 khớp manifest (${formatBytes(size)}) — bản backup toàn vẹn.`);
    logInfo(SCOPE, `Đích drill: ${drillDatabase} trên host ${safeTarget.host}:${safeTarget.port} (role ${safeTarget.user}).`);

    // 3) createdb → pg_restore → đếm bản ghi → dropdb.
    const childEnv = buildChildEnv(safeTarget, allowProduction);
    const hostArgs = [`--host=${safeTarget.host}`, `--port=${safeTarget.port}`, `--username=${safeTarget.user}`];
    const secrets = [target.password, target.url];
    // createdb/dropdb KHÔNG có --dbname; phải dùng --maintenance-db.
    const maintenanceArgs = [...hostArgs, `--maintenance-db=${target.maintenanceDatabase}`];

    logInfo(SCOPE, '🧹 Dọn database drill cũ (nếu có)...');
    const dropBefore = await runProcess(bins.dropdb, [...maintenanceArgs, '--if-exists', '--no-password', drillDatabase], { env: childEnv });
    if (!dropBefore.ok) {
      logWarn(SCOPE, `dropdb bỏ qua: ${redactForLog(dropBefore.stderr.trim(), secrets)}`);
    }

    logInfo(SCOPE, '🆕 createdb...');
    const create = await runProcess(bins.createdb, [...maintenanceArgs, `--owner=${safeTarget.user}`, '--no-password', drillDatabase], { env: childEnv });
    if (!create.ok) {
      throw new DrillError(`createdb thất bại (mã ${create.code}): ${redactForLog(`${create.stderr}\n${create.stdout}`.trim(), secrets)}`);
    }
    created = true;

    logInfo(SCOPE, '♻️  pg_restore --exit-on-error...');
    const restore = await runProcess(
      bins.pg_restore,
      [...hostArgs, `--dbname=${drillDatabase}`, '--no-owner', '--no-privileges', '--exit-on-error', '--no-password', dumpFile],
      { env: childEnv, timeoutMs: 60 * 60_000 }
    );
    if (!restore.ok) {
      throw new DrillError(`pg_restore thất bại (mã ${restore.code}): ${redactForLog(`${restore.stderr}\n${restore.stdout}`.trim(), secrets).slice(0, 2000)}`);
    }

    const counts = [];
    for (const table of CORE_TABLES) {
      const query = await runProcess(
        bins.psql,
        [...hostArgs, `--dbname=${drillDatabase}`, '--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', '-At', '-c', `SELECT count(*) FROM ${table};`],
        { env: childEnv }
      );
      if (!query.ok) {
        throw new DrillError(`Truy vấn bảng ${table} thất bại: ${redactForLog(`${query.stderr}\n${query.stdout}`.trim(), secrets).slice(0, 1000)}`);
      }
      const count = Number.parseInt(query.stdout.trim(), 10);
      if (!Number.isFinite(count)) {
        throw new DrillError(`count(${table}) không đọc được: "${redactForLog(query.stdout.trim(), secrets)}"`);
      }
      counts.push({ table, count });
    }
    logInfo(SCOPE, '📊 Số bản ghi sau restore:');
    for (const row of counts) logInfo(SCOPE, `   - ${row.table}: ${row.count}`);
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    if (counts.some((row) => row.count === 0)) {
      logWarn(SCOPE, '⚠️  Có bảng cốt lõi đang rỗng — kiểm tra lại xem backup có đầy đủ không.');
    }
    logInfo(SCOPE, `✅ RESTORE DRILL PASS — ${total} bản ghi ở 3 bảng cốt lõi, từ bản backup ${entry.key}.`);
    console.log(`DRILL_SUMMARY ${JSON.stringify({ pass: true, key: entry.key, database: drillDatabase, size, sha256: manifest.sha256, counts })}`);
  } catch (error) {
    exitCode = 1;
    logError(SCOPE, redactForLog(error?.message || String(error), [target.password, target.url]));
    console.log(`DRILL_SUMMARY ${JSON.stringify({ pass: false, error: redactForLog(error?.message || String(error), [target.password, target.url]) })}`);
  } finally {
    // 4) Luôn drop database drill, kể cả khi drill fail.
    if (created) {
      const childEnv = buildChildEnv(safeTarget, allowProduction);
      const drop = await runProcess(
        bins.dropdb,
        [`--host=${safeTarget.host}`, `--port=${safeTarget.port}`, '--username=' + safeTarget.user, `--maintenance-db=${target.maintenanceDatabase}`, '--if-exists', '--force', '--no-password', drillDatabase],
        { env: childEnv }
      );
      if (drop.ok) logInfo(SCOPE, `🧹 Đã drop database drill ${drillDatabase}.`);
      else logError(SCOPE, `Không drop được ${drillDatabase}: ${redactForLog(drop.stderr.trim(), [target.password])} — cần dọn tay.`);
    }
    try { client.destroy(); } catch { /* bỏ qua */ }
    if (options.keep) {
      logWarn(SCOPE, `--keep: giữ lại thư mục tạm ${workDir}`);
    } else {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
    }
  }
  process.exit(exitCode);
}

if (isBackupVerifyEntry) {
  main().catch((error) => {
    logError(SCOPE, redactForLog(error?.message || String(error), [envValue('DRILL_DATABASE_URL')]));
    process.exit(1);
  });
}
