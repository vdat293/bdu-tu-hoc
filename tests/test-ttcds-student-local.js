import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { TtcdsStudentService } from '../src/services/ttcds-student.service.js';

// Integration test: chỉ chạy khi có DATABASE_URL (test DB dùng lại bảng odp_*).
if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const MAIN_MSSV = 99000001;
const OTHER_MSSV = 99000002;
const MISSING_MSSV = '99999999';
const TKB_IDS = [80000001, 80000002];
const EVENT_IDS = [90000001, 90000002];
const TEST_COURSE = 'TST0873'; // mã môn riêng của test để không đụng dữ liệu thật trong odp_mon_hoc

async function cleanup() {
  await query('DELETE FROM odp_sinh_vien WHERE mssv IN ($1, $2)', [MAIN_MSSV, OTHER_MSSV]);
  await query('DELETE FROM odp_tbhk WHERE mssv IN ($1, $2)', [MAIN_MSSV, OTHER_MSSV]);
  await query('DELETE FROM odp_bang_diem WHERE mssv IN ($1, $2)', [MAIN_MSSV, OTHER_MSSV]);
  await query('DELETE FROM odp_diem_danh WHERE mssv IN ($1, $2)', [MAIN_MSSV, OTHER_MSSV]);
  await query('DELETE FROM odp_ren_luyen WHERE mssv IN ($1, $2)', [MAIN_MSSV, OTHER_MSSV]);
  await query('DELETE FROM odp_thoi_khoa_bieu WHERE id = ANY($1::bigint[])', [TKB_IDS]);
  await query('DELETE FROM odp_su_kien WHERE id = ANY($1::bigint[])', [EVENT_IDS]);
  await query('DELETE FROM odp_mon_hoc WHERE ma_mon_hoc = $1', [TEST_COURSE]);
}

