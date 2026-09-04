import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { PermissionService } from '../src/services/permission.service.js';
import { StudentService } from '../src/services/student.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

async function runPermissionRbacTest() {
  console.log('🧪 Bắt đầu kiểm thử Hệ thống RBAC 3 Lớp & PermissionService...');

  const OWNER_MSSV = 'TEST_RBAC_OWNER';
  const TTCDS_MSSV = 'TEST_RBAC_TTCDS';
  const ADMIN_MSSV = 'TEST_RBAC_ADMIN';
  const REGULAR_MSSV = 'TEST_RBAC_REGULAR';
  const VICE_MSSV = 'TEST_RBAC_VICE';
  const MEMBER_MSSV = 'TEST_RBAC_MEMBER';

  const ALL_TEST_STUDENTS = [
    OWNER_MSSV,
    TTCDS_MSSV,
    ADMIN_MSSV,
    REGULAR_MSSV,
    VICE_MSSV,
    MEMBER_MSSV
  ];

  let testClanId = null;

  try {
    // 0. Dọn dẹp dữ liệu cũ nếu có
    await query('DELETE FROM students WHERE mssv = ANY($1)', [ALL_TEST_STUDENTS]);
    await query('DELETE FROM system_roles WHERE mssv = ANY($1)', [ALL_TEST_STUDENTS]);
    await query("DELETE FROM clans WHERE code LIKE 'CLB_RBAC_TEST_%'");

    for (const mssv of ALL_TEST_STUDENTS) {
      await StudentService.recordLogin(mssv, `Tên ${mssv}`);
    }

    // Gán role owner cho OWNER_MSSV trong system_roles
    await query(`
      INSERT INTO system_roles (mssv, role, is_active)
      VALUES ($1, 'owner', TRUE);
    `, [OWNER_MSSV]);

    // Gán role identity_admin cho ADMIN_MSSV
    await query(`
      INSERT INTO system_roles (mssv, role, is_active)
      VALUES ($1, 'identity_admin', TRUE);
    `, [ADMIN_MSSV]);

    // Cấp nametag #TTCDS cho TTCDS_MSSV
    await query(`
      INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy, metadata)
      VALUES ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip', '{"capabilities":["clan:create"]}')
      ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;
    `);
    await query(`
      INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
      VALUES ($1, 'title:ttcds', 'manual', 'RBAC test grant')
      ON CONFLICT DO NOTHING;
    `, [TTCDS_MSSV]);

    console.log('--- [Test 1] Kiểm thử Quyền Quản trị viên Tối cao (Owner) ---');
    const isOwner = await PermissionService.isSystemOwner(OWNER_MSSV);
    assert.equal(isOwner, true, 'OWNER_MSSV phải là System Owner');

    const isNotOwner = await PermissionService.isSystemOwner(REGULAR_MSSV);
    assert.equal(isNotOwner, false, 'REGULAR_MSSV không được là System Owner');

    // Owner có quyền wildcard '*' -> match mọi capability
    const ownerCanAny = await PermissionService.can(OWNER_MSSV, 'clan:create');
    const ownerCanRandom = await PermissionService.can(OWNER_MSSV, 'system:super_power');
    assert.equal(ownerCanAny, true, 'Owner phải có quyền clan:create');
    assert.equal(ownerCanRandom, true, 'Owner có wildcard * nên match mọi quyền');
    console.log('✅ PASSED: System Owner sở hữu toàn quyền hệ thống (*).');

    console.log('--- [Test 2] Kiểm thử Quyền Nametag (#TTCDS) ---');
    const ttcdsCanCreate = await PermissionService.can(TTCDS_MSSV, 'clan:create');
    const regularCanCreate = await PermissionService.can(REGULAR_MSSV, 'clan:create');
    assert.equal(ttcdsCanCreate, true, 'Sinh viên sở hữu #TTCDS phải có quyền clan:create');
    assert.equal(regularCanCreate, false, 'Sinh viên thường không có quyền clan:create');
    console.log('✅ PASSED: Nametag #TTCDS cấp chính xác capability clan:create.');

    console.log('--- [Test 3] Kiểm thử Phân quyền System Roles (identity_admin) ---');
    const adminCanGrant = await PermissionService.can(ADMIN_MSSV, 'identity:grant');
    const adminCanRevoke = await PermissionService.can(ADMIN_MSSV, 'identity:revoke');
    const adminCannotCreateClan = await PermissionService.can(ADMIN_MSSV, 'clan:create');
    assert.equal(adminCanGrant, true, 'identity_admin có quyền identity:grant');
    assert.equal(adminCanRevoke, true, 'identity_admin có quyền identity:revoke');
    assert.equal(adminCannotCreateClan, false, 'identity_admin thuần túy không có quyền clan:create');
    console.log('✅ PASSED: System Role identity_admin hoạt động chuẩn xác.');

    console.log('--- [Test 4] Kiểm thử Quyền ngữ cảnh CLB (Clan-level Capabilities) ---');
    // Tạo CLB với TTCDS_MSSV làm Leader
    const clan = await StudentService.createClan({
      code: 'CLB_RBAC_TEST_' + Date.now(),
      name: 'CLB Test RBAC',
      leaderMssv: TTCDS_MSSV,
      enforcePermission: true
    });
    testClanId = clan.id;

    // Thêm VICE_MSSV và MEMBER_MSSV vào CLB
    await StudentService.joinClan(VICE_MSSV, testClanId);
    await StudentService.joinClan(MEMBER_MSSV, testClanId);

    // Set VICE_MSSV thành vice_leader
    await query("UPDATE student_clans SET role = 'vice_leader' WHERE clan_id = $1 AND mssv = $2", [testClanId, VICE_MSSV]);

    // 4.1. Kiểm tra Leader
    const leaderCanEdit = await PermissionService.canInClan(TTCDS_MSSV, testClanId, 'clan:edit');
    const leaderCanDisband = await PermissionService.canInClan(TTCDS_MSSV, testClanId, 'clan:disband');
    const leaderCanAssign = await PermissionService.canInClan(TTCDS_MSSV, testClanId, 'clan:role_assign');
    const leaderCanReview = await PermissionService.canInClan(TTCDS_MSSV, testClanId, 'clan:review_join');
    const leaderCanPin = await PermissionService.canInClan(TTCDS_MSSV, testClanId, 'clan:post_pin');
    assert.equal(leaderCanEdit, true);
    assert.equal(leaderCanDisband, true);
    assert.equal(leaderCanAssign, true);
    assert.equal(leaderCanReview, true);
    assert.equal(leaderCanPin, true);
    console.log('✅ PASSED: Trưởng CLB (leader) sở hữu toàn quyền quản trị CLB (clan:*).');

    // 4.2. Kiểm tra Vice Leader
    const viceCanReview = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:review_join');
    const viceCanKick = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:kick');
    const viceCanPin = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:post_pin');
    const viceCanAnnounce = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:announcement_create');
    const viceCannotDisband = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:disband');
    const viceCannotAssign = await PermissionService.canInClan(VICE_MSSV, testClanId, 'clan:role_assign');
    assert.equal(viceCanReview, true, 'Phó Bang có quyền duyệt đơn');
    assert.equal(viceCanKick, true, 'Phó Bang có quyền kick thành viên');
    assert.equal(viceCanPin, true, 'Phó Bang có quyền ghim bài');
    assert.equal(viceCanAnnounce, true, 'Phó Bang có quyền đăng thông báo');
    assert.equal(viceCannotDisband, false, 'Phó Bang KHÔNG có quyền giải tán CLB');
    assert.equal(viceCannotAssign, false, 'Phó Bang KHÔNG có quyền phân quyền trưởng/phó');
    console.log('✅ PASSED: Phó Bang (vice_leader) có quyền duyệt đơn, ghim bài nhưng không có quyền giải tán CLB.');

    // 4.3. Kiểm tra Member
    const memberCanPost = await PermissionService.canInClan(MEMBER_MSSV, testClanId, 'clan:post_create');
    const memberCanVote = await PermissionService.canInClan(MEMBER_MSSV, testClanId, 'clan:poll_vote');
    const memberCannotReview = await PermissionService.canInClan(MEMBER_MSSV, testClanId, 'clan:review_join');
    const memberCannotKick = await PermissionService.canInClan(MEMBER_MSSV, testClanId, 'clan:kick');
    const memberCannotPin = await PermissionService.canInClan(MEMBER_MSSV, testClanId, 'clan:post_pin');
    assert.equal(memberCanPost, true, 'Thành viên được đăng bài');
    assert.equal(memberCanVote, true, 'Thành viên được bình chọn');
    assert.equal(memberCannotReview, false, 'Thành viên thường không được duyệt đơn');
    assert.equal(memberCannotKick, false, 'Thành viên thường không được kick');
    assert.equal(memberCannotPin, false, 'Thành viên thường không được ghim');
    console.log('✅ PASSED: Thành viên (member) chỉ có quyền sinh hoạt nội bộ (đăng bài, vote).');

    // 4.4. Kiểm tra Owner kế thừa toàn bộ quyền trong CLB
    const ownerCanReviewInClan = await PermissionService.canInClan(OWNER_MSSV, testClanId, 'clan:review_join');
    assert.equal(ownerCanReviewInClan, true, 'System Owner tự động có quyền trong mọi CLB');
    console.log('✅ PASSED: System Owner có thẩm quyền tối cao kế thừa mọi quyền trong CLB.');

    console.log('--- [Test 5] Kiểm thử require và requireInClan (Ném lỗi 403) ---');
    await assert.rejects(
      async () => {
        await PermissionService.require(REGULAR_MSSV, 'clan:create', 'Không có quyền tạo CLB');
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Không có quyền tạo CLB/);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await PermissionService.requireInClan(MEMBER_MSSV, testClanId, 'clan:disband', 'Không có quyền giải tán');
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Không có quyền giải tán/);
        return true;
      }
    );
    console.log('✅ PASSED: require và requireInClan ném mã HTTP 403 đúng chuẩn.');

    console.log('--- [Test 6] Kiểm thử getEffectiveCapabilities ---');
    const leaderCaps = await PermissionService.getEffectiveCapabilities(TTCDS_MSSV, testClanId);
    assert.ok(Array.isArray(leaderCaps));
    assert.ok(leaderCaps.includes('clan:create'));
    assert.ok(leaderCaps.includes('clan:review_join'));

    const viceCaps = await PermissionService.getEffectiveCapabilities(VICE_MSSV, testClanId);
    assert.ok(viceCaps.includes('clan:review_join'));
    assert.ok(viceCaps.includes('clan:kick'));
    assert.equal(viceCaps.includes('clan:disband'), false);
    console.log('✅ PASSED: getEffectiveCapabilities tổng hợp đầy đủ danh sách quyền.');

    console.log('\n========================================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ PERMISSION SERVICE & RBAC ĐÃ ĐẠT 100%!');
    console.log('========================================================================\n');
  } finally {
    // Dọn dẹp
    if (testClanId) {
      await query('DELETE FROM clans WHERE id = $1', [testClanId]);
    }
    await query('DELETE FROM students WHERE mssv = ANY($1)', [ALL_TEST_STUDENTS]);
    await query('DELETE FROM system_roles WHERE mssv = ANY($1)', [ALL_TEST_STUDENTS]);
    await closeDatabase();
  }
}

runPermissionRbacTest().catch((err) => {
  console.error('❌ Kiểm thử RBAC thất bại:', err);
  process.exit(1);
});
