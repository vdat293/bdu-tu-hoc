import { describe, expect, it } from 'vitest';
import { filterCatalog } from '../../client/src/features/enrollment/catalog-filter.js';

const rows = [
  { maMon: 'AAA', lop: '27TH03', dsLop: ['27TH03'], dsKhoa: ['K.CNTT'], isCtdt: true, isChctdt: false, isRot: false },
  { maMon: 'BBB', lop: '27KT01', dsLop: ['27KT01'], dsKhoa: ['K.KT'], isCtdt: false, isChctdt: true, isRot: true },
  { maMon: 'CCC', lop: '27TH03', dsLop: ['27TH03', '27DT01'], dsKhoa: ['K.CNTT', 'K.DT'], isCtdt: true, isChctdt: false, isRot: false }
];

const ids = (list) => list.map((row) => row.maMon);

describe('filterCatalog', () => {
  it('0 filters by the student class or a shared class list', () => {
    expect(ids(filterCatalog(rows, { loaiLoc: 0, studentClass: '27TH03' }))).toEqual(['AAA', 'CCC']);
    expect(ids(filterCatalog(rows, { loaiLoc: 0, studentClass: '27DT01' }))).toEqual(['CCC']);
    expect(filterCatalog(rows, { loaiLoc: 0 })).toEqual([]);
  });

  it('1 filters failed subjects', () => {
    expect(ids(filterCatalog(rows, { loaiLoc: 1 }))).toEqual(['BBB']);
  });

  it('2 filters planned curriculum subjects', () => {
    expect(ids(filterCatalog(rows, { loaiLoc: 2 }))).toEqual(['AAA', 'CCC']);
  });

  it('3 needs a khoa selection and matches ds_khoa', () => {
    expect(filterCatalog(rows, { loaiLoc: 3 })).toEqual([]);
    expect(ids(filterCatalog(rows, { loaiLoc: 3, khoa: 'K.DT' }))).toEqual(['CCC']);
  });

  it('4 needs a lop selection and matches ds_lop', () => {
    expect(filterCatalog(rows, { loaiLoc: 4 })).toEqual([]);
    expect(ids(filterCatalog(rows, { loaiLoc: 4, lop: '27KT01' }))).toEqual(['BBB']);
  });

  it('6 filters unstudied curriculum subjects', () => {
    expect(ids(filterCatalog(rows, { loaiLoc: 6 }))).toEqual(['BBB']);
  });

  it('10 needs a subject selection and matches ma_mon', () => {
    expect(filterCatalog(rows, { loaiLoc: 10 })).toEqual([]);
    expect(ids(filterCatalog(rows, { loaiLoc: 10, subject: 'CCC' }))).toEqual(['CCC']);
  });

  it('unknown filters leave the list untouched', () => {
    expect(ids(filterCatalog(rows, { loaiLoc: 99 }))).toEqual(['AAA', 'BBB', 'CCC']);
  });
});