async function seed() {
  await cleanup();

  // Hồ sơ: chỉ MSSV chính có đầy đủ; OTHER là sinh viên khác để chắc filter theo mssv.
  await query(
    `INSERT INTO odp_sinh_vien
       (mssv, ten_day_du, ma_lop, ten_lop, ma_khoa, ten_khoa, ma_nganh, ten_nganh,
        ma_chuyen_nganh, ten_chuyen_nganh, hien_dien, nk)
     VALUES
       ($1, 'Nguyễn Văn Test', 'K29A', 'K29A-CNTT', 'TH', 'Công nghệ thông tin',
        '7480101', 'Kỹ thuật phần mềm', '7480101_01', 'KTPM', 'Đang học', 'K29'),
       ($2, 'Trần Thị Khác', 'K29B', 'K29B-CNTT', 'TH', 'Công nghệ thông tin',
        '7480101', 'Kỹ thuật phần mềm', '7480101_02', 'KTPM', 'Đang học', 'K29')`,
    [MAIN_MSSV, OTHER_MSSV]
  );

  // GPA: 2 kỳ, cố tình chèn kỳ lớn trước kỳ nhỏ để kiểm tra ORDER BY nkhk.
  await query(
    `INSERT INTO odp_tbhk
       (mssv, nkhk, ma_lop, ten_sinh_vien, so_tin_chi_dat_hk, so_tin_chi_dat_tich_luy,
        dtb_hk_he_4, dtb_hk_he_10, dtb_tich_luy_he_4, dtb_tich_luy_he_10, xep_loai_hoc_ki)
     VALUES
       ($1, 25262, 'K29A', 'Nguyễn Văn Test', 18, 33, 3.4, 8.2, 3.2, 7.9, 'Giỏi'),
       ($1, 25261, 'K29A', 'Nguyễn Văn Test', 15, 15, 3.0, 7.6, 3.0, 7.6, 'Khá')`,
    [MAIN_MSSV]
  );

  // Bảng điểm: 1 môn; mã môn suy từ tiền tố ma_nhom (odp_bang_diem không có ma_mon_hoc).
  // `tin_chi` của odp_bang_diem để NULL → phải lấy từ odp_mon_hoc qua LEFT JOIN.
  await query(
    `INSERT INTO odp_bang_diem
       (mssv, nkhk, ma_nhom, ten_mon_hoc, diem_hp, diem_hp_4, diem_chu_hp, diem_chu_hp_4, dat_hp)
     VALUES ($1, 25262, $2, 'Nhập môn kỹ thuật phần mềm', 7.2, 3.0, 'B', 'B', TRUE)`,
    [MAIN_MSSV, `${TEST_COURSE}_25262_01`]
  );
  await query(
    `INSERT INTO odp_mon_hoc (ma_mon_hoc, ten_mon_hoc, tin_chi, ma_khoa, loai_mon)
     VALUES ($1, 'Nhập môn kỹ thuật phần mềm', 3, 'TH', 'Chuyên ngành')`,
    [TEST_COURSE]
  );

  // Điểm danh kỳ 25262: 1 buổi Có + 1 buổi Vắng + 1 buổi chưa chấm (NULL) + 1 dòng SV khác.
  await query(
    `INSERT INTO odp_diem_danh
       (mssv, ma_nhom, ngay, buoi, ma_mon_hoc, ten_mon_hoc, nkhk, diem_danh, gio_co_mat)
     VALUES
       ($1, 'INF0873_25262_01', '2026-09-02', 1, 'INF0873', 'Nhập môn kỹ thuật phần mềm', 25262, 'Có', '07:00'),
       ($1, 'INF0873_25262_01', '2026-09-03', 1, 'INF0873', 'Nhập môn kỹ thuật phần mềm', 25262, 'Vắng', NULL),
       ($1, 'INF0873_25262_01', '2026-09-04', 1, 'INF0873', 'Nhập môn kỹ thuật phần mềm', 25262, NULL, NULL),
       ($2, 'INF0874_25262_01', '2026-09-02', 1, 'INF0874', 'Môn của SV khác', 25262, 'Vắng', NULL)`,
    [MAIN_MSSV, OTHER_MSSV]
  );

  await query(
    `INSERT INTO odp_ren_luyen (mssv, nkhk, hoc_ki, lop, diem_ren_luyen, xep_loai)
     VALUES ($1, 25262, 2, 'K29A', 85, 'Tốt')`,
    [MAIN_MSSV]
  );

  // TKB không có cột mssv → lọc theo danh_sach_sv (chuỗi JSON chứa MSSV).
  await query(
    `INSERT INTO odp_thoi_khoa_bieu
       (id, nkhk, ma_nhom, ma_mon_hoc, ten_mon_hoc, nhom_hoc, ma_giang_vien, ten_giang_vien,
        ma_phong, buoi_thu, thu_kieu_so, tiet_bat_dau, so_tiet, ngay_hoc, tuan_bat_dau, tuan_ket_thuc, danh_sach_sv)
     VALUES
       ($1, 25262, 'INF0873_25262_01', 'INF0873', 'Nhập môn kỹ thuật phần mềm', '01', 'GV01', 'TS. A',
        'A101', 2, 2, 1, 3, '2026-09-02', 1, 5, $3),
       ($2, 25262, 'INF0874_25262_01', 'INF0874', 'Môn của SV khác', '01', 'GV02', 'TS. B',
        'B202', 3, 3, 1, 3, '2026-09-03', 1, 5, $4)`,
    [TKB_IDS[0], TKB_IDS[1], `[${MAIN_MSSV}, ${OTHER_MSSV}]`, `[${OTHER_MSSV}]`]
  );

  // Sự kiện: 2 sự kiện, chỉ 1 chứa MSSV chính.
  await query(
    `INSERT INTO odp_su_kien (id, ten_su_kien, loai, the_loai, ngay_dien_ra, nkhk, danh_sach_sv)
     VALUES
       ($1, 'Chào tân sinh viên', 'Sự kiện', 'Chào đón', '2026-09-05', 25262, $3),
       ($2, 'Hội thảo học thuật', 'Sự kiện', 'Học thuật', '2026-09-06', 25262, $4)`,
    [EVENT_IDS[0], EVENT_IDS[1], `[${MAIN_MSSV}, ${OTHER_MSSV}]`, `[${OTHER_MSSV}]`]
  );
}

async function expectRejects(promise, status, messagePattern) {
  let error = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'Kỳ vọng promise reject');
  assert.equal(error.status, status, `Kỳ vọng .status ${status}, nhận ${error.status}`);
  if (messagePattern) assert.match(error.message, messagePattern);
}

