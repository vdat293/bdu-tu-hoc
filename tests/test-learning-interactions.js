import assert from 'node:assert/strict';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { LearningService } from '../src/services/learning.service.js';
import { IdentityPresentationService } from '../src/services/identity-presentation.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-learning-interactions: DATABASE_URL not configured.');
  process.exit(0);
}

const AUTHOR = 'TEST_LEARNING_AUTHOR';
const VIEWER = 'TEST_LEARNING_VIEWER';
const COURSE_CODE = 'TESTLEARN01';

try {
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [AUTHOR, VIEWER]);
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]);

  const syncedAt = new Date();
  await query(`
    INSERT INTO students (mssv, full_name, is_active, course_synced_at)
    VALUES ($1, 'Tác giả kiểm thử', TRUE, $3), ($2, 'Người xem kiểm thử', TRUE, $3);
  `, [AUTHOR, VIEWER, syncedAt]);
  const courseResult = await query(`
    INSERT INTO courses (normalized_code, display_code, name)
    VALUES ($1, $1, 'Môn kiểm thử luận bàn')
    RETURNING id;
  `, [COURSE_CODE]);
  const courseId = courseResult.rows[0].id;
  await query(`
    INSERT INTO student_courses (mssv, course_id, semester_code, semester_name, has_final_grade, last_seen_at)
    VALUES
      ($1, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4),
      ($2, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4);
  `, [AUTHOR, VIEWER, courseId, syncedAt]);

  await IdentityPresentationService.recordProfile(AUTHOR, {
    data: { ho_ten: 'Tác giả kiểm thử', hinh_anh: '/images/test-author.jpg' }
  });
  const identity = await IdentityPresentationService.updateSelectedTitles(AUTHOR, ['member:bdu']);
  assert.equal(identity.avatar_url, 'https://sv.bdu.edu.vn/images/test-author.jpg');
  assert.equal(identity.selected_titles[0].label, 'Sinh viên BDU');
  await assert.rejects(
    IdentityPresentationService.updateSelectedTitles(AUTHOR, ['a', 'b', 'c', 'd']),
    /tối đa 3/
  );

  const post = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'request',
    title: 'Cùng luận bàn bài tập',
    content: 'Mọi người giải thích giúp mình phần này nhé.'
  });
  assert.equal(post.like_count, 0);
  assert.equal(post.comment_count, 0);
  assert.equal(post.author.photo_url, 'https://sv.bdu.edu.vn/images/test-author.jpg');
  assert.equal(post.author.titles[0].label, 'Sinh viên BDU');

  const anonymousPost = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'request',
    title: 'Luận bàn riêng tư',
    content: 'Mình hơi ngại nên xin phép ẩn danh.',
    isAnonymous: true
  });
  assert.equal(anonymousPost.is_anonymous, true);
  assert.equal(anonymousPost.is_mine, true);
  assert.equal(anonymousPost.author.mssv, null);
  assert.equal(anonymousPost.author.name, 'Sinh viên giấu tên');

  const forcedPublicResource = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'document',
    title: 'Tài liệu phải công khai',
    content: 'Tài liệu tham khảo',
    url: 'https://github.com/example/course-document',
    isAnonymous: true
  });
  assert.equal(forcedPublicResource.is_anonymous, false, 'Tài liệu không được phép ẩn danh');
  assert.equal(forcedPublicResource.author.mssv, AUTHOR);

  const liked = await LearningService.toggleCoursePostLike(VIEWER, COURSE_CODE, post.id);
  assert.equal(liked.liked, true);
  assert.equal(liked.like_count, 1);

  const comment = await LearningService.addCoursePostComment(VIEWER, COURSE_CODE, post.id, {
    content: 'Mình nghĩ nên bắt đầu từ ví dụ đơn giản.'
  });
  const reply = await LearningService.addCoursePostComment(AUTHOR, COURSE_CODE, post.id, {
    content: 'Cảm ơn bạn, mình hiểu rồi.',
    parentId: comment.id
  });
  assert.equal(String(reply.parent_id), String(comment.id));

  const comments = await LearningService.getCoursePostComments(VIEWER, COURSE_CODE, post.id);
  assert.equal(comments.length, 2);
  const feed = await LearningService.getCoursePosts(VIEWER, COURSE_CODE);
  const viewedPost = feed.posts.find((item) => String(item.id) === String(post.id));
  const viewedAnonymousPost = feed.posts.find((item) => String(item.id) === String(anonymousPost.id));
  assert.equal(viewedPost.is_liked, true);
  assert.equal(viewedPost.like_count, 1);
  assert.equal(viewedPost.comment_count, 2);
  assert.equal(viewedAnonymousPost.author.mssv, null);

  await assert.rejects(
    LearningService.deleteCoursePost(VIEWER, COURSE_CODE, post.id),
    (error) => error.status === 403
  );
  await LearningService.deleteCoursePost(AUTHOR, COURSE_CODE, post.id);
  await LearningService.deleteCoursePost(AUTHOR, COURSE_CODE, anonymousPost.id);
  await LearningService.deleteCoursePost(AUTHOR, COURSE_CODE, forcedPublicResource.id);
  assert.equal(Number((await query('SELECT COUNT(*) AS total FROM course_post_likes WHERE post_id = $1', [post.id])).rows[0].total), 0);
  assert.equal(Number((await query('SELECT COUNT(*) AS total FROM course_post_comments WHERE post_id = $1', [post.id])).rows[0].total), 0);

  console.log('✓ Luận bàn theo môn: thích, bình luận, trả lời, phân quyền xóa và cascade đều hoạt động.');
} finally {
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [AUTHOR, VIEWER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
