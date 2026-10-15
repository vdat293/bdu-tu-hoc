/**
 * test-odp-sync.js — Task 1 (ODP ingest)
 *
 * Phần thuần: chuẩn hoá dòng ODP (coerce), 5 mã điểm danh, nhãn học kỳ.
 * Phần DB: `sync()` với HTTP mock — fetch xong mới TRUNCATE+INSERT trong 1
 * transaction cho từng bảng, nên bảng nào fetch lỗi thì GIỮ NGUYÊN dữ liệu cũ;
 * run status `success`/`failed` theo bảng bắt buộc (sinh_vien, tbhk).
 *
 * Chạy (Windows, không spawn runner):
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_CONFIRM_DESTRUCTIVE='1';
 *   $env:BDU_TEST_RUNNER='explicit';
 *   $env:BDU_TEST_DATABASE_URL='postgresql://bdu_test:bdu_test_password@127.0.0.1:55432/bdu_test_local';
 *   $env:DATABASE_URL=$env:BDU_TEST_DATABASE_URL; node tests/test-odp-sync.js
 */
import assert from 'node:assert/strict';
import https from 'node:https';
import { closeDatabase, getPool, query } from '../src/db/database.js';
import {
  ODP_SYNC_LOCK_ID,
  ODP_TABLES,
  OdpSyncService,
  hocKyLabel,
  normalizeOdpRows,
  validDiemDanh
} from '../src/services/odp-sync.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

process.env.CDS_USER = process.env.CDS_USER || 'test-user';
process.env.CDS_PASSWORD = process.env.CDS_PASSWORD || 'test-pass';
process.env.ODP_SYNC_RETRY_BASE_MS = '1';

const ODPS = ODP_TABLES.map((table) => table.table);
const PII_COLUMNS = ['cccd', 'email', 'ho_khau', 'danh_sach_ten_sv', 'sdt', 'noi_sinh', 'ton_giao'];
const BANNED_TABLES = ['dim_gio_thu_vien_odp', 'odp_gio_thu_vien'];

function emit() {
  const handlers = {};
  return {
    on(event, handler) {
      (handlers[event] = handlers[event] || []).push(handler);
      return this;
    },
    emit(event, ...args) {
      (handlers[event] || []).forEach((handler) => handler(...args));
      return this;
    },
    destroy() {}
  };
}

const originalGet = https.get;
let routeResolver = () => ({ status: 200, body: [] });
const requestLog = [];
let mockInstalled = false;

function installHttpMock() {
  if (mockInstalled) return;
  mockInstalled = true;
  https.get = (url, options, callback) => {
    const request = emit();
    const requestUrl = String(url);
    requestLog.push(requestUrl);
    setImmediate(() => {
      const outcome = routeResolver(requestUrl);
      if (outcome.error) {
        request.emit('error', new Error(outcome.error));
        return;
      }
      const response = emit();
      response.statusCode = outcome.status;
      response.setEncoding = () => {};
      callback(response);
      const text = typeof outcome.body === 'string' ? outcome.body : JSON.stringify(outcome.body);
      response.emit('data', text);
      response.emit('end');
    });
    return request;
  };
}

function restoreHttpMock() {
  if (!mockInstalled) return;
  https.get = originalGet;
  mockInstalled = false;
}

async function cleanupOdpTables() {
  await query(`TRUNCATE ${ODPS.join(', ')}`);
  await query('DELETE FROM odp_sync_runs');
}

function tableOf(url) {
  const pathname = url.split('?')[0];
  return pathname.split('/').pop();
}

function offsetOf(url) {
  const match = url.match(/[?&]offset=(\d+)/);
  return match ? Number(match[1]) : 0;
}

function limitOf(url) {
  const match = url.match(/[?&]limit=(\d+)/);
  return match ? Number(match[1]) : 15000;
}

