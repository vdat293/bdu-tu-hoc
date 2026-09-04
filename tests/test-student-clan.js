import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { StudentService } from '../src/services/student.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test-student-clan: DATABASE_URL not configured.');
  process.exit(0);
}

try {
  console.log('🧪 Bắt đầu kiểm thử Quản lý Sinh viên, Clan/Guild & Active Status...');

  const TEST_MSSV = 'TEST_SV_9999';
  const TEST_MSSV_2 = 'TEST_SV_8888';

  // Dọn dẹp dữ liệu test cũ nếu có
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [TEST_MSSV, TEST_MSSV_2]);
  await query('DELETE FROM clans WHERE code IN ($1, $2)', ['CLAN_TEST_DEV', 'CLAN_TEST_ESPORT']);

  // 1. Kiểm thử recordLogin: Lần đầu đăng nhập
  console.log('--- [Test 1] Ghi nhận đăng nhập lần đầu (Active status & timestamps) ---');
  const firstLogin = await StudentService.recordLogin(TEST_MSSV, 'Nguyễn Văn Test');
  assert.ok(firstLogin, 'Bản ghi sinh viên phải được trả về');
  assert.equal(firstLogin.mssv, TEST_MSSV);
  assert.equal(firstLogin.full_name, 'Nguyễn Văn Test');
  assert.equal(firstLogin.is_active, true, 'is_active phải là TRUE');
  assert.ok(firstLogin.first_login_at, 'first_login_at phải có giá trị');
  assert.ok(firstLogin.last_login_at, 'last_login_at phải có giá trị');
  const firstLoginTime = new Date(firstLogin.first_login_at).getTime();

  // Đợi một khoảng thời gian nhỏ trước khi đăng nhập lần 2
  await new Promise((r) => setTimeout(r, 50));

  // Ghi nhận đăng nhập lần 2
  const secondLogin = await StudentService.recordLogin(TEST_MSSV, 'Nguyễn Văn Test Updated');
  assert.equal(secondLogin.full_name, 'Nguyễn Văn Test Updated');
  assert.equal(secondLogin.is_active, true);
  assert.equal(
    new Date(secondLogin.first_login_at).getTime(),
    firstLoginTime,
    'first_login_at không được thay đổi ở các lần đăng nhập sau'
  );
  assert.ok(
    new Date(secondLogin.last_login_at).getTime() >= firstLoginTime,
    'last_login_at phải được cập nhật mới nhất'
  );
  console.log('✅ PASSED: Ghi nhận trạng thái Active và thời gian đăng nhập chuẩn xác.');

  // 2. Kiểm thử tạo Clan/Guild
  console.log('--- [Test 2] Tạo Clan/Guild theo phong cách game ---');
  const clanDev = await StudentService.createClan({
    code: 'CLAN_TEST_DEV',
    name: 'Câu Lạc Bộ Lập Trình BDU',
    tag: '[DEV]',
    description: 'Nơi quy tụ các lập trình viên BDU',
    leaderMssv: TEST_MSSV
  });
  assert.ok(clanDev.id, 'Clan phải có ID');
  assert.equal(clanDev.code, 'CLAN_TEST_DEV');
  assert.equal(clanDev.tag, '[DEV]');
  assert.equal(clanDev.leader_mssv, TEST_MSSV);
  assert.equal(clanDev.level, 1);

  const clanEsport = await StudentService.createClan({
    code: 'CLAN_TEST_ESPORT',
    name: 'BDU Gaming & Esports',
    tag: '[BDU-E]',
    description: 'CLB Thể thao điện tử',
    leaderMssv: TEST_MSSV_2
  });
  console.log('✅ PASSED: Tạo Clan/Guild thành công kèm Leader.');

  // 3. Kiểm thử 1 sinh viên có thể tham gia nhiều Clan/CLB
  console.log('--- [Test 3] Sinh viên tham gia nhiều nhóm/CLB cùng lúc ---');
  // Sinh viên TEST_MSSV đã là Leader của CLAN_TEST_DEV, giờ tham gia thêm CLAN_TEST_ESPORT với vai trò member
  const joinResult = await StudentService.joinClan(TEST_MSSV, clanEsport.id, 'member');
  assert.ok(joinResult, 'Phải tham gia được clan thứ 2');
  assert.equal(joinResult.role, 'member');

  // Lấy hồ sơ sinh viên kèm danh sách Clans
  const studentProfile = await StudentService.getStudent(TEST_MSSV);
  assert.equal(studentProfile.mssv, TEST_MSSV);
  assert.equal(studentProfile.is_active, true);
  assert.equal(studentProfile.clans.length, 2, 'Sinh viên phải đang tham gia đúng 2 Clan');

  const clanCodes = studentProfile.clans.map((c) => c.code).sort();
  assert.deepEqual(clanCodes, ['CLAN_TEST_DEV', 'CLAN_TEST_ESPORT']);

  const devClanRole = studentProfile.clans.find((c) => c.code === 'CLAN_TEST_DEV')?.role;
  const esportClanRole = studentProfile.clans.find((c) => c.code === 'CLAN_TEST_ESPORT')?.role;
  assert.equal(devClanRole, 'leader');
  assert.equal(esportClanRole, 'member');
  console.log('✅ PASSED: 1 sinh viên có thể tham gia nhiều nhóm/CLB với các chức vụ khác nhau.');

  // 4. Kiểm thử danh sách thành viên trong Clan
  console.log('--- [Test 4] Danh sách thành viên trong Clan có phân cấp role ---');
  const members = await StudentService.getClanMembers(clanEsport.id);
  assert.equal(members.length, 2, 'CLB Esport phải có 2 thành viên');
  assert.equal(members[0].role, 'leader', 'Bang chủ phải xếp trên');
  assert.equal(members[1].role, 'member', 'Thành viên xếp sau');
  console.log('✅ PASSED: Lấy danh sách thành viên Clan theo cấp bậc thành công.');

  // 5. Kiểm thử rời khỏi Clan
  console.log('--- [Test 5] Sinh viên rời nhóm/CLB ---');
  const left = await StudentService.leaveClan(TEST_MSSV, clanEsport.id);
  assert.equal(left, true);

  const updatedProfile = await StudentService.getStudent(TEST_MSSV);
  assert.equal(updatedProfile.clans.length, 1, 'Sau khi rời, chỉ còn 1 clan');
  assert.equal(updatedProfile.clans[0].code, 'CLAN_TEST_DEV');
  console.log('✅ PASSED: Rời nhóm/CLB thành công.');

  // Dọn dẹp dữ liệu test
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [TEST_MSSV, TEST_MSSV_2]);
  await query('DELETE FROM clans WHERE code IN ($1, $2)', ['CLAN_TEST_DEV', 'CLAN_TEST_ESPORT']);

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ STUDENT & CLAN ĐỀU THÀNH CÔNG!');
  console.log('======================================================');
} catch (error) {
  console.error('❌ Kiểm thử thất bại:', error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
