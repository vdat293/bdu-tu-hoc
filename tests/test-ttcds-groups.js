import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { TtcdsService, normalizeTtcdsMssv } from '../src/services/ttcds.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const OWNER_MSSV = 'TEST_TTCDS_OWNER';
const OTHER_OWNER_MSSV = 'TEST_TTCDS_OTHER';
const LEVEL_MSSV = 'TEST_TTCDS_LEVEL';
const MEMBER_A = '22050006';
const MEMBER_B = '24050126';

async function cleanupTestData() {
  // ttcds_group_members xoá theo cascade khi xoá group.
  await query("DELETE FROM ttcds_groups WHERE owner_mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM ttcds_permissions WHERE mssv LIKE 'TEST_TTCDS%'");
  await query("DELETE FROM ttcds_audit_logs WHERE actor_mssv LIKE 'TEST_TTCDS%' OR target_mssv LIKE 'TEST_TTCDS%'");
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
    assert.equal(Number(groupsWithMembers[0].member_count), 2, 'member_count phải đếm đúng thành viên');
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

    await assert.rejects(
      () => TtcdsService.setLevel({ mssv: LEVEL_MSSV, level: 'admin', grantedBy: OWNER_MSSV }),
      /check constraint|ttcds_permissions/i,
      'level ngoài view/create phải bị CHECK constraint từ chối'
    );
    assert.equal(await TtcdsService.getLevel(LEVEL_MSSV), 'create', 'Level hợp lệ trước đó không bị đổi');
    console.log('✅ PASSED: chỉ có view/create, mặc định view khi chưa cấp.');

    console.log('--- [Test 6] Xoá group kéo theo thành viên (ON DELETE CASCADE) ---');
    await query('DELETE FROM ttcds_groups WHERE id = $1', [group.id]);
    const orphans = await query(
      'SELECT COUNT(*)::int AS count FROM ttcds_group_members WHERE group_id = $1',
      [group.id]
    );
    assert.equal(orphans.rows[0].count, 0, 'Xoá group phải xoá hết thành viên của group');
    assert.deepEqual(await TtcdsService.listMembers(group.id), []);
    console.log('✅ PASSED: cascade dọn sạch thành viên khi xoá group.');

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
