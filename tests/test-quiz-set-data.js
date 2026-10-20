import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QUIZ_SCHEMA,
  parseQuizJson,
  normalizeQuiz,
  gradeQuizResponse,
  splitQuestionCounts,
  buildQuizSet,
  publicQuizSetQuestions
} from '../src/utils/quiz-data.js';

console.log('🧪 Kiểm tra quiz set data...');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeQuestion(index, overrides = {}) {
  return {
    id: overrides.id ?? `orig-${index}`,
    question: overrides.question ?? `Câu hỏi ${index}`,
    options: overrides.options ?? ['Đáp án A', 'Đáp án B', 'Đáp án C'],
    correct: overrides.correct ?? 'Đáp án B',
    explanation: overrides.explanation ?? `Giải thích ${index}`
  };
}

function makeQuestions(count, prefix = 'q') {
  return Array.from({ length: count }, (_, i) => {
    const q = makeQuestion(i + 1);
    q.question = `${prefix} ${i + 1}`;
    return q;
  });
}

function assertSplit(total, max, expected) {
  assert.deepEqual(
    splitQuestionCounts(total, max),
    expected,
    `split(${total}, ${max}) phải là ${JSON.stringify(expected)}`
  );
}

// ── splitQuestionCounts ─────────────────────────────────────────────────────

// Các ví dụ chốt trong spec §4.
assertSplit(60, 20, [20, 20, 20]);
assertSplit(65, 20, [17, 16, 16, 16]);
assertSplit(65, 25, [22, 22, 21]);
// 76 câu cần 16 phần khi max 5; hình dạng 5 phần đều (16/15/15/15/15) ứng với max 16.
assertSplit(76, 5, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4]);
assertSplit(76, 16, [16, 15, 15, 15, 15]);
assertSplit(20, 25, [20]);

// Biên hợp lệ.
assertSplit(1, 25, [1]);
assertSplit(25, 25, [25]);
assertSplit(26, 25, [13, 13]);
assertSplit(500, 25, Array(20).fill(25));
assertSplit(100, 5, Array(20).fill(5));

// partCount tối đa 20: 101 câu / max 5 = 21 phần -> từ chối.
assert.deepEqual(splitQuestionCounts(101, 5), [], 'quá 20 phần phải bị từ chối');

// maxPerPart ngoài 5–25 -> từ chối.
for (const badMax of [0, 4, 26, 30, 5.5, '20', null, undefined, NaN]) {
  assert.deepEqual(splitQuestionCounts(60, badMax), [], `maxPerPart ${String(badMax)} phải bị từ chối`);
}

// total ngoài 1–500 hoặc không phải số nguyên -> từ chối.
for (const badTotal of [0, -1, 501, 1.5, '60', null, undefined, NaN]) {
  assert.deepEqual(splitQuestionCounts(badTotal, 20), [], `total ${String(badTotal)} phải bị từ chối`);
}

// Bất biến: tổng khớp, mọi phần 1..max, số phần ≤ 20, không tăng dần.
for (const [total, max] of [[1, 5], [7, 5], [25, 20], [60, 20], [65, 20], [65, 25], [76, 5], [76, 16], [500, 25]]) {
  const sizes = splitQuestionCounts(total, max);
  assert.ok(Array.isArray(sizes) && sizes.length > 0, `split(${total}, ${max}) phải trả mảng`);
  assert.ok(sizes.length <= 20, `split(${total}, ${max}) không quá 20 phần`);
  assert.equal(sizes.reduce((sum, n) => sum + n, 0), total, `split(${total}, ${max}) phải cộng đúng`);
  assert.ok(sizes.every((n) => Number.isInteger(n) && n >= 1 && n <= max), `split(${total}, ${max}) mọi phần trong 1..${max}`);
  assert.ok(sizes.every((n, i) => i === 0 || n <= sizes[i - 1]), `split(${total}, ${max}) không tăng dần`);
}

// ── buildQuizSet ────────────────────────────────────────────────────────────

// Gộp 3 file 20 câu, chia 3 phần 20 câu, ID toàn cục q1..q60.
const file1 = makeQuestions(20, 'File 1 câu');
const file2 = makeQuestions(20, 'File 2 câu');
const file3 = makeQuestions(20, 'File 3 câu');
const merged = [...file1, ...file2, ...file3];

