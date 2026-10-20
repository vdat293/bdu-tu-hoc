import assert from 'node:assert/strict';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { QuizSetService } from '../src/modules/learning/quiz-set.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-learning-quiz-sets: DATABASE_URL not configured.');
  process.exit(0);
}

const AUTHOR = 'TEST_QS_AUTHOR';
const VIEWER = 'TEST_QS_VIEWER';
const OUTSIDER = 'TEST_QS_OUTSIDER';
const COURSE_CODE = 'TESTQS01';
const FORBIDDEN_KEYS = new Set(['correct', 'explanation', 'correct_answer', 'correct_count']);

function makeQuestions(count, prefix = 'cau') {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `${prefix}${number}`,
      question: `Câu ${number}: lựa chọn nào là đáp án đúng?`,
      options: [
        `Đáp án A ${number}`,
        `Đáp án B ${number}`,
        `Đáp án C ${number}`,
        `Đáp án D ${number}`
      ],
      correct: number % 2 === 0 ? `Đáp án B ${number}` : `Đáp án A ${number}`,
      explanation: `Giải thích cho câu ${number}.`
    };
  });
}

function findForbiddenKeys(value, path = '$', found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    findForbiddenKeys(child, `${path}.${key}`, found);
  }
  return found;
}

function assertNoAnswerLeak(value, label) {
  assert.deepEqual(findForbiddenKeys(value), [], `${label} không được lộ đáp án/giải thích`);
}

async function readProgress(setId, mssv = VIEWER, partIndex = null, mode = null) {
  const params = [mssv, setId];
  let sql = 'SELECT * FROM course_quiz_progress WHERE mssv = $1 AND set_id = $2';
  if (partIndex !== null) {
    params.push(partIndex);
    sql += ` AND part_index = $${params.length}`;
  }
  if (mode !== null) {
    params.push(mode);
    sql += ` AND mode = $${params.length}`;
  }
  sql += ' ORDER BY part_index, mode';
  const result = await query(sql, params);
  return partIndex !== null && mode !== null ? (result.rows[0] || null) : result.rows;
}

