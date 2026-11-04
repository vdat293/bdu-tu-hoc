/**
 * Pure domain logic for the enrollment priority list.
 * No DB, no fetch — safe to unit test and reuse on the client boundary.
 *
 * Normalized item (camelCase, thu_tu NOT included):
 *   { maMon, tenMon, soTc, idToHoc, nhomTo, lop, loai }
 * assignOrder adds `thuTu` (1-based, array order). The server is the only
 * place allowed to assign thu_tu — client input is never trusted.
 */

const VALID_LOAI = new Set(['chinh', 'du_phong']);
const MAX_ITEMS = 100;

function pick(item, camelKey, snakeKey) {
  const value = item?.[camelKey] ?? item?.[snakeKey];
  return value === undefined || value === null ? '' : String(value).trim();
}

function cleanText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function parseSoTc(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function validatePriorityItems(items) {
  const errors = [];
  if (!Array.isArray(items)) {
    return { ok: false, errors: ['Danh sách ưu tiên phải là một mảng.'] };
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, errors: [`Danh sách ưu tiên tối đa ${MAX_ITEMS} mục.`] };
  }

  const normalized = [];
  const seenId = new Set();

  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`Mục #${index + 1}: dữ liệu không hợp lệ.`);
      continue;
    }

    const maMon = pick(raw, 'maMon', 'ma_mon');
    const idToHoc = pick(raw, 'idToHoc', 'id_to_hoc');
    const loaiRaw = pick(raw, 'loai', 'loai') || 'chinh';
    const tenMon = cleanText(raw.tenMon ?? raw.ten_mon ?? '', 200);
    const nhomTo = cleanText(raw.nhomTo ?? raw.nhom_to ?? '', 16) || null;
    const lop = cleanText(raw.lop ?? '', 200) || null;
    const soTc = parseSoTc(raw.soTc ?? raw.so_tc);

    if (!maMon) errors.push(`Mục #${index + 1}: thiếu mã môn (ma_mon/maMon).`);
    else if (maMon.length > 32) errors.push(`Mục #${index + 1}: mã môn vượt quá 32 ký tự.`);

    if (!idToHoc) errors.push(`Mục #${index + 1}: thiếu id_to_hoc.`);
    else if (idToHoc.length > 40) errors.push(`Mục #${index + 1}: id_to_hoc vượt quá 40 ký tự.`);
    else if (seenId.has(idToHoc)) errors.push(`Mục #${index + 1}: id_to_hoc "${idToHoc}" bị trùng.`);

    if (!VALID_LOAI.has(loaiRaw)) errors.push(`Mục #${index + 1}: loại "${loaiRaw}" không hợp lệ (chỉ nhận chinh|du_phong).`);

    seenId.add(idToHoc);
    normalized.push({ maMon, tenMon, soTc, idToHoc, nhomTo, lop, loai: loaiRaw });
  }

  // Cross-item rules: per ma_mon at most one 'chinh'; a 'du_phong' is only
  // meaningful when the same subject also has a 'chinh' in this list.
  const chinhByMon = new Map();
  for (const item of normalized) {
    if (!item.maMon) continue;
    if (item.loai === 'chinh') chinhByMon.set(item.maMon, (chinhByMon.get(item.maMon) || 0) + 1);
  }
  for (const [maMon, count] of chinhByMon) {
    if (count > 1) errors.push(`Môn ${maMon}: có ${count} mục "chinh" — chỉ được 1.`);
  }
  for (const item of normalized) {
    if (item.loai === 'du_phong' && item.maMon && !chinhByMon.has(item.maMon)) {
      errors.push(`Môn ${item.maMon}: có dự phòng nhưng không có mục "chinh" trong cùng danh sách.`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, items: normalized };
}

export function assignOrder(items) {
  return (items || []).map((item, index) => ({ ...item, thuTu: index + 1 }));
}

export function pickFallbacks(items, maMon) {
  return (items || [])
    .filter((item) => item.loai === 'du_phong' && item.maMon === maMon)
    .sort((a, b) => (a.thuTu ?? Number.MAX_SAFE_INTEGER) - (b.thuTu ?? Number.MAX_SAFE_INTEGER));
}
