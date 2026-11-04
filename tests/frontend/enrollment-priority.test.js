import { describe, expect, it } from 'vitest';
import { groupBySubject, moveItem, toSavePayload, canSetAsChinh } from '../../client/src/features/enrollment/priority.js';

const item = (maMon, idToHoc, loai, thuTu, extra = {}) => ({ maMon, tenMon: 'Mon ' + maMon, soTc: 3, idToHoc, nhomTo: '01', lop: '27KT01', loai, thuTu, ...extra });

describe('groupBySubject', () => {
  it('nhóm theo maMon, giữ nguyên thứ tự thu_tu', () => {
    const list = [item('BBB', 'b1', 'chinh', 1), item('AAA', 'a1', 'chinh', 2), item('BBB', 'b2', 'du_phong', 3)];
    const grouped = groupBySubject(list);
    expect(grouped.map((g) => g.maMon)).toEqual(['BBB', 'AAA']);
    expect(grouped[0].chinh.idToHoc).toBe('b1');
    expect(grouped[0].duPhong.map((g) => g.idToHoc)).toEqual(['b2']);
    expect(grouped[1].chinh.idToHoc).toBe('a1');
    expect(grouped[1].duPhong).toEqual([]);
  });

  it('dự phòng không có chính vẫn được giữ lại (chinh = null)', () => {
    const grouped = groupBySubject([item('AAA', 'a2', 'du_phong', 1)]);
    expect(grouped[0].chinh).toBeNull();
    expect(grouped[0].duPhong).toHaveLength(1);
  });
});

describe('moveItem', () => {
  it('swap với phần tử lân cận và renumber thu_tu', () => {
    const list = [item('A', 'a', 'chinh', 1), item('B', 'b', 'chinh', 2), item('C', 'c', 'chinh', 3)];
    const moved = moveItem(list, 'b', -1);
    expect(moved.map((i) => i.idToHoc)).toEqual(['b', 'a', 'c']);
    expect(moved.map((i) => i.thuTu)).toEqual([1, 2, 3]);
  });

  it('không di chuyển quá đầu hoặc cuối mảng', () => {
    const list = [item('A', 'a', 'chinh', 1), item('B', 'b', 'chinh', 2), item('C', 'c', 'chinh', 3)];
    expect(moveItem(list, 'a', -1).map((i) => i.idToHoc)).toEqual(['a', 'b', 'c']);
    expect(moveItem(list, 'c', 1).map((i) => i.idToHoc)).toEqual(['a', 'b', 'c']);
  });
});

describe('toSavePayload', () => {
  it('giữ thứ tự mảng truyền vào và đủ các field bắt buộc', () => {
    const list = [item('B', 'b', 'chinh', 2), item('A', 'a', 'du_phong', 1, { tenMon: 'Mon A', soTc: 2 })];
    const payload = toSavePayload(list);
    expect(payload.map((i) => i.idToHoc)).toEqual(['b', 'a']);
    expect(payload.map((i) => i.thuTu)).toEqual([1, 2]);
    for (const entry of payload) {
      expect(Object.keys(entry).sort()).toEqual(['idToHoc', 'lop', 'loai', 'maMon', 'nhomTo', 'soTc', 'tenMon', 'thuTu'].sort());
    }
  });
});

describe('canSetAsChinh', () => {
  it('cho phép chọn môn khác làm chính tự do', () => {
    const list = [item('AAA', 'a1', 'chinh', 1), item('BBB', 'b1', 'chinh', 2)];
    expect(canSetAsChinh(list, list[1])).toBe(true);
  });

  it('không cho thăng dự phòng khi môn đã có chính (phải hạ chính trước)', () => {
    const list = [item('AAA', 'a1', 'chinh', 1), item('AAA', 'a2', 'du_phong', 2)];
    expect(canSetAsChinh(list, list[1])).toBe(false);
  });

  it('cho thăng dự phòng khi môn chưa có chính', () => {
    const list = [item('AAA', 'a2', 'du_phong', 1)];
    expect(canSetAsChinh(list, list[0])).toBe(true);
  });
});
