import assert from 'node:assert/strict';
import { AcademicRankingInternals } from '../src/services/academic-ranking.service.js';
import { BduIdentityInternals } from '../src/services/bdu-identity.service.js';
import { millisecondsUntilNextRun } from '../src/services/ranking-scheduler.service.js';

const students = [
  { mssv: '23000001', khoa_hoc: 26, ma_lop: '26TH01', ma_khoa: 'TH', ma_vien: 'TH-DT', gpa_tich_luy_he_4: 3.5, tin_chi_dat_tich_luy: 60 },
  { mssv: '23000002', khoa_hoc: 26, ma_lop: '26TH01', ma_khoa: 'TH', ma_vien: 'TH-DT', gpa_tich_luy_he_4: 3.5, tin_chi_dat_tich_luy: 55 },
  { mssv: '23000003', khoa_hoc: 26, ma_lop: '26TH02', ma_khoa: 'TH', ma_vien: 'TH-DT', gpa_tich_luy_he_4: 3.0, tin_chi_dat_tich_luy: 60 }
];

const ranked = AcademicRankingInternals.rankAllStudents(students);
assert.equal(ranked[0].xep_hang.gpa_tich_luy.truong.hang, 1);
assert.equal(ranked[1].xep_hang.gpa_tich_luy.truong.hang, 1);
assert.equal(ranked[2].xep_hang.gpa_tich_luy.truong.hang, 2);
assert.equal(ranked[1].xep_hang.tin_chi_tich_luy.lop.hang, 2);
assert.equal(ranked[2].xep_hang.tin_chi_tich_luy.truong.tong_sinh_vien, 3);
assert.equal(ranked[2].xep_hang.gpa_tich_luy.khoa.hang, 2);
assert.equal(AcademicRankingInternals.cohortFromMssv('24050001'), 27);

const bestInClass = AcademicRankingInternals.chooseHighlightedRanking({
  lop: { hang: 1, tong_sinh_vien: 40, gia_tri: 3.5 },
  vien: { hang: 20, tong_sinh_vien: 400, gia_tri: 3.5 },
  truong: { hang: 400, tong_sinh_vien: 1800, gia_tri: 3.5 }
});
assert.equal(bestInClass.scope, 'lop');
assert.equal(bestInClass.hang, 1);

const bestAtSchool = AcademicRankingInternals.chooseHighlightedRanking({
  lop: { hang: 1, tong_sinh_vien: 40, gia_tri: 3.8 },
  vien: { hang: 1, tong_sinh_vien: 400, gia_tri: 3.8 },
  truong: { hang: 3, tong_sinh_vien: 1800, gia_tri: 3.8 }
});
assert.equal(bestAtSchool.scope, 'truong');
assert.equal(bestAtSchool.hang, 3);

const leaderboard = AcademicRankingInternals.buildLeaderboard([
  { mssv: '24050001', full_name: 'Bạn', class_code: '27TH01', faculty_code: 'TH', institute_code: 'TH-DT', cohort: 27, cumulative_gpa_4: '3.42', cumulative_earned_credits: '82' },
  { mssv: '24050002', full_name: 'Sinh viên khác', class_code: '27TH01', faculty_code: 'TH', institute_code: 'TH-DT', cohort: 27, cumulative_gpa_4: '3.80', cumulative_earned_credits: '78' }
], { scope: 'school', metric: 'gpa', viewerMssv: '24050001' });
assert.equal(leaderboard[0].hang, 1);
assert.match(leaderboard[0].mssv, /•/);
assert.equal(leaderboard[1].la_sinh_vien_hien_tai, true);
assert.equal(leaderboard[1].mssv, '24050001');

assert.equal(
  BduIdentityInternals.findMssv({ data: { thong_tin_sinh_vien: { ma_sinh_vien: '24050001' } } }),
  '24050001'
);

// 2026-09-02 02:30 Asia/Ho_Chi_Minh -> 30 minutes until 03:00.
const beforeThree = Date.UTC(2026, 8, 1, 19, 30, 0);
assert.equal(millisecondsUntilNextRun(beforeThree), 30 * 60 * 1000);

// At exactly 03:00, schedule the next day instead of running twice.
const exactlyThree = Date.UTC(2026, 8, 1, 20, 0, 0);
assert.equal(millisecondsUntilNextRun(exactlyThree), 24 * 60 * 60 * 1000);

console.log('✓ Best-looking rank selection, leaderboard privacy, verified MSSV and 03:00 scheduler');
