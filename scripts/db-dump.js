import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findPostgresBinary, getSafeDatabaseTarget } from './postgres-utils.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDumpFile = path.resolve(currentDir, '..', 'data', 'backup.sql');
const targetFile = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultDumpFile;

const dumpDir = path.dirname(targetFile);
if (!fs.existsSync(dumpDir)) {
  fs.mkdirSync(dumpDir, { recursive: true });
}

let dbTarget;
try {
  dbTarget = getSafeDatabaseTarget();
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

console.log('======================================================');
console.log('📦 BDU Tự Học - Xuất Database (PostgreSQL Dump)');
console.log(`🌐 Database: ${dbTarget.database || 'mặc định'}`);
console.log(`📁 File lưu:  ${targetFile}`);
console.log('======================================================');
console.log('⏳ Đang tiến hành xuất dữ liệu...');

const args = [
  `--dbname=${dbTarget.url}`,
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-privileges',
  `--file=${targetFile}`
];

const env = { ...process.env };
if (dbTarget.password) {
  env.PGPASSWORD = dbTarget.password;
}

const child = spawn(pgDumpBin, args, {
  stdio: 'inherit',
  env
});

child.on('close', (code) => {
  if (code === 0) {
    const stats = fs.statSync(targetFile);
    const sizeKb = (stats.size / 1024).toFixed(2);
    console.log(`\n✅ Xuất dữ liệu thành công!`);
    console.log(`📊 Dung lượng: ${sizeKb} KB\n`);
  } else {
    console.error(`\n❌ Quá trình xuất thất bại với mã lỗi ${code}.`);
    process.exit(code || 1);
  }
});