const SINH_VIEN_ROW = {
  mssv: '24050126',
  ten_day_du: 'Nguyễn Văn Test',
  ho_sv: 'Nguyễn Văn',
  ten_sv: 'Test',
  gioi_tinh: '1',
  ngay_sinh: 'Tue, 17 Apr 1990 00:00:00 GMT',
  ma_lop: '25AD01',
  ten_lop: 'AD01',
  ma_khoa: 'TH',
  ten_khoa: 'Công nghệ thông tin',
  ma_nganh: 'TH',
  ten_nganh: 'Công nghệ thông tin',
  ma_chuyen_nganh: null,
  ten_chuyen_nganh: null,
  ma_cvht: null,
  ten_cvht: null,
  ten_bac_hoc: null,
  hien_dien: 'Đang học',
  nk: '2022-2028',
  cccd: '123456789',
  email: 'x@student.bdu.edu.vn',
  ho_khau: 'Bình Dương',
  sdt: '0900000000'
};

const TBHK_ROW = {
  mssv: '24050126',
  nkhk: '24251',
  ma_lop: '25AD01',
  ten_sinh_vien: 'Nguyễn Văn Test',
  so_tin_chi_dat_hk: '18',
  so_tin_chi_dat_tich_luy: '100',
  dtb_hk_he_4: '3.21',
  dtb_hk_he_10: '7.85',
  dtb_tich_luy_he_4: '3.05',
  dtb_tich_luy_he_10: '7.42',
  xep_loai_hoc_ki: 'Khá'
};

const BANG_DIEM_ROW = {
  mssv: '24050126',
  nkhk: '24251',
  ma_nhom: 'INF0873_24251_01',
  ten_mon_hoc: 'Nhập môn kỹ thuật phần mềm',
  diem_hp: '7.2',
  diem_hp_4: '3.0',
  diem_chu_hp: 'B',
  diem_chu_hp_4: 'B',
  dat_hp: 1,
  lop: '26AV01',
  ma_khoa: 'NN'
};

const DIEM_DANH_ROW = {
  mssv: '24050126',
  ma_nhom: 'INF0873_24251_01',
  ngay: 'Sat, 14 Sep 2024 00:00:00 GMT',
  ngay_origin: '2024-09-14',
  buoi: '1',
  ma_mon_hoc: 'INF0873',
  ten_mon_hoc: 'Nhập môn kỹ thuật phần mềm',
  diem_danh: 'Vắng',
  gio_co_mat: null
};

const THOI_KHOA_BIEU_ROW = {
  id: 1,
  nkhk: '24251',
  ma_nhom: 'INF0873_24251_01',
  ma_mon_hoc: 'INF0873',
  ten_mon_hoc: null,
  nhom_hoc: '01',
  ma_giang_vien: null,
  ten_giang_vien: null,
  ma_phong: null,
  buoi_thu: '1',
  thu_kieu_so: 7,
  tiet_bat_dau: 0,
  so_tiet: 5,
  ngay_hoc: 'Sat, 03 May 2025 00:00:00 GMT',
  tuan_bat_dau: '36',
  tuan_ket_thuc: 43,
  danh_sach_sv: '[24050126]',
  ma_lop: null
};

const REN_LUYEN_ROW = {
  mssv: '24050126',
  nkhk: '24251',
  hoc_ki: '1',
  lop: '25AD01',
  diem_ren_luyen: '65',
  xep_loai: 'Tốt ',
  ho_ten: 'Nguyễn Văn Test',
  nien_khoa_format: '2024-2025'
};

const SU_KIEN_ROW = {
  id: 1,
  ten_su_kien: 'Áp dụng cách học tiếng Anh',
  loai: 'seminar',
  the_loai: 'hoat_dong_clb',
  ngay_dien_ra: 'Sun, 16 Mar 2025 00:00:00 GMT',
  nkhk: '24252',
  danh_sach_sv: '[24050126, 24050008]',
  danh_sach_ten_sv: '["Nguyễn Văn Test"]',
  diem_cong: 1,
  pham_vi: 'TH'
};

const MON_HOC_ROWS = [
  { ma_mon_hoc: 'INF0873', ten_mon_hoc: 'Nhập môn kỹ thuật phần mềm', tin_chi: 3, ma_khoa: 'TH', type: 'Chuyên ngành' },
  { ma_mon_hoc: 'INF0874', ten_mon_hoc: 'Lập trình hướng đối tượng', tin_chi: '4', ma_khoa: null, type: 'Đại Cương' }
];

