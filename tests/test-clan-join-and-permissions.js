import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { StudentService } from '../src/services/student.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

async function runTest() {
  console.log('🧪 Bắt đầu kiểm thử Phân quyền Tạo CLB (#TTCDS) & Duyệt Yêu Cầu Gia Nhập...');

  const LEADER_MSSV = 'TEST_TTCDS_LEADER';
  const NON_VIP_MSSV = 'TEST_REGULAR_STUDENT';
  const APPLICANT_MSSV = 'TEST_APPLICANT_STUDENT';
  const CANCEL_MSSV = 'TEST_CANCEL_STUDENT';

  try {
    // 0. Dọn dẹp dữ liệu test cũ
    await query('DELETE FROM students WHERE mssv IN ($1, $2, $3, $4)', [LEADER_MSSV, NON_VIP_MSSV, APPLICANT_MSSV, CANCEL_MSSV]);
    await query("DELETE FROM clans WHERE code LIKE 'CLB_TEST_PERM_%'");

    await StudentService.recordLogin(LEADER_MSSV, 'Trưởng CLB TTCDS');
    await StudentService.recordLogin(NON_VIP_MSSV, 'Sinh Viên Thường');
    await StudentService.recordLogin(APPLICANT_MSSV, 'Sinh Viên Xin Gia Nhập');
    await StudentService.recordLogin(CANCEL_MSSV, 'Sinh Viên Hủy Đơn');

    // 1. Kiểm thử canCreateClan cho sinh viên chưa có danh hiệu #TTCDS
    console.log('--- [Test 1] Sinh viên không có #TTCDS không được tạo CLB ---');
    const regularCanCreate = await StudentService.canCreateClan(NON_VIP_MSSV);
    assert.equal(regularCanCreate, false, 'Sinh viên thường không được phép tạo CLB');

    await assert.rejects(
      async () => {
        await StudentService.createClan({
          code: 'CLB_TEST_PERM_FAIL',
          name: 'CLB Tạo Lỗi',
          leaderMssv: NON_VIP_MSSV,
          enforcePermission: true
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /#TTCDS/);
        return true;
      },
      'Phải chặn tạo CLB với mã lỗi 403'
    );
    console.log('✅ PASSED: Chặn tạo CLB đối với sinh viên không có nametag #TTCDS thành công.');

    // 2. Cấp danh hiệu #TTCDS cho LEADER_MSSV và tạo CLB
    console.log('--- [Test 2] Cấp nametag #TTCDS và tạo CLB thành công ---');
    // Đảm bảo item title:ttcds tồn tại trong identity_items
    await query(`
      INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy)
      VALUES ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Cấp quyền cho LEADER_MSSV
    await query(`
      INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
      VALUES ($1, 'title:ttcds', 'manual', 'Test grant #TTCDS')
      ON CONFLICT DO NOTHING;
    `, [LEADER_MSSV]);

    const leaderCanCreate = await StudentService.canCreateClan(LEADER_MSSV);
    assert.equal(leaderCanCreate, true, 'Sinh viên có #TTCDS phải được phép tạo CLB');

    const clan = await StudentService.createClan({
      code: 'CLB_TEST_PERM_' + Date.now(),
      name: 'CLB Lập Trình Chuyển Đổi Số',
      tag: '[TTCDS]',
      description: 'CLB sinh hoạt chuyên môn lập trình',
      leaderMssv: LEADER_MSSV,
      enforcePermission: true
    });
    assert.ok(clan && clan.id, 'Phải tạo được CLB');
    assert.equal(clan.leader_mssv, LEADER_MSSV);
    console.log('✅ PASSED: Sinh viên có nametag #TTCDS tạo CLB thành công.');

    // 3. Gửi yêu cầu xin tham gia CLB (requestJoinClan)
    console.log('--- [Test 3] Sinh viên gửi yêu cầu xin gia nhập CLB ---');
    const joinReq = await StudentService.requestJoinClan(APPLICANT_MSSV, clan.id, 'Em chào anh/chị, em xin vào CLB để học hỏi!');
    assert.ok(joinReq && joinReq.id, 'Phải tạo được bản ghi join request');
    assert.equal(joinReq.status, 'pending', 'Trạng thái ban đầu phải là pending');
    assert.equal(joinReq.mssv, APPLICANT_MSSV);
    assert.equal(joinReq.clan_id, clan.id);

    // Thử gửi lại yêu cầu khi đang pending -> phải bị chặn
    await assert.rejects(
      async () => {
        await StudentService.requestJoinClan(APPLICANT_MSSV, clan.id);
      },
      (err) => {
        assert.match(err.message, /đang chờ Trưởng CLB phê duyệt/);
        return true;
      },
      'Không được gửi yêu cầu trùng khi đang pending'
    );
    console.log('✅ PASSED: Gửi yêu cầu gia nhập và ngăn chặn yêu cầu trùng lặp thành công.');

    // 4. Kiểm tra quyền xem danh sách yêu cầu (Chỉ Trưởng CLB mới được xem)
    console.log('--- [Test 4] Phân quyền xem danh sách yêu cầu chờ duyệt ---');
    await assert.rejects(
      async () => {
        await StudentService.getPendingJoinRequests(clan.id, NON_VIP_MSSV);
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Chỉ Trưởng CLB/);
        return true;
      },
      'Người không phải leader không được xem yêu cầu'
    );

    const leaderPendingList = await StudentService.getPendingJoinRequests(clan.id, LEADER_MSSV);
    assert.equal(leaderPendingList.length, 1, 'Trưởng CLB phải thấy 1 yêu cầu chờ duyệt');
    assert.equal(leaderPendingList[0].mssv, APPLICANT_MSSV);
    assert.equal(leaderPendingList[0].status, 'pending');
    console.log('✅ PASSED: Phân quyền xem danh sách yêu cầu chờ duyệt chuẩn xác.');

    // 5. Trưởng CLB Từ Chối (Reject) yêu cầu
    console.log('--- [Test 5] Trưởng CLB từ chối yêu cầu gia nhập ---');
    const rejectRes = await StudentService.reviewJoinRequest(clan.id, LEADER_MSSV, joinReq.id, 'reject');
    assert.equal(rejectRes.success, true);
    assert.equal(rejectRes.status, 'rejected');

    // Kiểm tra thành viên không được thêm vào student_clans
    let members = await StudentService.getClanMembers(clan.id);
    assert.equal(members.some(m => m.mssv === APPLICANT_MSSV), false, 'Thành viên bị từ chối không được vào nhóm');
    console.log('✅ PASSED: Từ chối yêu cầu gia nhập thành công.');

    // 6. Gửi lại yêu cầu và Trưởng CLB Phê Duyệt (Approve)
    console.log('--- [Test 6] Gửi lại yêu cầu và Trưởng CLB phê duyệt ---');
    const secondReq = await StudentService.requestJoinClan(APPLICANT_MSSV, clan.id, 'Em xin gửi lại đơn!');
    assert.equal(secondReq.status, 'pending');

    const approveRes = await StudentService.reviewJoinRequest(clan.id, LEADER_MSSV, secondReq.id, 'approve');
    assert.equal(approveRes.success, true);
    assert.equal(approveRes.status, 'approved');

    members = await StudentService.getClanMembers(clan.id);
    const approvedMember = members.find(m => m.mssv === APPLICANT_MSSV);
    assert.ok(approvedMember, 'Thành viên được duyệt phải xuất hiện trong danh sách thành viên');
    assert.equal(approvedMember.role, 'member', 'Vai trò thành viên mới phải là member');

    // Đã là thành viên mà xin gia nhập tiếp -> bị chặn
    await assert.rejects(
      async () => {
        await StudentService.requestJoinClan(APPLICANT_MSSV, clan.id);
      },
      (err) => {
        assert.match(err.message, /đã là thành viên/);
        return true;
      }
    );
    console.log('✅ PASSED: Phê duyệt thành viên vào CLB thành công.');

    // 7. Sinh viên tự hủy yêu cầu gia nhập (cancelJoinRequest)
    console.log('--- [Test 7] Sinh viên tự hủy yêu cầu gia nhập ---');
    const cancelReq = await StudentService.requestJoinClan(CANCEL_MSSV, clan.id);
    assert.equal(cancelReq.status, 'pending');

    const cancelled = await StudentService.cancelJoinRequest(CANCEL_MSSV, clan.id);
    assert.equal(cancelled, true, 'Hủy yêu cầu phải thành công');

    const checkPending = await StudentService.getPendingJoinRequests(clan.id, LEADER_MSSV);
    assert.equal(checkPending.some(r => r.mssv === CANCEL_MSSV), false, 'Yêu cầu bị hủy không còn trong danh sách chờ duyệt');
    console.log('✅ PASSED: Hủy yêu cầu gia nhập thành công.');

    // 8. Kiểm tra listClans trả về has_pending_request
    console.log('--- [Test 8] Kiểm tra trường has_pending_request và pending_request_count trong listClans ---');
    const viewerClans = await StudentService.listClans(APPLICANT_MSSV);
    const targetClan = viewerClans.find(c => c.id === clan.id);
    assert.ok(targetClan);
    assert.equal(targetClan.is_joined, true);

    const leaderClans = await StudentService.listClans(LEADER_MSSV);
    const leaderClanView = leaderClans.find(c => c.id === clan.id);
    assert.ok(leaderClanView);
    assert.equal(leaderClanView.my_role, 'leader');
    console.log('✅ PASSED: Danh bạ CLB hiển thị chính xác vai trò và cờ trạng thái.');

    // Cleanup
    await query('DELETE FROM students WHERE mssv IN ($1, $2, $3, $4)', [LEADER_MSSV, NON_VIP_MSSV, APPLICANT_MSSV, CANCEL_MSSV]);
    await query('DELETE FROM clans WHERE id = $1', [clan.id]);

    console.log('\n========================================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ PHÂN QUYỀN TẠO CLB VÀ DUYỆT GIA NHẬP ĐỀU ĐẠT 100%!');
    console.log('========================================================================\n');
  } finally {
    await closeDatabase();
  }
}

runTest().catch(err => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
