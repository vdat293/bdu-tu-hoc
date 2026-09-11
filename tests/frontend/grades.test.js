import { describe, expect, it } from 'vitest';
import { buildGradesCsv, calculateRank, coursesForFilters, formatScore, getCourseResult, getSemesters, latestSummary } from '../../client/src/features/gpa/grades.js';

const semesters = [
  { hoc_ky: 20261, ten_hoc_ky: 'Học kỳ 1', dtb_tich_luy_he_10: '8.25', dtb_tich_luy_he_4: '3.4', so_tin_chi_dat_tich_luy: 42, ds_diem_mon_hoc: [{ ma_mon: 'JSX101', ten_mon: 'Lập trình JSX', diem_tk: 8.5, diem_tk_so: 3.5, diem_tk_chu: 'A', ket_qua: 1, so_tin_chi: 3 }, { ma_mon: 'PENDING', ten_mon: 'Chưa công bố điểm', diem_tk: null, diem_tk_so: null, diem_tk_chu: '', ket_qua: '', so_tin_chi: 3 }] },
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
    expect(getCourseResult(semesters[0].ds_diem_mon_hoc[1])).toMatchObject({ status: 'ungraded', graded: false });
    expect(getCourseResult({ ket_qua: 0, diem_tk: '--', diem_tk_so: '--', diem_tk_chu: '--' })).toMatchObject({ status: 'ungraded', graded: false });
    expect(getCourseResult({ diem_tk_chu: 'P' })).toMatchObject({ status: 'passed', graded: true });
    expect(getCourseResult({ diem_tk: 0, diem_tk_so: 0 })).toMatchObject({ status: 'failed', graded: true });
  });

  it('keeps the existing rank thresholds and CSV Vietnamese header', () => {
    expect(calculateRank(0, 3.6)).toBe('Xuất sắc');
    expect(calculateRank('', '')).toBe('Chưa xếp loại');
    expect(latestSummary([]).rank).toBe('Chưa xếp loại');
    expect(buildGradesCsv(semesters)).toContain('Học Kỳ,Mã Môn,Tên Môn Học');
    expect(buildGradesCsv(semesters)).toContain('Lập trình JSX');
    expect(buildGradesCsv(semesters)).toContain('Chưa có điểm');
    expect(buildGradesCsv(semesters, { query: 'jsx' })).toContain('Lập trình JSX');
    expect(buildGradesCsv(semesters, { query: 'jsx' })).not.toContain('Web');
    expect(buildGradesCsv([{ hoc_ky: 1, ds_diem_mon_hoc: [{ ma_mon: 'ZERO', so_tin_chi: 0, diem_tk: 0 }] }])).toContain('"0"');
    expect(latestSummary([{ so_tin_chi_dat_tich_luy: '187' }]).credits).toBe(187);
  });
});
