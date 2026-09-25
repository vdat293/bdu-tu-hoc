import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  findPostgresBinary,
  getPostgresConnectionArgs,
  getPostgresEnv,
  getSafeDatabaseTarget
} from './postgres-utils.js';

const cliArgs = process.argv.slice(2);
const allowProduction = cliArgs.includes('--allow-production');
const yes = cliArgs.includes('--yes');
const positionalArgs = cliArgs.filter((arg) => !arg.startsWith('--'));
const unknownArgs = cliArgs.filter((arg) => arg.startsWith('--') && !['--allow-production', '--yes'].includes(arg));

if (unknownArgs.length > 0) {
  console.error(`❌ Không hỗ trợ flag: ${unknownArgs.join(', ')}`);
  process.exit(2);
}
if (positionalArgs.length !== 1) {
  console.error('Cách dùng: npm run db:restore -- <đường_dẫn_file> --yes');
  process.exit(2);
}
if (!yes) {
  console.error('❌ Restore là thao tác phá hủy. Phải truyền --yes sau khi kiểm tra backup.');
  process.exit(2);
}

const targetFile = path.resolve(process.cwd(), positionalArgs[0]);
let fileStats;
try {
  fileStats = fs.lstatSync(targetFile);
} catch (error) {
  console.error(`❌ Không tìm thấy file backup tại: ${targetFile}`);
  process.exit(1);
}
if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
  console.error('❌ Backup phải là file thường, không được là symlink.');
  process.exit(1);
}

let dbTarget;
try {
  dbTarget = getSafeDatabaseTarget({ operation: 'restore', allowProduction, preferMigration: true });
} catch (err) {
  console.error(`❌ Lỗi: ${err.message}`);
  process.exit(1);
}

const manifestFile = `${targetFile}.manifest.json`;
let manifest;
try {
  const manifestStats = fs.lstatSync(manifestFile);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw new Error('manifest không phải file thường');
  manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
} catch (error) {
  console.error(`❌ Backup phải có manifest hợp lệ (${manifestFile}): ${error.message}`);
  process.exit(1);
}
if (
  manifest?.format !== 'bdu-postgres-dump'
  || manifest?.version !== 1
  || !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))
  || manifest.database !== dbTarget.database
  || Number(manifest.size) !== fileStats.size
) {
  console.error('❌ Manifest backup không khớp format/database/size.');
  process.exit(1);
}
const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
if (actualSha256 !== String(manifest.sha256).toLowerCase()) {
  console.error('❌ SHA-256 backup không khớp manifest; từ chối restore.');
  process.exit(1);
}

if (process.env.BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE !== '1') {
  console.error('❌ Thiếu BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE=1.');
  process.exit(1);
}
if (process.env.BDU_MAINTENANCE_CONFIRM_DATABASE !== dbTarget.database) {
  console.error(`❌ Xác nhận database không khớp. Expected BDU_MAINTENANCE_CONFIRM_DATABASE=${dbTarget.database}.`);
  process.exit(1);
}

const psqlBin = findPostgresBinary('psql');
if (!psqlBin) {
  console.error('❌ Không tìm thấy công cụ `psql` trên máy.');
  if (process.platform === 'win32') {
    console.error('👉 Trên Windows: Vui lòng cài PostgreSQL và thêm đường dẫn `C:\\Program Files\\PostgreSQL\\<version>\\bin` vào biến môi trường PATH.');
  } else {
    console.error('👉 Trên Mac: Cài qua brew: `brew install postgresql@16` hoặc `brew install libpq`.');
  }
  process.exit(1);
}

console.log('======================================================');
console.log('📥 BDU Tự Học - Nhập Database (PostgreSQL Restore)');
console.log(`🌐 Database đích: ${dbTarget.database}`);
console.log(`📁 File nguồn:    ${targetFile}`);
console.log(`🧾 Manifest:     ${manifestFile}`);
console.log('======================================================');
console.log('⏳ Đang tiến hành nạp dữ liệu vào database...');

const args = [
  ...getPostgresConnectionArgs(dbTarget, { allowProduction }),
  '--no-psqlrc',
  '--single-transaction',
  '--set=ON_ERROR_STOP=1',
  `--file=${targetFile}`
];

const env = { ...process.env, ...getPostgresEnv(dbTarget, { allowProduction }) };
delete env.DATABASE_URL;
delete env.MIGRATION_DATABASE_URL;
delete env.BACKUP_DATABASE_URL;
delete env.PGPASSWORD;
delete env.PGHOST;
delete env.PGPORT;
delete env.PGUSER;
delete env.PGDATABASE;
if (dbTarget.password) env.PGPASSWORD = dbTarget.password;

const child = spawn(psqlBin, args, {
  stdio: 'inherit',
  env
});

child.on('error', (error) => {
  console.error(`❌ Không thể chạy psql: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`\n✅ Phục hồi dữ liệu thành công vào database '${dbTarget.database}'!`);
    console.log('🧪 Hãy chạy smoke test trước khi dùng database này cho môi trường thật.');
  } else {
    console.error(`\n❌ Quá trình nạp dữ liệu kết thúc với mã lỗi ${code}. Transaction đã rollback nếu PostgreSQL còn hoạt động.`);
    process.exitCode = code || 1;
  }
});
