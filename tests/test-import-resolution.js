import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard cho toàn bộ đợt tái cấu trúc src/: mọi import tương đối phải resolve
// được tới file thật. Khi di chuyển file mà quên sửa một import, Node chỉ báo
// ERR_MODULE_NOT_FOUND lúc chạy — có thể chỉ đúng một nhánh request, rất khó
// phát hiện bằng mắt. Test này biến lỗi đó thành lỗi ngay ở gate.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Thư mục không quét: dependency cài sẵn, artifact build, hoặc ngoài repo.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.playwright-mcp', 'temp', 'coverage']);
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'client/src', 'public/js', 'public/games/js'];
const SCAN_FILES = ['server.js'];

// Chỉ kiểm tra import TƯƠNG ĐỐI. Package name do npm resolve, không thuộc
// phạm vi kiểm tra path nội bộ.
const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function collectFiles(target, files) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.(?:js|mjs|cjs)$/.test(target)) files.push(target);
    return files;
  }
  if (!stat.isDirectory()) return files;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    collectFiles(path.join(target, entry.name), files);
  }
  return files;
}

// Node ESM chấp nhận specifier không đuôi file; thứ tự thử khớp cách Node
// thật sự tra cứu, để test không báo động giả cho file hợp lệ.
const CANDIDATE_SUFFIXES = ['', '.js', '.mjs', '.cjs', '/index.js', '/index.mjs'];

function resolvesToFile(specifier, fromFile) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  return CANDIDATE_SUFFIXES.some((suffix) => {
    const candidate = `${base}${suffix}`;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
}

const scanned = [];
for (const entry of [...SCAN_ROOTS, ...SCAN_FILES]) {
  const target = path.join(ROOT, entry);
  if (!fs.existsSync(target)) continue;
  collectFiles(target, scanned);
}

assert.ok(scanned.length > 50, `Chỉ quét được ${scanned.length} file — có thể đường dẫn scan sai`);

const broken = [];
let checked = 0;
for (const file of scanned) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      // Tiến regex TRƯỚC khi xử lý, nếu không `continue` sẽ lặp vô hạn trên
      // cùng một match.
      match = pattern.exec(source);
      // Specifier có nội suy (`./${file}.js`) là import động: không thể resolve
      // tĩnh, và không phải lỗi khi di chuyển file. Bỏ qua.
      if (specifier.includes('${')) continue;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        checked += 1;
        if (!resolvesToFile(specifier, file)) {
          broken.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
  }
}

assert.equal(
  broken.length,
  0,
  `Có ${broken.length} import tương đối không resolve được (thường do di chuyển file mà quên sửa path):\n  ${broken.join('\n  ')}`
);

console.log(`✅ Import resolution OK: ${checked} specifier tương đối trong ${scanned.length} file đều tồn tại.`);
