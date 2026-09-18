import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { AcademicSnapshotService, extractAcademicSnapshot } from '../src/services/academic-snapshot.service.js';

const TEST_MSSV = 'TEST_ACADEMIC_SNAPSHOT';

let failures = 0;
function check(label, condition, extra = '') {
  console.log(`${condition ? '✅' : '❌'} ${label}${condition ? '' : ` — ${extra}`}`);
  if (!condition) failures += 1;
}

// 1. Trích xuất thuần từ payload BDU — không cần DB.
console.log('🧪 Kiểm thử snapshot học lực (GPA 10/4, tín chỉ, xếp loại)...');

const payload = {
  result: true,
  data: {
    ds_diem_hocky: [
      {
        hoc_ky: '20242',
        dtb_tich_luy_he_10: '8,51',
        dtb_tich_luy_he_4: '3.63',
        so_tin_chi_dat_tich_luy: '98',
        xep_loai_tkb_hk: 'Xuất sắc'
      },
      {
        hoc_ky: '20241',
        dtb_tich_luy_he_10: '8.10',
        dtb_tich_luy_he_4: '3.40',
        so_tin_chi_dat_tich_luy: '80',
        xep_loai_tkb_hk: 'Giỏi'
      }
    ]
  }
};
const summary = extractAcademicSnapshot(payload);
check('Đọc đúng GPA hệ 10 (chuẩn hoá dấu phẩy)', summary?.gpa_10 === 8.51, JSON.stringify(summary));
check('Đọc đúng GPA hệ 4', summary?.gpa_4 === 3.63);
check('Đọc đúng tín chỉ đạt', summary?.earned_credits === 98);
check('Ưu tiên xếp loại từ payload', summary?.classification === 'Xuất sắc');
check('Lấy đúng học kỳ mới nhất', summary?.semester_code === '20242');

const fallbackRank = extractAcademicSnapshot({
  data: {
    ds_diem_hocky: [{
      hoc_ky: '20242',
      dtb_tich_luy_he_10: '7.0',
      dtb_tich_luy_he_4: '2.6',
      so_tin_chi_dat_tich_luy: '50'
    }]
  }
});
check('Tự xếp loại khi payload thiếu xep_loai', fallbackRank?.classification === 'Khá', JSON.stringify(fallbackRank));

const fallbackCumulative = extractAcademicSnapshot({
  ds_diem_hocky: [{ hoc_ky: '20242', dtb_hk_he10: '9.0', dtb_hk_he4: '3.8', so_tin_chi_dat_hk: '16' }]
});
check('Fallback GPA học kỳ khi thiếu tích lũy', fallbackCumulative?.gpa_10 === 9 && fallbackCumulative?.gpa_4 === 3.8 && fallbackCumulative?.earned_credits === 16);
check('Payload rỗng trả null', extractAcademicSnapshot({ data: { ds_diem_hocky: [] } }) === null);
check('Payload lạ trả null', extractAcademicSnapshot({ result: false }) === null);

// 2. Vòng lặp DB: lưu snapshot rồi đọc lại; payload thiếu không xoá dữ liệu cũ.
if (!process.env.DATABASE_URL) {
  console.log('Skipping DB round-trip: DATABASE_URL not configured.');
  console.log(failures ? `\n❌ ${failures} kiểm tra thất bại.` : '\n✅ PASSED (phần thuần tuý).');
  process.exit(failures ? 1 : 0);
}

try {
  await query('DELETE FROM students WHERE mssv = $1', [TEST_MSSV]);
  await query(
    `INSERT INTO students (mssv, full_name, is_active) VALUES ($1, 'Snapshot Test', TRUE)`,
    [TEST_MSSV]
  );

  const saved = await AcademicSnapshotService.saveFromGrades(TEST_MSSV, payload, { source: 'test' });
  check('saveFromGrades trả bản ghi', Boolean(saved) && saved.mssv === TEST_MSSV);
  check('DB lưu đúng GPA hệ 10', Number(saved?.gpa_10) === 8.51);
  check('DB lưu đúng xếp loại', saved?.classification === 'Xuất sắc');

  const fetched = await AcademicSnapshotService.getSnapshot(TEST_MSSV);
  check('getSnapshot đọc lại đúng tín chỉ', Number(fetched?.earned_credits) === 98);

  // Payload thiếu GPA (BDU trả partial) không được xoá số liệu cũ.
  await AcademicSnapshotService.saveFromGrades(TEST_MSSV, {
    data: { ds_diem_hocky: [{ hoc_ky: '20243', so_tin_chi_dat_tich_luy: '104' }] }
  }, { source: 'test_partial' });
  const partial = await AcademicSnapshotService.getSnapshot(TEST_MSSV);
  check('Payload thiếu giữ nguyên GPA cũ', Number(partial?.gpa_10) === 8.51 && Number(partial?.gpa_4) === 3.63);
  check('Payload thiếu cập nhật tín chỉ mới', Number(partial?.earned_credits) === 104);
} catch (error) {
  failures += 1;
  console.error('❌ Lỗi kiểm thử DB:', error);
} finally {
  try {
    await query('DELETE FROM students WHERE mssv = $1', [TEST_MSSV]);
  } catch {}
  await closeDatabase();
}

if (failures) {
  console.error(`\n❌ ${failures} kiểm tra thất bại.`);
  process.exit(1);
}
console.log('\n✅ PASSED: Snapshot học lực lưu/đọc đúng và không mất dữ liệu khi payload thiếu.');