let built = buildQuizSet({ questions: merged, maxQuestionsPerPart: 20, minutesPerPart: 30 });
assert.equal(built.ok, true, 'build 60 câu hợp lệ');
assert.deepEqual(built.errors, []);
assert.ok(built.set);
assert.deepEqual(built.set.partSizes, [20, 20, 20]);
assert.equal(built.set.partCount, 3);
assert.equal(built.set.questionCount, 60);
assert.equal(built.set.maxQuestionsPerPart, 20);
assert.equal(built.set.minutesPerPart, 30);
assert.equal(built.set.questions.length, 60);

// Thứ tự file được giữ nguyên, ID gốc bị bỏ và cấp lại q1..qN.
assert.equal(built.set.questions[0].question, 'File 1 câu 1');
assert.equal(built.set.questions[20].question, 'File 2 câu 1');
assert.equal(built.set.questions[40].question, 'File 3 câu 1');
for (let i = 0; i < 60; i++) {
  assert.equal(built.set.questions[i].id, `q${i + 1}`, `ID toàn cục q${i + 1}`);
  assert.equal(built.set.questions[i].partIndex, Math.floor(i / 20), `partIndex câu ${i + 1}`);
}
assert.deepEqual(
  built.set.questions[0],
  {
    id: 'q1',
    partIndex: 0,
    question: 'File 1 câu 1',
    options: ['Đáp án A', 'Đáp án B', 'Đáp án C'],
    correct: 'Đáp án B',
    explanation: 'Giải thích 1'
  },
  'câu đã build có đủ field và không lộ field nội bộ'
);

// 65 câu / max 20 -> [17,16,16,16] và partIndex đúng biên.
built = buildQuizSet({ questions: makeQuestions(65), maxQuestionsPerPart: 20, minutesPerPart: 30 });
assert.equal(built.ok, true);
assert.deepEqual(built.set.partSizes, [17, 16, 16, 16]);
assert.equal(built.set.partCount, 4);
assert.equal(built.set.questionCount, 65);
for (const [index, expectedPart] of [[0, 0], [16, 0], [17, 1], [32, 1], [33, 2], [48, 2], [49, 3], [64, 3]]) {
  assert.equal(built.set.questions[index].partIndex, expectedPart, `câu ${index + 1} thuộc phần ${expectedPart}`);
}

// 65 câu / max 25 -> [22,22,21].
built = buildQuizSet({ questions: makeQuestions(65), maxQuestionsPerPart: 25, minutesPerPart: 30 });
assert.equal(built.ok, true);
assert.deepEqual(built.set.partSizes, [22, 22, 21]);
assert.equal(built.set.partCount, 3);

// 500 câu / max 25 -> 20 phần, không phần nào > 25.
built = buildQuizSet({ questions: makeQuestions(500), maxQuestionsPerPart: 25, minutesPerPart: 30 });
assert.equal(built.ok, true);
assert.deepEqual(built.set.partSizes, Array(20).fill(25));
assert.equal(built.set.partCount, 20);
assert.equal(built.set.questionCount, 500);
assert.ok(built.set.questions.every((q) => q.partIndex >= 0 && q.partIndex < 20));
assert.equal(built.set.questions[0].id, 'q1');
assert.equal(built.set.questions[499].id, 'q500');

// ID gốc trùng / không hợp lệ đều bị bỏ, cấp lại q1..qN.
built = buildQuizSet({
  questions: [
    makeQuestion(1, { id: 'dup' }),
    makeQuestion(2, { id: 'dup' }),
    makeQuestion(3, { id: '' }),
    makeQuestion(4, { id: 'bad id!' })
  ],
  maxQuestionsPerPart: 5,
  minutesPerPart: 5
});
assert.equal(built.ok, true, 'ID gốc phải bị bỏ qua và cấp lại');
assert.deepEqual(built.set.questions.map((q) => q.id), ['q1', 'q2', 'q3', 'q4']);

