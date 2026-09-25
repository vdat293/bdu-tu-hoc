import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  findPostgresBinary,
  getPostgresConnectionArgs,
  getPostgresEnv,
  getSafeDatabaseTarget
} from './postgres-utils.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDumpFile = path.resolve(currentDir, '..', 'data', 'backup.sql');
const cliArgs = process.argv.slice(2);
const allowProduction = cliArgs.includes('--allow-production');
const positionalArgs = cliArgs.filter((arg) => !arg.startsWith('--'));
const fileArg = positionalArgs[0] || '';
const unknownArgs = cliArgs.filter((arg) => arg.startsWith('--') && arg !== '--allow-production');

if (unknownArgs.length > 0) {
  console.error(`❌ Không hỗ trợ flag: ${unknownArgs.join(', ')}`);
  process.exit(2);
}
if (positionalArgs.length > 1) {
  console.error('Cách dùng: npm run db:dump -- [đường_dẫn_file] [--allow-production]');
  process.exit(2);
}

const targetFile = fileArg ? path.resolve(process.cwd(), fileArg) : defaultDumpFile;
const dumpDir = path.dirname(targetFile);
fs.mkdirSync(dumpDir, { recursive: true, mode: 0o700 });
try {
  if (fs.lstatSync(targetFile).isSymbolicLink()) {
    throw new Error('Không ghi backup qua symlink.');
  }
  if (fs.lstatSync(`${targetFile}.manifest.json`).isSymbolicLink()) {
    throw new Error('Không ghi manifest backup qua symlink.');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let dbTarget;
try {
  dbTarget = getSafeDatabaseTarget({ operation: 'dump', allowProduction, preferBackup: true });
} catch (err) {
  console.error(`❌ Lỗi: ${err.message}`);
  process.exit(1);
}

const pgDumpBin = findPostgresBinary('pg_dump');
if (!pgDumpBin) {
  console.error('❌ Không tìm thấy công cụ `pg_dump` trên máy.');
  if (process.platform === 'win32') {
    console.error('👉 Trên Windows: Vui lòng cài PostgreSQL và thêm đường dẫn `C:\\Program Files\\PostgreSQL\\<version>\\bin` vào biến môi trường PATH.');
  } else {
    console.error('👉 Trên Mac: Cài qua brew: `brew install postgresql@16` hoặc `brew install libpq`.');
  }
  process.exit(1);
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

const manifestFile = `${targetFile}.manifest.json`;
let connectionArgs;
let postgresEnv;
try {
  connectionArgs = getPostgresConnectionArgs(dbTarget, { allowProduction });
  postgresEnv = getPostgresEnv(dbTarget, { allowProduction });
} catch (error) {
  console.error(`❌ Lỗi cấu hình kết nối: ${error.message}`);
  process.exit(1);
}

const tempFile = createPrivateTempFile(targetFile);
const tempManifestFile = createPrivateTempFile(manifestFile);
console.log('======================================================');
console.log('📦 BDU Tự Học - Xuất Database (PostgreSQL Dump)');
console.log(`🌐 Database: ${dbTarget.database}`);
console.log(`📁 File lưu:  ${targetFile}`);
console.log('======================================================');
console.log('⏳ Đang tiến hành xuất dữ liệu...');

const args = [
  ...connectionArgs,
  '--format=plain',
  '--no-owner',
  '--no-privileges',
  `--file=${tempFile}`
];

const env = { ...process.env, ...postgresEnv };
delete env.DATABASE_URL;
delete env.MIGRATION_DATABASE_URL;
delete env.BACKUP_DATABASE_URL;
delete env.PGPASSWORD;
delete env.PGHOST;
delete env.PGPORT;
delete env.PGUSER;
delete env.PGDATABASE;
if (dbTarget.password) env.PGPASSWORD = dbTarget.password;

const child = spawn(pgDumpBin, args, {
  stdio: 'inherit',
  env
});

const cleanupTemp = () => {
  try { fs.rmSync(tempFile, { force: true }); } catch {}
  try { fs.rmSync(tempManifestFile, { force: true }); } catch {}
};
const abortOnSignal = (signal) => {
  cleanupTemp();
  child.kill(signal);
  process.exitCode = 130;
};
process.once('SIGINT', () => abortOnSignal('SIGINT'));
process.once('SIGTERM', () => abortOnSignal('SIGTERM'));

child.on('error', (error) => {
  cleanupTemp();
  console.error(`❌ Không thể chạy pg_dump: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', (code) => {
  if (code !== 0) {
    cleanupTemp();
    console.error(`\n❌ Quá trình xuất thất bại với mã lỗi ${code}. File cũ không bị ghi đè.`);
    process.exitCode = code || 1;
    return;
  }

  try {
    const fileDescriptor = fs.openSync(tempFile, 'r');
    try { fs.fsyncSync(fileDescriptor); } finally { fs.closeSync(fileDescriptor); }
    fs.chmodSync(tempFile, 0o600);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(tempFile)).digest('hex');
    const manifest = {
      format: 'bdu-postgres-dump',
      version: 1,
      database: dbTarget.database,
      createdAt: new Date().toISOString(),
      size: fs.statSync(tempFile).size,
      sha256: digest
    };
    fs.writeFileSync(tempManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const manifestDescriptor = fs.openSync(tempManifestFile, 'r');
    try { fs.fsyncSync(manifestDescriptor); } finally { fs.closeSync(manifestDescriptor); }
    fs.renameSync(tempFile, targetFile);
    fs.renameSync(tempManifestFile, manifestFile);
    const stats = fs.statSync(targetFile);
    const sizeKb = (stats.size / 1024).toFixed(2);
    console.log(`\n✅ Xuất dữ liệu thành công!`);
    console.log(`📊 Dung lượng: ${sizeKb} KB`);
    console.log(`🔐 SHA-256: ${digest}`);
    console.log('🔒 Quyền file: 0600; ghi atomic để không để lại backup dở dang.');
  } catch (error) {
    cleanupTemp();
    console.error(`❌ Không hoàn tất được backup atomic: ${error.message}`);
    process.exitCode = 1;
  }
});