try {
  await query('DELETE FROM identity_entitlement_grants WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]);
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]);
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]);

  const syncedAt = new Date();
  await query(`
    INSERT INTO students (mssv, full_name, is_active, course_synced_at)
    VALUES
      ($1, 'Tác giả bộ đề', TRUE, $4),
      ($2, 'Người làm bộ đề', TRUE, $4),
      ($3, 'Người ngoài môn', TRUE, $4);
  `, [AUTHOR, VIEWER, OUTSIDER, syncedAt]);

  const courseResult = await query(`
    INSERT INTO courses (normalized_code, display_code, name)
    VALUES ($1, $1, 'Môn kiểm thử bộ đề')
    RETURNING id;
  `, [COURSE_CODE]);
  const courseId = courseResult.rows[0].id;

  await query(`
    INSERT INTO student_courses (mssv, course_id, semester_code, semester_name, has_final_grade, last_seen_at)
    VALUES
      ($1, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4),
      ($2, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4);
  `, [AUTHOR, VIEWER, courseId, syncedAt]);

  await query(`
    INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy)
    VALUES ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip')
    ON CONFLICT (id) DO NOTHING;
  `);
  await query(`
    INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
    VALUES ($1, 'title:ttcds', 'manual', 'Test grant #TTCDS cho bộ đề')
    ON CONFLICT DO NOTHING;
  `, [AUTHOR]);

  const questions60 = makeQuestions(60);
  const sourceFiles = [
    { name: 'C:\\tai-lieu\\bai-1.json', questionCount: 20 },
    { name: 'folder/bai-2.json ', questionCount: 20 },
    { name: '  bai-3.json', questionCount: 20 }
  ];

  // 1. Chỉ TTCDS được tạo; client partSizes/part_count bị bỏ qua, server tự chia.
  await assert.rejects(
    () => QuizSetService.createSet(VIEWER, COURSE_CODE, {
      title: 'Bộ đề không có quyền',
      questions: questions60,
      sourceFiles,
      maxQuestionsPerPart: 20,
      minutesPerPart: 30
    }),
    (err) => err.status === 403 && err.code === 'TTCDS_FORBIDDEN'
  );

  assert.equal((await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_sets WHERE course_id = $1',
    [courseId]
  )).rows[0].total, 0, '403 không được tạo bộ đề');

  const created = await QuizSetService.createSet(AUTHOR, COURSE_CODE, {
    title: '  Bộ đề kiểm thử 60 câu  ',
    description: '  Mô tả bộ đề kiểm thử.  ',
    questions: questions60,
    sourceFiles,
    maxQuestionsPerPart: 20,
    minutesPerPart: 30,
    partSizes: [60],
    part_count: 1
  });

  assert.equal(created.title, 'Bộ đề kiểm thử 60 câu');
  assert.equal(created.description, 'Mô tả bộ đề kiểm thử.');
  assert.equal(created.question_count, 60);
  assert.equal(created.part_count, 3);
  assert.deepEqual(created.part_sizes, [20, 20, 20]);
  assert.equal(created.minutes_per_part, 30);
  assert.equal(created.is_mine, true);
  assert.equal(created.author.mssv, AUTHOR);
  assert.equal(created.author.name, 'Tác giả bộ đề');
  assert.ok(Array.isArray(created.author.titles));

  const stored = (await query(
    'SELECT * FROM course_quiz_sets WHERE id = $1',
    [created.id]
  )).rows[0];
  assert.deepEqual(stored.part_sizes, [20, 20, 20]);
  assert.equal(stored.part_count, 3);
  assert.equal(stored.question_count, 60);
  assert.deepEqual(stored.source_files, [
    { name: 'bai-1.json', questionCount: 20 },
    { name: 'bai-2.json', questionCount: 20 },
    { name: 'bai-3.json', questionCount: 20 }
  ]);
  assert.deepEqual(Object.keys(stored.source_files[0]).sort(), ['name', 'questionCount']);
  assert.equal(stored.questions.length, 60);
  assert.deepEqual(stored.questions.map((question) => question.partIndex).slice(0, 21), [
    ...Array(20).fill(0),
    1
  ]);

  // 2. Tạo 65 câu / 20 → 4 phần 17/16/16/16, không phần nào vượt 25.
  const created65 = await QuizSetService.createSet(AUTHOR, COURSE_CODE, {
    title: 'Bộ đề 65 câu',
    questions: makeQuestions(65, 'sau'),
    sourceFiles: [{ name: 'bai-65.json', questionCount: 65 }],
    maxQuestionsPerPart: 20,
    minutesPerPart: 15
  });
  assert.equal(created65.part_count, 4);
  assert.deepEqual(created65.part_sizes, [17, 16, 16, 16]);
  assert.ok(created65.part_sizes.every((size) => size <= 25));

  // 3. Danh sách chỉ trả summary + tiến độ, không trả câu hỏi/đáp án.
  const listed = await QuizSetService.listSets(VIEWER, COURSE_CODE);
  assert.ok(Array.isArray(listed.sets));
  const listedSet = listed.sets.find((item) => String(item.id) === String(created.id));
  assert.ok(listedSet, 'Danh sách phải có bộ đề vừa tạo');
  assert.equal(listedSet.part_count, 3);
  assert.deepEqual(listedSet.part_sizes, [20, 20, 20]);
  assert.equal(listedSet.is_mine, false);
  assert.equal('questions' in listedSet, false);
  assert.equal(listedSet.progress.length, 3);
  for (const part of listedSet.progress) {
    assert.deepEqual(Object.keys(part).sort(), ['part_index', 'review', 'test']);
    assert.equal(part.review, null);
    assert.equal(part.test, null);
  }
  assertNoAnswerLeak(listedSet, 'listSets');

  // 4. Chi tiết phần chỉ trả câu hỏi công khai + chưa có progress/review.
  const detailReview = await QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 0, 'review');
  assert.equal(detailReview.set.id, created.id);
  assert.equal(detailReview.set.question_count, 60);
  assert.equal('questions' in detailReview.set, false);
  assert.deepEqual(detailReview.part, {
    index: 0,
    question_count: 20,
    time_limit_seconds: null
  });
  assert.equal(detailReview.questions.length, 20);
  for (const question of detailReview.questions) {
    assert.deepEqual(Object.keys(question).sort(), ['id', 'options', 'question']);
    assert.equal(question.options.length, 4);
  }
  assert.equal(detailReview.progress, null);
  assert.equal(detailReview.review, null);
  assertNoAnswerLeak({ set: detailReview.set, questions: detailReview.questions }, 'getPart review');

  const detailTest = await QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 1, 'test');
  assert.deepEqual(detailTest.part, {
    index: 1,
    question_count: 20,
    time_limit_seconds: 1800
  });
  assert.equal(detailTest.questions[0].id, 'q21');
  assertNoAnswerLeak({ set: detailTest.set, questions: detailTest.questions }, 'getPart test');

  // 5. partIndex/mode không hợp lệ → 400; người ngoài môn → 403.
  await assert.rejects(
    () => QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 3, 'review'),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, -1, 'review'),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 0, 'practice'),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 99, { mode: 'test' }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 0, { mode: 'practice' }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  for (const action of [
    () => QuizSetService.listSets(OUTSIDER, COURSE_CODE),
    () => QuizSetService.getPart(OUTSIDER, COURSE_CODE, created.id, 0, 'review'),
    () => QuizSetService.startPart(OUTSIDER, COURSE_CODE, created.id, 0, { mode: 'test' }),
    () => QuizSetService.deleteSet(OUTSIDER, COURSE_CODE, created.id)
  ]) {
    await assert.rejects(action, (err) => err.status === 403);
  }

  // 6. Start review: không timer; gọi lại là resume, giữ started_at.
  const reviewStart = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 0, {
    mode: 'review'
  });
  assert.equal(reviewStart.remaining_seconds, null);
  assert.equal(reviewStart.completed_at, null);
  assert.equal(reviewStart.restarted, false);
  assert.ok(reviewStart.started_at);
  const reviewStartAgain = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 0, {
    mode: 'review'
  });
  assert.equal(
    new Date(reviewStartAgain.started_at).getTime(),
    new Date(reviewStart.started_at).getTime(),
    'Start review lần hai phải giữ nguyên thời điểm bắt đầu'
  );
  assert.equal(reviewStartAgain.remaining_seconds, null);
  const reviewRow = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(Number(reviewRow.answered), 0);
  assert.equal(Number(reviewRow.total_count), 20);
  assert.equal(reviewRow.completed_at, null);

  const reviewDetail = await QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 0, 'review');
  assert.deepEqual(Object.keys(reviewDetail.progress).sort(), [
    'answered',
    'completed_at',
    'responses',
    'total_count'
  ]);
  assert.equal(reviewDetail.progress.total_count, 20);
  assert.deepEqual(reviewDetail.progress.responses, []);

  // 7. Start test: timer lấy từ DB, bắt đầu gần 1800 giây.
  const testStart = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 1, {
    mode: 'test'
  });
  assert.ok(testStart.started_at);
  assert.equal(testStart.completed_at, null);
  assert.equal(testStart.restarted, false);
  assert.ok(
    testStart.remaining_seconds > 1790 && testStart.remaining_seconds <= 1800,
    `remaining_seconds phải gần 1800, nhận ${testStart.remaining_seconds}`
  );
  const testRow = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(testRow.answered), 0);
  assert.equal(Number(testRow.total_count), 20);
  assert.equal(testRow.best_correct, null);
  assert.equal(testRow.best_total, null);
  assert.equal(Number(testRow.attempts), 0);

  // 8. Restart giữa lượt test KHÔNG được reset timer/responses; chỉ lượt đã
  //    hoàn thành mới được làm lại và giữ best/attempts.
  const midTestResponses = [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án B 22' }
  ];
  await query(`
    UPDATE course_quiz_progress
    SET started_at = NOW() - INTERVAL '10 seconds',
        answered = 4,
        correct_count = 2,
        total_count = 20,
        responses = $1::jsonb,
        updated_at = NOW()
    WHERE mssv = $2 AND set_id = $3 AND part_index = 1 AND mode = 'test';
  `, [JSON.stringify(midTestResponses), VIEWER, created.id]);

  const midTestBefore = await readProgress(created.id, VIEWER, 1, 'test');
  const midTestRestart = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 1, {
    mode: 'test',
    restart: true
  });
  assert.equal(midTestRestart.restarted, false, 'Restart giữa lượt test phải bị từ chối');
  assert.equal(
    new Date(midTestRestart.started_at).getTime(),
    new Date(midTestBefore.started_at).getTime(),
    'Restart giữa lượt không được đặt lại started_at'
  );
  assert.equal(midTestRestart.completed_at, null);
  assert.ok(
    midTestRestart.remaining_seconds < 1795 && midTestRestart.remaining_seconds > 1770,
    `Restart giữa lượt không được cấp lại full timer, nhận ${midTestRestart.remaining_seconds}`
  );

  const midTestAfter = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(new Date(midTestAfter.started_at).getTime(), new Date(midTestBefore.started_at).getTime());
  assert.equal(Number(midTestAfter.answered), Number(midTestBefore.answered));
  assert.equal(Number(midTestAfter.correct_count), Number(midTestBefore.correct_count));
  assert.deepEqual(midTestAfter.responses, midTestResponses);
  assert.equal(midTestAfter.completed_at, null);

  // Completed test + restart: reset lượt, giữ best/attempts.
  await query(`
    UPDATE course_quiz_progress
    SET answered = 7,
        correct_count = 5,
        total_count = 20,
        best_correct = 12,
        best_total = 20,
        attempts = 3,
        responses = $1::jsonb,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE mssv = $2 AND set_id = $3 AND part_index = 1 AND mode = 'test';
  `, [
    JSON.stringify([{ id: 'q21', response: 'Đáp án A 21' }]),
    VIEWER,
    created.id
  ]);

  const restarted = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 1, {
    mode: 'test',
    restart: true
  });
  assert.equal(restarted.restarted, true);
  assert.equal(restarted.completed_at, null);
  assert.ok(
    restarted.remaining_seconds > 1790 && restarted.remaining_seconds <= 1800,
    'Restart phải đặt lại timer gần 1800 giây'
  );
  const restartedRow = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(restartedRow.answered), 0);
  assert.equal(Number(restartedRow.correct_count), 0);
  assert.equal(Number(restartedRow.total_count), 20);
  assert.deepEqual(restartedRow.responses, []);
  assert.equal(restartedRow.completed_at, null);
  assert.equal(Number(restartedRow.best_correct), 12, 'Restart phải giữ best_correct');
  assert.equal(Number(restartedRow.best_total), 20, 'Restart phải giữ best_total');
  assert.equal(Number(restartedRow.attempts), 3, 'Restart phải giữ attempts');

  const resumed = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 1, {
    mode: 'test'
  });
  assert.equal(resumed.restarted, false);
  assert.equal(resumed.completed_at, null);
  assert.ok(resumed.remaining_seconds > 0 && resumed.remaining_seconds <= 1800);
  assert.equal(
    new Date(resumed.started_at).getTime(),
    new Date(restarted.started_at).getTime(),
    'Start test không restart phải resume đúng lượt đang làm'
  );

  // 9. Progress test trước khi nộp không lộ correct; list progress có best/attempts.
  const detailWithProgress = await QuizSetService.getPart(VIEWER, COURSE_CODE, created.id, 1, 'test');
  assert.ok(detailWithProgress.progress);
  assert.deepEqual(Object.keys(detailWithProgress.progress).sort(), [
    'answered',
    'attempts',
    'best_correct',
    'best_total',
    'completed_at',
    'responses',
    'total_count'
  ]);
  assert.equal(detailWithProgress.progress.attempts, 3);
  assert.equal(detailWithProgress.progress.best_correct, 12);
  assert.deepEqual(detailWithProgress.progress.responses, []);
  assertNoAnswerLeak(detailWithProgress.progress, 'test progress trước khi nộp');

  const listedWithProgress = await QuizSetService.listSets(VIEWER, COURSE_CODE);
  const listedProgressSet = listedWithProgress.sets.find(
    (item) => String(item.id) === String(created.id)
  );
  assert.equal(listedProgressSet.progress[0].review.answered, 0);
  assert.equal(listedProgressSet.progress[0].review.total_count, 20);
  assert.equal('responses' in listedProgressSet.progress[0].review, false);
  assert.equal(listedProgressSet.progress[1].test.best_correct, 12);
  assert.equal(listedProgressSet.progress[1].test.best_total, 20);
  assert.equal(listedProgressSet.progress[1].test.attempts, 3);
  assertNoAnswerLeak(listedProgressSet, 'listSets sau khi start');

  // 10. Validate create: title/description/config/sourceFiles; không ghi dòng lỗi.
  const invalidCases = [
    {
      input: { title: '   ', questions: questions60, sourceFiles, maxQuestionsPerPart: 20, minutesPerPart: 30 },
      path: '$.title'
    },
    {
      input: { title: 'Bộ đề', description: 'x'.repeat(5001), questions: questions60, sourceFiles, maxQuestionsPerPart: 20, minutesPerPart: 30 },
      path: '$.description'
    },
    {
      input: { title: 'Bộ đề', questions: questions60, sourceFiles, maxQuestionsPerPart: 4, minutesPerPart: 30 },
      path: '$.maxQuestionsPerPart'
    },
    {
      input: { title: 'Bộ đề', questions: questions60, sourceFiles, maxQuestionsPerPart: 20, minutesPerPart: 181 },
      path: '$.minutesPerPart'
    },
    {
      input: {
        title: 'Bộ đề',
        questions: questions60,
        sourceFiles: Array.from({ length: 11 }, (_, index) => ({ name: `f${index}.json`, questionCount: 5 })),
        maxQuestionsPerPart: 20,
        minutesPerPart: 30
      },
      path: '$.sourceFiles'
    },
    {
      input: {
        title: 'Bộ đề',
        questions: questions60,
        sourceFiles: [{ name: 'bai.json', questionCount: 59 }],
        maxQuestionsPerPart: 20,
        minutesPerPart: 30
      },
      path: '$.sourceFiles'
    },
    {
      input: {
        title: 'Bộ đề',
        questions: questions60,
        sourceFiles: [{ name: '   ', questionCount: 60 }],
        maxQuestionsPerPart: 20,
        minutesPerPart: 30
      },
      path: '$.sourceFiles'
    },
    {
      input: {
        title: 'Bộ đề',
        questions: [],
        sourceFiles: [],
        maxQuestionsPerPart: 20,
        minutesPerPart: 30
      },
      path: '$.questions'
    }
  ];

  const beforeInvalidCount = (await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_sets WHERE course_id = $1',
    [courseId]
  )).rows[0].total;

  for (const { input, path } of invalidCases) {
    await assert.rejects(
      () => QuizSetService.createSet(AUTHOR, COURSE_CODE, input),
      (err) => err.status === 400
        && err.code === 'QUIZ_SET_INVALID'
        && Array.isArray(err.errors)
        && err.errors.some((item) => item.path === path),
      `Phải trả 400 ${path}`
    );
  }

  const afterInvalidCount = (await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_sets WHERE course_id = $1',
    [courseId]
  )).rows[0].total;
  assert.equal(afterInvalidCount, beforeInvalidCount, 'Bộ đề lỗi không được ghi DB');

  // 11. Quyền xóa: chỉ tác giả; xóa set cascade progress.
  await assert.rejects(
    () => QuizSetService.deleteSet(VIEWER, COURSE_CODE, created.id),
    (err) => err.status === 403 && err.code === 'QUIZ_SET_FORBIDDEN'
  );
  assert.equal((await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_sets WHERE id = $1',
    [created.id]
  )).rows[0].total, 1);

  const progressBeforeDelete = (await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_progress WHERE set_id = $1',
    [created.id]
  )).rows[0].total;
  assert.ok(progressBeforeDelete >= 2);
  const deletion = await QuizSetService.deleteSet(AUTHOR, COURSE_CODE, created.id);
  assert.equal(deletion.deleted, true);
  assert.equal(String(deletion.id), String(created.id));
  assert.equal((await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_sets WHERE id = $1',
    [created.id]
  )).rows[0].total, 0);
  assert.equal((await query(
    'SELECT COUNT(*)::int AS total FROM course_quiz_progress WHERE set_id = $1',
    [created.id]
  )).rows[0].total, 0, 'Xóa bộ đề phải cascade progress');

  await QuizSetService.deleteSet(AUTHOR, COURSE_CODE, created65.id);

  console.log('✓ Bộ đề trắc nghiệm: TTCDS create, chia phần server-side, list/detail không lộ đáp án, quyền xem/xóa, start review/test, restart giữ best/attempts và validate đều hoạt động.');
} finally {
  await query('DELETE FROM identity_entitlement_grants WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
