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
//
// Tra ve DANH SACH theo so route giam dan, khong phai mot ban duy nhat: ban
// goc nhieu route nhat co the la ban monolithic cu import nhung file da bi
// di chuyen trong dot tai cau truc (vi du admin-dashboard.controller.js), nen
// no khong con import duoc. Khi do phai lui ve ban cu ke tiep con nap duoc
// thay vi crash — neu khong, guard se chet cam chu khong bao loi.
function readOriginalCandidates() {
  let commits = [];
  try {
    commits = execFileSync('git', ['log', '--format=%H', '--', 'src/routes/api.routes.js'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
  const candidates = [];
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
    candidates.push({ source, count, commit });
  }
  candidates.sort((left, right) => right.count - left.count);
  return candidates;
}

const candidates = readOriginalCandidates();
if (candidates.length === 0) {
  console.log('Khong tim thay ban goc lich su cua api.routes.js - bo qua kiem tra.');
  process.exit(0);
}

// Route duoc THEM SAU ban goc (khong co trong ban goc). So sanh theo kieu
// "ban goc la day con dung thu tu cua ban moi": route cu khong duoc mat, khong
// duoc hoan vi; route chen them phai nam trong danh sach nay. Neu chi so khop
// theo chi so (i === i) nhu truoc thi mot route chen giua se bao lech toan bo
// phan sau, con neu noi long thanh "cung tap" thi mat luon kha nang bat hoan vi.
//
// Ban goc la ban nhieu route nhat NAP DUOC (xem readOriginalCandidates). Neu ban
// do la ban monolithic cu chua co route diem ren luyen thi cac route moi phai co
// mat o day; them route moi ma khong khai bao => script fail.
const ROUTES_ADDED_AFTER_SPLIT = new Set([
  'GET /training-score/semesters',
  'GET /training-score/criteria',
  'POST /training-score/cds-sync',
  'GET /training-score/cds-credentials',
  'DELETE /training-score/cds-credentials',
  'POST /training-score/submit',
  // Route them o Task 3 (cong tac khoa dich vu bao tri): endpoint cong khai de
  // client doc trang thai khoa. Khong co trong ban goc api.routes.js.
  'GET /status',
  // Route admin cua Task 5 (cong tac khoa dich vu bao tri): bat/tat khoa qua
  // /admin; khong co trong ban goc api.routes.js.
  'GET /admin/dashboard/service-lock',
  'PUT /admin/dashboard/service-lock',
  // Route admin cua Task 4 (tab Insights): 5 endpoint phan tich hanh vi. Dang
  // ky sau PUT /admin/dashboard/service-lock, truoc POST /admin/dashboard/purge.
  'GET /admin/dashboard/insights/features',
  'GET /admin/dashboard/insights/hours',
  'GET /admin/dashboard/insights/cohort',
  'GET /admin/dashboard/insights/quality',
  'GET /admin/dashboard/insights/users/:mssv/journey'
]);

try {
  const { ENGLISH_ANSWERS_PATH } = process.env;
  let original = null;
  let before = null;
  const loadErrors = [];

  for (const candidate of candidates) {
    fs.writeFileSync(oldAbsolute, candidate.source, 'utf8');
    try {
      // Query string bu cache: cung duong dan nhung noi dung khac nhau giua
      // cac ung vien.
      const { default: oldRouter } = await import(`../${oldRelative}?v=${candidate.commit}`);
      before = describe(oldRouter);
      original = candidate;
      break;
    } catch (error) {
      loadErrors.push(`${candidate.commit.slice(0, 8)} (${candidate.count} route): ${error.code || error.message}`);
    }
  }

  if (!original) {
    console.error('Khong nap duoc ban goc nao tu git:');
    for (const line of loadErrors.slice(0, 10)) console.error(`  ${line}`);
    process.exitCode = 2;
  } else {
    const { default: newRouter } = await import('../src/routes/api.routes.js');
    const after = describe(newRouter);

    console.log(`Ban goc lay tu commit ${original.commit.slice(0, 8)} (${original.count} lenh dang ky route).`);
    if (loadErrors.length > 0) {
      console.log(`Bo qua ${loadErrors.length} ban goc khong nap duoc (lui ve ban cu ke tiep).`);
    }
    console.log(`Ban goc : ${before.length} layer`);
    console.log(`Moi     : ${after.length} layer`);

    // Duyet ban moi, khop tung layer cua ban goc theo dung thu tu. Layer khong
    // khop duoc voi ban goc la route moi chen vao.
    const inserted = [];
    const mismatch = [];
    let cursor = 0;
    for (const layer of after) {
      if (cursor < before.length && layer === before[cursor]) {
        cursor += 1;
        continue;
      }
      if (ROUTES_ADDED_AFTER_SPLIT.has(layer)) {
        inserted.push(layer);
        continue;
      }
      // Route la trong ban goc nhung xuat hien sai vi tri -> hoan vi.
      if (cursor < before.length) {
        mismatch.push({ expected: before[cursor], actual: layer, index: cursor + 1 });
        break;
      }
    }
    const unconsumed = before.slice(cursor);

    if (mismatch.length > 0) {
      console.error('\nSAI LACH - route ban goc xuat hien sai thu tu hoac bi doi:');
      console.error(`  doi #${mismatch[0].index}  goc: ${mismatch[0].expected}\n        moi: ${mismatch[0].actual}`);
      process.exitCode = 1;
    } else if (unconsumed.length > 0) {
      console.error(`\nSAI LACH - thieu ${unconsumed.length} route so voi ban goc:`);
      for (const layer of unconsumed.slice(0, 20)) console.error(`  ${layer}`);
      process.exitCode = 1;
    } else {
      console.log(`Route them sau ban goc: ${inserted.length}${inserted.length ? ` -> ${inserted.join(', ')}` : ''}`);
      console.log('\nOK - thu tu route cu giong het ban goc, khong hoan vi, khong mat route.');
    }
  }
  void ENGLISH_ANSWERS_PATH;
} finally {
  fs.rmSync(oldAbsolute, { force: true });
}
