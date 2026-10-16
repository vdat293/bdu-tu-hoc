/**
 * Helper thuần cho tab Tổng quan / TKB của TTCDS (không JSX để test trực tiếp).
 * Ngày `ngay` dạng 'YYYY-MM-DD'; tuần tính T2–CN theo lịch.
 */

export function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mondayKey(day) {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shortDay(day) {
  return `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
}

export function addDaysStr(mondayStr, days) {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function fmtDayMonth(dateStr) {
  const d = parseDay(dateStr);
  return d ? shortDay(d) : '';
}

export function weekRangeLabel(mondayStr) {
  return `${fmtDayMonth(mondayStr)}–${fmtDayMonth(addDaysStr(mondayStr, 6))}`;
}

// Kỳ mới nhất CÓ nhật ký điểm danh (null khi chưa chấm kỳ nào).
export function latestJournalTerm(nhatKy) {
  let best = null;
  for (const row of Array.isArray(nhatKy) ? nhatKy : []) {
    const n = Number(row?.nkhk);
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

// Gom nhật ký điểm danh theo tuần T2–CN. Buổi chưa chấm (diem_danh null)
// không tính vào mẫu — tuần không buổi nào đã chấm thì bỏ trống (null),
// không vẽ 0% (kiểu Dashboard).
export function groupJournalByWeek(nhatKy) {
  const groups = new Map();
  for (const row of Array.isArray(nhatKy) ? nhatKy : []) {
    const day = parseDay(row?.ngay);
    if (!day) continue;
    const key = mondayKey(day);
    if (!groups.has(key)) groups.set(key, { key, sessions: [] });
    groups.get(key).sessions.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((group, index) => {
      const graded = group.sessions.filter((s) => s?.diem_danh !== null && s?.diem_danh !== undefined && String(s.diem_danh).trim() !== '');
      const present = graded.filter((s) => s?.co_mat === true).length;
      return {
        ...group,
        index: index + 1,
        total: graded.length,
        present,
        rate: graded.length > 0 ? (100 * present) / graded.length : null
      };
    });
}

function gpaNumber(term, keys) {
  for (const key of keys) {
    const v = Number(term?.[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

// Ưu tiên thang 10; không có thì dùng thang 4 (giữ đúng thang, không trộn).
export function gpaSeries(terms) {
  const rows = Array.isArray(terms) ? terms : [];
  const he10 = rows.map((t) => gpaNumber(t, ['dtb_tich_luy_he_10', 'dtb_hk_he_10']));
  if (he10.some((v) => v !== null)) return { values: he10, scale: 'thang 10' };
  return {
    values: rows.map((t) => gpaNumber(t, ['dtb_tich_luy_he_4', 'dtb_hk_he_4'])),
    scale: 'thang 4'
  };
}

export function attendanceRate(row) {
  const present = Number(row?.di_hoc) || 0;
  const absent = Number(row?.vang) || 0;
  const total = present + absent;
  return total > 0 ? (100 * present) / total : null;
}

/**
 * Mã kỳ dạng số của Dashboard (`25262` → học kỳ 2, năm 2025): 2 ký tự đầu là
 * năm (2000 + yy), ký tự thứ 5 là học kỳ.
 */
export function parseTermCode(nkhk) {
  const text = String(nkhk ?? '').trim();
  if (text.length < 5) return null;
  const year = Number(text.slice(0, 2));
  const hk = Number(text.charAt(4));
  if (!Number.isInteger(year) || year <= 0) return null;
  if (!Number.isInteger(hk) || hk < 1 || hk > 3) return { year: 2000 + year, hk: null };
  return { year: 2000 + year, hk };
}

/**
 * Caption kỳ NHẤT QUÁN: `["Học kỳ 2 · 2025-2026", "mã 25262"]`.
 */
export function termCaption(source) {
  const nkhk = source?.nkhk;
  const hasCode = nkhk !== null && nkhk !== undefined && String(nkhk).trim() !== '';
  let hk = Number(source?.hoc_ky);
  if (!Number.isInteger(hk) || hk < 1 || hk > 3) hk = null;
  let year = Number(source?.nien_khoa);
  if (!Number.isInteger(year) || year <= 0) year = null;
  if ((hk === null || year === null) && hasCode) {
    const parsed = parseTermCode(nkhk);
    if (parsed) {
      if (hk === null) hk = parsed.hk;
      if (year === null) year = parsed.year;
    }
  }
  if (hk !== null && year !== null) return [`Học kỳ ${hk} · ${year}-${year + 1}`, `mã ${nkhk}`];
  if (source?.ten_hoc_ky || source?.ten_nkhk) return [source.ten_hoc_ky || source.ten_nkhk];
  return [hasCode ? `Học kỳ ${nkhk}` : '—'];
}

export function termShortLabel(source) {
  const [line] = termCaption(source);
  return line.replace('Học kỳ ', 'Kỳ ').replace(/(\d{4})-(\d{4})/, '$1');
}

// --- Lưới TKB: giờ tiết cổng trường (mỗi tiết 45 phút) ---

export const GIO_TIET = [
  '07:00', '07:45', '08:30', '09:15', '10:00', '13:00', '13:45',
  '14:30', '15:15', '16:00', '17:45', '18:30', '19:15', '20:00'
];

export const THU_COLS = [1, 2, 3, 4, 5, 6, 7];
export const THU_NAMES = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };

export function gioBatDau(tiet) {
  return GIO_TIET[tiet - 1] ?? '';
}

export function gioKetThuc(tiet, soTiet = 1) {
  const cuoi = Math.min(tiet + Math.max(soTiet, 1) - 1, GIO_TIET.length);
  const bd = GIO_TIET[cuoi - 1];
  if (!bd) return '';
  const [h, m] = bd.split(':').map(Number);
  const total = h * 60 + m + 45;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// thu_kieu_so của kho: 2 = Thứ 2 … 8 = Chủ nhật → ISO 1..7.
export function isoDow(item) {
  const v = Number(item?.thu_kieu_so);
  if (Number.isInteger(v) && v >= 2 && v <= 8) return v - 1;
  const m = /^Thứ (\d)$/.exec(String(item?.thu ?? '').trim());
  if (m) return Number(m[1]) - 1;
  if (String(item?.thu ?? '').includes('Chủ nhật')) return 7;
  return null;
}

// Nhãn nhóm gọn: `INF1063_24252_01` → `01`.
export function shortGroupLabel(maNhom) {
  const text = String(maNhom ?? '');
  const i = text.lastIndexOf('_');
  return i >= 0 && i < text.length - 1 ? text.slice(i + 1) : text;
}

export function attendanceClass(pct) {
  if (pct >= 85) return 'nhan-xanh';
  if (pct >= 75) return 'nhan-vang';
  return 'nhan-do';
}
