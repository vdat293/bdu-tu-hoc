import fs from 'node:fs';

const sourcePath = 'public/css/style.css';
const outputPath = 'public/css/login.css';
const source = fs.readFileSync(sourcePath, 'utf8');

const ranges = [
  ['base-login', '', '/* ==========================================================================\r\n   VIEW 2: APP LAYOUT'],
  ['institutional-login', '/* Login: institutional split composition */', '/* Navigation */'],
  ['privacy-login', '/* ========================================================================== \r\n   PRODUCT LOGIN — INTERACTIVE PRIVACY CHARACTERS', '/* ==========================================================================\r\n   AUTO ENGLISH EXERCISE / MOODLE']
];

const normalized = source.replaceAll('\r\n', '\n');
const chunks = [];
for (const [name, startMarker, endMarker] of ranges) {
  const start = startMarker ? normalized.indexOf(startMarker.replaceAll('\r\n', '\n')) : 0;
  if (start < 0) throw new Error(`Không tìm thấy mốc CSS bắt đầu: ${name}`);
  const end = endMarker ? normalized.indexOf(endMarker.replaceAll('\r\n', '\n'), start + startMarker.length) : normalized.length;
  if (end < 0) throw new Error(`Không tìm thấy mốc CSS kết thúc: ${name}`);
  chunks.push(`/* ${name} extracted from style.css; keep source order. */\n${normalized.slice(start, end).trim()}`);
}

fs.writeFileSync(outputPath, `${chunks.join('\n\n')}\n`, 'utf8');
console.log(`Login CSS đã tách: ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