async function run() {
  console.log('Bat dau kiem thu TtcdsStudentService (doc kho odp_* local)...');

  try {
    await seed();

    console.log('--- [Test 1] getStudent: ho_so + gpa_hoc_ky sắp theo nkhk + nhãn học kỳ ---');
    const detail = await TtcdsStudentService.getStudent(String(MAIN_MSSV));
    assert.equal(detail.tim_thay, true);
    assert.equal(detail.ho_so.ten_day_du, 'Nguyễn Văn Test');
    assert.equal(detail.ho_so.mssv, String(MAIN_MSSV));
    assert.equal(detail.ho_so.lop ?? detail.ho_so.ma_lop, 'K29A');
    assert.equal(detail.ho_so.nien_khoa, 'K29', 'odp_sinh_vien.nk phải được trả dưới khoá nien_khoa');
    assert.deepEqual(
      detail.gpa_hoc_ky.map((term) => term.nkhk),
      [25261, 25262],
      'gpa_hoc_ky phải sắp tăng dần theo nkhk'
    );
    assert.match(detail.gpa_hoc_ky[0].ten_hoc_ky, /Học kỳ 1/);
    assert.match(detail.gpa_hoc_ky[1].ten_hoc_ky, /Học kỳ 2/);
    assert.equal(Number(detail.gpa_hoc_ky[1].dtb_tich_luy_he_4), 3.2);
    console.log('PASSED: ho_so + GPA đúng, có nhãn học kỳ.');

    console.log('--- [Test 2] bang_diem: mã môn suy từ ma_nhom + tín chỉ lấy từ odp_mon_hoc ---');
    assert.equal(detail.bang_diem.length, 1);
    assert.equal(detail.bang_diem[0].ma_mon_hoc, TEST_COURSE);
    assert.equal(detail.bang_diem[0].ten_mon, 'Nhập môn kỹ thuật phần mềm');
    assert.equal(Number(detail.bang_diem[0].diem_he_4), 3.0);
    assert.equal(detail.bang_diem[0].diem_chu, 'B');
    assert.equal(detail.bang_diem[0].ma_nhom, `${TEST_COURSE}_25262_01`);
    // odp_bang_diem.tin_chi NULL → COALESCE lấy odp_mon_hoc.tin_chi = 3.
    assert.equal(Number(detail.bang_diem[0].tin_chi), 3, 'tin_chi phải điền từ odp_mon_hoc');
    assert.equal(Number(detail.bang_diem[0].so_tin_chi), 3, 'so_tin_chi phải điền từ odp_mon_hoc');
    assert.match(detail.bang_diem[0].ten_hoc_ky, /Học kỳ 2/);
    console.log('PASSED: bang_diem map đúng shape frontend + tín chỉ từ odp_mon_hoc.');

    console.log('--- [Test 3] diem_danh theo kỳ: Vắng KHÔNG tính vào di_hoc, đếm đúng chưa chấm ---');
    const term = detail.diem_danh.find((row) => row.nkhk === 25262);
    assert.ok(term, 'phải có dòng điểm danh kỳ 25262');
    assert.equal(term.di_hoc, 1, 'chỉ buổi Có được tính có mặt');
    assert.equal(term.vang, 1);
    assert.equal(term.chua, 1, '1 buổi chưa chấm (diem_danh NULL)');
    assert.equal(term.di_hoc + term.vang + term.chua, 3, 'so_buoi = di_hoc + vang + chua');
    assert.match(term.ten_hoc_ky, /Học kỳ 2/);
    console.log('PASSED: Vắng tách riêng, chưa chấm đếm thật.');

    console.log('--- [Test 4] diem_danh_mon: đếm theo (nkhk, ma_mon_hoc) ---');
    const mon = detail.diem_danh_mon.find((row) => row.ma_mon_hoc === 'INF0873');
    assert.ok(mon);
    assert.equal(mon.so_buoi, 3);
    assert.equal(mon.di_hoc, 1);
    assert.equal(mon.vang, 1);
    assert.equal(mon.chua, 1);
    assert.equal(mon.di_hoc + mon.vang + mon.chua, mon.so_buoi, 'so_buoi = di_hoc + vang + chua');
    assert.equal(mon.ten_mon_hoc, 'Nhập môn kỹ thuật phần mềm');
    console.log('PASSED: diem_danh_mon đếm đúng, tách Vắng + chưa chấm.');

    console.log('--- [Test 5] ren_luyen + su_kien (chỉ sự kiện chứa MSSV) ---');
    assert.equal(Number(detail.ren_luyen[0].diem_ren_luyen), 85);
    assert.equal(detail.ren_luyen[0].xep_loai, 'Tốt');
    assert.equal(detail.su_kien.length, 1, 'chỉ trả sự kiện có MSSV trong danh_sach_sv');
    assert.equal(detail.su_kien[0].ten_su_kien, 'Chào tân sinh viên');
    assert.equal(detail.su_kien[0].ngay, '2026-09-05');
    console.log('PASSED: ren_luyen + su_kien lọc đúng theo MSSV.');

    console.log('--- [Test 6] thoi_khoa_bieu: chỉ buổi có MSSV trong danh_sach_sv ---');
    assert.equal(detail.thoi_khoa_bieu.length, 1, 'chỉ trả buổi có MSSV');
    assert.equal(detail.thoi_khoa_bieu[0].ma_mon_hoc, 'INF0873');
    assert.equal(detail.thoi_khoa_bieu[0].ten_mon, 'Nhập môn kỹ thuật phần mềm');
    assert.equal(detail.thoi_khoa_bieu[0].phong, 'A101');
    console.log('PASSED: TKB lọc đúng theo danh_sach_sv.');

    console.log('--- [Test 7] searchStudents: prefix MSSV + tên, giới hạn kết quả ---');
    const search = await TtcdsStudentService.searchStudents('99');
    assert.ok(search.ket_qua.some((row) => row.mssv === String(MAIN_MSSV)));
    assert.ok(search.ket_qua.every((row) => 'ten_day_du' in row && 'ma_lop' in row && 'hien_dien' in row));
    const byName = await TtcdsStudentService.searchStudents('Nguyễn Văn');
    assert.ok(byName.ket_qua.some((row) => row.mssv === String(MAIN_MSSV)));
    const limited = await TtcdsStudentService.searchStudents('99', { limit: 1 });
    assert.equal(limited.ket_qua.length, 1, 'limit phải được tôn trọng');
    console.log('PASSED: search theo MSSV/tên, trả { ket_qua }.');

    console.log('--- [Test 8] lỗi mang .status: 400 khi q ngắn, 404 khi thiếu SV ---');
    await expectRejects(TtcdsStudentService.searchStudents('9'), 400);
    await expectRejects(TtcdsStudentService.searchStudents('  '), 400);
    await expectRejects(TtcdsStudentService.getStudent(MISSING_MSSV), 404);
    console.log('PASSED: q ngắn -> 400, SV không có -> 404.');

    console.log('--- [Test 9] getAttendance: lọc theo kỳ, thiếu dữ liệu -> 404 ---');
    const attendance = await TtcdsStudentService.getAttendance(String(MAIN_MSSV), { nkhk: '25262' });
    assert.equal(attendance.tong_so_buoi, 3);
    assert.equal(attendance.so_buoi_vang, 1);
    assert.equal(attendance.nhat_ky.length, 3);
    assert.ok(attendance.nhat_ky.every((row) => typeof row.ngay === 'string'));
    await expectRejects(TtcdsStudentService.getAttendance(MISSING_MSSV, { nkhk: '25262' }), 404);
    await expectRejects(
      TtcdsStudentService.getAttendance(String(MAIN_MSSV), { ma_mon_hoc: 'KHONG_CO' }),
      404
    );
    console.log('PASSED: nhật ký điểm danh + 404 khi trống.');

    console.log('TAT CA BAI KIEM THU TTCDS STUDENT (LOCAL) DA DAT!');
  } finally {
    await cleanup();
    await closeDatabase();
  }
}

run().catch((err) => {
  console.error('❌ Kiểm thử TtcdsStudentService thất bại:', err);
  process.exit(1);
});
