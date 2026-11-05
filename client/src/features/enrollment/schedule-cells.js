import { parseTkb, sessionOf } from './tkb.js';

/**
 * Build the weekly mini-schedule map used by both schedule cards.
 * entries: [{ maMon, tkb, loai? }]
 * result: Map<`${thu}:${session}`, Map<maMon, { maMon, loai }>>
 */
export function buildScheduleCells(entries = []) {
  const cells = new Map();
  for (const entry of entries) {
    if (!entry?.maMon) continue;
    for (const segment of parseTkb(entry.tkb ?? '')) {
      const key = `${segment.thu}:${sessionOf(segment)}`;
      if (!cells.has(key)) cells.set(key, new Map());
      cells.get(key).set(entry.maMon, { maMon: entry.maMon, loai: entry.loai ?? 'chinh' });
    }
  }
  return cells;
}