// Correct/option được chuẩn hóa lại như normalizeQuiz.
built = buildQuizSet({
  questions: [{
    question: '  Câu có khoảng trắng  ',
    options: [' Đáp án A ', 'Đáp án B'],
    correct: '  đáp án a  ',
    explanation: '  giải thích  '
  }],
  maxQuestionsPerPart: 5,
  minutesPerPart: 5
});
assert.equal(built.ok, true);
assert.equal(built.set.questions[0].question, 'Câu có khoảng trắng');
assert.deepEqual(built.set.questions[0].options, ['Đáp án A', 'Đáp án B']);
assert.equal(built.set.questions[0].correct, 'Đáp án A');
assert.equal(built.set.questions[0].explanation, 'giải thích');

// Config mặc định 20 câu/phần, 30 phút/phần.
built = buildQuizSet({ questions: makeQuestions(5) });
assert.equal(built.ok, true);
assert.equal(built.set.maxQuestionsPerPart, 20);
assert.equal(built.set.minutesPerPart, 30);

// 0 câu -> từ chối.
built = buildQuizSet({ questions: [], maxQuestionsPerPart: 20, minutesPerPart: 30 });
assert.equal(built.ok, false);
assert.equal(built.set, null);
assert.ok(built.errors.some((e) => e.path === '$.questions'), '0 câu báo lỗi $.questions');

// 501 câu -> từ chối (giới hạn 500 câu toàn bộ bộ đề).
built = buildQuizSet({ questions: makeQuestions(501), maxQuestionsPerPart: 25, minutesPerPart: 30 });
assert.equal(built.ok, false);
assert.equal(built.set, null);
assert.ok(built.errors.some((e) => e.path === '$.questions'), '501 câu báo lỗi $.questions');

// questions không phải mảng -> từ chối.
for (const badQuestions of [null, undefined, 'x', {}, 5]) {
  built = buildQuizSet({ questions: badQuestions, maxQuestionsPerPart: 20, minutesPerPart: 30 });
  assert.equal(built.ok, false, `questions ${String(badQuestions)} phải bị từ chối`);
  assert.ok(built.errors.some((e) => e.path === '$.questions'));
}

// Input null/không phải object -> từ chối thay vì throw.
built = buildQuizSet(null);
assert.equal(built.ok, false);
assert.ok(built.errors.some((e) => e.path === '$.questions'));

// maxQuestionsPerPart ngoài 5–25 -> từ chối.
for (const badMax of [4, 26, 0, 25.5, '20', null, NaN]) {
  built = buildQuizSet({ questions: makeQuestions(10), maxQuestionsPerPart: badMax, minutesPerPart: 30 });
  assert.equal(built.ok, false, `maxQuestionsPerPart ${String(badMax)} phải bị từ chối`);
  assert.equal(built.set, null);
  assert.ok(built.errors.some((e) => e.path === '$.maxQuestionsPerPart'));
}

// minutesPerPart ngoài 5–180 -> từ chối.
for (const badMinutes of [4, 181, 0, 30.5, '30', null, NaN]) {
  built = buildQuizSet({ questions: makeQuestions(10), maxQuestionsPerPart: 20, minutesPerPart: badMinutes });
  assert.equal(built.ok, false, `minutesPerPart ${String(badMinutes)} phải bị từ chối`);
  assert.equal(built.set, null);
  assert.ok(built.errors.some((e) => e.path === '$.minutesPerPart'));
}

// Tổng số câu vượt quá 20 phần (101 câu / max 5) -> từ chối.
built = buildQuizSet({ questions: makeQuestions(101), maxQuestionsPerPart: 5, minutesPerPart: 30 });
assert.equal(built.ok, false);
assert.equal(built.set, null);
assert.ok(built.errors.some((e) => e.path === '$.questions'), 'quá 20 phần báo lỗi $.questions');

// Biên hợp lệ của config.
built = buildQuizSet({ questions: makeQuestions(10), maxQuestionsPerPart: 25, minutesPerPart: 5 });
assert.equal(built.ok, true);
built = buildQuizSet({ questions: makeQuestions(10), maxQuestionsPerPart: 25, minutesPerPart: 180 });
assert.equal(built.ok, true);

