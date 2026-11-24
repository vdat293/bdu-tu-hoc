import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminFiles = [
  path.join(ROOT, 'client', 'admin.html')
];

function collectJsx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsx(full);
    else if (/\.(js|jsx)$/.test(entry.name)) adminFiles.push(full);
  }
}
collectJsx(path.join(ROOT, 'client', 'src', 'admin'));

for (const file of adminFiles) {
  const src = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/, `${path.relative(ROOT, file)} must never use dangerouslySetInnerHTML`);
  assert.doesNotMatch(src, /24050126/, `${path.relative(ROOT, file)} must never hardcode owner MSSV`);
  assert.doesNotMatch(src, /SYSTEM_OWNER_MSSV/, `${path.relative(ROOT, file)} must never mention SYSTEM_OWNER_MSSV`);
}

console.log(`✅ React Admin Dashboard rendering safety verified across ${adminFiles.length} files (no dangerouslySetInnerHTML or owner leaks).`);
