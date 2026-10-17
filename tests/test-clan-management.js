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

    // 5. Chuyển giao quyền Bang Chủ khi người yêu cầu KHÔNG phải leader hiện tại.
    //    Tình huống này phơi bày bug: code cũ hạ vai trò của người YÊU CẦU thay vì
    //    hạ leader đang giữ quyền. Admin (vice_leader trong CLB) thăng TEST_MEMBER
    //    lên leader -> TEST_LEADER (leader hiện tại) phải bị hạ xuống member,
    //    còn TEST_OWNER_001 giữ nguyên vice_leader.
    await StudentService.recordLogin('TEST_OWNER_001', 'Quản Trị Viên');
    await StudentService.joinClan('TEST_OWNER_001', clan.id, 'vice_leader');
    await StudentService.updateMemberRole(clan.id, 'TEST_OWNER_001', 'TEST_MEMBER', 'leader');

    members = await StudentService.getClanMembers(clan.id);
    const transferredLeader = members.find(m => m.mssv === 'TEST_MEMBER');
    const demotedOldLeader = members.find(m => m.mssv === 'TEST_LEADER');
    const requesterAfterTransfer = members.find(m => m.mssv === 'TEST_OWNER_001');
    const clanAfterTransfer = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clan.id]);

    assert.strictEqual(transferredLeader.role, 'leader', 'TEST_MEMBER phải nhận được vai trò leader');
    assert.strictEqual(clanAfterTransfer.rows[0].leader_mssv, 'TEST_MEMBER', 'clans.leader_mssv phải trỏ tới TEST_MEMBER');
    assert.strictEqual(demotedOldLeader.role, 'member', 'Leader HIỆN TẠI (TEST_LEADER) phải bị hạ xuống member');
    assert.strictEqual(requesterAfterTransfer.role, 'vice_leader', 'Người yêu cầu (admin) giữ nguyên vai trò, không bị hạ như code cũ');
    console.log('✅ PASSED: Chuyển giao Bang Chủ hạ đúng leader cũ, không hạ người yêu cầu.');

    // 6. Tự chuyển giao: leader hiện tại (TEST_MEMBER) nhường ngôi lại cho TEST_LEADER.
    await StudentService.updateMemberRole(clan.id, 'TEST_MEMBER', 'TEST_LEADER', 'leader');
    members = await StudentService.getClanMembers(clan.id);
    const restoredLeader = members.find(m => m.mssv === 'TEST_LEADER');
    const selfDemotedLeader = members.find(m => m.mssv === 'TEST_MEMBER');
    const clanAfterSelfTransfer = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clan.id]);
    assert.strictEqual(restoredLeader.role, 'leader', 'TEST_LEADER phải nhận lại vai trò leader');
    assert.strictEqual(selfDemotedLeader.role, 'member', 'TEST_MEMBER phải bị hạ về member sau khi nhường ngôi');
    assert.strictEqual(clanAfterSelfTransfer.rows[0].leader_mssv, 'TEST_LEADER', 'clans.leader_mssv phải trỏ lại TEST_LEADER');
    console.log('✅ PASSED: Leader tự nhường ngôi (self-demotion) hoạt động đúng.');

    // Dọn thành viên admin tạm để các bước sau giữ nguyên số lượng thành viên.
    await StudentService.leaveClan('TEST_OWNER_001', clan.id);

    // 7. Cập nhật thông tin CLB
    const updatedClan = await StudentService.updateClanInfo(clan.id, 'TEST_LEADER', {
      name: 'CLB Test Quản Trị Đổi Tên',
      description: 'Mô tả mới đã được cập nhật'
    });
    assert.strictEqual(updatedClan.name, 'CLB Test Quản Trị Đổi Tên', 'Tên CLB phải được cập nhật');
    console.log('✅ PASSED: Cập nhật thông tin CLB thành công.');

    // 8. Khai trừ thành viên
    await StudentService.kickMember(clan.id, 'TEST_LEADER', 'TEST_MEMBER');
    members = await StudentService.getClanMembers(clan.id);
    assert.strictEqual(members.length, 1, 'Sau khi kick, CLB chỉ còn 1 thành viên');
    console.log('✅ PASSED: Khai trừ thành viên ra khỏi CLB thành công.');

    // 9. Giải tán CLB
    await StudentService.disbandClan(clan.id, 'TEST_LEADER');
    const checkClan = await query('SELECT * FROM clans WHERE id = $1', [clan.id]);
    assert.strictEqual(checkClan.rows.length, 0, 'CLB phải bị xóa khỏi CSDL sau khi giải tán');
    console.log('✅ PASSED: Giải tán CLB thành công.');

    // Cleanup students
    await query("DELETE FROM students WHERE mssv IN ('TEST_LEADER', 'TEST_MEMBER', 'TEST_OWNER_001')");

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
