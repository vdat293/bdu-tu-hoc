/**
 * Kiem chung tinh trung cho buoc tach controller: tap method cua file goc phai
 * BANG DUNG tap method cua cac file domain moi (khong thieu, khong thua).
 * Agent bao cao bang so tay khong du tin; phai so bang may.
 *
 * Dung: node scripts/verify-controller-split.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = path.join(root, 'src', 'controllers', 'api.controller.js');
const MODULES_DIR = path.join(root, 'src', 'modules');

// Method dang `  name(req, res) {` hoac `  async name(req, res) {` o indent 2
// ben trong object literal ApiController.
const METHOD_RE = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(\s*req\s*,\s*res\s*(?:,\s*next\s*)?\)\s*\{/gm;
// Kiem tra cac file domain moi co export object literal `export const X = {`.
// KHONG dung co `g`: regex co `g` la stateful qua lastIndex, `.test()` se
// cho ket qua sai o cac file sau.
const EXPORT_RE = /^export const \w+ = \{/m;

function collectOriginalMethods(file) {
  const source = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const match of source.matchAll(METHOD_RE)) names.add(match[1]);
  return names;
}

function collectModuleMethods(dir) {
  const names = new Set();
  const files = [];
  // Controller nằm trong thu muc con theo domain (modules/auth/...), nen phai
  // de quy chu khong se quet 0 file va bao "thieu toan bo" gia.
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_shared') continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.controller.js')) {
        // admin-dashboard.controller.js da duoc tach o BUOC 1, khong phai mot
        // phan cua ApiController nen khong so sanh vao day.
        if (entry.name === 'admin-dashboard.controller.js') continue;
        files.push(full);
      }
    }
  };
  walk(dir);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!EXPORT_RE.test(source)) throw new Error(`${path.relative(root, file)} khong export object literal`);
    for (const match of source.matchAll(METHOD_RE)) names.add(match[1]);
  }
  return { names, count: files.length };
}

const original = collectOriginalMethods(ORIGINAL);
const { names: split, count: fileCount } = collectModuleMethods(MODULES_DIR);

const missing = [...original].filter((name) => !split.has(name)).sort();
const extra = [...split].filter((name) => !original.has(name)).sort();

console.log(`File goc      : ${original.size} method`);
console.log(`File domain   : ${split.size} method trong ${fileCount} file controller`);
console.log(`Thieu         : ${missing.length}${missing.length ? ` -> ${missing.join(', ')}` : ''}`);
console.log(`Thua         : ${extra.length}${extra.length ? ` -> ${extra.join(', ')}` : ''}`);

if (missing.length > 0 || extra.length > 0) {
  console.error('\nSAI LACH - tach khong trung nguyen.');
  process.exitCode = 1;
} else {
  console.log('\nOK - tap method goc va tach khop hoan toan.');
}
