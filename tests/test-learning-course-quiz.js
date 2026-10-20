import assert from 'node:assert/strict';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { LearningService } from '../src/services/learning.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-learning-course-quiz: DATABASE_URL not configured.');
  process.exit(0);
}

const AUTHOR = 'TEST_QUIZ_AUTHOR';
const VIEWER = 'TEST_QUIZ_VIEWER';
const OUTSIDER = 'TEST_QUIZ_OUTSIDER';
const COURSE_CODE = 'TESTQUIZ01';

const VALID_QUIZ = {
  schema: 'bdu-quiz/v1',
  title: 'Ôn tập Chương 1',
  description: 'Mô tả quiz',
  timeLimitSeconds: 600,
  questions: [
    {
      id: 'q1',
      question: 'Cấu trúc dữ liệu nào hoạt động theo nguyên tắc LIFO?',
      options: ['Hàng đợi', 'Ngăn xếp', 'Danh sách liên kết', 'Cây nhị phân'],
      correct: 'B',
      explanation: 'Ngăn xếp (stack) hoạt động theo LIFO: vào sau, ra trước.'
    },
    {
      id: 'q2',
      question: 'Phép toán nào thêm phần tử vào ngăn xếp?',
      options: ['pop', 'push', 'dequeue', 'enqueue'],
      correct: 'B',
      explanation: 'push thêm phần tử vào đỉnh ngăn xếp.'
    }
  ]
};

async function countPosts(courseId) {
  const result = await query(
    'SELECT COUNT(*)::int AS total FROM course_posts WHERE course_id = $1',
    [courseId]
  );
  return result.rows[0].total;
}

async function countQuizzes(courseId) {
  const result = await query(`
    SELECT COUNT(*)::int AS total
    FROM course_quizzes cq
    JOIN course_posts cp ON cp.id = cq.post_id
    WHERE cp.course_id = $1;
  `, [courseId]);
  return result.rows[0].total;
}

