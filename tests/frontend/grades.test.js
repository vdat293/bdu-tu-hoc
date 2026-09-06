import { describe, expect, it } from 'vitest';
import { buildGradesCsv, calculateRank, coursesForFilters, formatScore, getSemesters, latestSummary } from '../../client/src/features/gpa/grades.js';

const semesters = [
  { hoc_ky: 20261, ten_hoc_ky: 'Học kỳ 1', dtb_tich_luy_he_10: '8.25', dtb_tich_luy_he_4: '3.4', so_tin_chi_dat_tich_luy: 42, ds_diem_mon_hoc: [{ ma_mon: 'JSX101', ten_mon: 'Lập trình JSX', diem_tk: 8.5, diem_tk_so: 3.5, diem_tk_chu: 'A', ket_qua: 1, so_tin_chi: 3 }] },
  { hoc_ky: 20260, ten_hoc_ky: 'Học kỳ hè', ds_diem_mon_hoc: [{ ma_mon: 'WEB101', ten_mon: 'Web', diem_tk_chu: 'F', ket_qua: 0, so_tin_chi: 2 }] }
];

describe('grade selectors and formatters', () => {
  it('unwraps BDU grade envelope and preserves summary precision', () => {
    expect(getSemesters({ data: { ds_diem_hocky: semesters } })).toEqual(semesters);
    expect(latestSummary(semesters)).toEqual({ gpa10: '8.25', gpa4: '3.40', credits: 42, rank: 'Giỏi' });
    expect(formatScore('x')).toBe('x');
  });

  it('combines URL filters without mixing pass/fail rows', () => {
    expect(coursesForFilters(semesters, { semester: '20261', status: 'PASS', query: 'jsx' })).toHaveLength(1);
    expect(coursesForFilters(semesters, { status: 'FAIL' })).toHaveLength(1);
  });

  it('keeps the existing rank thresholds and CSV Vietnamese header', () => {
    expect(calculateRank(0, 3.6)).toBe('Xuất sắc');
    expect(buildGradesCsv(semesters)).toContain('Học Kỳ,Mã Môn,Tên Môn Học');
    expect(buildGradesCsv(semesters)).toContain('Lập trình JSX');
  });
});
