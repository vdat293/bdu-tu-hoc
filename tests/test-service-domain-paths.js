import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard cho đợt dời 12 service đơn-domain vào src/modules/<domain>/ (Task 2).
// Ba điều phải luôn đúng sau refactor:
//   (a) 12 file nằm ở đích mới và KHÔNG còn ở src/services/;
//   (b) không còn tham chiếu đường dẫn cũ `services/<name>.service.js` trong
//       src / tests / scripts / client / server.js (import sót chỉ nổ
//       ERR_MODULE_NOT_FOUND khi endpoint tương ứng được gọi);
//   (c) tầng dùng chung src/services/ không import ngược lên src/modules/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

// Tên file đã dời -> domain đích. Tên gốc được ghép chuỗi khi kiểm tra để
// chính file guard này không tự báo động khi bị quét.
const MOVED = {
  'achievement.service.js': 'academics',
  'traffic-insights.service.js': 'admin',
  'mention.service.js': 'community',
  'english-exercise.service.js': 'english',
  'avatar-override.service.js': 'media',
  'discord-oauth.service.js': 'notifications',
  'notification.service.js': 'notifications',
  'survey.service.js': 'survey',
  'survey-run.service.js': 'survey',
  'training-score.service.js': 'training',
  'vocab.service.js': 'vocab',
  'grammar.service.js': 'grammar'
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.playwright-mcp', 'temp', 'coverage']);
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'client'];
const SCAN_FILES = ['server.js'];

function collectFiles(target, out) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    collectFiles(path.join(target, entry.name), out);
  }
  return out;
}

// (a) File tồn tại ở đích mới, không còn ở chỗ cũ.
const missingAtDest = [];
const leftAtOldPath = [];
for (const [name, domain] of Object.entries(MOVED)) {
  const dest = path.join(ROOT, 'src', 'modules', domain, name);
  if (!fs.existsSync(dest)) missingAtDest.push(path.relative(ROOT, dest));
  if (fs.existsSync(path.join(ROOT, 'src', 'services', name))) {
    leftAtOldPath.push(path.join('src', 'services', name));
  }
}
assert.deepStrictEqual(missingAtDest, [], `Thiếu file ở đích mới:\n  ${missingAtDest.join('\n  ')}`);
assert.deepStrictEqual(leftAtOldPath, [], `File đã dời vẫn còn ở src/services/:\n  ${leftAtOldPath.join('\n  ')}`);

// (b) Không còn tham chiếu đường dẫn cũ trong vùng quét.
const scanned = [];
for (const entry of [...SCAN_ROOTS, ...SCAN_FILES]) {
  collectFiles(path.join(ROOT, entry), scanned);
}
const oldRefRe = new RegExp(`services/(?:${Object.keys(MOVED).map((n) => n.replace(/\./g, '\\.')).join('|')})`);
const staleRefs = [];
for (const file of scanned) {
  if (path.resolve(file) === path.resolve(SELF)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (oldRefRe.test(line)) staleRefs.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
  });
}
assert.deepStrictEqual(staleRefs, [], `Còn tham chiếu đường dẫn service cũ:\n  ${staleRefs.join('\n  ')}`);

// (c) src/services/ không import ngược lên src/modules/.
const servicesDir = path.join(ROOT, 'src', 'services');
const backImports = [];
const backRe = /from\s+['"]\.\.\/modules\//;
for (const file of collectFiles(servicesDir, [])) {
  if (backRe.test(fs.readFileSync(file, 'utf8'))) {
    backImports.push(path.relative(ROOT, file));
  }
}
assert.deepStrictEqual(backImports, [], `Tầng shared import ngược lên domain:\n  ${backImports.join('\n  ')}`);

console.log(`✅ Service domain paths OK: ${Object.keys(MOVED).length} service ở đúng domain, 0 tham chiếu cũ.`);
