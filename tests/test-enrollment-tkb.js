import assert from 'node:assert/strict';
import { parseTkb, groupsConflict, findConflictingPairs } from '../src/modules/enrollment/enrollment-tkb.js';

const section = (name, fn) => {
  try { fn(); console.log('  ok -', name); } catch (error) { console.error('  FAIL -', name); throw error; }
};

console.log('enrollment-tkb');

section('parses a range with date range separated by "đến"', () => {
  const [seg] = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  assert.equal(seg.thu, 3);
  assert.equal(seg.startPeriod, 1);
  assert.equal(seg.endPeriod, 3);
  assert.equal(seg.from.getFullYear(), 2026);
  assert.equal(seg.from.getMonth(), 11);
  assert.equal(seg.from.getDate(), 29);
  assert.equal(seg.to.getFullYear(), 2027);
  assert.equal(seg.to.getMonth(), 0);
  assert.equal(seg.to.getDate(), 26);
});

section('single date means a single session (from = to)', () => {
  const [seg] = parseTkb('Thứ 4,tiết 6->8,Ph B.1,GV QT001,23/02/27');
  assert.equal(seg.thu, 4);
  assert.equal(seg.startPeriod, 6);
  assert.equal(seg.endPeriod, 8);
  assert.equal(seg.from.getTime(), seg.to.getTime());
  assert.equal(seg.from.getDate(), 23);
  assert.equal(seg.from.getMonth(), 1);
});

section('<hr>-separated segments are all parsed', () => {
  const segs = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27<hr>Thứ 3,tiết 1->3,Ph AI.2,GV QT050,23/02/27');
  assert.equal(segs.length, 2);
  assert.equal(segs[1].from.getTime(), segs[1].to.getTime());
});

section('garbage input returns []', () => {
  assert.deepEqual(parseTkb('không có gì ở đây'), []);
  assert.deepEqual(parseTkb(''), []);
  assert.deepEqual(parseTkb(null), []);
});

section('segments missing period info are skipped, valid ones kept', () => {
  const segs = parseTkb('hello<hr>Thứ 5,tiết 2->4,Ph C.3,GV X,01/03/27');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].thu, 5);
});

section('groupsConflict: same period range and overlapping dates on the same weekday', () => {
  const a = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  const b = parseTkb('Thứ 3,tiết 2->4,Ph B.1,GV QT001,01/01/27 đến 30/01/27');
  assert.equal(groupsConflict(a, b), true);
});

section('groupsConflict: different weekday never conflicts', () => {
  const a = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  const b = parseTkb('Thứ 4,tiết 1->3,Ph B.1,GV QT001,01/01/27 đến 30/01/27');
  assert.equal(groupsConflict(a, b), false);
});

section('groupsConflict: same weekday but disjoint periods never conflicts', () => {
  const a = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  const b = parseTkb('Thứ 3,tiết 4->6,Ph B.1,GV QT001,01/01/27 đến 30/01/27');
  assert.equal(groupsConflict(a, b), false);
});

section('groupsConflict: same weekday and periods but disjoint dates never conflicts', () => {
  const a = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  const b = parseTkb('Thứ 3,tiết 1->3,Ph B.1,GV QT001,27/01/27 đến 20/02/27');
  assert.equal(groupsConflict(a, b), false);
});

section('groupsConflict: empty/unparsable input never conflicts (safe no-op)', () => {
  const a = parseTkb('Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27');
  assert.equal(groupsConflict(a, []), false);
  assert.equal(groupsConflict([], []), false);
});

section('findConflictingPairs: reports the pair when main subjects overlap', () => {
  const pairs = findConflictingPairs([
    { maMon: 'AAA', tenMon: 'Môn A', loai: 'chinh', tkb: 'Thứ 3,tiết 1->3,Ph AI.2,GV G,29/12/26 đến 26/01/27' },
    { maMon: 'BBB', tenMon: 'Môn B', loai: 'chinh', tkb: 'Thứ 3,tiết 2->4,Ph B.1,GV G,01/01/27 đến 30/01/27' }
  ]);
  assert.deepEqual(pairs, [{ a: { maMon: 'AAA', tenMon: 'Môn A' }, b: { maMon: 'BBB', tenMon: 'Môn B' } }]);
});

section('findConflictingPairs: ignores non-overlapping periods, weekdays and dates', () => {
  const base = { loai: 'chinh' };
  assert.deepEqual(findConflictingPairs([
    { ...base, maMon: 'AAA', tkb: 'Thứ 3,tiết 1->3,Ph A,GV G,29/12/26 đến 26/01/27' },
    { ...base, maMon: 'BBB', tkb: 'Thứ 3,tiết 4->6,Ph B,GV G,01/01/27 đến 30/01/27' }
  ]), []);
  assert.deepEqual(findConflictingPairs([
    { ...base, maMon: 'AAA', tkb: 'Thứ 3,tiết 1->3,Ph A,GV G,29/12/26 đến 26/01/27' },
    { ...base, maMon: 'BBB', tkb: 'Thứ 4,tiết 1->3,Ph B,GV G,01/01/27 đến 30/01/27' }
  ]), []);
  assert.deepEqual(findConflictingPairs([
    { ...base, maMon: 'AAA', tkb: 'Thứ 3,tiết 1->3,Ph A,GV G,29/12/26 đến 26/01/27' },
    { ...base, maMon: 'BBB', tkb: 'Thứ 3,tiết 1->3,Ph B,GV G,27/01/27 đến 20/02/27' }
  ]), []);
});

section('findConflictingPairs: only considers "chinh", skips unparsable TKB', () => {
  const tkb = 'Thứ 3,tiết 1->3,Ph A,GV G,29/12/26 đến 26/01/27';
  assert.deepEqual(findConflictingPairs([
    { maMon: 'AAA', loai: 'chinh', tkb },
    { maMon: 'BBB', loai: 'du_phong', tkb }
  ]), []);
  assert.deepEqual(findConflictingPairs([
    { maMon: 'AAA', loai: 'chinh', tkb },
    { maMon: 'BBB', loai: 'chinh', tkb: 'không đọc được' }
  ]), []);
});

console.log('OK');