/** 3 dòng: dùng cho test phân trang với limit=2 (trang 1 đầy 2 dòng, trang 2 còn 1 dòng). */
const MON_HOC_PAGED_ROWS = [
  ...MON_HOC_ROWS,
  { ma_mon_hoc: 'INF0875', ten_mon_hoc: 'Cấu trúc dữ liệu', tin_chi: 3, ma_khoa: 'TH', type: 'Chuyên ngành' }
];

const OK_TABLE_ROWS = {
  fact_ho_so_sinh_vien_odp: [SINH_VIEN_ROW],
  fact_bang_diem_tbhk_odp: [TBHK_ROW],
  dim_bang_diem_odp: [BANG_DIEM_ROW],
  dim_danh_sach_diem_danh_odp: [DIEM_DANH_ROW],
  dim_thoi_khoa_bieu_odp: [THOI_KHOA_BIEU_ROW],
  dim_diem_ren_luyen_odp: [REN_LUYEN_ROW],
  dim_su_kien_odp: [SU_KIEN_ROW],
  dim_mon_hoc_odp: MON_HOC_ROWS
};

function rowsFor(table, offset, limit, overrides = {}) {
  const rows = Object.prototype.hasOwnProperty.call(overrides, table)
    ? overrides[table]
    : (OK_TABLE_ROWS[table] || []);
  if (offset >= rows.length) return [];
  return rows.slice(offset, offset + limit);
}

/**
 * `ignoreLimit`: nguồn trả nguyên bảng bất kể `limit` (hành vi THẬT của cds.bdu.edu.vn).
 * `ignoreOffset`: nguồn tôn trọng `limit` nhưng luôn trả trang đầu.
 */
function scenarioResponder({ failing = [], ignoreLimit = [], ignoreOffset = [], overrides = {} } = {}) {
  return (url) => {
    const table = tableOf(url);
    if (failing.includes(table)) return { status: 500, body: 'boom' };
    if (ignoreLimit.includes(table)) {
      const rows = rowsFor(table, 0, Number.MAX_SAFE_INTEGER, overrides);
      return { status: 200, body: rows };
    }
    const offset = ignoreOffset.includes(table) ? 0 : offsetOf(url);
    return { status: 200, body: rowsFor(table, offset, limitOf(url), overrides) };
  };
}

