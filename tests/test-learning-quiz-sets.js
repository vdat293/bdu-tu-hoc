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
    () => QuizSetService.answerReview(OUTSIDER, COURSE_CODE, created.id, 0, {
      questionId: 'q1',
      response: 'Đáp án A 1'
    }),
    () => QuizSetService.saveProgress(OUTSIDER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: [],
      completed: false
    }),
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

  // 11. Ôn tập: answer chỉ chấm từng câu và không ghi tiến độ; test không được
  //     gọi answer. Save merge không ghi đè, hoàn thành khi đủ câu, restart reset.
  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created65.id, 0, {
      questionId: 'q1',
      response: 'Đáp án A 1'
    }),
    (err) => err.status === 409 && err.code === 'QUIZ_NOT_STARTED',
    'Answer khi chưa start phải trả 409 QUIZ_NOT_STARTED'
  );
  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created.id, 1, {
      questionId: 'q21',
      response: 'Đáp án A 21'
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_REVIEW_ONLY',
    'Answer chỉ dành cho ôn tập; lượt test đang làm phải bị từ chối'
  );
  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created.id, 1, {
      questionId: 'q21',
      response: 'Đáp án A 21',
      mode: 'test'
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_REVIEW_ONLY',
    'Answer mode test phải trả 400'
  );

  const reviewBeforeAnswer = await readProgress(created.id, VIEWER, 0, 'review');
  const reviewAnswerCorrect = await QuizSetService.answerReview(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    { questionId: 'q1', response: '  đáp án a 1 ' }
  );
  assert.deepEqual(Object.keys(reviewAnswerCorrect).sort(), [
    'correct',
    'correct_answer',
    'explanation'
  ]);
  assert.equal(reviewAnswerCorrect.correct, true);
  assert.equal(reviewAnswerCorrect.correct_answer, 'Đáp án A 1');
  assert.equal(reviewAnswerCorrect.explanation, 'Giải thích cho câu 1.');

  const reviewAnswerWrong = await QuizSetService.answerReview(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    { questionId: 'q2', response: 'Đáp án A 2' }
  );
  assert.equal(reviewAnswerWrong.correct, false);
  assert.equal(reviewAnswerWrong.correct_answer, 'Đáp án B 2');
  const reviewAfterAnswer = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(
    JSON.stringify(reviewAfterAnswer),
    JSON.stringify(reviewBeforeAnswer),
    'answer không được ghi tiến độ'
  );

  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created.id, 0, {
      questionId: 'q21',
      response: 'Đáp án A 21'
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID',
    'Câu ngoài phần phải bị từ chối'
  );
  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created.id, 0, {
      questionId: 'q1',
      response: 'Đáp án Z 1'
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID',
    'Đáp án không thuộc options phải bị từ chối'
  );

  const reviewSave1 = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    {
      mode: 'review',
      responses: [
        { id: 'q1', response: 'Đáp án A 1' },
        { id: 'q2', response: 'Đáp án A 2' }
      ],
      completed: false
    }
  );
  assert.equal(reviewSave1.mode, 'review');
  assert.equal(reviewSave1.answered, 2);
  assert.equal(reviewSave1.correct_count, 1);
  assert.equal(reviewSave1.total_count, 20);
  assert.equal(reviewSave1.completed_at, null);
  assert.equal(reviewSave1.remaining_seconds, null);
  assert.equal(reviewSave1.expired, false);
  assert.equal(reviewSave1.already_completed, false);
  assert.equal('best_correct' in reviewSave1, false);
  assert.equal('best_total' in reviewSave1, false);
  assert.equal('attempts' in reviewSave1, false);
  assert.deepEqual(reviewSave1.responses, [
    { id: 'q1', response: 'Đáp án A 1', correct: true },
    { id: 'q2', response: 'Đáp án A 2', correct: false }
  ]);

  const reviewRow1 = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(Number(reviewRow1.answered), 2);
  assert.equal(Number(reviewRow1.correct_count), 1);
  assert.equal(Number(reviewRow1.total_count), 20);
  assert.equal(reviewRow1.completed_at, null);
  assert.equal(reviewRow1.best_correct, null);
  assert.equal(Number(reviewRow1.attempts), 0);

  // Merge no-overwrite: q1/q2 đã trả lời thì giữ đáp án cũ (kể cả đáp án mới
  // đúng), chỉ thêm q3.
  const reviewSave2 = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    {
      mode: 'review',
      responses: [
        { id: 'q1', response: 'Đáp án B 1' },
        { id: 'q2', response: 'Đáp án B 2' },
        { id: 'q3', response: 'Đáp án A 3' }
      ],
      completed: false
    }
  );
  assert.equal(reviewSave2.answered, 3);
  assert.equal(reviewSave2.correct_count, 2);
  const reviewSave2ById = new Map(reviewSave2.responses.map((entry) => [entry.id, entry]));
  assert.deepEqual(reviewSave2ById.get('q1'), {
    id: 'q1',
    response: 'Đáp án A 1',
    correct: true
  });
  assert.deepEqual(reviewSave2ById.get('q2'), {
    id: 'q2',
    response: 'Đáp án A 2',
    correct: false
  });
  assert.deepEqual(reviewSave2ById.get('q3'), {
    id: 'q3',
    response: 'Đáp án A 3',
    correct: true
  });

  const reviewResume = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 0, {
    mode: 'review'
  });
  assert.equal(reviewResume.restarted, false);
  assert.equal(reviewResume.remaining_seconds, null);
  assert.equal(reviewResume.completed_at, null);
  assert.equal(
    new Date(reviewResume.started_at).getTime(),
    new Date(reviewRow1.started_at).getTime(),
    'Review đang làm phải resume đúng vị trí'
  );

  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: [],
      completed: true
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_REVIEW_INCOMPLETE',
    'Ôn tập chưa đủ câu không được completed'
  );
  assert.equal((await readProgress(created.id, VIEWER, 0, 'review')).completed_at, null);

  const reviewRemainingAnswers = stored.questions
    .slice(3, 20)
    .map((question) => ({ id: question.id, response: question.correct }));
  const reviewComplete = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    {
      mode: 'review',
      responses: reviewRemainingAnswers,
      completed: true
    }
  );
  assert.equal(reviewComplete.answered, 20);
  assert.equal(reviewComplete.correct_count, 19);
  assert.equal(reviewComplete.total_count, 20);
  assert.ok(reviewComplete.completed_at);
  assert.equal(reviewComplete.remaining_seconds, null);
  assert.equal(reviewComplete.expired, false);
  assert.equal(reviewComplete.already_completed, false);
  assert.equal(reviewComplete.responses.length, 20);
  assert.equal(reviewComplete.responses.find((entry) => entry.id === 'q2').correct, false);

  const reviewCompletedRow = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(Number(reviewCompletedRow.answered), 20);
  assert.equal(Number(reviewCompletedRow.correct_count), 19);
  assert.ok(reviewCompletedRow.completed_at);
  assert.equal(reviewCompletedRow.best_correct, null);
  assert.equal(Number(reviewCompletedRow.attempts), 0);

  const reviewDuplicate = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    { mode: 'review', responses: [], completed: false }
  );
  assert.equal(reviewDuplicate.already_completed, true);
  assert.equal(reviewDuplicate.answered, 20);
  assert.equal(reviewDuplicate.correct_count, 19);
  assert.equal(
    new Date(reviewDuplicate.completed_at).getTime(),
    new Date(reviewComplete.completed_at).getTime()
  );

  await assert.rejects(
    () => QuizSetService.answerReview(VIEWER, COURSE_CODE, created.id, 0, {
      questionId: 'q1',
      response: 'Đáp án A 1'
    }),
    (err) => err.status === 409 && err.code === 'QUIZ_COMPLETED',
    'Answer sau khi hoàn thành ôn tập phải trả 409'
  );

  const reviewCompletedDetail = await QuizSetService.getPart(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    'review'
  );
  assert.equal(reviewCompletedDetail.review, null);
  assert.equal(reviewCompletedDetail.progress.answered, 20);
  assert.ok(reviewCompletedDetail.progress.completed_at);
  assert.equal(
    reviewCompletedDetail.progress.responses.find((entry) => entry.id === 'q2').correct,
    false
  );

  const listedAfterReview = await QuizSetService.listSets(VIEWER, COURSE_CODE);
  const listedReviewSet = listedAfterReview.sets.find(
    (item) => String(item.id) === String(created.id)
  );
  assert.equal(listedReviewSet.progress[0].review.answered, 20);
  assert.ok(listedReviewSet.progress[0].review.completed_at);
  assertNoAnswerLeak(listedReviewSet, 'listSets sau khi ôn tập xong');

  const reviewRestart = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 0, {
    mode: 'review',
    restart: true
  });
  assert.equal(reviewRestart.restarted, true, 'Ôn tập xong + restart phải làm lại');
  assert.equal(reviewRestart.completed_at, null);
  assert.equal(reviewRestart.remaining_seconds, null);
  const reviewRestartedRow = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(Number(reviewRestartedRow.answered), 0);
  assert.equal(Number(reviewRestartedRow.correct_count), 0);
  assert.equal(Number(reviewRestartedRow.total_count), 20);
  assert.deepEqual(reviewRestartedRow.responses, []);
  assert.equal(reviewRestartedRow.completed_at, null);
  assert.equal(reviewRestartedRow.best_correct, null);
  assert.equal(Number(reviewRestartedRow.attempts), 0);

  const reviewRestartAgain = await QuizSetService.startPart(
    VIEWER,
    COURSE_CODE,
    created.id,
    0,
    { mode: 'review', restart: true }
  );
  assert.equal(reviewRestartAgain.restarted, false, 'Review đang làm restart phải resume');
  assert.equal(
    new Date(reviewRestartAgain.started_at).getTime(),
    new Date(reviewRestart.started_at).getTime()
  );

  // 12. Kiểm tra: lưu đáp án mới nhất trước khi nộp, không lộ correct; nộp
  //     chấm toàn bộ, attempts/best đúng, nộp lặp idempotent, review sau nộp.
  const testSave1 = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    {
      mode: 'test',
      responses: [
        { id: 'q21', response: 'Đáp án A 21' },
        { id: 'q22', response: 'Đáp án A 22' }
      ],
      completed: false
    }
  );
  assert.equal(testSave1.mode, 'test');
  assert.equal(testSave1.answered, 2);
  assert.equal(testSave1.total_count, 20);
  assert.equal(testSave1.completed_at, null);
  assert.equal(testSave1.already_completed, false);
  assert.ok(testSave1.remaining_seconds > 0);
  assert.equal(testSave1.expired, false);
  assert.equal('correct_count' in testSave1, false);
  assertNoAnswerLeak(testSave1, 'saveProgress test trước khi nộp');
  assert.deepEqual(testSave1.responses, [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án A 22' }
  ]);

  const testRowBeforeSubmit = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(testRowBeforeSubmit.answered), 2);
  assert.equal(Number(testRowBeforeSubmit.correct_count), 0);
  assert.equal(Number(testRowBeforeSubmit.total_count), 20);
  assert.equal(testRowBeforeSubmit.completed_at, null);
  assert.equal(Number(testRowBeforeSubmit.best_correct), 12);
  assert.equal(Number(testRowBeforeSubmit.best_total), 20);
  assert.equal(Number(testRowBeforeSubmit.attempts), 3);
  assert.deepEqual(testRowBeforeSubmit.responses, [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án A 22' }
  ]);

  const testDetailBeforeSubmit = await QuizSetService.getPart(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    'test'
  );
  assert.equal(testDetailBeforeSubmit.review, null);
  assert.equal(testDetailBeforeSubmit.progress.answered, 2);
  assert.deepEqual(testDetailBeforeSubmit.progress.responses, [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án A 22' }
  ]);
  assertNoAnswerLeak(testDetailBeforeSubmit.progress, 'detail test trước khi nộp');

  // Đổi đáp án trước khi nộp: latest wins, không lưu cờ đúng/sai.
  const testSave2 = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    {
      mode: 'test',
      responses: [
        { id: 'q21', response: 'Đáp án A 21' },
        { id: 'q22', response: 'Đáp án B 22' }
      ],
      completed: false
    }
  );
  assert.equal(testSave2.answered, 2);
  assert.deepEqual(testSave2.responses, [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án B 22' }
  ]);
  assertNoAnswerLeak(testSave2, 'saveProgress test đổi đáp án');
  const testRowAfterChange = await readProgress(created.id, VIEWER, 1, 'test');
  assert.deepEqual(testRowAfterChange.responses, [
    { id: 'q21', response: 'Đáp án A 21' },
    { id: 'q22', response: 'Đáp án B 22' }
  ]);
  assert.equal(Number(testRowAfterChange.correct_count), 0);

  const testComplete = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    {
      mode: 'test',
      responses: [{ id: 'q23', response: 'Đáp án C 23' }],
      completed: true
    }
  );
  assert.equal(testComplete.answered, 3);
  assert.equal(testComplete.correct_count, 2);
  assert.equal(testComplete.total_count, 20);
  assert.ok(testComplete.completed_at);
  assert.equal(testComplete.remaining_seconds, 0);
  assert.equal(testComplete.expired, false);
  assert.equal(testComplete.already_completed, false);
  assert.equal(testComplete.best_correct, 12);
  assert.equal(testComplete.best_total, 20);
  assert.equal(testComplete.attempts, 4);
  assert.equal(testComplete.responses.length, 3);
  assert.equal(testComplete.responses.find((entry) => entry.id === 'q21').correct, true);
  assert.equal(testComplete.responses.find((entry) => entry.id === 'q22').correct, true);
  assert.equal(testComplete.responses.find((entry) => entry.id === 'q23').correct, false);

  const testCompletedRow = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(testCompletedRow.correct_count), 2);
  assert.equal(Number(testCompletedRow.attempts), 4);
  assert.equal(Number(testCompletedRow.best_correct), 12);
  assert.equal(Number(testCompletedRow.best_total), 20);
  assert.ok(testCompletedRow.completed_at);

  const testDuplicate = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    {
      mode: 'test',
      responses: [{ id: 'q24', response: 'Đáp án B 24' }],
      completed: true
    }
  );
  assert.equal(testDuplicate.already_completed, true);
  assert.equal(testDuplicate.answered, 3);
  assert.equal(testDuplicate.correct_count, 2);
  assert.equal(testDuplicate.attempts, 4);
  assert.equal(
    new Date(testDuplicate.completed_at).getTime(),
    new Date(testComplete.completed_at).getTime()
  );
  assert.equal(testDuplicate.responses.some((entry) => entry.id === 'q24'), false);
  const testRowAfterDuplicate = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(testRowAfterDuplicate.answered), 3);
  assert.equal(Number(testRowAfterDuplicate.attempts), 4);

  const testDetailCompleted = await QuizSetService.getPart(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    'test'
  );
  assert.ok(Array.isArray(testDetailCompleted.review));
  assert.equal(testDetailCompleted.review.length, 20);
  const reviewById = new Map(testDetailCompleted.review.map((entry) => [entry.id, entry]));
  assert.deepEqual(Object.keys(reviewById.get('q21')).sort(), ['correct', 'explanation', 'id']);
  assert.equal(reviewById.get('q21').correct, 'Đáp án A 21');
  assert.equal(reviewById.get('q22').correct, 'Đáp án B 22');
  assert.equal(reviewById.get('q23').correct, 'Đáp án A 23');
  assert.equal(reviewById.get('q24').correct, 'Đáp án B 24');
  assert.equal(reviewById.get('q21').explanation, 'Giải thích cho câu 21.');
  assert.equal(
    testDetailCompleted.progress.responses.find((entry) => entry.id === 'q23').correct,
    false
  );

  const listedAfterTest = await QuizSetService.listSets(VIEWER, COURSE_CODE);
  const listedTestSet = listedAfterTest.sets.find(
    (item) => String(item.id) === String(created.id)
  );
  assert.equal(listedTestSet.progress[1].test.best_correct, 12);
  assert.equal(listedTestSet.progress[1].test.best_total, 20);
  assert.equal(listedTestSet.progress[1].test.attempts, 4);
  assert.ok(listedTestSet.progress[1].test.completed_at);
  assertNoAnswerLeak(listedTestSet, 'listSets sau khi kiểm tra xong');

  const gradedRestart = await QuizSetService.startPart(
    VIEWER,
    COURSE_CODE,
    created.id,
    1,
    { mode: 'test', restart: true }
  );
  assert.equal(gradedRestart.restarted, true);
  assert.equal(gradedRestart.completed_at, null);
  assert.ok(gradedRestart.remaining_seconds > 1790);
  const gradedRestartRow = await readProgress(created.id, VIEWER, 1, 'test');
  assert.equal(Number(gradedRestartRow.answered), 0);
  assert.equal(Number(gradedRestartRow.correct_count), 0);
  assert.deepEqual(gradedRestartRow.responses, []);
  assert.equal(Number(gradedRestartRow.best_correct), 12);
  assert.equal(Number(gradedRestartRow.best_total), 20);
  assert.equal(Number(gradedRestartRow.attempts), 4);

  // Nộp sớm khi chưa trả lời câu nào (còn hạn) → 400; sau khi trả lời thì
  // attempt đầu tiên khởi tạo best/attempts.
  const part2Start = await QuizSetService.startPart(VIEWER, COURSE_CODE, created.id, 2, {
    mode: 'test'
  });
  assert.ok(part2Start.remaining_seconds > 1790);
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 2, {
      mode: 'test',
      responses: [],
      completed: true
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_EMPTY_SUBMIT',
    'Nộp 0 câu trước khi hết giờ phải trả 400'
  );
  const part2BeforeSubmit = await readProgress(created.id, VIEWER, 2, 'test');
  assert.equal(Number(part2BeforeSubmit.answered), 0);
  assert.equal(part2BeforeSubmit.completed_at, null);
  assert.equal(Number(part2BeforeSubmit.attempts), 0);

  const part2Complete = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    created.id,
    2,
    {
      mode: 'test',
      responses: [
        { id: 'q41', response: 'Đáp án A 41' },
        { id: 'q42', response: 'Đáp án A 42' },
        { id: 'q43', response: 'Đáp án C 43' },
        { id: 'q44', response: 'Đáp án B 44' }
      ],
      completed: true
    }
  );
  assert.equal(part2Complete.answered, 4);
  assert.equal(part2Complete.correct_count, 2);
  assert.equal(part2Complete.total_count, 20);
  assert.equal(part2Complete.best_correct, 2);
  assert.equal(part2Complete.best_total, 20);
  assert.equal(part2Complete.attempts, 1);
  assert.ok(part2Complete.completed_at);

  // 13. Hết giờ: response mới bị 409 và không đổi row; finalize lấy dữ liệu đã
  //     lưu; hết giờ với 0 câu vẫn được finalize.
  const timeoutSet = await QuizSetService.createSet(AUTHOR, COURSE_CODE, {
    title: 'Bộ đề kiểm tra timeout 5 câu',
    questions: makeQuestions(5, 'timeout'),
    sourceFiles: [{ name: 'timeout.json', questionCount: 5 }],
    maxQuestionsPerPart: 5,
    minutesPerPart: 5
  });
  assert.equal(timeoutSet.part_count, 1);
  assert.deepEqual(timeoutSet.part_sizes, [5]);
  const timeoutStart = await QuizSetService.startPart(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    { mode: 'test' }
  );
  assert.ok(timeoutStart.remaining_seconds > 290 && timeoutStart.remaining_seconds <= 300);

  const timeoutSaved = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    {
      mode: 'test',
      responses: [
        { id: 'q1', response: 'Đáp án A 1' },
        { id: 'q2', response: 'Đáp án B 2' }
      ],
      completed: false
    }
  );
  assert.equal(timeoutSaved.answered, 2);
  assertNoAnswerLeak(timeoutSaved, 'saveProgress timeout trước hạn');

  const timeoutRowBeforeExpiry = await readProgress(timeoutSet.id, VIEWER, 0, 'test');
  await query(`
    UPDATE course_quiz_progress
    SET started_at = NOW() - INTERVAL '301 seconds',
        updated_at = NOW()
    WHERE mssv = $1 AND set_id = $2 AND part_index = 0 AND mode = 'test';
  `, [VIEWER, timeoutSet.id]);
  const timeoutRowExpired = await readProgress(timeoutSet.id, VIEWER, 0, 'test');

  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, timeoutSet.id, 0, {
      mode: 'test',
      responses: [{ id: 'q3', response: 'Đáp án A 3' }],
      completed: false
    }),
    (err) => err.status === 409 && err.code === 'QUIZ_TIME_UP',
    'Response mới sau hạn phải trả 409 QUIZ_TIME_UP'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, timeoutSet.id, 0, {
      mode: 'test',
      responses: [{ id: 'q3', response: 'Đáp án A 3' }],
      completed: true
    }),
    (err) => err.status === 409 && err.code === 'QUIZ_TIME_UP',
    'Không được merge response mới vào lần finalize sau hạn'
  );
  const timeoutRowAfterLate = await readProgress(timeoutSet.id, VIEWER, 0, 'test');
  assert.deepEqual(timeoutRowAfterLate.responses, timeoutRowExpired.responses);
  assert.deepEqual(timeoutRowAfterLate.responses, timeoutRowBeforeExpiry.responses);
  assert.equal(Number(timeoutRowAfterLate.answered), 2);
  assert.equal(timeoutRowAfterLate.completed_at, null);
  assert.equal(
    new Date(timeoutRowAfterLate.started_at).getTime(),
    new Date(timeoutRowExpired.started_at).getTime(),
    'Late response không được đổi started_at/row'
  );

  const timeoutFinal = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    { mode: 'test', responses: [], completed: true }
  );
  assert.equal(timeoutFinal.answered, 2);
  assert.equal(timeoutFinal.correct_count, 2);
  assert.equal(timeoutFinal.total_count, 5);
  assert.equal(timeoutFinal.best_correct, 2);
  assert.equal(timeoutFinal.best_total, 5);
  assert.equal(timeoutFinal.attempts, 1);
  assert.ok(timeoutFinal.completed_at);
  assert.equal(timeoutFinal.remaining_seconds, 0);
  assert.equal(timeoutFinal.expired, true);
  assert.equal(timeoutFinal.already_completed, false);

  const timeoutDetail = await QuizSetService.getPart(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    'test'
  );
  assert.equal(timeoutDetail.review.length, 5);
  assert.equal(timeoutDetail.review.find((entry) => entry.id === 'q1').correct, 'Đáp án A 1');
  assert.equal(timeoutDetail.review.find((entry) => entry.id === 'q3').correct, 'Đáp án A 3');

  const timeoutRestart = await QuizSetService.startPart(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    { mode: 'test', restart: true }
  );
  assert.equal(timeoutRestart.restarted, true);
  assert.ok(timeoutRestart.remaining_seconds > 290);
  const timeoutRestartRow = await readProgress(timeoutSet.id, VIEWER, 0, 'test');
  assert.equal(Number(timeoutRestartRow.best_correct), 2);
  assert.equal(Number(timeoutRestartRow.best_total), 5);
  assert.equal(Number(timeoutRestartRow.attempts), 1);

  await query(`
    UPDATE course_quiz_progress
    SET started_at = NOW() - INTERVAL '301 seconds',
        updated_at = NOW()
    WHERE mssv = $1 AND set_id = $2 AND part_index = 0 AND mode = 'test';
  `, [VIEWER, timeoutSet.id]);
  const zeroTimeoutFinal = await QuizSetService.saveProgress(
    VIEWER,
    COURSE_CODE,
    timeoutSet.id,
    0,
    { mode: 'test', responses: [], completed: true }
  );
  assert.equal(zeroTimeoutFinal.answered, 0);
  assert.equal(zeroTimeoutFinal.correct_count, 0);
  assert.equal(zeroTimeoutFinal.total_count, 5);
  assert.equal(zeroTimeoutFinal.attempts, 2);
  assert.equal(zeroTimeoutFinal.best_correct, 2, 'Điểm 0 không được thay best cũ');
  assert.equal(zeroTimeoutFinal.best_total, 5);
  assert.ok(zeroTimeoutFinal.completed_at);
  assert.equal(zeroTimeoutFinal.expired, true);

  // Validate progress: mode/responses, không ghi trước start.
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'practice',
      responses: [],
      completed: false
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: [{ id: 'q1' }],
      completed: false
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: Array.from({ length: 21 }, (_, index) => ({
        id: `q${index + 1}`,
        response: `Đáp án A ${index + 1}`
      })),
      completed: false
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created65.id, 0, {
      mode: 'review',
      responses: [],
      completed: false
    }),
    (err) => err.status === 409 && err.code === 'QUIZ_NOT_STARTED'
  );
  assert.equal(
    await readProgress(created65.id, VIEWER, 0, 'review'),
    null,
    'Progress không được tạo trước khi start'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: [{ id: 'q21', response: 'Đáp án A 21' }],
      completed: false
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID',
    'Không được lưu câu ngoài phần'
  );
  await assert.rejects(
    () => QuizSetService.saveProgress(VIEWER, COURSE_CODE, created.id, 0, {
      mode: 'review',
      responses: [{ id: 'q1', response: 'Đáp án Z 1' }],
      completed: false
    }),
    (err) => err.status === 400 && err.code === 'QUIZ_SET_INVALID',
    'Không được lưu option không tồn tại'
  );
  const reviewAfterInvalid = await readProgress(created.id, VIEWER, 0, 'review');
  assert.equal(Number(reviewAfterInvalid.answered), 0);
  assert.deepEqual(reviewAfterInvalid.responses, []);

  // 14. Quyền xóa: chỉ tác giả; xóa set cascade progress.
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
  await QuizSetService.deleteSet(AUTHOR, COURSE_CODE, timeoutSet.id);

  console.log('✓ Bộ đề trắc nghiệm: TTCDS create, chia phần server-side, list/detail không lộ đáp án, quyền xem/xóa, start review/test, answer review, save progress hai chế độ, chấm/best/attempts, timeout và restart đều hoạt động.');
} finally {
  await query('DELETE FROM identity_entitlement_grants WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM students WHERE mssv IN ($1, $2, $3)', [AUTHOR, VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code = $1', [COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
