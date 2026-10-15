/**
 * test-ranking-from-odp.js — Task 3 (ranking đọc từ kho `odp_*`)
 *
 * Mục tiêu: chứng minh `collectRankings()` KHÔNG còn gọi API ODP (`https.get`)
 * mà đọc thẳng kho local, và kết quả tính toán (credit, GPA, xếp hạng) đúng như
 * dữ liệu seed. Bảng `odp_*` là nguồn duy nhất.
 *
 * Chạy (Windows, không spawn runner):
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_CONFIRM_DESTRUCTIVE='1';
 *   $env:BDU_TEST_RUNNER='explicit';
 *   $env:BDU_TEST_DATABASE_URL='postgresql://bdu_test:bdu_test_password@127.0.0.1:55432/bdu_test_local';
 *   $env:DATABASE_URL=$env:BDU_TEST_DATABASE_URL; node tests/test-ranking-from-odp.js
 */
import assert from 'node:assert/strict';
import https from 'node:https';
import { closeDatabase, query } from '../src/db/database.js';
import { AcademicRankingInternals, AcademicRankingService } from '../src/services/academic-ranking.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const database = await query('SELECT current_database() AS name');
const databaseName = database.rows[0]?.name || '';
if (!/(dev|test)/i.test(databaseName)) {
  throw new Error(`Refusing to seed non-dev database: ${databaseName}`);
}

// MSSV phải đúng 8 chữ số để `cohortFromMssv` suy được khóa (24xx9001 → khóa 27),
// và `ma_lop` phải mở đầu bằng khóa đó để `rollingCohortWindow` chọn đúng sinh viên.
const MSSV_A = '24990001';
const MSSV_B = '24990002';
const NKHK = 25262;

