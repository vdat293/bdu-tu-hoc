/**
 * Pure parser for BDU thời khóa biểu strings.
 *
 * Real example (from ds_nhom_to.tkb):
 *   "Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27<hr>Thứ 3,tiết 1->3,Ph AI.2,GV QT050,23/02/27"
 *
 * Segments that cannot be parsed (no weekday or no period range) are dropped.
 * Segments with unparsable dates keep null from/to — groupsConflict() then
 * returns false for that pair (safe no-op, never a wrong withdraw).
 */

function parseVietnameseDate(match) {
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

export function parseTkb(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const segments = String(raw).split(/<hr\s*\/?>/i);
  const parsed = [];

  for (const segment of segments) {
    const thuMatch = segment.match(/thứ\s*(\d+)/i) || (/chủ\s*nhật/i.test(segment) ? ['cn', '8'] : null);
    const periodMatch = segment.match(/tiết\s*(\d+)\s*->\s*(\d+)/i);
    if (!thuMatch || !periodMatch) continue;

    const thu = Number(thuMatch[1]);
    let startPeriod = Number(periodMatch[1]);
    let endPeriod = Number(periodMatch[2]);
    if (!Number.isFinite(thu) || !Number.isFinite(startPeriod) || !Number.isFinite(endPeriod)) continue;
    if (startPeriod > endPeriod) [startPeriod, endPeriod] = [endPeriod, startPeriod];

    const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/g;
    const matches = [...segment.matchAll(dateRegex)];
    let from = null;
    let to = null;
    if (matches.length >= 1) {
      from = parseVietnameseDate(matches[0]);
      to = matches.length >= 2 ? parseVietnameseDate(matches[matches.length - 1]) : from;
      if (from && to && from.getTime() > to.getTime()) [from, to] = [to, from];
    }

    parsed.push({ thu, startPeriod, endPeriod, from, to });
  }

  return parsed;
}

function periodsOverlap(a, b) {
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
}

function datesOverlap(a, b) {
  // Unknown bounds => unknown outcome => never claim a conflict (safe no-op).
  if (!a.from || !a.to || !b.from || !b.to) return false;
  return a.from.getTime() <= b.to.getTime() && b.from.getTime() <= a.to.getTime();
}

export function groupsConflict(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  for (const s1 of listA) {
    for (const s2 of listB) {
      if (s1.thu === s2.thu && periodsOverlap(s1, s2) && datesOverlap(s1, s2)) return true;
    }
  }
  return false;
}

/**
 * Các cặp môn "chinh" trong danh sách ưu tiên bị trùng lịch học.
 * Chỉ xét môn chính: dự phòng là phương án thay thế, không đăng ký cùng lúc.
 * Môn không đọc được TKB bị bỏ qua (không báo trùng oan).
 */
export function findConflictingPairs(items = []) {
  const parsed = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.maMon && item.loai === 'chinh')
    .map((item) => ({
      maMon: String(item.maMon),
      tenMon: item.tenMon ? String(item.tenMon) : '',
      segments: parseTkb(item.tkb)
    }));

  const pairs = [];
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.segments.length === 0 || b.segments.length === 0) continue;
      if (!groupsConflict(a.segments, b.segments)) continue;
      pairs.push({
        a: { maMon: a.maMon, tenMon: a.tenMon },
        b: { maMon: b.maMon, tenMon: b.tenMon }
      });
    }
  }
  return pairs;
}