async function runDbTests() {
  installHttpMock();
  await cleanupOdpTables();

  console.log('🧪 [ODP] 5. sync() ghi theo từng bảng: TRUNCATE + INSERT trong 1 transaction...');
  await query("INSERT INTO odp_mon_hoc (ma_mon_hoc, ten_mon_hoc, tin_chi) VALUES ('KEEP_OLD', 'Dữ liệu cũ', 9)");
  routeResolver = scenarioResponder();
  const all = await OdpSyncService.sync({ triggerSource: 'scheduler' });
  assert.equal(all.skipped, false);
  assert.equal(all.errors.length, 0, JSON.stringify(all.errors));
  assert.equal(all.counts.mon_hoc, 2, 'counts.mon_hoc phải là 2');
  assert.equal(Object.keys(all.counts).length, 8, 'phải đếm đủ 8 bảng');
  assert.equal(all.counts.sinh_vien, 1);

  const monHoc = await query('SELECT ma_mon_hoc, tin_chi, loai_mon FROM odp_mon_hoc ORDER BY ma_mon_hoc');
  assert.equal(monHoc.rows.length, 2, 'odp_mon_hoc phải bị TRUNCATE rồi nạp đúng 2 dòng mới');
  assert.deepEqual(
    monHoc.rows.map((row) => row.ma_mon_hoc),
    ['INF0873', 'INF0874']
  );
  assert.equal(monHoc.rows[0].loai_mon, 'Chuyên ngành', 'type nguồn phải map vào loai_mon');
  assert.equal(Number(monHoc.rows[1].tin_chi), 4);

  const sinhVien = await query('SELECT mssv, ngay_sinh::text AS ngay_sinh, hien_dien FROM odp_sinh_vien WHERE mssv = 24050126');
  assert.equal(sinhVien.rows.length, 1);
  assert.equal(sinhVien.rows[0].ngay_sinh, '1990-04-17');
  assert.equal(sinhVien.rows[0].hien_dien, 'Đang học');

  const diemDanh = await query('SELECT nkhk, ngay::text AS ngay, buoi, diem_danh FROM odp_diem_danh WHERE mssv = 24050126');
  assert.equal(diemDanh.rows.length, 1);
  assert.equal(diemDanh.rows[0].nkhk, 24251, 'nkhk phải suy từ ma_nhom');
  assert.equal(diemDanh.rows[0].ngay, '2024-09-14');
  assert.equal(Number(diemDanh.rows[0].buoi), 1);
  assert.equal(diemDanh.rows[0].diem_danh, 'Vắng');

  const renLuyen = await query('SELECT xep_loai, diem_ren_luyen FROM odp_ren_luyen WHERE mssv = 24050126');
  assert.equal(renLuyen.rows[0].xep_loai, 'Tốt', 'text nguồn phải được trim');

  const tkb = await query("SELECT danh_sach_sv, so_tiet, tiet_bat_dau FROM odp_thoi_khoa_bieu WHERE id = 1");
  assert.equal(tkb.rows[0].danh_sach_sv, '[24050126]');
  assert.equal(Number(tkb.rows[0].tiet_bat_dau), 0, 'tiet_bat_dau = 0 là giá trị hợp lệ, không được thành NULL');

  const run = await query('SELECT status, trigger_source, counts FROM odp_sync_runs WHERE id = $1', [all.runId]);
  assert.equal(run.rows[0].status, 'success');
  assert.equal(run.rows[0].trigger_source, 'scheduler');
  assert.equal(Number(run.rows[0].counts.mon_hoc), 2);
  console.log('✅ PASSED: mỗi bảng TRUNCATE+INSERT trọn transaction, run success.');

  console.log('🧪 [ODP] 6. Bảng fetch lỗi GIỮ NGUYÊN dữ liệu cũ; bảng bắt buộc lỗi → run failed...');
  await query("INSERT INTO odp_thoi_khoa_bieu (id, ma_mon_hoc) VALUES (999999, 'SENTINEL')");
  routeResolver = scenarioResponder({
    failing: ['fact_ho_so_sinh_vien_odp', 'dim_thoi_khoa_bieu_odp']
  });
  const partial = await OdpSyncService.sync({ triggerSource: 'manual' });
  assert.equal(partial.skipped, false);
  assert.deepEqual(
    partial.errors.map((entry) => entry.key).sort(),
    ['sinh_vien', 'thoi_khoa_bieu']
  );
  assert.equal(partial.counts.mon_hoc, 2, 'các bảng khác vẫn phải được nạp và đếm');

  const sentinel = await query('SELECT count(*)::int AS count FROM odp_thoi_khoa_bieu WHERE id = 999999');
  assert.equal(sentinel.rows[0].count, 1, 'bảng fetch lỗi KHÔNG được TRUNCATE — phải giữ nguyên dữ liệu cũ');

  const failedRun = await query('SELECT status, error FROM odp_sync_runs WHERE id = $1', [partial.runId]);
  assert.equal(failedRun.rows[0].status, 'failed', 'bảng bắt buộc (sinh_vien) lỗi → run failed');
  assert.match(String(failedRun.rows[0].error), /sinh_vien/);
  assert.match(String(failedRun.rows[0].error), /thoi_khoa_bieu/);
  console.log('✅ PASSED: bảng lỗi giữ dữ liệu cũ, run failed khi bảng bắt buộc lỗi.');

  console.log('🧪 [ODP] 6b. Nguồn trả 200 nhưng RỖNG → không được xoá sạch bảng cũ...');
  const beforeEmpty = await query('SELECT count(*)::int AS count FROM odp_ren_luyen');
  await query("INSERT INTO odp_ren_luyen (mssv, nkhk, xep_loai) VALUES (24999999, 24251, 'SENTINEL')");
  routeResolver = scenarioResponder({ overrides: { dim_diem_ren_luyen_odp: [] } });
  const emptyPayload = await OdpSyncService.sync({ triggerSource: 'scheduler' });
  assert.deepEqual(emptyPayload.errors.map((entry) => entry.key), ['ren_luyen']);
  const afterEmpty = await query('SELECT count(*)::int AS count FROM odp_ren_luyen');
  assert.equal(
    afterEmpty.rows[0].count,
    beforeEmpty.rows[0].count + 1,
    'response rỗng KHÔNG được TRUNCATE bảng'
  );
  const sentinelKept = await query("SELECT count(*)::int AS count FROM odp_ren_luyen WHERE xep_loai = 'SENTINEL'");
  assert.equal(sentinelKept.rows[0].count, 1);
  assert.equal(emptyPayload.counts.ren_luyen, undefined, 'bảng rỗng không được tính là thành công');
  const emptyRun = await query('SELECT status FROM odp_sync_runs WHERE id = $1', [emptyPayload.runId]);
  assert.equal(emptyRun.rows[0].status, 'success', 'ren_luyen không bắt buộc → run vẫn success');
  console.log('✅ PASSED: nguồn trả rỗng giữ nguyên dữ liệu cũ.');

  console.log('🧪 [ODP] 7. Phân trang: dừng khi trang trả < limit, gộp qua các trang...');
  routeResolver = scenarioResponder({ overrides: { dim_mon_hoc_odp: MON_HOC_PAGED_ROWS } });
  requestLog.length = 0;
  process.env.ODP_SYNC_PAGE_SIZE = '2';
  let paged;
  try {
    paged = await OdpSyncService.sync({ triggerSource: 'scheduler' });
  } finally {
    delete process.env.ODP_SYNC_PAGE_SIZE;
  }
  assert.equal(paged.counts.mon_hoc, 3, 'phải gộp 2 trang của dim_mon_hoc_odp (2 + 1 dòng)');
  const monHocRequests = requestLog.filter((url) => tableOf(url) === 'dim_mon_hoc_odp');
  assert.deepEqual(monHocRequests.map(offsetOf), [0, 2], 'phải gọi tiếp offset=2 khi trang trước đầy');
  assert.equal(limitOf(monHocRequests[0]), 2, 'trang phải dùng đúng limit cấu hình');
  assert.equal(limitOf(monHocRequests[1]), 2);
  console.log('✅ PASSED: phân trang dừng đúng khi trang trả < limit.');

  console.log('🧪 [ODP] 7b. Nguồn bỏ qua `limit` (hành vi thật của cds.bdu.edu.vn) → 1 response là trọn bảng...');
  routeResolver = scenarioResponder({
    ignoreLimit: ['dim_mon_hoc_odp'],
    overrides: { dim_mon_hoc_odp: MON_HOC_PAGED_ROWS }
  });
  requestLog.length = 0;
  process.env.ODP_SYNC_PAGE_SIZE = '2';
  let pagedAll;
  try {
    pagedAll = await OdpSyncService.sync({ triggerSource: 'scheduler' });
  } finally {
    delete process.env.ODP_SYNC_PAGE_SIZE;
  }
  assert.equal(pagedAll.counts.mon_hoc, 3, 'trang trả > limit nghĩa là đã có trọn bảng — không được lặp vô hạn');
  assert.equal(
    requestLog.filter((url) => tableOf(url) === 'dim_mon_hoc_odp').length,
    1,
    'phải dừng ngay sau 1 request khi nguồn bỏ qua limit'
  );
  console.log('✅ PASSED: nguồn bỏ qua limit không gây lặp vô hạn.');

  console.log('🧪 [ODP] 7c. Nguồn bỏ qua `offset` (trả lại trang cũ) → dừng, không nhân đôi dữ liệu...');
  routeResolver = scenarioResponder({ ignoreOffset: ['dim_mon_hoc_odp'] });
  requestLog.length = 0;
  process.env.ODP_SYNC_PAGE_SIZE = '2';
  let pagedRepeat;
  try {
    pagedRepeat = await OdpSyncService.sync({ triggerSource: 'scheduler' });
  } finally {
    delete process.env.ODP_SYNC_PAGE_SIZE;
  }
  assert.equal(pagedRepeat.counts.mon_hoc, 2, 'trang trùng phải bị bỏ, không nhân đôi dữ liệu');
  assert.equal(
    requestLog.filter((url) => tableOf(url) === 'dim_mon_hoc_odp').length,
    2,
    'phải dừng ngay khi phát hiện trang trùng'
  );
  console.log('✅ PASSED: nguồn bỏ qua offset dừng đúng, không nhân đôi.');

  console.log('🧪 [ODP] 8. Advisory lock: instance thứ hai không ghi chồng...');
  const lockClient = await getPool().connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [ODP_SYNC_LOCK_ID]);
    routeResolver = scenarioResponder();
    const skipped = await OdpSyncService.sync({ triggerSource: 'scheduler' });
    assert.equal(skipped.skipped, true, 'không lấy được lock phải trả skipped=true');
    assert.equal(skipped.runId, null);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [ODP_SYNC_LOCK_ID]);
    lockClient.release();
  }
  console.log('✅ PASSED: advisory lock chặn 2 instance chạy chồng.');

  console.log('🧪 [ODP] 9. markStaleRuns() dọn run treo...');
  const stale = await query(
    "INSERT INTO odp_sync_runs (status, trigger_source, started_at) "
    + "VALUES ('running', 'scheduler', NOW() - INTERVAL '10 hours') RETURNING id"
  );
  const fresh = await query(
    "INSERT INTO odp_sync_runs (status, trigger_source, started_at) "
    + "VALUES ('running', 'scheduler', NOW()) RETURNING id"
  );
  const marked = await OdpSyncService.markStaleRuns();
  assert.ok(marked >= 1, 'phải đánh dấu ít nhất 1 run treo');
  const statuses = await query(
    'SELECT id, status FROM odp_sync_runs WHERE id = ANY($1::bigint[])',
    [[stale.rows[0].id, fresh.rows[0].id]]
  );
  const byId = new Map(statuses.rows.map((row) => [String(row.id), row.status]));
  assert.equal(byId.get(String(stale.rows[0].id)), 'failed');
  assert.equal(byId.get(String(fresh.rows[0].id)), 'running');
  console.log('✅ PASSED: run treo quá 6 giờ bị đánh dấu failed, run mới giữ nguyên.');

  console.log('🧪 [ODP] 10. isReady() + không rò cột PII vào kho...');
  assert.equal(OdpSyncService.isReady(), true);
  const columns = await query(
    "SELECT table_name, column_name FROM information_schema.columns "
    + "WHERE table_name LIKE 'odp\\_%' ESCAPE '\\'"
  );
  const columnNames = columns.rows.map((row) => row.column_name);
  for (const banned of PII_COLUMNS) {
    assert.ok(!columnNames.includes(banned), `Cột PII "${banned}" không được có trong kho ODP`);
  }
  const odpTables = new Set(columns.rows.map((row) => row.table_name));
  for (const banned of BANNED_TABLES) {
    assert.ok(!odpTables.has(banned), `Không được tạo bảng ${banned}`);
  }
  console.log('✅ PASSED: isReady + kho ODP không có cột PII.');
}

