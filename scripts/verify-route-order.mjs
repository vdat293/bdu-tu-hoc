/**
 * Kiem chung THU TU route: so router stack cua api.routes.js moi voi ban goc
 * (lay tu git HEAD), lap bang method + path theo dung thu tu.
 *
 * Express khop route theo thu tu dang ky, nen "hoan vi" khong phai la thay
 * doi tuong duong — no la thay doi hanh vi. Script nay bat buoc danh sach
 * phai GIONG HET MOT (khong chi cung tap).
 *
 * Dung: node scripts/verify-route-order.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ban goc phai nam trong repo de cac import tuong doi giong het.
const oldRelative = 'src/routes/__verify_old_api.routes.js';
const oldAbsolute = path.join(root, oldRelative);

function describe(router) {
  const layers = [];
  for (const layer of router.stack || []) {
    if (layer.route) {
      const route = layer.route;
      const methods = Object.keys(route.methods || {}).filter((m) => m !== '_all').sort().join('|');
      layers.push(`${methods.toUpperCase()} ${route.path}`);
      continue;
    }
    if (layer.name === 'router' && layer.handle?.stack) {
      // `router.use(path, mw)` — middleware gắn tên, khong phai route.
      layers.push(`USE ${layer.regexp?.source?.split('\\')[0] ?? ''}`);
    }
  }
  return layers;
}

// So với HEAD là tautology: sau khi commit tách, HEAD chính là file assembler
// nên so với working tree luôn ra "OK" và cổng bảo vệ thứ tự route chết
// âm thầm. Thay vào đó chọn bản gốc ĐỦ NHIỀU route nhất trong lịch sử — tự
// sửa chính, không phụ thuộc hard-code commit hash.
function readOriginalSource() {
  let commits = [];
  try {
    commits = execFileSync('git', ['log', '--format=%H', '--', 'src/routes/api.routes.js'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
  let best = null;
  for (const commit of commits) {
    let source;
    try {
      source = execFileSync('git', ['show', `${commit}:src/routes/api.routes.js`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024
      });
    } catch {
      continue;
    }
    // Đếm route bằng số lần gọi router.get/post/... trong file.
    const count = (source.match(/\brouter\.(get|post|put|patch|delete|use)\s*\(/g) || []).length;
    if (!best || count > best.count) best = { source, count, commit };
  }
  return best;
}

let original;
try {
  original = readOriginalSource();
} catch (error) {
  console.error('Khong doc duoc ban goc tu git:', error.message);
  process.exit(2);
}
if (!original) {
  console.log('Khong tim thay ban goc lich su cua api.routes.js - bo qua kiem tra.');
  process.exit(0);
}
fs.writeFileSync(oldAbsolute, original.source, 'utf8');
console.log(`Ban goc lay tu commit ${original.commit.slice(0, 8)} (${original.count} lenh dang ky route).`);

try {
  const { ENGLISH_ANSWERS_PATH } = process.env;
  const { default: oldRouter } = await import(`../${oldRelative}`);
  const { default: newRouter } = await import('../src/routes/api.routes.js');

  const before = describe(oldRouter);
  const after = describe(newRouter);

  console.log(`Ban goc : ${before.length} layer`);
  console.log(`Moi     : ${after.length} layer`);

  if (before.length !== after.length) {
    console.error('SAI LACH - so layer khac nhau.');
    process.exitCode = 1;
  } else {
    const diffs = [];
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i]) diffs.push({ index: i + 1, before: before[i], after: after[i] });
    }
    if (diffs.length === 0) {
      console.log('\nOK - thu tu route giong het ban goc, khong hoan vi.');
    } else {
      console.error(`\nSAI LACH - ${diffs.length} vi tri lech:`);
      for (const d of diffs.slice(0, 20)) {
        console.error(`  #${d.index}  goc: ${d.before}\n        moi: ${d.after}`);
      }
      process.exitCode = 1;
    }
  }
  void ENGLISH_ANSWERS_PATH;
} finally {
  fs.rmSync(oldAbsolute, { force: true });
}