// Validate lại từng câu: options 2–6, unique, correct khớp option, giới hạn ký tự.
const invalidQuestionCases = [
  { name: '1 option', override: { options: ['A'], correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: '7 options', override: { options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: 'option rỗng', override: { options: ['A', '   '], correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: 'option > 500 ký tự', override: { options: ['A', 'B'.repeat(501)], correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: 'option trùng hoa/thường + khoảng trắng', override: { options: ['A', ' a '], correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: 'options không phải mảng', override: { options: 'A,B', correct: 'A' }, path: /questions\[1\]\.options/ },
  { name: 'correct không khớp option', override: { correct: 'Z' }, path: /questions\[1\]\.correct/ },
  { name: 'correct không phải chuỗi', override: { correct: 1 }, path: /questions\[1\]\.correct/ },
  { name: 'question rỗng', override: { question: '   ' }, path: /questions\[1\]\.question/ },
  { name: 'question > 2000 ký tự', override: { question: 'x'.repeat(2001) }, path: /questions\[1\]\.question/ },
  { name: 'question không phải chuỗi', override: { question: null }, path: /questions\[1\]\.question/ },
  { name: 'explanation > 2000 ký tự', override: { explanation: 'x'.repeat(2001) }, path: /questions\[1\]\.explanation/ },
  { name: 'câu không phải object', override: null, path: /questions\[1\]/ }
];

for (const testCase of invalidQuestionCases) {
  const questions = [makeQuestion(1), makeQuestion(2)];
  if (testCase.override === null) questions[1] = 'not-an-object';
  else questions[1] = { ...questions[1], ...testCase.override };
  built = buildQuizSet({ questions, maxQuestionsPerPart: 20, minutesPerPart: 30 });
  assert.equal(built.ok, false, `phải từ chối: ${testCase.name}`);
  assert.equal(built.set, null, `set null: ${testCase.name}`);
  assert.ok(
    built.errors.some((e) => testCase.path.test(e.path)),
    `${testCase.name}: errors phải có path ${testCase.path}, nhận ${JSON.stringify(built.errors)}`
  );
}

// Biên hợp lệ: option 500 ký tự, question 2000 ký tự, explanation 2000 ký tự.
built = buildQuizSet({
  questions: [{
    question: 'q'.repeat(2000),
    options: ['a'.repeat(500), 'b'],
    correct: 'a'.repeat(500),
    explanation: 'e'.repeat(2000)
  }],
  maxQuestionsPerPart: 5,
  minutesPerPart: 5
});
assert.equal(built.ok, true, 'biên độ dài hợp lệ phải qua');

// ── publicQuizSetQuestions ──────────────────────────────────────────────────

const publicSource = buildQuizSet({
  questions: makeQuestions(30),
  maxQuestionsPerPart: 10,
  minutesPerPart: 15
}).set;

const part1 = publicQuizSetQuestions(publicSource.questions, 1);
assert.equal(part1.length, 10);
assert.equal(part1[0].id, 'q11');
assert.equal(part1[9].id, 'q20');
for (const q of part1) {
  assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'question'], 'chỉ trả id/question/options');
  assert.equal(Object.hasOwn(q, 'correct'), false);
  assert.equal(Object.hasOwn(q, 'explanation'), false);
  assert.equal(Object.hasOwn(q, 'partIndex'), false);
}
assert.deepEqual(publicQuizSetQuestions(publicSource.questions, 3), [], 'partIndex ngoài phạm vi -> []');
assert.deepEqual(publicQuizSetQuestions(publicSource.questions, -1), [], 'partIndex âm -> []');
assert.deepEqual(publicQuizSetQuestions(publicSource.questions, 0.5), [], 'partIndex lẻ -> []');
assert.deepEqual(publicQuizSetQuestions(null, 0), [], 'questions null -> []');
assert.deepEqual(publicQuizSetQuestions('x', 0), [], 'questions không phải mảng -> []');

// Trả bản sao options, không cho client sửa snapshot gốc.
part1[0].options.push('Đáp án thêm');
assert.equal(publicSource.questions[10].options.length, 3, 'options trả về phải là bản sao');

// ── Giữ nguyên normalizeQuiz / parseQuizJson / grade theo text ──────────────

const normalized = normalizeQuiz({
  schema: QUIZ_SCHEMA,
  questions: [{ id: 'keep-me', question: 'Q?', options: ['A', 'B'], correct: 'b' }]
});
assert.equal(normalized.ok, true);
assert.equal(normalized.quiz.questions[0].id, 'keep-me', 'normalizeQuiz vẫn giữ ID gốc');
assert.equal(normalized.quiz.questions[0].correct, 'B');

assert.equal(parseQuizJson(JSON.stringify({ schema: QUIZ_SCHEMA, questions: [{ question: 'Q', options: ['A', 'B'], correct: 'A' }] })).ok, true);
assert.equal(gradeQuizResponse({ options: ['A', 'B'], correct: 'B' }, ' b '), true);
assert.equal(gradeQuizResponse({ options: ['A', 'B'], correct: 'B' }, 'A'), false);

// ── Migration 065: static schema assertions ─────────────────────────────────

let migrationSql;
try {
  migrationSql = readFileSync(new URL('../migrations/065_course_quiz_sets.sql', import.meta.url), 'utf8');
  console.log('🧪 Kiểm tra migration 065...');
} catch {
  assert.fail('Missing migrations/065_course_quiz_sets.sql — tạo migration trước khi chạy test.');
}

// §3.1 dọn quiz-post cũ.
assert.match(migrationSql, /DELETE\s+FROM\s+course_posts\s+WHERE\s+kind\s*=\s*'quiz'\s*;/i);
const dropProgressAt = migrationSql.search(/DROP\s+TABLE\s+IF\s+EXISTS\s+course_quiz_progress\s*;/i);
const dropQuizzesAt = migrationSql.search(/DROP\s+TABLE\s+IF\s+EXISTS\s+course_quizzes\s*;/i);
assert.ok(dropProgressAt >= 0, 'phải drop course_quiz_progress');
assert.ok(dropQuizzesAt >= 0, 'phải drop course_quizzes');
assert.ok(dropProgressAt < dropQuizzesAt, 'drop progress trước quizzes để không vướng FK');
assert.match(
  migrationSql,
  /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+course_posts_kind_check/i,
  'drop CHECK kind cũ'
);
assert.match(
  migrationSql,
  /CHECK\s*\(\s*kind\s+IN\s*\(\s*'request'\s*,\s*'document'\s*,\s*'video'\s*,\s*'link'\s*\)\s*\)/i,
  'CHECK kind phải quay lại đúng 4 loại cũ'
);
assert.doesNotMatch(
  migrationSql,
  /CHECK\s*\([^)]*kind\s+IN\s*\([^)]*'quiz'/i,
  'CHECK kind mới không được còn quiz'
);

// §3.2 course_quiz_sets.
assert.match(migrationSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+course_quiz_sets/i);
assert.match(migrationSql, /id\s+BIGSERIAL\s+PRIMARY\s+KEY/i);
assert.match(migrationSql, /course_id\s+BIGINT\s+NOT\s+NULL\s+REFERENCES\s+courses\(id\)\s+ON\s+DELETE\s+CASCADE/i);
assert.match(migrationSql, /author_mssv\s+VARCHAR\(32\)\s+NOT\s+NULL\s+REFERENCES\s+students\(mssv\)\s+ON\s+DELETE\s+CASCADE/i);
assert.match(migrationSql, /title\s+TEXT\s+NOT\s+NULL/i);
assert.match(migrationSql, /description\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+''/i);
assert.match(migrationSql, /source_files\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i);
assert.match(migrationSql, /questions\s+JSONB\s+NOT\s+NULL/i);
assert.match(migrationSql, /part_sizes\s+JSONB\s+NOT\s+NULL/i);
assert.match(migrationSql, /part_count\s+SMALLINT\s+NOT\s+NULL\s+CHECK\s*\(\s*part_count\s+BETWEEN\s+1\s+AND\s+20\s*\)/i);
assert.match(migrationSql, /question_count\s+SMALLINT\s+NOT\s+NULL\s+CHECK\s*\(\s*question_count\s+BETWEEN\s+1\s+AND\s+500\s*\)/i);
assert.match(migrationSql, /max_questions_per_part\s+SMALLINT\s+NOT\s+NULL\s+CHECK\s*\(\s*max_questions_per_part\s+BETWEEN\s+5\s+AND\s+25\s*\)/i);
assert.match(migrationSql, /minutes_per_part\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(\s*minutes_per_part\s+BETWEEN\s+5\s+AND\s+180\s*\)/i);
assert.match(migrationSql, /created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
assert.match(migrationSql, /updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
assert.match(migrationSql, /jsonb_typeof\(questions\)\s*=\s*'array'/i);
assert.match(migrationSql, /jsonb_typeof\(part_sizes\)\s*=\s*'array'/i);
assert.match(migrationSql, /jsonb_array_length\(questions\)/i, 'question_count phải khớp độ dài questions');
assert.match(migrationSql, /jsonb_array_length\(part_sizes\)/i, 'part_count phải khớp độ dài part_sizes');
assert.match(migrationSql, /jsonb_array_elements\((?:part_sizes|sizes)\)/i, 'phải kiểm tra tổng part_sizes');
assert.match(migrationSql, /course_quiz_set_part_sizes_valid\s*\(/i, 'phải dùng hàm validate part_sizes');
assert.match(migrationSql, /jsonb_path_exists/i, 'phải kiểm tra phần tử part_sizes là số nguyên trong 1..max');

// §3.3 course_quiz_progress.
assert.match(migrationSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+course_quiz_progress/i);
assert.match(migrationSql, /mssv\s+VARCHAR\(32\)\s+NOT\s+NULL\s+REFERENCES\s+students\(mssv\)\s+ON\s+DELETE\s+CASCADE/i);
assert.match(migrationSql, /set_id\s+BIGINT\s+NOT\s+NULL\s+REFERENCES\s+course_quiz_sets\(id\)\s+ON\s+DELETE\s+CASCADE/i);
assert.match(migrationSql, /part_index\s+SMALLINT\s+NOT\s+NULL\s+CHECK\s*\(\s*part_index\s+BETWEEN\s+0\s+AND\s+19\s*\)/i);
assert.match(migrationSql, /mode\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*mode\s+IN\s*\(\s*'review'\s*,\s*'test'\s*\)\s*\)/i);
assert.match(migrationSql, /started_at\s+TIMESTAMPTZ/i);
assert.match(migrationSql, /answered\s+SMALLINT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
assert.match(migrationSql, /correct_count\s+SMALLINT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
assert.match(migrationSql, /total_count\s+SMALLINT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
assert.match(migrationSql, /best_correct\s+SMALLINT/i);
assert.match(migrationSql, /best_total\s+SMALLINT/i);
assert.match(migrationSql, /attempts\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*attempts\s*>=\s*0\s*\)/i);
assert.match(migrationSql, /responses\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i);
assert.match(migrationSql, /jsonb_typeof\(responses\)\s*=\s*'array'/i);
assert.match(migrationSql, /completed_at\s+TIMESTAMPTZ/i);
assert.match(migrationSql, /PRIMARY\s+KEY\s*\(\s*mssv\s*,\s*set_id\s*,\s*part_index\s*,\s*mode\s*\)/i);
assert.match(migrationSql, /correct_count\s+BETWEEN\s+0\s+AND\s+answered/i);
assert.match(migrationSql, /best_correct\s+IS\s+NULL\s+OR\s+best_total\s+IS\s+NULL\s+OR\s+best_correct\s+BETWEEN\s+0\s+AND\s+best_total/i);

// Indexes.
assert.match(migrationSql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+course_quiz_sets_course_idx\s+ON\s+course_quiz_sets\s*\(\s*course_id\s*,\s*created_at\s+DESC\s*\)/i);
assert.match(migrationSql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+course_quiz_sets_author_idx\s+ON\s+course_quiz_sets\s*\(\s*author_mssv\s*,\s*created_at\s+DESC\s*\)/i);
assert.match(migrationSql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+course_quiz_progress_mssv_idx\s+ON\s+course_quiz_progress\s*\(\s*mssv\s*,\s*updated_at\s+DESC\s*\)/i);
assert.match(migrationSql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+course_quiz_progress_set_idx\s+ON\s+course_quiz_progress\s*\(\s*set_id\s*,\s*part_index\s*\)/i);

// Không seed dữ liệu.
assert.doesNotMatch(migrationSql, /^\s*INSERT\s+INTO\b/im, 'migration không seed dữ liệu');

console.log('✅ quiz set data OK');
