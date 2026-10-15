/**
 * odp-sync.service.js — Kéo 8 bảng ODP của trường (cds.bdu.edu.vn/data) về Postgres.
 *
 * An toàn dữ liệu (quan trọng nhất):
 *   - Với MỖI bảng: fetch trọn bảng trước, rồi mới `BEGIN; TRUNCATE; INSERT; COMMIT`.
 *   - Bảng nào fetch/nạp lỗi → transaction rollback → GIỮ NGUYÊN dữ liệu cũ của bảng đó.
 *   - `sync()` bọc trong `withAdvisoryLock(ODP_SYNC_LOCK_ID)`; không lấy được lock → `{ skipped: true }`.
 *   - Bảng bắt buộc (sinh_vien, tbhk) lỗi → run `failed`; vẫn ghi `counts`/`errors` của bảng khác.
 *
 * Nguồn: `GET {CDS_BASE_URL}/{bảng}?limit=15000&offset=N` (Basic auth CDS_USER/CDS_PASSWORD),
 * dừng khi trang trả về < limit. Retry 5 lần backoff x2 + jitter, timeout ODP_SYNC_TIMEOUT_MS.
 */
import https from 'node:https';
import { Buffer } from 'node:buffer';
import { isDatabaseConfigured, query, withAdvisoryLock } from '../db/database.js';

export const ODP_SYNC_LOCK_ID = 2_030_036_030;

const DEFAULT_BASE_URL = 'https://cds.bdu.edu.vn/data';
const DEFAULT_PAGE_SIZE = 15000;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_MAX_ROWS = 600000;
const INSERT_BATCH_SIZE = 1000;
const STALE_RUN_HOURS = 6;

/** Hạn cứng cho TRỌN một bảng = bội số của timeout idle, tránh treo vô hạn giữ advisory lock. */
const TABLE_DEADLINE_MULTIPLIER = 10;

const TRIGGER_SOURCES = new Set(['scheduler', 'manual']);

/** Bảng bắt buộc: lỗi các bảng này → cả run là `failed`. */
const ODP_REQUIRED_KEYS = new Set(['sinh_vien', 'tbhk']);

/**
 * Cột khoá KHÔNG được null/empty (khớp NOT NULL/PK trong migration 059). Dòng vi phạm
 * bị loại để một dòng hỏng không abort cả bảng. `diem_danh` chỉ NOT NULL ở `mssv`
 * (ngay/nkhk/ma_nhom của nó cho phép NULL theo thiết kế nguồn).
 */
const ROW_REQUIRED_KEYS = {
  sinh_vien: ['mssv'],
  tbhk: ['mssv', 'nkhk'],
  bang_diem: ['mssv', 'nkhk', 'ma_nhom'],
  diem_danh: ['mssv'],
  thoi_khoa_bieu: ['id'],
  ren_luyen: ['mssv', 'nkhk'],
  su_kien: ['id'],
  mon_hoc: ['ma_mon_hoc']
};

/** Khi 2 dòng trùng khoá bị gộp, ưu tiên dòng có nhiều cột này non-null hơn. */
const DEDUPE_PREFERRED_COLUMNS = {
  diem_danh: ['diem_danh', 'gio_co_mat']
};

/** Chỉ 5 mã điểm danh đã chấm hợp lệ; mọi giá trị khác ("26TH01", "7", "9.5", "") → NULL. */
const VALID_DIEM_DANH = new Set(['Có', 'Sớm', 'Trễ', 'Phép', 'Vắng']);

