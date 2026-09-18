import assert from 'node:assert/strict';
import '../src/config/load-env.js';
import { closeDatabase, query, isDatabaseConfigured } from '../src/db/database.js';
import { CommunityService } from '../src/services/community.service.js';
import { PermissionService } from '../src/services/permission.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-confession-delete-hierarchy: DATABASE_URL not configured.');
  process.exit(0);
}

const MOD_A = 'TEST_CFS_MOD_A';
const MOD_B = 'TEST_CFS_MOD_B';
const ADMIN = 'TEST_CFS_ADMIN';
const ADMIN2 = 'TEST_CFS_ADMIN2';
const REGULAR = 'TEST_CFS_REGULAR';
const OWNER = String(process.env.SYSTEM_OWNER_MSSV || '').trim().toUpperCase();
const TEST_MSSVS = [MOD_A, MOD_B, ADMIN, ADMIN2, REGULAR, OWNER].filter(Boolean);

async function createConfession(authorMssv, title, category = 'confession') {
  const post = await CommunityService.createPost({
    authorMssv,
    title,
    content: `Nội dung ${title}`,
    scope: 'school',
    category,
    isAnonymous: true,
    attachments: []
  });
  return String(post.id);
}

try {
  assert.ok(OWNER, 'SYSTEM_OWNER_MSSV phải được cấu hình để chạy kiểm thử này.');

  console.log('🧪 Bắt đầu kiểm thử thứ bậc role khi xoá bài Confession...');

  await query('DELETE FROM community_posts WHERE author_mssv = ANY($1::text[])', [TEST_MSSVS]);
  await query('DELETE FROM system_roles WHERE mssv = ANY($1::text[])', [TEST_MSSVS]);
  await query('DELETE FROM students WHERE mssv = ANY($1::text[])', [TEST_MSSVS]);
  for (const mssv of TEST_MSSVS) {
    await query(`INSERT INTO students (mssv, full_name, is_active) VALUES ($1, $2, TRUE)`, [mssv, mssv]);
  }
  await query(`
    INSERT INTO system_roles (mssv, role, is_active) VALUES
      ($1, 'moderator', TRUE),
      ($2, 'moderator', TRUE),
      ($3, 'identity_admin', TRUE),
      ($4, 'identity_admin', TRUE);
  `, [MOD_A, MOD_B, ADMIN, ADMIN2]);

  console.log('--- [Test 1] Cấp bậc role hệ thống ---');
  const levels = await PermissionService.getSystemRoleLevels(TEST_MSSVS);
  assert.equal(levels.get(MOD_A), 1, 'moderator phải có cấp 1');
  assert.equal(levels.get(ADMIN), 2, 'identity_admin phải có cấp 2');
  assert.equal(levels.get(REGULAR), 0, 'sinh viên thường phải có cấp 0');
  assert.equal(levels.get(OWNER), 3, 'SYSTEM_OWNER_MSSV phải có cấp 3');
  console.log('✅ PASSED: Cấp bậc owner > identity_admin > moderator > sinh viên.');

  const postModB = await createConfession(MOD_B, 'Confession của Mod B');
  const postModA = await createConfession(MOD_A, 'Confession của Mod A');
  const postAdmin = await createConfession(ADMIN, 'Confession của Admin');
  const postAdmin2 = await createConfession(ADMIN2, 'Confession của Admin 2');
  const postRegular = await createConfession(REGULAR, 'Confession sinh viên thường');
  const postDiscussion = await createConfession(MOD_B, 'Bài thảo luận của Mod B', 'discussion');

  console.log('--- [Test 2] Moderator không xoá được bài của Moderator khác ---');
  const modBFlags = await CommunityService.getPostById(postModB, MOD_A);
  assert.equal(modBFlags.can_delete, false, 'Mod A không được thấy nút xoá bài của Mod B.');
  await assert.rejects(
    () => CommunityService.deletePost(postModB, MOD_A),
    (error) => error?.status === 403
  );
  console.log('✅ PASSED: Cùng cấp moderator không xoá bài nhau.');

  console.log('--- [Test 3] Moderator xoá được bài sinh viên thường ---');
  const regularFlags = await CommunityService.getPostById(postRegular, MOD_A);
  assert.equal(regularFlags.can_delete, true, 'Mod A phải xoá được bài sinh viên thường.');
  const deletedRegular = await CommunityService.deletePost(postRegular, MOD_A);
  assert.equal(deletedRegular.deleted, true);
  assert.equal(await CommunityService.getPostById(postRegular, MOD_A), null);
  console.log('✅ PASSED: Moderator xoá được bài cấp thấp hơn.');

  console.log('--- [Test 4] identity_admin xoá được bài moderator, không xoá bài cùng cấp ---');
  const adminFlags = await CommunityService.getPostById(postModB, ADMIN);
  assert.equal(adminFlags.can_delete, true, 'identity_admin phải xoá được bài moderator.');
  const deletedModB = await CommunityService.deletePost(postModB, ADMIN);
  assert.equal(deletedModB.deleted, true);
  await assert.rejects(
    () => CommunityService.deletePost(postAdmin2, ADMIN),
    (error) => error?.status === 403
  );
  console.log('✅ PASSED: identity_admin xoá bài cấp thấp, chặn cùng cấp.');

  console.log('--- [Test 5] Owner xoá được mọi bài và không bị chặn bởi thứ bậc ---');
  const ownerFlags = await CommunityService.getPostById(postAdmin2, OWNER);
  assert.equal(ownerFlags.can_delete, true, 'Owner phải xoá được bài identity_admin.');
  const deletedByOwner = await CommunityService.deletePost(postAdmin2, OWNER);
  assert.equal(deletedByOwner.deleted, true);
  const deletedAdminByOwner = await CommunityService.deletePost(postAdmin, OWNER);
  assert.equal(deletedAdminByOwner.deleted, true);
  console.log('✅ PASSED: Owner xoá được mọi bài Confession.');

  console.log('--- [Test 6] Bài ngoài confession giữ quy tắc kiểm duyệt cũ ---');
  const discussionFlags = await CommunityService.getPostById(postDiscussion, MOD_A);
  assert.equal(discussionFlags.can_delete, true, 'Bài discussion không áp thứ bậc.');
  const deletedDiscussion = await CommunityService.deletePost(postDiscussion, MOD_A);
  assert.equal(deletedDiscussion.deleted, true);
  console.log('✅ PASSED: Chỉ confession áp dụng thứ bậc role.');

  console.log('--- [Test 7] Tác giả luôn xoá được bài của mình ---');
  const deletedOwn = await CommunityService.deletePost(postModA, MOD_A);
  assert.equal(deletedOwn.deleted, true);
  console.log('✅ PASSED: Tác giả giữ quyền xoá bài của mình.');

  console.log('--- [Test 8] Cờ can_delete trong feed khớp với quyền xoá ---');
  const flagsPostModB = await createConfession(MOD_B, 'Confession kiểm tra feed Mod B');
  const flagsPostRegular = await createConfession(REGULAR, 'Confession kiểm tra feed thường');
  const feed = await CommunityService.getPosts({ scope: 'school', category: 'confession', viewerMssv: MOD_A, limit: 100 });
  const rowModB = feed.posts.find((item) => String(item.id) === flagsPostModB);
  const rowRegular = feed.posts.find((item) => String(item.id) === flagsPostRegular);
  assert.equal(rowModB?.can_delete, false, 'Feed phải tắt cờ xoá với bài cùng cấp.');
  assert.equal(rowRegular?.can_delete, true, 'Feed phải bật cờ xoá với bài cấp thấp hơn.');

  console.log('\n🎉 TẤT CẢ BÀI KIỂM THỬ THỨ BẬC XOÁ CONFESSION ĐỀU THÀNH CÔNG!');
} finally {
  await query('DELETE FROM community_posts WHERE author_mssv = ANY($1::text[])', [TEST_MSSVS]).catch(() => {});
  await query('DELETE FROM system_roles WHERE mssv = ANY($1::text[])', [TEST_MSSVS]).catch(() => {});
  await query('DELETE FROM students WHERE mssv = ANY($1::text[])', [TEST_MSSVS]).catch(() => {});
  await closeDatabase();
}