async function main() {
  console.log('🧪 Bắt đầu kiểm thử ODP ingest (migration 059 + odp-sync.service.js)...');

  console.log('🧪 [ODP] 1. validDiemDanh() chỉ nhận đúng 5 mã...');
  for (const code of ['Có', 'Sớm', 'Trễ', 'Phép', 'Vắng']) {
    assert.equal(validDiemDanh(code), code);
    assert.equal(validDiemDanh(`  ${code}  `), code);
  }
  for (const junk of ['26TH01', '7', '9.5', '', '   ', null, undefined, 'Có mặt', 'có', 'trễ', 0, 26]) {
    assert.equal(validDiemDanh(junk), null, `Giá trị rác ${JSON.stringify(junk)} phải thành NULL`);
  }
  console.log('✅ PASSED: chỉ 5 mã điểm danh hợp lệ, rác → NULL.');

  console.log('🧪 [ODP] 2. hocKyLabel() suy từ nkhk...');
  assert.deepEqual(hocKyLabel(24251), { hoc_ky: 1, nien_khoa: 2024, ten_hoc_ky: 'Học kỳ 1, năm học 2024-2025' });
  assert.deepEqual(hocKyLabel('24252'), { hoc_ky: 2, nien_khoa: 2024, ten_hoc_ky: 'Học kỳ 2, năm học 2024-2025' });
  assert.deepEqual(hocKyLabel(24253), { hoc_ky: 3, nien_khoa: 2024, ten_hoc_ky: 'Học kỳ 3, năm học 2024-2025' });
  assert.deepEqual(hocKyLabel(21221), { hoc_ky: 1, nien_khoa: 2021, ten_hoc_ky: 'Học kỳ 1, năm học 2021-2022' });
  assert.deepEqual(hocKyLabel(26271), { hoc_ky: 1, nien_khoa: 2026, ten_hoc_ky: 'Học kỳ 1, năm học 2026-2027' });
  assert.deepEqual(hocKyLabel(26272), { hoc_ky: 2, nien_khoa: 2026, ten_hoc_ky: 'Học kỳ 2, năm học 2026-2027' });
  assert.deepEqual(hocKyLabel(null), { hoc_ky: null, nien_khoa: null, ten_hoc_ky: null });
  console.log('✅ PASSED: nhãn học kỳ đúng công thức (hk = ký tự thứ 5).');

  console.log('🧪 [ODP] 3. normalizeOdpRows() coerce + loại dòng thiếu mssv...');
  const diemDanh = normalizeOdpRows('diem_danh', [
    { mssv: '', ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '1', diem_danh: 'Có' },
    { mssv: null, ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '1', diem_danh: 'Có' },
    { mssv: '24050126', ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '1', diem_danh: '26TH01' },
    { mssv: '24050127', ma_nhom: 'INF0873_24251_01', ngay: 'Sat, 14 Sep 2024 00:00:00 GMT', buoi: '2', diem_danh: '7' },
    { mssv: '24050128', ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '3', diem_danh: '9.5' },
    { mssv: '24050129', ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '4', diem_danh: '' },
    { mssv: '24050130', ma_nhom: 'INF0873_24251_01', ngay_origin: '2024-09-14', buoi: '5', diem_danh: 'Vắng' },
    { mssv: '24050131', ma_nhom: 'LAP1234_26271_01', buoi: '6', diem_danh: 'Có' }
  ]);
  assert.equal(diemDanh.length, 6, '2 dòng thiếu mssv phải bị loại');
  assert.equal(diemDanh[0].mssv, 24050126, 'mssv phải là số nguyên');
  assert.equal(diemDanh[0].diem_danh, null, "'26TH01' là rác → NULL");
  assert.equal(diemDanh[1].diem_danh, null, "'7' là rác → NULL");
  assert.equal(diemDanh[2].diem_danh, null, "'9.5' là rác → NULL");
  assert.equal(diemDanh[3].diem_danh, null, "'' là rác → NULL");
  assert.equal(diemDanh[4].diem_danh, 'Vắng', "'Vắng' phải giữ nguyên");
  assert.equal(diemDanh[5].nkhk, 26271, 'nkhk phải suy từ ma_nhom');
  assert.equal(diemDanh[1].buoi, 2);
  assert.equal(diemDanh[1].ngay, '2024-09-14');
  assert.equal(diemDanh[5].ngay, null, 'nguồn thiếu ngày → NULL (không bịa)');
  assert.ok(!Object.keys(diemDanh[0]).includes('ngay_origin'), 'không được lưu cột phụ của nguồn');

  const monHoc = normalizeOdpRows('mon_hoc', [
    { ma_mon_hoc: 'INF0873', ten_mon_hoc: 'X', tin_chi: '3', ma_khoa: 'TH', type: 'Chuyên ngành' },
    { ma_mon_hoc: '', ten_mon_hoc: 'bỏ', tin_chi: 1 },
    { ma_mon_hoc: 'INF0874', ten_mon_hoc: 'Y', tin_chi: 4, ma_khoa: null, type: 'Đại Cương', updated_at: 'x' }
  ]);
  assert.equal(monHoc.length, 2);
  assert.equal(monHoc[0].tin_chi, 3);
  assert.equal(monHoc[0].loai_mon, 'Chuyên ngành');
  assert.equal(monHoc[1].loai_mon, 'Đại Cương');
  assert.ok(!Object.keys(monHoc[1]).includes('updated_at'));

  const suKien = normalizeOdpRows('su_kien', [{
    id: 1,
    ten_su_kien: 'X',
    loai: 'seminar',
    the_loai: 'hoat_dong_clb',
    ngay_dien_ra: 'Sun, 16 Mar 2025 00:00:00 GMT',
    nkhk: '24252',
    danh_sach_sv: '[24050126]',
    danh_sach_ten_sv: '["Nguyễn Văn Test"]'
  }]);
  assert.equal(suKien.length, 1);
  assert.equal(suKien[0].danh_sach_sv, '[24050126]', 'danh_sach_sv giữ nguyên chuỗi');
  assert.equal(suKien[0].ngay_dien_ra, '2025-03-16');
  assert.equal(suKien[0].nkhk, 24252);
  assert.ok(!('danh_sach_ten_sv' in suKien[0]), 'danh_sach_ten_sv là PII — không vào kho');

  const bangDiem = normalizeOdpRows('bang_diem', [{
    mssv: '24050126',
    nkhk: '24251',
    ma_nhom: 'INF0873_24251_01',
    ten_mon_hoc: 'X',
    diem_hp: '7.2',
    diem_hp_4: '3.0',
    diem_chu_hp: 'B',
    diem_chu_hp_4: 'B',
    dat_hp: 1,
    lop: '26AV01',
    ma_khoa: 'NN'
  }]);
  assert.equal(bangDiem[0].dat_hp, true);
  assert.equal(bangDiem[0].diem_hp, 7.2);
  assert.equal(bangDiem[0].tin_chi, null, 'nguồn dim_bang_diem_odp không có tin_chi → NULL');
  console.log('✅ PASSED: chuẩn hoá dòng + map cột + loại PII.');

  console.log('🧪 [ODP] 4. ODP_TABLES: đúng 8 bảng, khoá & cột theo spec §4...');
  assert.equal(ODP_SYNC_LOCK_ID, 2030036030);
  assert.equal(ODP_TABLES.length, 8);
  assert.deepEqual(
    ODP_TABLES.map((table) => table.key),
    ['sinh_vien', 'tbhk', 'bang_diem', 'diem_danh', 'thoi_khoa_bieu', 'ren_luyen', 'su_kien', 'mon_hoc']
  );
  assert.deepEqual(ODP_TABLES.find((t) => t.key === 'bang_diem').pk, ['mssv', 'nkhk', 'ma_nhom']);
  assert.deepEqual(ODP_TABLES.find((t) => t.key === 'su_kien').pk, ['id']);
  const allColumns = ODP_TABLES.flatMap((table) => table.columns);
  for (const banned of PII_COLUMNS) {
    assert.ok(!allColumns.includes(banned), `Cột PII "${banned}" không được khai báo trong ODP_TABLES`);
  }
  assert.ok(!ODP_TABLES.some((table) => table.endpoint.includes('thu_vien')), 'không kéo bảng thư viện');
  console.log('✅ PASSED: ODP_TABLES đúng 8 bảng, không có PII/thư viện.');

  try {
    await runDbTests();
  } finally {
    restoreHttpMock();
    try {
      await cleanupOdpTables();
    } catch (error) {
      console.warn('Không dọn được bảng ODP:', error.message);
    }
    await closeDatabase();
  }

  console.log('✅ Tất cả kiểm thử ODP ingest PASS.');
}

await main();
