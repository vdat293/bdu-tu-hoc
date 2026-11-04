import assert from 'node:assert/strict';
import { validatePriorityItems, assignOrder, pickFallbacks } from '../src/modules/enrollment/enrollment-priority.js';

const chinh = (maMon, idToHoc) => ({ ma_mon: maMon, id_to_hoc: idToHoc, loai: 'chinh', ten_mon: 'Môn ' + maMon, thu_tu: 999 });
const duPhong = (maMon, idToHoc) => ({ ma_mon: maMon, id_to_hoc: idToHoc, loai: 'du_phong' });
const section = (name, fn) => {
  try { fn(); console.log('  ok -', name); } catch (error) { console.error('  FAIL -', name); throw error; }
};

console.log('enrollment-priority');

section('rejects non-array', () => {
  const r = validatePriorityItems('nope');
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

section('rejects more than 100 items', () => {
  const items = Array.from({ length: 101 }, (_, i) => chinh('M' + i, 'id' + i));
  const r = validatePriorityItems(items);
  assert.equal(r.ok, false);
});

section('rejects item missing ma_mon or id_to_hoc', () => {
  assert.equal(validatePriorityItems([{ id_to_hoc: 'x', loai: 'chinh' }]).ok, false);
  assert.equal(validatePriorityItems([{ ma_mon: 'INF1383', loai: 'chinh' }]).ok, false);
  assert.equal(validatePriorityItems([{ ma_mon: '  ', id_to_hoc: 'x', loai: 'chinh' }]).ok, false);
});

section('rejects invalid loai', () => {
  const r = validatePriorityItems([{ ma_mon: 'A', id_to_hoc: 'a1', loai: 'vip' }]);
  assert.equal(r.ok, false);
});

section('rejects duplicate id_to_hoc', () => {
  const r = validatePriorityItems([chinh('A', 'same'), { ma_mon: 'B', id_to_hoc: 'same', loai: 'chinh' }]);
  assert.equal(r.ok, false);
});

section('rejects two chinh in one mon', () => {
  const r = validatePriorityItems([chinh('A', 'a1'), chinh('A', 'a2')]);
  assert.equal(r.ok, false);
});

section('rejects du_phong without chinh for that mon', () => {
  const r = validatePriorityItems([duPhong('A', 'a2'), chinh('B', 'b1')]);
  assert.equal(r.ok, false);
});

section('rejects du_phong of a mon whose chinh is missing even if another mon is chinh', () => {
  const r = validatePriorityItems([duPhong('A', 'a2')]);
  assert.equal(r.ok, false);
});

section('accepts one chinh + many du_phong for the same mon, and other mons', () => {
  const r = validatePriorityItems([chinh('A', 'a1'), duPhong('A', 'a2'), duPhong('A', 'a3'), chinh('B', 'b1')]);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 4);
});

section('normalize trims, truncates ten_mon to 200 chars, ignores client thu_tu', () => {
  const longName = 'x'.repeat(250);
  const r = validatePriorityItems([{ ma_mon: '  A  ', ten_mon: longName, id_to_hoc: '  a1 ', loai: 'chinh', thu_tu: 999, nhom_to: ' 01 ', lop: ' 27KT01 ' }]);
  assert.equal(r.ok, true);
  const item = r.items[0];
  assert.equal(item.maMon, 'A');
  assert.equal(item.idToHoc, 'a1');
  assert.equal(item.tenMon.length, 200);
  assert.equal(item.nhomTo, '01');
  assert.equal(item.lop, '27KT01');
  assert.equal(item.thuTu, undefined, 'thu_tu phải do server gán, không lấy từ input');
});

section('assignOrder assigns thuTu 1..n by array order', () => {
  const r = validatePriorityItems([chinh('A', 'a1'), chinh('B', 'b1')]);
  const ordered = assignOrder(r.items);
  assert.deepEqual(ordered.map((i) => i.thuTu), [1, 2]);
});

section('pickFallbacks returns du_phong of the same mon ordered by thu_tu', () => {
  const r = validatePriorityItems([chinh('A', 'a1'), duPhong('A', 'a3'), duPhong('A', 'a2'), chinh('B', 'b1'), duPhong('B', 'b2')]);
  const ordered = assignOrder(r.items);
  const fallbacks = pickFallbacks(ordered, 'A');
  assert.deepEqual(fallbacks.map((i) => i.idToHoc), ['a3', 'a2'], 'giữ thứ tự đã có thu_tu trong danh sách');
  assert.ok(fallbacks.every((i) => i.loai === 'du_phong' && i.maMon === 'A'));
});

section('pickFallbacks sorts by thu_tu, not array order', () => {
  const items = [
    { maMon: 'A', idToHoc: 'a1', loai: 'chinh', thuTu: 5 },
    { maMon: 'A', idToHoc: 'a3', loai: 'du_phong', thuTu: 9 },
    { maMon: 'A', idToHoc: 'a2', loai: 'du_phong', thuTu: 2 },
  ];
  assert.deepEqual(pickFallbacks(items, 'A').map((i) => i.idToHoc), ['a2', 'a3']);
});

console.log('OK');
