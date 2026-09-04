import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findPostgresBinary, getSafeDatabaseTarget } from './postgres-utils.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDumpFile = path.resolve(currentDir, '..', 'data', 'backup.sql');
const targetFile = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultDumpFile;

if (!fs.existsSync(targetFile)) {
  console.error(`❌ Không tìm thấy file backup tại: ${targetFile}`);
  console.error(`👉 Vui lòng copy file "backup.sql" vào thư mục "data/" hoặc chỉ định đường dẫn:`);
  console.error(`   npm run db:restore <đường_dẫn_file>\n`);
  process.exit(1);
}

let dbTarget;
try {
  dbTarget = getSafeDatabaseTarget();
} catch (err) {
  console.error(`❌ Lỗi: ${err.message}`);
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
console.log(`🌐 Database đích: ${dbTarget.database || 'mặc định'}`);
console.log(`📁 File nguồn:    ${targetFile}`);
console.log('======================================================');
console.log('⏳ Đang tiến hành nạp dữ liệu vào database...');

const args = [
  `--dbname=${dbTarget.url}`,
  `--file=${targetFile}`
];

const env = { ...process.env };
if (dbTarget.password) {
  env.PGPASSWORD = dbTarget.password;
}

const child = spawn(psqlBin, args, {
  stdio: 'inherit',
  env
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`\n✅ Phục hồi dữ liệu thành công vào database '${dbTarget.database}'!`);
    console.log(`🚀 Giờ bạn có thể chạy: npm run dev\n`);
  } else {
    console.error(`\n❌ Quá trình nạp dữ liệu kết thúc với mã lỗi ${code}.`);
    console.error(`💡 Nếu lỗi do database chưa tồn tại, hãy chạy trước:`);
    console.error(`   npm run db:setup:dev`);
    process.exit(code || 1);
  }
});
