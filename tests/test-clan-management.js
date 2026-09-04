import assert from 'assert';
import { query, closeDatabase } from '../src/db/database.js';
import { StudentService } from '../src/services/student.service.js';

async function runClanManagementTest() {
  console.log('🧪 Bắt đầu kiểm thử Quản trị CLB & Phân quyền thành viên...');

  try {
    // 1. Tạo 2 sinh viên test
    await StudentService.recordLogin('TEST_LEADER', 'Nguyễn Bang Chủ');
    await StudentService.recordLogin('TEST_MEMBER', 'Trần Thành Viên');

    // 2. Leader tạo clan
    const clan = await StudentService.createClan({
      leaderMssv: 'TEST_LEADER',
      name: 'CLB Test Quản Trị',
      code: 'CLB_TEST_MGMT_' + Date.now(),
      tag: '[MGMT]',
      description: 'Nhóm dùng để test chức năng quản trị'
    });
    assert(clan && clan.id, 'Phải tạo được CLB test');
    console.log('--- [Test 1] Tạo CLB test thành công ---');

    // 3. Member tham gia clan
    await StudentService.joinClan('TEST_MEMBER', clan.id);
    let members = await StudentService.getClanMembers(clan.id);
    assert.strictEqual(members.length, 2, 'CLB phải có đúng 2 thành viên');
    console.log('--- [Test 2] Thêm thành viên vào CLB thành công ---');

    // 4. Phân quyền: Thăng chức TEST_MEMBER thành vice_leader
    await StudentService.updateMemberRole(clan.id, 'TEST_LEADER', 'TEST_MEMBER', 'vice_leader');
    members = await StudentService.getClanMembers(clan.id);
    const viceMember = members.find(m => m.mssv === 'TEST_MEMBER');
    assert.strictEqual(viceMember.role, 'vice_leader', 'TEST_MEMBER phải có role là vice_leader');
    console.log('✅ PASSED: Thăng chức thành viên lên Phó Bang thành công.');

    // 5. Cập nhật thông tin CLB
    const updatedClan = await StudentService.updateClanInfo(clan.id, 'TEST_LEADER', {
      name: 'CLB Test Quản Trị Đổi Tên',
      description: 'Mô tả mới đã được cập nhật'
    });
    assert.strictEqual(updatedClan.name, 'CLB Test Quản Trị Đổi Tên', 'Tên CLB phải được cập nhật');
    console.log('✅ PASSED: Cập nhật thông tin CLB thành công.');

    // 6. Khai trừ thành viên
    await StudentService.kickMember(clan.id, 'TEST_LEADER', 'TEST_MEMBER');
    members = await StudentService.getClanMembers(clan.id);
    assert.strictEqual(members.length, 1, 'Sau khi kick, CLB chỉ còn 1 thành viên');
    console.log('✅ PASSED: Khai trừ thành viên ra khỏi CLB thành công.');

    // 7. Giải tán CLB
    await StudentService.disbandClan(clan.id, 'TEST_LEADER');
    const checkClan = await query('SELECT * FROM clans WHERE id = $1', [clan.id]);
    assert.strictEqual(checkClan.rows.length, 0, 'CLB phải bị xóa khỏi CSDL sau khi giải tán');
    console.log('✅ PASSED: Giải tán CLB thành công.');

    // Cleanup students
    await query("DELETE FROM students WHERE mssv IN ('TEST_LEADER', 'TEST_MEMBER')");

    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ QUẢN TRỊ CLB ĐỀU THÀNH CÔNG!');
    console.log('======================================================\n');
  } finally {
    await closeDatabase();
  }
}

runClanManagementTest().catch(err => {
  console.error('❌ Clan management test failed:', err);
  process.exit(1);
});