try {
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]);
  await query('DELETE FROM identity_entitlement_grants WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]);
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]);

  const syncedAt = new Date();
  await query(`
    INSERT INTO students (mssv, full_name, is_active, course_synced_at)
    VALUES
      ($1, 'Tác giả kiểm thử', TRUE, $4),
      ($2, 'Người xem kiểm thử', TRUE, $4),
      ($3, 'Người ngoài môn kiểm thử', TRUE, $4);
  `, [AUTHOR, VIEWER, OUTSIDER, syncedAt]);

  const courseResult = await query(`
    INSERT INTO courses (normalized_code, display_code, name)
    VALUES ($1, $1, 'Môn kiểm thử trắc nghiệm')
    RETURNING id;
  `, [COURSE_CODE]);
  const courseId = courseResult.rows[0].id;

  await query(`
    INSERT INTO student_courses (mssv, course_id, semester_code, semester_name, has_final_grade, last_seen_at)
    VALUES
      ($1, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4),
      ($2, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4);
  `, [AUTHOR, VIEWER, courseId, syncedAt]);

  // Cấp danh hiệu #TTCDS cho tác giả theo fixture của test-clan-join-and-permissions.
  await query(`
    INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy)
    VALUES ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip')
    ON CONFLICT (id) DO NOTHING;
  `);
  await query(`
    INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
    VALUES ($1, 'title:ttcds', 'manual', 'Test grant #TTCDS')
    ON CONFLICT DO NOTHING;
  `, [AUTHOR]);

  // 1. Người không có #TTCDS không được tạo quiz và không để lại dòng dở dang.
  await assert.rejects(
    () => LearningService.createCoursePost(VIEWER, COURSE_CODE, {
      kind: 'quiz', title: 'Quiz', content: '', quiz: VALID_QUIZ
    }),
    (err) => err.status === 403
      && err.code === 'TTCDS_FORBIDDEN'
      && /#TTCDS/.test(err.message)
  );
  assert.equal(await countQuizzes(courseId), 0, '403 không được tạo dòng course_quizzes');

  // 2. Tác giả có #TTCDS tạo quiz; title/content fallback từ JSON.
  const post = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'quiz', title: '', content: '', quiz: VALID_QUIZ
  });
  assert.equal(post.kind, 'quiz');
  assert.equal(post.title, VALID_QUIZ.title);
  assert.equal(post.content, VALID_QUIZ.description);
  assert.equal(post.quiz.question_count, 2);
  assert.equal(post.quiz.time_limit_seconds, 600);
  assert.equal(post.quiz.progress, null);
  assert.equal(post.is_anonymous, false);
  assert.deepEqual(post.attachments, []);
  assert.equal('questions' in post.quiz, false);

  const quizRow = await query(`
    SELECT question_count, time_limit_seconds
    FROM course_quizzes
    WHERE post_id = $1;
  `, [post.id]);
  assert.equal(quizRow.rows.length, 1);
  assert.equal(Number(quizRow.rows[0].question_count), 2);
  assert.equal(Number(quizRow.rows[0].time_limit_seconds), 600);

  // 3. Validation server-side: thiếu correct và JSON quá 256 KB đều bị chặn,
  //    không insert dở dang vào course_posts/course_quizzes.
  const postsBefore = await countPosts(courseId);
  const quizzesBefore = await countQuizzes(courseId);

  const missingCorrect = JSON.parse(JSON.stringify(VALID_QUIZ));
  delete missingCorrect.questions[1].correct;
  await assert.rejects(
    () => LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
      kind: 'quiz', title: 'Quiz lỗi', content: '', quiz: missingCorrect
    }),
    (err) => err.status === 400
      && err.code === 'QUIZ_INVALID'
      && Array.isArray(err.errors)
      && err.errors.some((item) => item.path === 'questions[1].correct')
  );

  const oversizedQuiz = {
    ...VALID_QUIZ,
    questions: [
      {
        ...VALID_QUIZ.questions[0],
        explanation: 'x'.repeat(300 * 1024)
      }
    ]
  };
  await assert.rejects(
    () => LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
      kind: 'quiz', title: 'Quiz quá lớn', content: '', quiz: oversizedQuiz
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_INVALID'
  );

  assert.equal(await countPosts(courseId), postsBefore, 'Quiz lỗi không được tạo course_posts');
  assert.equal(await countQuizzes(courseId), quizzesBefore, 'Quiz lỗi không được tạo course_quizzes');

  // 4. Feed trả summary quiz cho viewer trong môn, không lộ câu hỏi/đáp án.
  const feed = await LearningService.getCoursePosts(VIEWER, COURSE_CODE);
  const quizPost = feed.posts.find((item) => String(item.id) === String(post.id));
  assert.ok(quizPost, 'Feed phải có bài quiz vừa tạo');
  assert.equal(quizPost.quiz.question_count, 2);
  assert.equal(quizPost.quiz.time_limit_seconds, 600);
  assert.equal(quizPost.quiz.progress, null);
  assert.equal('questions' in quizPost.quiz, false);
  assert.equal(JSON.stringify(quizPost).includes('correct_option'), false);
  assert.equal(JSON.stringify(quizPost).includes('Ngăn xếp (stack) hoạt động'), false);

  // 5. Hồi quy: bốn loại bài cũ giữ nguyên hành vi.
  await assert.rejects(
    () => LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
      kind: 'document', title: 'Tài liệu thiếu liên kết', content: 'Mô tả'
    }),
    (err) => err.status === 400
  );

  const documentPost = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'document',
    title: 'Tài liệu Drive',
    content: 'Tài liệu tham khảo',
    url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'
  });
  assert.equal(documentPost.kind, 'document');
  assert.equal(documentPost.quiz, null);
  assert.equal(documentPost.attachments.length, 1);

  const feedAfterDocument = await LearningService.getCoursePosts(VIEWER, COURSE_CODE);
  const documentInFeed = feedAfterDocument.posts.find((item) => String(item.id) === String(documentPost.id));
  assert.equal(documentInFeed.quiz, null);

  // 6. Người ngoài môn không đọc được feed.
  await assert.rejects(
    () => LearningService.getCoursePosts(OUTSIDER, COURSE_CODE),
    (err) => err.status === 403
  );

  // 7. GET đề: không lộ đáp án/giải thích, chưa start thì progress null và
  //    remaining_seconds bằng time limit.
  const detail = await LearningService.getCourseQuiz(VIEWER, COURSE_CODE, post.id);
  assert.equal(detail.course.code, COURSE_CODE);
  assert.equal(detail.post.kind, 'quiz');
  assert.equal(detail.post.author.name, 'Tác giả kiểm thử');
  assert.equal(detail.quiz.questions.length, 2);
  assert.equal('correct' in detail.quiz.questions[0], false);
  assert.equal('explanation' in detail.quiz.questions[0], false);
  assert.equal(detail.quiz.review, null);
  assert.equal(detail.quiz.remaining_seconds, 600);
  assert.equal(detail.quiz.progress, null);
  assert.equal(detail.quiz.expired, false);
  assert.equal(JSON.stringify(detail).includes('Ngăn xếp (stack) hoạt động'), false);

  // 8. Bài không phải quiz trả 404 QUIZ_NOT_FOUND; người ngoài môn và mã môn
  //    sai đều bị chặn 403 trước khi đọc đề.
  const requestPost = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
    kind: 'request', title: 'Bài hỏi đáp', content: 'Ai có tài liệu ôn tập chương 1?'
  });
  await assert.rejects(
    () => LearningService.getCourseQuiz(VIEWER, COURSE_CODE, requestPost.id),
    (err) => err.status === 404 && err.code === 'QUIZ_NOT_FOUND'
  );
  await assert.rejects(
    () => LearningService.getCourseQuiz(VIEWER, COURSE_CODE, '9223372036854775807'),
    (err) => err.status === 404 && err.code === 'QUIZ_NOT_FOUND'
  );
  await assert.rejects(
    () => LearningService.getCourseQuiz(OUTSIDER, COURSE_CODE, post.id),
    (err) => err.status === 403
  );
  await assert.rejects(
    () => LearningService.getCourseQuiz(VIEWER, 'TESTQUIZ99', post.id),
    (err) => err.status === 403
  );

  console.log('✓ Trắc nghiệm theo môn: quyền #TTCDS, tạo quiz, validate, feed summary và hồi quy kind cũ đều hoạt động.');
} finally {
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM identity_entitlement_grants WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