try {
  await query(`
    TRUNCATE odp_sinh_vien, odp_tbhk, odp_bang_diem, odp_mon_hoc, odp_thoi_khoa_bieu,
             academic_rankings, academic_ranking_sync_runs RESTART IDENTITY CASCADE
  `);

  // Hồ sơ: ten_day_du CỐ TÌNH khác ten_sinh_vien trong odp_tbhk để chứng minh
  // ranking vẫn ưu tiên tên ở dòng GPA (đúng như hành vi trước khi đổi nguồn).
  await query(`
    INSERT INTO odp_sinh_vien (mssv, ten_day_du, ho_sv, ten_sv, ma_lop, ma_khoa, ten_khoa, hien_dien, nk)
    VALUES
      ($1, 'Nguyễn Văn A (hồ sơ)', 'Nguyễn', 'A', '27TH01', 'TH', 'Công nghệ thông tin', 'Đang học', 'K27'),
      ($2, 'Trần Thị B (hồ sơ)', 'Trần', 'B', '27TH01', 'TH', 'Công nghệ thông tin', 'Đang học', 'K27')
  `, [MSSV_A, MSSV_B]);

  await query(`
    INSERT INTO odp_tbhk (
      mssv, nkhk, ma_lop, ten_sinh_vien, so_tin_chi_dat_hk, so_tin_chi_dat_tich_luy,
      dtb_hk_he_4, dtb_hk_he_10, dtb_tich_luy_he_4, dtb_tich_luy_he_10, xep_loai_hoc_ki
    ) VALUES
      ($1, $3, '27TH01', 'Nguyễn Văn A', 12, 90, 3.20, 8.0, 3.42, 8.5, 'Giỏi'),
      ($2, $3, '27TH01', 'Trần Thị B', 9, 60, 3.60, 8.8, 3.80, 9.0, 'Xuất sắc')
  `, [MSSV_A, MSSV_B, NKHK]);

  // A: 1 môn ĐẠT + 1 môn TRƯỢT; B: 1 môn ĐẠT. `tin_chi` luôn NULL trong kho nên
  // tín chỉ đạt phải lấy từ odp_mon_hoc qua mã môn suy từ tiền tố `ma_nhom`.
  await query(`
    INSERT INTO odp_bang_diem (
      mssv, nkhk, ma_nhom, ten_mon_hoc, diem_hp, diem_hp_4, diem_chu_hp, diem_chu_hp_4,
      dat_hp, tin_chi, lop, ma_khoa
    ) VALUES
      ($1, $3, 'INF0873_25262_01', 'Nhập môn kỹ thuật phần mềm', 7.2, 3.0, 'B', 'B', true, NULL, '27TH01', 'TH'),
      ($1, $3, 'MAT1001_25262_01', 'Giải tích', 3.0, 0.5, 'F', 'F', false, NULL, '27TH01', 'TH'),
      ($2, $3, 'INF0874_25262_01', 'Cấu trúc dữ liệu', 8.4, 3.5, 'A', 'A', true, NULL, '27TH01', 'TH')
  `, [MSSV_A, MSSV_B, NKHK]);

  await query(`
    INSERT INTO odp_mon_hoc (ma_mon_hoc, ten_mon_hoc, tin_chi, ma_khoa, loai_mon) VALUES
      ('INF0873', 'Nhập môn kỹ thuật phần mềm', 3, 'TH', 'Chuyên ngành'),
      ('INF0874', 'Cấu trúc dữ liệu', 4, 'TH', 'Chuyên ngành'),
      ('MAT1001', 'Giải tích', 3, 'TH', 'Đại cương')
  `);

  await query(`
    INSERT INTO odp_thoi_khoa_bieu (
      id, nkhk, ma_nhom, ma_mon_hoc, ma_giang_vien, tiet_bat_dau, so_tiet, ngay_hoc, danh_sach_sv
    ) VALUES
      (1, $1, 'INF0873_25262_01', 'INF0873', 'GV01', 1, 3, '2025-09-08', '24990001,24990002')
  `, [NKHK]);

  // Spy chặn mọi lời gọi mạng: đường đọc giờ phải chạy hoàn toàn trên Postgres.
  const originalGet = https.get;
  const httpCalls = [];
  https.get = (...args) => {
    httpCalls.push(String(args[0]));
    throw new Error(`Đường đọc ranking không được gọi https.get: ${args[0]}`);
  };

  try {
    // --- collectRankings: 5 SELECT thay 5 lần fetchRows -------------------
    const report = await AcademicRankingInternals.collectRankings();

    assert.deepEqual(report.sourceCounts, {
      gpa: 2,
      profiles: 2,
      details: 3,
      courses: 3,
      timetable: 1
    }, 'source counts phải khớp đúng số dòng seed từ kho odp_*');
    assert.deepEqual(report.activityTerms, [NKHK]);
    assert.equal(report.targetNkhk, NKHK);
    assert.equal(report.warnings.length, 0, 'đọc kho local không sinh cảnh báo nguồn');
    assert.equal(report.students.length, 2);

    const [a, b] = report.students;
    assert.equal(a.mssv, MSSV_A);
    assert.equal(a.ho_ten, 'Nguyễn Văn A', 'tên lấy từ odp_tbhk.ten_sinh_vien như trước');
    assert.equal(a.ma_khoa, 'TH');
    assert.equal(a.ma_vien, 'TH-DT');
    assert.equal(a.khoa_hoc, 27);
    assert.equal(a.hien_dien, 'Đang học');
    assert.equal(a.nkhk, NKHK);
    assert.equal(a.gpa_hoc_ky_he_4, 3.2);
    assert.equal(a.gpa_tich_luy_he_4, 3.42);
    assert.equal(a.xep_loai_tich_luy, 'Giỏi');
    assert.equal(a.xep_loai_hoc_ky, 'Giỏi');
    assert.equal(a.tin_chi_dat_hoc_ky, 12);
    // 1 môn đạt (INF0873, 3 tín chỉ) + 1 môn trượt (MAT1001) → 3, KHÔNG phải 90.
    assert.equal(a.tin_chi_dat_tich_luy, 3);
    assert.equal(a.nguon_tin_chi_tich_luy, 'tong_mon_dat');
    assert.equal(typeof a.xep_hang.gpa_tich_luy.truong.hang, 'number');

    assert.equal(b.tin_chi_dat_tich_luy, 4, 'B đạt INF0874 = 4 tín chỉ');
    assert.equal(b.nguon_tin_chi_tich_luy, 'tong_mon_dat');
    assert.equal(b.gpa_tich_luy_he_4, 3.8);

    assert.deepEqual(httpCalls, [], 'không có lời gọi https.get trên đường đọc');

    // --- sync('manual') đầu-cuối: ghi academic_rankings từ kho -----------
    const synced = await AcademicRankingService.sync('manual');
    assert.equal(synced.skipped, false);
    assert.equal(synced.studentCount, 2);

    const stored = await query(`
      SELECT mssv, cumulative_gpa_4 AS gpa, cumulative_earned_credits AS credits,
             cumulative_credit_source AS source, cohort, full_name, class_code, semester_code
      FROM academic_rankings
      WHERE mssv = $1
    `, [MSSV_A]);
    assert.equal(stored.rows.length, 1);
    assert.equal(Number(stored.rows[0].gpa), 3.42);
    assert.equal(Number(stored.rows[0].credits), 3);
    assert.equal(stored.rows[0].source, 'tong_mon_dat');
    assert.equal(stored.rows[0].cohort, 27);
    assert.equal(stored.rows[0].full_name, 'Nguyễn Văn A');
    assert.equal(stored.rows[0].class_code, '27TH01');
    assert.equal(stored.rows[0].semester_code, NKHK);

    const lookup = await AcademicRankingService.getLatestByMssv(MSSV_A);
    assert.equal(lookup.tin_chi_dat_tich_luy, 3);
    assert.equal(lookup.gpa_tich_luy_he_4, 3.42);

    // --- kho rỗng: lỗi rõ ràng về kho, KHÔNG phải lỗi mạng -----------------
    await query('DELETE FROM odp_tbhk');
    await query('DELETE FROM odp_sinh_vien');
    await assert.rejects(
      () => AcademicRankingService.sync('manual'),
      /rỗng/i,
      'kho ODP rỗng phải báo lỗi nói rõ kho rỗng'
    );

    assert.deepEqual(httpCalls, [], 'kể cả nhánh lỗi cũng không gọi https.get');
    console.log('✓ Ranking đọc từ kho odp_*: 5 SELECT, credit từ môn đạt, không gọi API ODP');
  } finally {
    https.get = originalGet;
  }
} finally {
  await closeDatabase();
}
