/**
 * Client-side TKB helpers for filtering/rendering the enrollment catalog.
 * Mirrors the server parser (src/modules/enrollment/enrollment-tkb.js) for the
 * fields the UI needs: weekday + period range. No dates — filters are by
 * "thứ" and "buổi" only.
 */

const SESSION_LABELS = {
  morning: 'Sáng',
  afternoon: 'Chiều',
  evening: 'Tối'
};

export const SESSION_OPTIONS = [
  { value: 'all', label: 'Tất cả buổi' },
  { value: 'morning', label: 'Sáng' },
  { value: 'afternoon', label: 'Chiều' },
  { value: 'evening', label: 'Tối' }
];

export const DAY_OPTIONS = [
  { value: 0, label: 'Tất cả thứ' },
  { value: 2, label: 'Thứ 2' },
  { value: 3, label: 'Thứ 3' },
  { value: 4, label: 'Thứ 4' },
  { value: 5, label: 'Thứ 5' },
  { value: 6, label: 'Thứ 6' },
  { value: 7, label: 'Thứ 7' },
  { value: 8, label: 'CN' }
];

const DAY_SHORT = { 2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5', 6: 'T6', 7: 'T7', 8: 'CN' };

export function parseTkb(tkb) {
  if (!tkb || typeof tkb !== 'string') return [];
  const segments = String(tkb).split(/<hr\s*\/?>/i);
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
    parsed.push({ thu, startPeriod, endPeriod });
  }
  return parsed;
}

export function sessionOf(segment) {
  // BDU periods: 1–5 sáng, 6–10 chiều, 11–15 tối.
  if (segment.startPeriod <= 5) return 'morning';
  if (segment.startPeriod <= 10) return 'afternoon';
  return 'evening';
}

export function tkbMatchesDay(tkb, day) {
  if (!day) return true;
  return parseTkb(tkb).some((segment) => segment.thu === Number(day));
}

export function tkbMatchesSession(tkb, session) {
  if (!session || session === 'all') return true;
  return parseTkb(tkb).some((segment) => sessionOf(segment) === session);
}

export function tkbBadges(tkb) {
  const segments = parseTkb(tkb);
  const seen = new Set();
  const badges = [];
  for (const segment of segments) {
    const key = `${segment.thu}-${segment.startPeriod}-${segment.endPeriod}`;
    if (seen.has(key)) continue;
    seen.add(key);
    badges.push(`${DAY_SHORT[segment.thu] ?? segment.thu} · ${segment.startPeriod}–${segment.endPeriod}`);
  }
  return badges;
}

export function sessionLabel(session) {
  return SESSION_LABELS[session] ?? '';
}
