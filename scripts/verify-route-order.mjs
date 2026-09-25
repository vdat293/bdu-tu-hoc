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

let oldSource;
try {
  oldSource = execFileSync('git', ['show', 'HEAD:src/routes/api.routes.js'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  });
} catch (error) {
  console.error('Khong doc duoc ban goc tu git HEAD:', error.message);
  process.exit(2);
}
fs.writeFileSync(oldAbsolute, oldSource, 'utf8');

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