/** Đối chiếu không phân biệt hoa/thường nhưng trả về mã chuẩn ('trễ' → 'Trễ'). */
const CANONICAL_DIEM_DANH = new Map(
  [...VALID_DIEM_DANH].map((code) => [code.toLocaleLowerCase('vi'), code])
);

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toInt(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function toNum(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function toDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const calendar = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (calendar) return `${calendar[1]}-${calendar[2]}-${calendar[3]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toBool(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'đạt', 'dat', 'pass', 'passed'].includes(text)) return true;
  if (['0', 'false', 'no', 'không đạt', 'khong dat', 'fail', 'failed'].includes(text)) return false;
  const number = Number(text);
  return Number.isFinite(number) ? number !== 0 : null;
}

/** @returns {string|null} mã điểm danh chuẩn hoá hoa/thường, hoặc null nếu là rác. */
export function validDiemDanh(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize('NFC').trim();
  return CANONICAL_DIEM_DANH.get(text.toLocaleLowerCase('vi')) || null;
}

/**
 * Nhãn học kỳ suy trực tiếp từ `nkhk`: hk = ký tự thứ 5, niên khóa = 2000 + 2 ký tự đầu.
 * Mã học kỳ lạ (vd `24254` → hk 4) vẫn giữ được `nien_khoa`/`ten_nien_khoa`; chỉ
 * `hoc_ky`/`ten_hoc_ky` là null khi không nhận diện được học kỳ.
 */
export function hocKyLabel(nkhk) {
  const empty = { hoc_ky: null, nien_khoa: null, ten_nien_khoa: null, ten_hoc_ky: null };
  const term = toInt(nkhk);
  const text = term === null ? '' : String(term);
  if (text.length < 5) return { ...empty };
  const year = Number(text.slice(0, 2));
  if (!Number.isInteger(year) || year <= 0) return { ...empty };
  const nien_khoa = 2000 + year;
  const ten_nien_khoa = `năm học ${nien_khoa}-${nien_khoa + 1}`;
  const hoc_ky = Number(text.charAt(4));
  if (!Number.isInteger(hoc_ky) || hoc_ky < 1 || hoc_ky > 3) {
    return { hoc_ky: null, nien_khoa, ten_nien_khoa, ten_hoc_ky: null };
  }
  return {
    hoc_ky,
    nien_khoa,
    ten_nien_khoa,
    ten_hoc_ky: `Học kỳ ${hoc_ky}, năm học ${nien_khoa}-${nien_khoa + 1}`
  };
}

/** nkhk không có trong nguồn điểm danh — suy từ `ma_nhom` (vd "INF0873_24251_01"). */
function termFromMaNhom(value) {
  const parts = String(value ?? '').trim().split('_');
  return parts.length >= 2 ? toInt(parts[1]) : null;
}

const COERCERS = {
  int: toInt,
  num: toNum,
  text: toText,
  date: toDate,
  bool: toBool,
  diem_danh: validDiemDanh
};

/**
 * Cột đích của từng bảng theo spec §4 (đã lọc PII) — `[tên cột, kiểu coerce, nguồn?]`.
 * `nguồn` mặc định là chính tên cột; có thể là tên khác, mảng ưu tiên, hoặc hàm suy diễn.
 */
const TABLE_FIELDS = {
  sinh_vien: [
    ['mssv', 'int'],
    ['ten_day_du', 'text'],
    ['ho_sv', 'text'],
    ['ten_sv', 'text'],
    ['gioi_tinh', 'text'],
    ['ngay_sinh', 'date'],
    ['ma_lop', 'text'],
    ['ten_lop', 'text'],
    ['ma_khoa', 'text'],
    ['ten_khoa', 'text'],
    ['ma_nganh', 'text'],
    ['ten_nganh', 'text'],
    ['ma_chuyen_nganh', 'text'],
    ['ten_chuyen_nganh', 'text'],
    ['ma_cvht', 'text'],
    ['ten_cvht', 'text'],
    ['ten_bac_hoc', 'text'],
    ['hien_dien', 'text'],
    ['nk', 'text']
  ],
  tbhk: [
    ['mssv', 'int'],
    ['nkhk', 'int'],
    ['ma_lop', 'text'],
    ['ten_sinh_vien', 'text'],
    ['so_tin_chi_dat_hk', 'int'],
    ['so_tin_chi_dat_tich_luy', 'int'],
    ['dtb_hk_he_4', 'num'],
    ['dtb_hk_he_10', 'num'],
    ['dtb_tich_luy_he_4', 'num'],
    ['dtb_tich_luy_he_10', 'num'],
    ['xep_loai_hoc_ki', 'text']
  ],
  bang_diem: [
    ['mssv', 'int'],
    ['nkhk', 'int'],
    ['ma_nhom', 'text'],
    ['ten_mon_hoc', 'text'],
    ['diem_hp', 'num'],
    ['diem_hp_4', 'num'],
    ['diem_chu_hp', 'text'],
    ['diem_chu_hp_4', 'text'],
    ['dat_hp', 'bool'],
    // Nguồn dim_bang_diem_odp không có cột tin_chi → luôn NULL (giữ cột cho chung bộ cột ranking).
    ['tin_chi', 'int'],
    ['lop', 'text'],
    ['ma_khoa', 'text']
  ],
  diem_danh: [
    ['mssv', 'int'],
    ['ma_nhom', 'text'],
    ['ngay', 'date', ['ngay_origin', 'ngay']],
    ['buoi', 'int'],
    ['ma_mon_hoc', 'text'],
    ['ten_mon_hoc', 'text'],
    ['nkhk', 'int', (row) => termFromMaNhom(row.ma_nhom)],
    ['diem_danh', 'diem_danh'],
    ['gio_co_mat', 'text']
  ],
  thoi_khoa_bieu: [
    ['id', 'int'],
    ['nkhk', 'int'],
    ['ma_nhom', 'text'],
    ['ma_mon_hoc', 'text'],
    ['ten_mon_hoc', 'text'],
    ['nhom_hoc', 'text'],
    ['ma_giang_vien', 'text'],
    ['ten_giang_vien', 'text'],
    ['ma_phong', 'text'],
    ['buoi_thu', 'int'],
    ['thu_kieu_so', 'int'],
    ['tiet_bat_dau', 'int'],
    ['so_tiet', 'int'],
    ['ngay_hoc', 'date'],
    ['tuan_bat_dau', 'int'],
    ['tuan_ket_thuc', 'int'],
    ['danh_sach_sv', 'text']
  ],
  ren_luyen: [
    ['mssv', 'int'],
    ['nkhk', 'int'],
    ['hoc_ki', 'int'],
    ['lop', 'text'],
    ['diem_ren_luyen', 'num'],
    ['xep_loai', 'text']
  ],
  su_kien: [
    ['id', 'int'],
    ['ten_su_kien', 'text'],
    ['loai', 'text'],
    ['the_loai', 'text'],
    ['ngay_dien_ra', 'date'],
    ['nkhk', 'int'],
    ['danh_sach_sv', 'text']
  ],
  mon_hoc: [
    ['ma_mon_hoc', 'text'],
    ['ten_mon_hoc', 'text'],
    ['tin_chi', 'int'],
    ['ma_khoa', 'text'],
    ['loai_mon', 'text', 'type']
  ]
};

const TABLE_META = [
  { key: 'sinh_vien', endpoint: 'fact_ho_so_sinh_vien_odp', table: 'odp_sinh_vien', pk: ['mssv'] },
  { key: 'tbhk', endpoint: 'fact_bang_diem_tbhk_odp', table: 'odp_tbhk', pk: ['mssv', 'nkhk'] },
  { key: 'bang_diem', endpoint: 'dim_bang_diem_odp', table: 'odp_bang_diem', pk: ['mssv', 'nkhk', 'ma_nhom'] },
  { key: 'diem_danh', endpoint: 'dim_danh_sach_diem_danh_odp', table: 'odp_diem_danh', pk: ['mssv', 'ma_nhom', 'ngay', 'buoi'] },
  { key: 'thoi_khoa_bieu', endpoint: 'dim_thoi_khoa_bieu_odp', table: 'odp_thoi_khoa_bieu', pk: ['id'] },
  { key: 'ren_luyen', endpoint: 'dim_diem_ren_luyen_odp', table: 'odp_ren_luyen', pk: ['mssv', 'nkhk'] },
  { key: 'su_kien', endpoint: 'dim_su_kien_odp', table: 'odp_su_kien', pk: ['id'] },
  { key: 'mon_hoc', endpoint: 'dim_mon_hoc_odp', table: 'odp_mon_hoc', pk: ['ma_mon_hoc'] }
];

/** `{ key, endpoint, table, columns, pk }` cho 8 bảng ODP. */
export const ODP_TABLES = TABLE_META.map((meta) => ({
  ...meta,
  columns: TABLE_FIELDS[meta.key].map(([name]) => name)
}));

const TABLE_BY_KEY = new Map(ODP_TABLES.map((table) => [table.key, table]));

function readSource(row, source) {
  if (typeof source === 'function') return source(row);
  if (Array.isArray(source)) {
    for (const candidate of source) {
      const value = row[candidate];
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  }
  return row[source];
}

/**
 * Chuẩn hoá thuần: coerce kiểu, map cột, bỏ dòng thiếu cột khoá bắt buộc
 * (mssv/nkhk/ma_nhom/id/ma_mon_hoc tuỳ bảng — xem ROW_REQUIRED_KEYS) để một dòng
 * hỏng không làm abort cả bảng khi INSERT.
 * @returns {Array<object>} chỉ gồm các cột đích của bảng.
 */
export function normalizeOdpRows(key, rows) {
  const table = TABLE_BY_KEY.get(key);
  if (!table) throw new Error(`Bảng ODP không hợp lệ: ${key}`);
  const fields = TABLE_FIELDS[key];
  const requiredKeys = ROW_REQUIRED_KEYS[key] || [table.pk[0]];
  const normalized = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = {};
    for (const [name, kind, source] of fields) {
      record[name] = COERCERS[kind](readSource(row, source || name));
    }
    if (requiredKeys.some((column) => isBlank(record[column]))) continue;
    normalized.push(record);
  }
  return normalized;
}

function baseUrl() {
  return String(process.env.CDS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function retryBaseMs() {
  return envInt('ODP_SYNC_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS);
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve();
}

function backoffDelay(attempt) {
  const base = retryBaseMs();
  return base * (2 ** (attempt - 1)) + Math.floor(Math.random() * base);
}

function httpError(message, status = null) {
  const error = new Error(message);
  error.status = status;
  error.retryable = status === null || status === 429 || status >= 500;
  return error;
}

function requestJson(url, { user, password, timeout, rejectUnauthorized, deadline }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer = null;
    const settle = (callback) => (value) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      callback(value);
    };
    const resolveOnce = settle(resolve);
    const rejectOnce = settle(reject);

    const request = https.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'BDU-Hub-Odp-Sync/1.0'
      },
      rejectUnauthorized,
      timeout
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      // Stream đứt/abort giữa chừng phải reject, nếu không promise treo mãi.
      response.on('error', (error) => {
        rejectOnce(httpError(`Lỗi đọc dữ liệu từ ${url}: ${error.message}`, null));
      });
      response.on('end', () => {
        if (response.statusCode === 401) {
          return rejectOnce(httpError('Sai tài khoản hoặc mật khẩu CDS.', 401));
        }
        if (!response.statusCode || response.statusCode >= 400) {
          return rejectOnce(httpError(`CDS trả HTTP ${response.statusCode} cho ${url}.`, response.statusCode));
        }
        try {
          const payload = JSON.parse(body);
          const rows = Array.isArray(payload) ? payload : payload?.data;
          if (!Array.isArray(rows)) throw new Error('Nguồn không trả về danh sách JSON.');
          resolveOnce(rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)));
        } catch (error) {
          rejectOnce(httpError(`JSON không hợp lệ từ ${url}: ${error.message}`, null));
        }
      });
    });

    // Hạn cứng cho trọn một bảng: dù response nhỏ giọt hay không bao giờ kết thúc thì
    // promise vẫn settle, không giữ advisory lock vô hạn.
    const remaining = Number(deadline) - Date.now();
    if (Number.isFinite(remaining)) {
      deadlineTimer = setTimeout(() => {
        request.destroy(httpError(`Quá hạn đồng bộ bảng khi tải ${url}.`, null));
      }, Math.max(0, remaining));
    }

    request.on('timeout', () => request.destroy(httpError(`Hết thời gian tải ${url}.`, null)));
    request.on('error', rejectOnce);
  });
}

async function fetchPage(url, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await requestJson(url, options);
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === DEFAULT_RETRY_ATTEMPTS) break;
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastError;
}

function rowIdentity(table, row) {
  if (!row) return 'undefined';
  return String(row[table.pk[0]] ?? '');
}

/**
 * Kéo trọn một bảng ODP.
 *
 * Nguồn thật (`cds.bdu.edu.vn/data`) HIỆN BỎ QUA cả `limit` lẫn `offset`: mỗi request
 * trả về nguyên bảng dưới dạng một mảng JSON. Luật phân trang chuẩn ("trang < limit thì
 * dừng") vì thế không đủ, nên có thêm các chốt an toàn — mọi bất thường đều là LỖI CỦA
 * BẢNG (throw) để bảng giữ nguyên dữ liệu cũ, tuyệt đối không ghi dữ liệu thiếu:
 *   1. `batch.length > limit` → nguồn bỏ qua `limit` ⇒ 1 response đã là trọn bảng, dừng.
 *   2. Trang sau trùng chữ ký với trang trước → nguồn bỏ qua `offset` ⇒ dừng bằng lỗi.
 *   3. Trang đầu ngắn bất thường (`0 < length < limit`) → probe 1 lần với `limit * 2`;
 *      probe trả nhiều hơn ⇒ nguồn giới hạn cỡ trang ⇒ lỗi.
 *   4. Tổng số dòng vượt `ODP_SYNC_MAX_ROWS` ⇒ lỗi (chặn OOM).
 */
async function fetchTable(table, options) {
  const limit = Math.max(1, envInt('ODP_SYNC_PAGE_SIZE', DEFAULT_PAGE_SIZE));
  const maxPages = Math.max(1, envInt('ODP_SYNC_MAX_PAGES', 1000));
  const maxRows = Math.max(1, envInt('ODP_SYNC_MAX_ROWS', DEFAULT_MAX_ROWS));
  const tableOptions = { ...options, deadline: Date.now() + options.timeout * TABLE_DEADLINE_MULTIPLIER };
  const rows = [];
  let offset = 0;
  let previousSignature = null;
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await fetchPage(`${options.base}/${table.endpoint}?limit=${limit}&offset=${offset}`, tableOptions);
    const signature = `${batch.length}|${rowIdentity(table, batch[0])}|${rowIdentity(table, batch[batch.length - 1])}`;
    if (previousSignature !== null && signature === previousSignature) {
      throw new Error(
        `Nguồn trả lại cùng một trang ở offset=${offset} (bỏ qua offset) — không xác định được toàn bộ bảng.`
      );
    }
    for (const row of batch) rows.push(row);
    if (rows.length > maxRows) {
      throw new Error(`Bảng ${table.key} vượt quá ${maxRows} dòng — nghi nguồn trả lặp, giữ nguyên dữ liệu cũ.`);
    }
    if (batch.length !== limit) {
      // Trang đầu NGẮN (`0 < length < limit`): có thể là bảng nhỏ thật, hoặc nguồn
      // âm thầm cắt cỡ trang → probe 1 lần với `limit * 2` để phân biệt.
      if (offset === 0 && batch.length > 0 && batch.length < limit) {
        const probe = await fetchPage(
          `${options.base}/${table.endpoint}?limit=${limit * 2}&offset=0`,
          tableOptions
        );
        if (probe.length > batch.length) {
          throw new Error(
            `Nguồn giới hạn cỡ trang: limit=${limit} trả ${batch.length} dòng nhưng `
            + `limit=${limit * 2} trả ${probe.length} dòng — giữ nguyên dữ liệu cũ.`
          );
        }
      }
      return rows;
    }
    previousSignature = signature;
    offset += limit;
  }
  throw new Error(`Phân trang ${table.endpoint} vượt quá ${maxPages} trang.`);
}

function preferenceScore(row, columns) {
  return columns.reduce((score, column) => score + (isBlank(row[column]) ? 0 : 1), 0);
}

/**
 * Gộp dòng trùng khoá để TRUNCATE+INSERT không vỡ vì khoá trùng.
 * - Dòng có bất kỳ thành phần khoá nào null/empty KHÔNG bị gộp (không dồn vào '\u0000'),
 *   vì các khoá đó cho phép NULL ở tầng DB (vd `odp_diem_danh.ngay`).
 * - Khi gộp, ưu tiên dòng có nhiều cột `DEDUPE_PREFERRED_COLUMNS` non-null hơn.
 */
function dedupeRows(table, rows) {
  const pk = table.pk || [];
  const preferred = DEDUPE_PREFERRED_COLUMNS[table.key] || [];
  const indexByKey = new Map();
  const output = [];
  for (const row of rows) {
    const components = pk.map((column) => row[column]);
    if (pk.length === 0 || components.some(isBlank)) {
      output.push(row);
      continue;
    }
    const key = components.join('\u0001');
    if (!indexByKey.has(key)) {
      indexByKey.set(key, output.length);
      output.push(row);
      continue;
    }
    const index = indexByKey.get(key);
    if (preferenceScore(row, preferred) >= preferenceScore(output[index], preferred)) {
      output[index] = row;
    }
  }
  return output;
}

/** TRUNCATE + INSERT theo batch — PHẢI được gọi trong transaction của caller. */
async function replaceTable(client, table, rows) {
  const records = dedupeRows(table, rows);
  await client.query(`TRUNCATE TABLE ${table.table}`);
  const columns = table.columns.join(', ');
  for (let index = 0; index < records.length; index += INSERT_BATCH_SIZE) {
    const batch = records.slice(index, index + INSERT_BATCH_SIZE);
    const params = [];
    const placeholders = batch.map((record) => {
      const slots = table.columns.map((column) => {
        params.push(record[column] === undefined ? null : record[column]);
        return `$${params.length}`;
      });
      return `(${slots.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table.table} (${columns}) VALUES ${placeholders.join(', ')}`,
      params
    );
  }
  return records.length;
}

async function markStaleRuns(client = null) {
  const sql = `
    UPDATE odp_sync_runs
    SET status = 'failed',
        finished_at = NOW(),
        error = COALESCE(NULLIF(error, ''), 'Bị bỏ dở: không hoàn tất trong ' || $1 || ' giờ.')
    WHERE status = 'running'
      AND started_at < NOW() - make_interval(hours => $1)
  `;
  const params = [STALE_RUN_HOURS];
  const result = client ? await client.query(sql, params) : await query(sql, params);
  return result.rowCount;
}

function errorSummary(errors) {
  if (errors.length === 0) return null;
  return errors.map((entry) => `${entry.key}: ${entry.message}`).join('; ').slice(0, 2000);
}

async function runSync(client, triggerSource) {
  const user = process.env.CDS_USER;
  const password = process.env.CDS_PASSWORD;
  if (!user || !password) throw new Error('Chưa cấu hình CDS_USER và CDS_PASSWORD.');

  const staleMarked = await markStaleRuns(client);
  if (staleMarked > 0) {
    console.warn(`[odp-sync] Đã đánh dấu thất bại ${staleMarked} run bị bỏ dở.`);
  }

  const runResult = await client.query(
    `INSERT INTO odp_sync_runs (status, trigger_source) VALUES ('running', $1) RETURNING id`,
    [triggerSource]
  );
  const runId = runResult.rows[0].id;
  const options = {
    user,
    password,
    base: baseUrl(),
    timeout: envInt('ODP_SYNC_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    rejectUnauthorized: !envBool('CDS_INSECURE_TLS', false)
  };

  const counts = {};
  const errors = [];

  for (const table of ODP_TABLES) {
    try {
      // Fetch trọn bảng TRƯỚC; chỉ khi có dữ liệu mới mở transaction để thay thế.
      const rows = await fetchTable(table, options);
      const normalized = normalizeOdpRows(table.key, rows);
      // Nguồn trả 200 nhưng rỗng (glitch upstream) KHÔNG được phép xoá sạch bảng cũ.
      if (normalized.length === 0) {
        throw new Error(`Nguồn trả 0 dòng cho ${table.endpoint} — giữ nguyên dữ liệu cũ.`);
      }
      await client.query('BEGIN');
      let inserted;
      try {
        inserted = await replaceTable(client, table, normalized);
        await client.query('COMMIT');
      } catch (error) {
        // ROLLBACK lỗi không được che lỗi gốc.
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(`[odp-sync] ROLLBACK thất bại cho ${table.key}: ${rollbackError.message}`);
        }
        throw error;
      }
      counts[table.key] = inserted;
    } catch (error) {
      errors.push({ key: table.key, message: String(error.message).slice(0, 500) });
      console.error(`[odp-sync] Bảng ${table.key} lỗi — giữ nguyên dữ liệu cũ: ${error.message}`);
    }
  }

  const status = errors.some((entry) => ODP_REQUIRED_KEYS.has(entry.key)) ? 'failed' : 'success';
  await client.query(
    `UPDATE odp_sync_runs
     SET status = $2, finished_at = NOW(), counts = $3::jsonb, error = $4
     WHERE id = $1`,
    [runId, status, JSON.stringify(counts), errorSummary(errors)]
  );

  return { runId, counts, errors, status };
}

export const OdpSyncService = {
  isReady() {
    return isDatabaseConfigured()
      && Boolean(process.env.CDS_USER)
      && Boolean(process.env.CDS_PASSWORD);
  },

  /**
   * Lần chạy gần nhất từ `odp_sync_runs` cho /admin (đọc thuần, không tạo run).
   * Trả `null` khi chưa cấu hình DB hoặc bảng chưa có dòng nào.
   * @returns {Promise<object|null>}
   */
  async getLatestRun() {
    if (!isDatabaseConfigured()) return null;
    const result = await query(
      `SELECT id, started_at, finished_at, status, trigger_source, counts, error
       FROM odp_sync_runs
       ORDER BY id DESC
       LIMIT 1`
    );
    return result.rows[0] || null;
  },

  /**
   * @param {{ triggerSource?: 'scheduler'|'manual' }} [options]
   * @returns {Promise<{ skipped: boolean, runId: number|null, counts: object, errors: Array<{key:string,message:string}>, status?: string }>}
   */
  async sync({ triggerSource = 'scheduler' } = {}) {
    if (!TRIGGER_SOURCES.has(triggerSource)) {
      throw new Error(
        `triggerSource không hợp lệ: ${JSON.stringify(triggerSource)} (chỉ nhận "scheduler" hoặc "manual").`
      );
    }
    if (!isDatabaseConfigured()) throw new Error('Chưa cấu hình DATABASE_URL.');
    const result = await withAdvisoryLock(ODP_SYNC_LOCK_ID, (client) => runSync(client, triggerSource));
    if (!result.acquired) {
      return { skipped: true, runId: null, counts: {}, errors: [] };
    }
    return { skipped: false, ...result.value };
  },

  markStaleRuns
};
