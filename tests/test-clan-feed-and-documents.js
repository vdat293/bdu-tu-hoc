import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { StudentService } from '../src/services/student.service.js';
import { CommunityService } from '../src/services/community.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test-clan-feed-and-documents: DATABASE_URL not configured.');
  process.exit(0);
}

try {
  console.log('🧪 Bắt đầu kiểm thử Bản Tin CLB & Kho Tài Liệu (Group + Confessions logic)...');

  const MSSV_LEADER = 'TEST_CLAN_LEADER_99';
  const MSSV_VICE = 'TEST_CLAN_VICE_99';
  const MSSV_MEMBER = 'TEST_CLAN_MEMBER_99';
  const MSSV_OUTSIDER = 'TEST_CLAN_OUTSIDER_99';

  // Dọn dẹp sinh viên test cũ
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3, $4)', [
    MSSV_LEADER,
    MSSV_VICE,
    MSSV_MEMBER,
    MSSV_OUTSIDER
  ]);

  // Khởi tạo 4 sinh viên
  await StudentService.recordLogin(MSSV_LEADER, 'Đặng Bang Chủ');
  await StudentService.recordLogin(MSSV_VICE, 'Lê Phó Bang');
  await StudentService.recordLogin(MSSV_MEMBER, 'Nguyễn Thành Viên');
  await StudentService.recordLogin(MSSV_OUTSIDER, 'Trần Ngoài Nhóm');

  // 1. Tạo CLB test
  const clan = await StudentService.createClan({
    code: 'CLAN_TEST_FEED_' + Date.now(),
    name: 'CLB Học Thuật & Tài Liệu BDU',
    tag: '[BDU_DOCS]',
    description: 'CLB chia sẻ tài liệu ôn thi và thảo luận học thuật',
    leaderMssv: MSSV_LEADER
  });
  assert.ok(clan && clan.id, 'Phải tạo thành công CLB test');
  console.log('--- [Test 1] Tạo CLB thành công:', clan.id);

  // Thêm Vice Leader và Member vào clan
  await StudentService.joinClan(MSSV_VICE, clan.id);
  await StudentService.updateMemberRole(clan.id, MSSV_LEADER, MSSV_VICE, 'vice_leader');
  await StudentService.joinClan(MSSV_MEMBER, clan.id);

  // 2. Kiểm thử: Người ngoài nhóm (MSSV_OUTSIDER) không được đăng bài vào CLB
  console.log('--- [Test 2] Chặn người ngoài nhóm đăng bài vào CLB ---');
  let outsiderBlocked = false;
  try {
    await CommunityService.createPost({
      authorMssv: MSSV_OUTSIDER,
      title: 'Spam từ người ngoài',
      content: 'Nội dung không hợp lệ',
      scope: 'clan',
      scopeId: String(clan.id)
    });
  } catch (err) {
    outsiderBlocked = true;
    assert.match(err.message, /tham gia CLB/, 'Lỗi phải nêu rõ cần tham gia CLB');
  }
  assert.ok(outsiderBlocked, 'Người ngoài nhóm phải bị từ chối đăng bài');
  console.log('✅ PASSED: Chặn người ngoài nhóm thành công (HTTP 403).');

  // 3. Kiểm thử: Thành viên thường không được phép đặt category 'announcement' hoặc 'isPinned: true'
  console.log('--- [Test 3] Thành viên thường không được tự ý ghim hoặc đăng Thông báo ---');
  let announceBlocked = false;
  try {
    await CommunityService.createPost({
      authorMssv: MSSV_MEMBER,
      title: 'Thông báo trái phép',
      content: 'Thành viên thường cố tình đăng thông báo',
      scope: 'clan',
      scopeId: String(clan.id),
      category: 'announcement'
    });
  } catch (err) {
    announceBlocked = true;
    assert.match(err.message, /Chỉ Bang Chủ hoặc Phó Bang/, 'Phải chặn thông báo');
  }
  assert.ok(announceBlocked, 'Phải chặn thành viên thường đăng thông báo');

  // Đăng thảo luận nhưng cố tình kèm isPinned: true -> hệ thống tự reset is_pinned: false
  const memberPost = await CommunityService.createPost({
    authorMssv: MSSV_MEMBER,
    title: 'Câu hỏi ôn thi môn Lập trình Web',
    content: 'Mọi người cho mình hỏi đề thi cuối kỳ có phần Node.js không?',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'question',
    isPinned: true,          // Cố tình ghim
    attachments: [
      {
        url: 'https://drive.google.com/file/d/1a2b3c4d5e/view',
        title: 'Đề thi mẫu 2025'
      }
    ]
  });
  assert.equal(memberPost.category, 'question');
  assert.equal(memberPost.is_pinned, false, 'is_pinned của member phải bị ép về false');
  console.log('✅ PASSED: Hệ thống tự động bảo vệ quyền hạn ghim/thông báo.');

  // 4. Kiểm thử: Bang Chủ đăng Thông báo & Ghim bài
  console.log('--- [Test 4] Bang Chủ đăng thông báo và ghim bài thành công ---');
  const leaderPost = await CommunityService.createPost({
    authorMssv: MSSV_LEADER,
    title: 'Lịch họp CLB tuần này',
    content: 'Tất cả các thành viên chú ý lịch sinh hoạt vào thứ Bảy lúc 9h sáng nhé!',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'announcement',
    isPinned: true
  });
  assert.equal(leaderPost.category, 'announcement');
  assert.equal(leaderPost.is_pinned, true);
  console.log('✅ PASSED: Bang Chủ đăng thông báo và ghim bài thành công.');

  // 5. Kiểm thử: Đăng tài liệu với Folder Google Drive
  console.log('--- [Test 5] Đăng tài liệu chia sẻ Folder Google Drive ---');
  const materialPost = await CommunityService.createPost({
    authorMssv: MSSV_VICE,
    title: 'Kho Slide và Đề Cương Ôn Thi CSDL',
    content: 'Gửi cả nhóm folder Drive tổng hợp slide và bài tập lớn.',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'material',
    attachments: [
      {
        url: 'https://drive.google.com/drive/folders/1xyz_test_folder_id',
        title: 'Thư mục Slide CSDL BDU'
      },
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Video hướng dẫn đồ án'
      }
    ]
  });
  assert.equal(materialPost.category, 'material');
  console.log('✅ PASSED: Đăng tài liệu với attachments thành công.');

  // 6. Kiểm thử: Đăng Confession nội bộ CLB
  console.log('--- [Test 6] Đăng Confession ẩn danh trong CLB ---');
  const confessPost = await CommunityService.createPost({
    authorMssv: MSSV_MEMBER,
    title: 'Tâm sự ôn thi áp lực quá',
    content: 'Kỳ này đăng ký 7 môn áp lực quá mọi người ơi, có ai học cùng không?',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'confession',
    isAnonymous: true
  });
  assert.equal(confessPost.category, 'confession');
  assert.equal(confessPost.author.is_anonymous, true);
  console.log('✅ PASSED: Đăng Confession nội bộ CLB thành công.');

  // 7. Kiểm thử: Phó Bang ghim bài của Member
  console.log('--- [Test 7] Phó Bang ghim bài viết của Member ---');
  const pinResult = await CommunityService.togglePinPost(memberPost.id, MSSV_VICE);
  assert.equal(pinResult.is_pinned, true, 'Bài viết phải chuyển sang trạng thái đã ghim');

  // Lấy danh sách bài viết để kiểm tra thứ tự sắp xếp (Bài ghim phải ở trên đầu)
  const feedPosts = await CommunityService.getPosts({
    scope: 'clan',
    scopeId: String(clan.id),
    requesterMssv: MSSV_MEMBER
  });
  assert.ok(feedPosts.posts.length >= 4, 'Phải có ít nhất 4 bài viết');
  assert.equal(feedPosts.posts[0].is_pinned, true, 'Bài đầu tiên phải là bài được ghim');
  assert.equal(feedPosts.posts[1].is_pinned, true, 'Bài thứ 2 cũng phải là bài được ghim');
  console.log('✅ PASSED: Ghim bài viết và sắp xếp ưu tiên bài ghim chuẩn xác.');

  // 8. Kiểm thử: Kho Tài Liệu (Documents aggregation & statistics)
  console.log('--- [Test 8] Truy vấn Kho Tài Liệu CLB và kiểm tra thống kê ---');
  const clanDocs = await CommunityService.getClanDocuments(clan.id, { search: '' });
  assert.ok(clanDocs.stats, 'Phải có dữ liệu thống kê');
  assert.ok(clanDocs.total >= 3, 'Phải tổng hợp được ít nhất 3 tài liệu');
  assert.ok(clanDocs.stats.folders >= 1, 'Phải có ít nhất 1 folder');
  assert.ok(clanDocs.stats.files >= 1, 'Phải có ít nhất 1 file');
  assert.ok(clanDocs.stats.videos >= 1, 'Phải có ít nhất 1 video');

  // Lọc chỉ thư mục
  const folderDocs = await CommunityService.getClanDocuments(clan.id, { type: 'drive_folder' });
  assert.ok(folderDocs.documents.every(d => d.type === 'drive_folder'), 'Tất cả phải là drive_folder');
  console.log('✅ PASSED: Kho Tài Liệu tổng hợp chính xác (Folders, Files, Videos, Links).');

  // 9. Kiểm thử: Xóa bài viết (Quản trị viên xóa bài của thành viên)
  console.log('--- [Test 9] Bang Chủ xóa bài viết vi phạm của thành viên ---');
  const deleteResult = await CommunityService.deletePost(confessPost.id, MSSV_LEADER);
  assert.equal(deleteResult.deleted, true);
  const checkPost = await CommunityService.getPostById(confessPost.id);
  assert.equal(checkPost, null, 'Bài viết phải không còn tồn tại sau khi xóa');
  console.log('✅ PASSED: Bang Chủ có quyền xóa bài viết trong CLB.');

  // 10. Dọn dẹp dữ liệu test
  await query('DELETE FROM clans WHERE id = $1', [clan.id]);
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3, $4)', [
    MSSV_LEADER,
    MSSV_VICE,
    MSSV_MEMBER,
    MSSV_OUTSIDER
  ]);

  console.log('\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ BẢN TIN & KHO TÀI LIỆU ĐÃ ĐẠT 100%!');
} catch (err) {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exitCode = 1;
} finally {
  try {
    await query("DELETE FROM clans WHERE code LIKE 'CLAN_TEST_FEED_%'");
    await query("DELETE FROM students WHERE mssv LIKE 'TEST_CLAN_%'");
  } catch {}
  await closeDatabase();
}
