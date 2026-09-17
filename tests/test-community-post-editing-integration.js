import assert from 'node:assert/strict';
import '../src/config/load-env.js';
import { closeDatabase, query, isDatabaseConfigured } from '../src/db/database.js';
import { CommunityService } from '../src/services/community.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping: DATABASE_URL not configured.');
  process.exit(0);
}

const AUTHOR = 'TEST_POST_EDIT_AUTHOR';
const OTHER = 'TEST_POST_EDIT_OTHER';
const OWNER = String(process.env.SYSTEM_OWNER_MSSV || '').trim().toUpperCase();
let postId = null;

try {
  assert.ok(OWNER, 'SYSTEM_OWNER_MSSV phải được cấu hình để chạy kiểm thử này.');
  for (const mssv of [AUTHOR, OTHER, OWNER]) {
    await query(`INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE) ON CONFLICT (mssv) DO NOTHING`, [mssv]);
  }

  const created = await CommunityService.createPost({
    authorMssv: AUTHOR,
    title: 'BDU Confession kiểm thử',
    content: 'Nội dung gốc',
    scope: 'school',
    category: 'confession',
    isAnonymous: true,
    attachments: []
  });
  postId = String(created.id);

  // 1. Người khác không phải tác giả/quản trị viên: bị chặn.
  const otherFlags = await CommunityService.getPostById(postId, OTHER);
  assert.equal(otherFlags.can_edit, false, 'Người khác không được phép sửa.');
  assert.equal(otherFlags.can_delete, false, 'Người khác không được phép xoá.');
  await assert.rejects(
    () => CommunityService.updatePost({ postId, requesterMssv: OTHER, content: 'Sửa lén' }),
    (err) => err.status === 403
  );

  // 2. Quản trị viên SYSTEM_OWNER_MSSV: sửa mọi bài, kể cả bài ẩn danh.
  const ownerFlags = await CommunityService.getPostById(postId, OWNER);
  assert.equal(ownerFlags.can_edit, true, 'Quản trị viên phải sửa được mọi bài.');
  assert.equal(ownerFlags.can_delete, true, 'Quản trị viên phải xoá được mọi bài.');

  const updated = await CommunityService.updatePost({
    postId,
    requesterMssv: OWNER,
    title: 'Tiêu đề quản trị viên sửa',
    content: 'Nội dung quản trị viên sửa',
    isAnonymous: false
  });
  assert.equal(updated.content, 'Nội dung quản trị viên sửa');
  assert.equal(updated.title, 'Tiêu đề quản trị viên sửa');
  assert.equal(updated.is_anonymous, false, 'Quản trị viên đổi được trạng thái ẩn danh.');
  assert.ok(updated.edited_at, 'edited_at phải được ghi nhận.');

  // 3. Tác giả vẫn sửa được bài của mình.
  const authorUpdate = await CommunityService.updatePost({
    postId,
    requesterMssv: AUTHOR,
    content: 'Tác giả tự sửa'
  });
  assert.equal(authorUpdate.content, 'Tác giả tự sửa');
  assert.equal(authorUpdate.title, 'Tiêu đề quản trị viên sửa', 'Không truyền title thì giữ nguyên.');

  // 4. Kiểm tra cờ trong danh sách bài viết.
  const ownerFeed = await CommunityService.getPosts({ scope: 'forum', viewerMssv: OWNER, limit: 100 });
  const ownerRow = ownerFeed.posts.find((item) => String(item.id) === postId);
  assert.ok(ownerRow?.can_edit && ownerRow?.can_delete, 'Feed của quản trị viên phải bật cờ sửa/xoá.');
  assert.ok(ownerRow?.edited_at, 'Feed phải trả về edited_at.');

  const otherFeed = await CommunityService.getPosts({ scope: 'forum', viewerMssv: OTHER, limit: 100 });
  const otherRow = otherFeed.posts.find((item) => String(item.id) === postId);
  assert.equal(otherRow?.can_edit, false);
  assert.equal(otherRow?.can_delete, false);

  // 5. Quản trị viên xoá bài viết.
  const deleted = await CommunityService.deletePost(postId, OWNER);
  assert.equal(deleted.deleted, true);
  const afterDelete = await CommunityService.getPostById(postId, OWNER);
  assert.equal(afterDelete, null, 'Bài đã xoá không còn truy cập được.');

  console.log('✓ Quản trị viên SYSTEM_OWNER_MSSV sửa/xoá mọi Confession; tác giả giữ quyền của mình.');
} finally {
  if (postId) await query('DELETE FROM community_posts WHERE id = $1', [postId]).catch(() => {});
  await query('DELETE FROM students WHERE mssv = ANY($1::text[])', [[AUTHOR, OTHER]]).catch(() => {});
  await closeDatabase();
}
