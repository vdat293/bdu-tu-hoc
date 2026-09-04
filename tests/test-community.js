import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { CommunityService, parseDriveOrMediaUrl } from '../src/services/community.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test-community: DATABASE_URL not configured.');
  process.exit(0);
}

try {
  console.log('🧪 Bắt đầu kiểm thử Góc Tự Học Số (Community Hub)...');

  const TEST_AUTHOR = 'TEST_COMMUNITY_AUTHOR';
  const TEST_VIEWER = 'TEST_COMMUNITY_VIEWER';

  // 1. Kiểm thử Parser URL Đa phương tiện (File, Folder, Drive Video, YouTube)
  console.log('--- [Test 1] Kiểm tra Parser URL Google Drive & Video ---');

  // 1.1 Drive File
  const driveFile = parseDriveOrMediaUrl('https://drive.google.com/file/d/1A2B3C4D_FILE/view?usp=sharing', 'Đề thi cuối kỳ');
  assert.equal(driveFile.type, 'drive_file');
  assert.equal(driveFile.id, '1A2B3C4D_FILE');
  assert.equal(driveFile.embed_url, 'https://drive.google.com/file/d/1A2B3C4D_FILE/preview');
  assert.equal(driveFile.download_url, 'https://drive.google.com/uc?export=download&id=1A2B3C4D_FILE');

  // 1.2 Drive Folder
  const driveFolder = parseDriveOrMediaUrl('https://drive.google.com/drive/folders/1Folder_XYZ123', 'Kho tài liệu ôn tập');
  assert.equal(driveFolder.type, 'drive_folder');
  assert.equal(driveFolder.id, '1Folder_XYZ123');
  assert.equal(driveFolder.embed_url, 'https://drive.google.com/embeddedfolderview?id=1Folder_XYZ123#grid');

  // 1.3 Drive Video
  const driveVideo = parseDriveOrMediaUrl('https://drive.google.com/file/d/1Video_MP4_XYZ/view', 'Video giải đề chi tiết', 'video');
  assert.equal(driveVideo.type, 'drive_video');
  assert.equal(driveVideo.id, '1Video_MP4_XYZ');
  assert.equal(driveVideo.embed_url, 'https://drive.google.com/file/d/1Video_MP4_XYZ/preview');

  // 1.4 YouTube Video
  const ytVideo = parseDriveOrMediaUrl('https://youtu.be/dQw4w9WgXcQ', 'Video hướng dẫn');
  assert.equal(ytVideo.type, 'youtube');
  assert.equal(ytVideo.id, 'dQw4w9WgXcQ');
  assert.equal(ytVideo.embed_url, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(parseDriveOrMediaUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').type, 'youtube');

  // Không cho phép protocol nguy hiểm và không nhận diện nhầm domain giả mạo.
  assert.equal(parseDriveOrMediaUrl('javascript:alert(1)'), null);
  const spoofedDrive = parseDriveOrMediaUrl('https://example.com/file/d/1FAKE/view', 'Link ngoài');
  assert.equal(spoofedDrive.type, 'link');

  console.log('✅ PASSED: Parser nhận diện và chuyển hóa đúng định dạng File, Folder, Drive Video, YouTube.');

  // Dọn dẹp dữ liệu cũ nếu có
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [TEST_AUTHOR, TEST_VIEWER]);

  // 2. Kiểm thử Tạo bài viết với đa dạng đính kèm (File + Folder + Video)
  console.log('--- [Test 2] Đăng bài viết kèm File tài liệu, Folder và Video ---');
  const post = await CommunityService.createPost({
    authorMssv: TEST_AUTHOR,
    title: 'Tổng hợp tài liệu và video giải bài tập Giải tích 1',
    content: 'Chào các bạn, mình chia sẻ đề thi, folder bài giảng và video hướng dẫn ôn thi tại đây nhé!',
    scope: 'school',
    isAnonymous: false,
    attachments: [
      { url: 'https://drive.google.com/file/d/1A2B3C4D_FILE/view?usp=sharing', title: 'Đề cương ôn tập PDF' },
      { url: 'https://drive.google.com/drive/folders/1Folder_XYZ123', title: 'Folder bài giảng' },
      { url: 'https://drive.google.com/file/d/1Video_MP4_XYZ/view', title: 'Video bài giảng', type: 'video' },
      { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Clip YouTube tham khảo' }
    ]
  });

  assert.ok(post.id, 'Bài viết phải có ID');
  assert.equal(post.like_count, 0);
  assert.equal(post.comment_count, 0);
  assert.equal(post.attachments.length, 4, 'Phải lưu đủ 4 đính kèm');
  assert.equal(post.attachments[0].type, 'drive_file');
  assert.equal(post.attachments[1].type, 'drive_folder');
  assert.equal(post.attachments[2].type, 'drive_video');
  assert.equal(post.attachments[3].type, 'youtube');
  console.log('✅ PASSED: Tạo bài viết với đầy đủ File, Folder, Drive Video và YouTube thành công.');

  // 3. Kiểm thử Thả tim / Hủy thả tim (Toggle Like)
  console.log('--- [Test 3] Kiểm tra cơ chế Toggle Like ---');
  const like1 = await CommunityService.toggleLike(post.id, TEST_VIEWER);
  assert.equal(like1.liked, true);
  assert.equal(like1.like_count, 1);

  // Xem bài viết dưới góc nhìn của Viewer -> is_liked phải là true
  const postDetailAfterLike = await CommunityService.getPostById(post.id, TEST_VIEWER);
  assert.equal(postDetailAfterLike.is_liked, true);
  assert.equal(postDetailAfterLike.like_count, 1);

  // Bấm like lần 2 -> Hủy like (Unlike)
  const like2 = await CommunityService.toggleLike(post.id, TEST_VIEWER);
  assert.equal(like2.liked, false);
  assert.equal(like2.like_count, 0);

  const postDetailAfterUnlike = await CommunityService.getPostById(post.id, TEST_VIEWER);
  assert.equal(postDetailAfterUnlike.is_liked, false);
  assert.equal(postDetailAfterUnlike.like_count, 0);
  console.log('✅ PASSED: Toggle like và đồng bộ like_count hoạt động chính xác.');

  // 4. Kiểm thử Bình luận và Phản hồi bình luận (Comments & Replies)
  console.log('--- [Test 4] Thêm bình luận và phản hồi bình luận ---');
  const comment1 = await CommunityService.addComment({
    postId: post.id,
    authorMssv: TEST_VIEWER,
    content: 'Cảm ơn bạn nhiều, tài liệu rất chi tiết!'
  });
  assert.ok(comment1.id);

  const replyComment = await CommunityService.addComment({
    postId: post.id,
    authorMssv: TEST_AUTHOR,
    content: 'Chúc bạn ôn thi tốt nhé!',
    parentId: comment1.id
  });
  assert.equal(replyComment.parent_id, comment1.id);

  const comments = await CommunityService.getComments(post.id, TEST_VIEWER);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].content, 'Cảm ơn bạn nhiều, tài liệu rất chi tiết!');
  assert.equal(comments[1].parent_id, comment1.id);

  const updatedPost = await CommunityService.getPostById(post.id);
  assert.equal(updatedPost.comment_count, 2, 'comment_count trên bài viết phải là 2');
  console.log('✅ PASSED: Bình luận và phản hồi bình luận thành công.');

  // 5. Kiểm thử Chế độ Ẩn danh (Confession Mode)
  console.log('--- [Test 5] Chế độ Confession ẩn danh ---');
  const anonymousPost = await CommunityService.createPost({
    authorMssv: TEST_AUTHOR,
    title: 'Góc tâm sự ôn thi',
    content: 'Có ai thấy thầy dạy môn này khó không ạ?',
    scope: 'school',
    isAnonymous: true
  });

  // Người khác xem -> MSSV bị ẩn, tên là 'Sinh viên giấu tên'
  const viewedByOther = await CommunityService.getPostById(anonymousPost.id, TEST_VIEWER);
  assert.equal(viewedByOther.author.mssv, null, 'MSSV của tác giả phải bị ẩn đối với người khác');
  assert.equal(viewedByOther.author.name, 'Sinh viên giấu tên');

  // Chính tác giả xem -> Thấy được MSSV của mình
  const viewedByAuthor = await CommunityService.getPostById(anonymousPost.id, TEST_AUTHOR);
  assert.equal(viewedByAuthor.author.mssv, TEST_AUTHOR);
  assert.equal(viewedByAuthor.is_mine, true);

  const myPosts = await CommunityService.getPosts({ scope: 'forum', authorMssv: TEST_AUTHOR, viewerMssv: TEST_AUTHOR });
  assert.ok(myPosts.posts.some((item) => item.id === anonymousPost.id));
  assert.ok(myPosts.posts.every((item) => item.is_mine), 'Bộ lọc server phải chỉ trả bài của người xem');

  const anonymousPosts = await CommunityService.getPosts({ scope: 'forum', isAnonymous: true, viewerMssv: TEST_VIEWER });
  assert.ok(anonymousPosts.posts.some((item) => item.id === anonymousPost.id));
  assert.ok(anonymousPosts.posts.every((item) => item.is_anonymous));
  console.log('✅ PASSED: Bảo mật danh tính trong chế độ ẩn danh chuẩn xác.');

  // 6. Kiểm thử Lọc theo Scope (Phạm vi)
  console.log('--- [Test 6] Lọc bài viết theo Scope ---');
  await query('INSERT INTO clans (id, code, name, leader_mssv) VALUES (100, $1, $2, $3) ON CONFLICT (id) DO NOTHING', [
    'CLAN_100_TEST', 'CLB CNTT', TEST_AUTHOR
  ]);
  await query('INSERT INTO student_clans (mssv, clan_id, role) VALUES ($1, 100, $2) ON CONFLICT (mssv, clan_id) DO NOTHING', [
    TEST_AUTHOR, 'leader'
  ]);

  await CommunityService.createPost({
    authorMssv: TEST_AUTHOR,
    title: 'Thông báo nội bộ Clan IT',
    content: 'Tối nay họp team nha mọi người',
    scope: 'clan',
    scopeId: '100'
  });
  const facultyPost = await CommunityService.createPost({
    authorMssv: TEST_AUTHOR,
    title: 'Trao đổi chủ đề Viện/Khoa',
    content: 'Bài công khai theo chủ đề chuyên môn.',
    scope: 'faculty'
  });

  const schoolPosts = await CommunityService.getPosts({ scope: 'school' });
  const clanPosts = await CommunityService.getPosts({ scope: 'clan', scopeId: '100' });
  const forumPosts = await CommunityService.getPosts({ scope: 'forum' });

  assert.ok(clanPosts.posts.some((p) => p.title === 'Thông báo nội bộ Clan IT'));
  assert.ok(!schoolPosts.posts.some((p) => p.title === 'Thông báo nội bộ Clan IT'));
  assert.ok(forumPosts.posts.some((p) => p.id === facultyPost.id), 'Feed forum phải chứa bài chủ đề Viện/Khoa');
  assert.ok(!forumPosts.posts.some((p) => p.title === 'Thông báo nội bộ Clan IT'), 'Feed forum không được làm lộ bài CLB');
  console.log('✅ PASSED: Phân vùng phạm vi (Scope) bài viết hoạt động đúng chuẩn.');

  // 7. Chỉ tác giả được xóa bài; khóa ngoại cascade tự dọn tương tác.
  console.log('--- [Test 7] Xóa bài viết và kiểm tra quyền sở hữu ---');
  await assert.rejects(
    CommunityService.deletePost(post.id, TEST_VIEWER),
    (error) => error?.status === 403
  );
  const deleted = await CommunityService.deletePost(post.id, TEST_AUTHOR);
  assert.equal(deleted.deleted, true);
  assert.equal(await CommunityService.getPostById(post.id, TEST_AUTHOR), null);
  console.log('✅ PASSED: Không thể xóa bài người khác; tác giả xóa bài thành công.');

  // Dọn dẹp dữ liệu test
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [TEST_AUTHOR, TEST_VIEWER]);
  await query("DELETE FROM clans WHERE id = 100 OR code = 'CLAN_100_TEST'");

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ COMMUNITY & DRIVE EMBED ĐỀU THÀNH CÔNG!');
  console.log('======================================================');
} catch (error) {
  console.error('❌ Kiểm thử thất bại:', error);
  process.exitCode = 1;
} finally {
  try {
    await query("DELETE FROM clans WHERE id = 100 OR code = 'CLAN_100_TEST'");
  } catch {}
  await closeDatabase();
}
