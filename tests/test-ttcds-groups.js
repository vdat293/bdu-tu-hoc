import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { TtcdsService, normalizeTtcdsMssv } from '../src/services/ttcds.service.js';
import { PermissionService, TITLE_CAPABILITIES_MAP } from '../src/services/permission.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const OWNER_MSSV = 'TEST_TTCDS_OWNER';
const OTHER_OWNER_MSSV = 'TEST_TTCDS_OTHER';
const LEVEL_MSSV = 'TEST_TTCDS_LEVEL';
const GATE_MSSV = 'TEST_TTCDS_GATE';
const REGULAR_MSSV = 'TEST_TTCDS_REGULAR';
const MEMBER_A = '22050006';
const MEMBER_B = '24050126';

async function cleanupTestData() {
  // ttcds_group_members xoá theo cascade khi xoá group.
  await query("DELETE FROM ttcds_groups WHERE owner_mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM ttcds_permissions WHERE mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM ttcds_audit_logs WHERE actor_mssv LIKE 'TEST_TTCDS%' OR target_mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM identity_entitlement_grants WHERE mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM system_roles WHERE mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM students WHERE mssv LIKE 'TEST_TTCDS%'");
}

async function runTtcdsGroupsTest() {
  console.log('🧪 Bắt đầu kiểm thử TtcdsService (groups/members/permissions)...');

  try {
    await cleanupTestData();

    console.log('--- [Test 1] Chuẩn hóa MSSV (UPPER-trim) ---');
    assert.equal(normalizeTtcdsMssv(' 24050126 '), '24050126');
    assert.equal(normalizeTtcdsMssv(' test_ttcds_level '), 'TEST_TTCDS_LEVEL');
    assert.equal(normalizeTtcdsMssv(''), '');
    assert.equal(normalizeTtcdsMssv(null), '');
    console.log('✅ PASSED: MSSV luôn được UPPER-trim.');

    console.log('--- [Test 2] createGroup + listGroups lọc theo owner ---');
    const group = await TtcdsService.createGroup({
      name: 'Các bé tân sinh viên K29',
      nienKhoa: 'K29',
      description: 'Nhóm quan tâm khóa 29',
      ownerMssv: OWNER_MSSV
    });
    assert.ok(group?.id, 'createGroup phải trả về group có id');
    assert.equal(group.name, 'Các bé tân sinh viên K29');
    assert.equal(group.nien_khoa, 'K29');
    assert.equal(group.owner_mssv, OWNER_MSSV);

    const ownGroups = await TtcdsService.listGroups(OWNER_MSSV);
    assert.equal(ownGroups.length, 1, 'Owner phải thấy đúng group của mình');
    assert.equal(ownGroups[0].id, group.id);
    assert.equal(Number(ownGroups[0].member_count), 0, 'Group mới chưa có thành viên');

    const otherOwnerGroups = await TtcdsService.listGroups(OTHER_OWNER_MSSV);
    assert.equal(otherOwnerGroups.length, 0, 'Owner khác KHÔNG được thấy group riêng tư');

    const adminGroups = await TtcdsService.listGroups(OTHER_OWNER_MSSV, { includeAll: true });
    assert.ok(adminGroups.some((item) => item.id === group.id), 'includeAll phải thấy mọi group');
    console.log('✅ PASSED: group riêng tư theo owner, includeAll cho admin.');

    console.log('--- [Test 2b] mentor: trim, absent → null, blank → null ---');
    const mentorGroup = await TtcdsService.createGroup({
      name: 'Nhóm mentor test',
      mentor: ' Thầy Đạt ',
      ownerMssv: OWNER_MSSV
    });
    assert.ok(mentorGroup?.id, 'createGroup có mentor phải trả về group có id');
    assert.equal(mentorGroup.mentor, 'Thầy Đạt', 'mentor phải được trim');
    const listedMentor = (await TtcdsService.listGroups(OWNER_MSSV))
      .find((item) => item.id === mentorGroup.id);
    assert.equal(listedMentor?.mentor, 'Thầy Đạt', 'listGroups phải trả mentor');

    const noMentorGroup = await TtcdsService.createGroup({
      name: 'Nhóm không mentor',
      ownerMssv: OWNER_MSSV
    });
    assert.equal(noMentorGroup.mentor, null, 'thiếu mentor phải thành NULL');

    const blankMentorGroup = await TtcdsService.createGroup({
      name: 'Nhóm mentor rỗng',
      mentor: '   ',
      ownerMssv: OWNER_MSSV
    });
    assert.equal(blankMentorGroup.mentor, null, "mentor rỗng/'   ' phải thành NULL");

    const longMentorGroup = await TtcdsService.createGroup({
      name: 'Nhóm mentor dài',
      mentor: ` ${'M'.repeat(150)} `,
      ownerMssv: OWNER_MSSV
    });
    assert.equal(longMentorGroup.mentor.length, 120, 'mentor tối đa 120 ký tự');
    console.log('✅ PASSED: mentor trim, absent/blank → null, tối đa 120 ký tự.');

    console.log('--- [Test 3] addMember chuẩn hóa MSSV + seed students ---');
    await TtcdsService.addMember(group.id, ` ${MEMBER_A} `, {
      addedBy: OWNER_MSSV,
      note: 'được giao chính thức'
    });
    await TtcdsService.addMember(group.id, `  ${MEMBER_B}  `, {
      addedBy: ` ${OWNER_MSSV} `,
      note: 'tự follow thêm'
    });
    // Thêm lại cùng SV với space/lowercase: không được nhân bản bản ghi.
    await TtcdsService.addMember(group.id, ` ${MEMBER_A} `, {
      addedBy: OWNER_MSSV,
      note: 'được giao chính thức'
    });

    const members = await TtcdsService.listMembers(group.id);
    assert.deepEqual(
      members.map((member) => member.mssv),
      [MEMBER_A, MEMBER_B],
      'listMembers phải chuẩn hóa UPPER và không nhân bản MSSV'
    );
    assert.equal(members[0].added_by_mssv, OWNER_MSSV);
    assert.equal(members[0].note, 'được giao chính thức');
    assert.ok(members[0].created_at, 'member phải có created_at');

    const seeded = await query('SELECT mssv FROM students WHERE mssv = ANY($1::varchar[])', [[MEMBER_A, MEMBER_B]]);
    assert.equal(seeded.rows.length, 2, 'addMember phải seed students trước khi thêm vào group');

    const groupsWithMembers = await TtcdsService.listGroups(OWNER_MSSV);
    const groupWithMembers = groupsWithMembers.find((item) => item.id === group.id);
    assert.equal(Number(groupWithMembers.member_count), 2, 'member_count phải đếm đúng thành viên');
    console.log('✅ PASSED: MSSV chuẩn hóa, không nhân bản, students được seed, member_count đúng.');

    console.log('--- [Test 4] removeMember trả về boolean và chuẩn hóa MSSV ---');
    assert.equal(await TtcdsService.removeMember(group.id, ` ${MEMBER_A} `), true);
    assert.equal(await TtcdsService.removeMember(group.id, MEMBER_A), false, 'Xoá lần hai phải trả về false');
    const membersAfterRemove = await TtcdsService.listMembers(group.id);
    assert.deepEqual(membersAfterRemove.map((member) => member.mssv), [MEMBER_B]);
    console.log('✅ PASSED: removeMember idempotent theo MSSV chuẩn hóa.');

    console.log("--- [Test 5] getLevel mặc định 'view' + setLevel ---");
    assert.equal(await TtcdsService.getLevel(LEVEL_MSSV), 'view', "Chưa có dòng quyền thì mặc định 'view'");

    const granted = await TtcdsService.setLevel({
      mssv: ` ${LEVEL_MSSV} `,
      level: 'create',
      grantedBy: OWNER_MSSV,
      note: 'giao phụ trách SV'
    });
    assert.equal(granted.mssv, LEVEL_MSSV);
    assert.equal(granted.level, 'create');
    assert.equal(granted.granted_by, OWNER_MSSV);
    assert.equal(await TtcdsService.getLevel(` ${LEVEL_MSSV} `), 'create');
    assert.equal(await TtcdsService.getLevel(OTHER_OWNER_MSSV), 'view');

    // granted_by cũng là MSSV: phải UPPER-trim như mọi MSSV khác.
    const regranted = await TtcdsService.setLevel({
      mssv: LEVEL_MSSV,
      level: 'create',
      grantedBy: '  test_grantor  ',
      note: 'cấp lại'
    });
    assert.equal(regranted.granted_by, 'TEST_GRANTOR', 'granted_by phải được UPPER-trim');

    await assert.rejects(
      () => TtcdsService.setLevel({ mssv: LEVEL_MSSV, level: 'admin', grantedBy: OWNER_MSSV }),
      /check constraint|ttcds_permissions/i,
      'level ngoài view/create phải bị CHECK constraint từ chối'
    );
    assert.equal(await TtcdsService.getLevel(LEVEL_MSSV), 'create', 'Level hợp lệ trước đó không bị đổi');

    // granted_by trắng vẫn phải thành NULL (không lưu chuỗi rỗng).
    const clearedGrantor = await TtcdsService.setLevel({
      mssv: LEVEL_MSSV,
      level: 'create',
      grantedBy: '   '
    });
    assert.equal(clearedGrantor.granted_by, null, 'granted_by trắng phải thành NULL');
    assert.equal(await TtcdsService.getLevel(LEVEL_MSSV), 'create');
    console.log('✅ PASSED: chỉ có view/create, mặc định view khi chưa cấp.');

    console.log("--- [Test 5b] Owner hệ thống luôn 'create' ---");
    const SYSOWNER_MSSV = 'TEST_TTCDS_SYSOWNER';
    await query(
      "INSERT INTO system_roles (mssv, role, is_active) VALUES ($1, 'owner', TRUE) ON CONFLICT DO NOTHING",
      [SYSOWNER_MSSV]
    );
    await query(`
      INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
      VALUES ($1, 'title:ttcds', 'manual', 'sysowner test grant')
      ON CONFLICT DO NOTHING;
    `, [SYSOWNER_MSSV]);
    await TtcdsService.setLevel({ mssv: SYSOWNER_MSSV, level: 'view', grantedBy: OWNER_MSSV });
    assert.equal(await TtcdsService.getLevel(SYSOWNER_MSSV), 'create', 'Owner hệ thống luôn create kể cả khi bị gán view');
    assert.equal(await TtcdsService.requireCreate(SYSOWNER_MSSV), true, 'requireCreate phải pass cho owner');
    console.log('✅ PASSED: owner hệ thống mặc định create.');

    console.log('--- [Test 6] Xoá group kéo theo thành viên (ON DELETE CASCADE) ---');
    await query('DELETE FROM ttcds_groups WHERE id = $1', [group.id]);
    const orphans = await query(
      'SELECT COUNT(*)::int AS count FROM ttcds_group_members WHERE group_id = $1',
      [group.id]
    );
    assert.equal(orphans.rows[0].count, 0, 'Xoá group phải xoá hết thành viên của group');
    assert.deepEqual(await TtcdsService.listMembers(group.id), []);
    console.log('✅ PASSED: cascade dọn sạch thành viên khi xoá group.');

    console.log('--- [Test 7] Gating ttcds:access + nấc view/create ---');
    // Map dự phòng phải phủ cả 3 id danh hiệu (title hiện tại + alias achievement/legacy).
    for (const titleId of ['title:ttcds', 'achievement:ttcds', 'ttcds']) {
      assert.ok(
        TITLE_CAPABILITIES_MAP[titleId]?.includes('ttcds:access'),
        `${titleId} phải map tới ttcds:access`
      );
    }

    // Cấp nametag #TTCDS cho GATE_MSSV (theo mẫu grant của tests/test-permission-rbac.js).
    // Metadata cố tình chỉ có clan:create để chứng minh map dự phòng cấp thêm ttcds:access.
    await query(`
      INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy, metadata)
      VALUES ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip', '{"capabilities":["clan:create"]}')
      ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, is_active = TRUE;
    `);
    await query(`
      INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
      VALUES ($1, 'title:ttcds', 'manual', 'gating test grant')
      ON CONFLICT DO NOTHING;
    `, [GATE_MSSV]);

    assert.equal(await PermissionService.can(GATE_MSSV, 'ttcds:access'), true, 'Có #TTCDS phải có ttcds:access');
    assert.equal(await PermissionService.can(GATE_MSSV, 'clan:create'), true, 'Có #TTCDS vẫn giữ clan:create');
    const ungrantedCanAccess = await PermissionService.can(REGULAR_MSSV, 'ttcds:access');
    assert.equal(ungrantedCanAccess, false, 'Không có nametag thì KHÔNG có ttcds:access');

    // requireAccess: thiếu nametag -> 403; còn nametag -> pass.
    await assert.rejects(
      () => TtcdsService.requireAccess(REGULAR_MSSV),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Trung tâm Chuyển đổi số/);
        return true;
      }
    );
    assert.equal(await TtcdsService.requireAccess(GATE_MSSV), true);

    // requireCreate: mặc định 'view' -> 403; sau setLevel 'create' -> pass.
    assert.equal(await TtcdsService.getLevel(GATE_MSSV), 'view', 'GATE user mặc định view trước khi cấp');
    await assert.rejects(
      () => TtcdsService.requireCreate(GATE_MSSV),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /không có quyền tạo nhóm/);
        return true;
      }
    );

    await TtcdsService.setLevel({ mssv: GATE_MSSV, level: 'create', grantedBy: OWNER_MSSV, note: 'gating test' });
    assert.equal(await TtcdsService.requireCreate(GATE_MSSV), true);

    // Thiếu nametag thì requireCreate phải chặn ngay từ cổng access (403).
    await assert.rejects(
      () => TtcdsService.requireCreate(REGULAR_MSSV),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Trung tâm Chuyển đổi số/);
        return true;
      }
    );
    console.log('✅ PASSED: ttcds:access + nấc view/create chặn đúng 403.');

    console.log('\n========================================================================');
    console.log('🎉 TẤT CẢ BÀI KIỂM THỬ TTCDS GROUPS ĐÃ ĐẠT!');
    console.log('========================================================================\n');
  } finally {
    await cleanupTestData();
    await closeDatabase();
  }
}

runTtcdsGroupsTest().catch((err) => {
  console.error('❌ Kiểm thử TtcdsService thất bại:', err);
  process.exit(1);
});
