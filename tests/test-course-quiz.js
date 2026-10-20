import assert from 'node:assert/strict';
import {
  QUIZ_SCHEMA,
  QUIZ_MAX_BYTES,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_OPTIONS,
  QUIZ_MAX_OPTIONS,
  QUIZ_DEFAULT_TIME_LIMIT,
  parseQuizJson,
  normalizeQuiz,
  publicQuizQuestions,
  gradeQuizResponse,
  gradeQuizResponses,
  remainingSeconds,
  quizTemplateJson
} from '../src/utils/quiz-data.js';

console.log('🧪 Kiểm tra quiz-data...');

// constants
assert.equal(QUIZ_SCHEMA, 'bdu-quiz/v1');
assert.equal(QUIZ_MAX_BYTES, 256 * 1024);
assert.equal(QUIZ_MAX_QUESTIONS, 100);
assert.equal(QUIZ_MIN_OPTIONS, 2);
assert.equal(QUIZ_MAX_OPTIONS, 6);
assert.equal(QUIZ_DEFAULT_TIME_LIMIT, 0);

// valid parse
const validText = JSON.stringify({
  schema: 'bdu-quiz/v1',
  title: 'T',
  description: 'D',
  timeLimitSeconds: 600,
  questions: [{ id: 'q1', question: 'Q?', options: ['A', 'B'], correct: 'b', explanation: 'E' }]
});
let r = parseQuizJson(validText);
assert.equal(r.ok, true, 'parse hợp lệ');
assert.equal(r.errors.length, 0);
assert.equal(r.quiz.schema, 'bdu-quiz/v1');
assert.equal(r.quiz.title, 'T');
assert.equal(r.quiz.description, 'D');
assert.equal(r.quiz.timeLimitSeconds, 600);
assert.equal(r.quiz.questions[0].correct, 'B');
assert.equal(r.quiz.questions[0].explanation, 'E');

// BOM
r = parseQuizJson('\uFEFF' + validText);
assert.equal(r.ok, true, 'BOM bị bỏ');

// CRLF normalization
const crlf = JSON.stringify({
  schema: 'bdu-quiz/v1',
  questions: [{ question: 'line1\r\nline2', options: ['a\r\nb', 'c'], correct: 'a\r\nb' }]
});
r = parseQuizJson(crlf);
assert.equal(r.ok, true);
assert.equal(r.quiz.questions[0].question, 'line1\nline2');
assert.equal(r.quiz.questions[0].options[0], 'a\nb');
assert.equal(r.quiz.questions[0].correct, 'a\nb');

// schema missing/wrong
r = parseQuizJson(JSON.stringify({ questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] }));
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$.schema'));

r = parseQuizJson(JSON.stringify({ schema: 'x', questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] }));
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$.schema'));

// top-level array
r = parseQuizJson(JSON.stringify([{ question: 'q', options: ['a','b'], correct: 'A' }]));
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$'));

// JSON invalid
r = parseQuizJson('{bad json');
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$' && /JSON không hợp lệ/.test(e.message)));

// 0 questions
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$.questions'));

// 101 questions
const many = Array.from({ length: 101 }, (_, i) => ({ question: `q${i}`, options: ['a','b'], correct: 'A' }));
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: many });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => e.path === '$.questions'));

// 1 option
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: ['a'], correct: 'A' }] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => /options/.test(e.path)));

// 7 options
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: ['a','b','c','d','e','f','g'], correct: 'A' }] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => /options/.test(e.path)));

// duplicate options case/whitespace
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: ['Ab', ' ab '], correct: 'A' }] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => /options/.test(e.path)));

// correct khớp option khác hoa/thường + khoảng trắng -> lưu chuỗi option gốc (canonical)
r = normalizeQuiz({
  schema: 'bdu-quiz/v1',
  questions: [
    {
      question: 'q',
      options: [' Hàng đợi ', 'Ngăn xếp'],
      correct: '  ngăn xếp  '
    }
  ]
});
assert.equal(r.ok, true);
assert.equal(r.quiz.questions[0].correct, 'Ngăn xếp');
assert.deepEqual(r.quiz.questions[0].options, ['Hàng đợi', 'Ngăn xếp']);

// correct là chữ cái không trùng option -> lỗi đúng message
r = normalizeQuiz({
  schema: 'bdu-quiz/v1',
  questions: [{ question: 'q', options: ['Hàng đợi', 'Ngăn xếp'], correct: 'B' }]
});
assert.equal(r.ok, false);
assert.ok(r.errors.some((e) => e.path === 'questions[0].correct'));
assert.ok(
  r.errors.some((e) => e.message === 'Câu 1: correct phải trùng một lựa chọn trong options.'),
  'correct sai phải báo đúng message'
);

// correct number rejected
r = normalizeQuiz({
  schema: 'bdu-quiz/v1',
  questions: [{ question: 'q', options: ['Hàng đợi', 'Ngăn xếp'], correct: 1 }]
});
assert.equal(r.ok, false);
assert.ok(r.errors.some((e) => /correct/.test(e.path)));

// correct rỗng / toàn khoảng trắng cũng bị từ chối
for (const emptyCorrect of ['', '   ']) {
  r = normalizeQuiz({
    schema: 'bdu-quiz/v1',
    questions: [{ question: 'q', options: ['Hàng đợi', 'Ngăn xếp'], correct: emptyCorrect }]
  });
  assert.equal(r.ok, false, `correct ${JSON.stringify(emptyCorrect)} phải bị từ chối`);
  assert.ok(
    r.errors.some((e) => e.message === 'Câu 1: correct phải trùng một lựa chọn trong options.'),
    `correct ${JSON.stringify(emptyCorrect)} phải báo lỗi trùng option`
  );
}

// id: none -> q1..qN
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [
  { question: 'q1', options: ['a','b'], correct: 'A' },
  { question: 'q2', options: ['a','b'], correct: 'A' }
] });
assert.equal(r.ok, true);
assert.equal(r.quiz.questions[0].id, 'q1');
assert.equal(r.quiz.questions[1].id, 'q2');

// id: all present kept
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [
  { id: 'x', question: 'q1', options: ['a','b'], correct: 'A' },
  { id: 'y', question: 'q2', options: ['a','b'], correct: 'A' }
] });
assert.equal(r.ok, true);
assert.equal(r.quiz.questions[0].id, 'x');
assert.equal(r.quiz.questions[1].id, 'y');

// id mixed -> error
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [
  { id: 'x', question: 'q1', options: ['a','b'], correct: 'A' },
  { question: 'q2', options: ['a','b'], correct: 'A' }
] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => /id/.test(e.path)));

// id duplicate -> error
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [
  { id: 'x', question: 'q1', options: ['a','b'], correct: 'A' },
  { id: 'x', question: 'q2', options: ['a','b'], correct: 'A' }
] });
assert.equal(r.ok, false);
assert.ok(r.errors.some(e => /id/.test(e.path)));

// char limits
const longQ = 'a'.repeat(2001);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: longQ, options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, false);
const okQ = 'a'.repeat(2000);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: okQ, options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, true);

const longOpt = 'a'.repeat(501);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: [longOpt, 'b'], correct: longOpt }] });
assert.equal(r.ok, false);
const okOpt = 'a'.repeat(500);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: [okOpt, 'b'], correct: okOpt }] });
assert.equal(r.ok, true);

const longExp = 'a'.repeat(2001);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: ['a','b'], correct: 'A', explanation: longExp }] });
assert.equal(r.ok, false);
const okExp = 'a'.repeat(2000);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q', options: ['a','b'], correct: 'A', explanation: okExp }] });
assert.equal(r.ok, true);

const longTitle = 'a'.repeat(181);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', title: longTitle, questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, false);
const okTitle = 'a'.repeat(180);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', title: okTitle, questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, true);

const longDesc = 'a'.repeat(5001);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', description: longDesc, questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, false);
const okDesc = 'a'.repeat(5000);
r = normalizeQuiz({ schema: 'bdu-quiz/v1', description: okDesc, questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, true);

// timeLimitSeconds
for (const [v, ok] of [[0, true], [29, false], [30, true], [14400, true], [14401, false]]) {
  r = normalizeQuiz({ schema: 'bdu-quiz/v1', timeLimitSeconds: v, questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
  assert.equal(r.ok, ok, `tls ${v}`);
}
r = normalizeQuiz({ schema: 'bdu-quiz/v1', timeLimitSeconds: '600', questions: [{ question: 'q', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, false);

// size parse
const big = 'a'.repeat(QUIZ_MAX_BYTES + 1);
r = parseQuizJson(big);
assert.equal(r.ok, false);
// exact boundary text (valid small json) not >; test byte length exact by padding? just ensure under works
r = parseQuizJson(validText);
assert.equal(r.ok, true);

// control chars rejected
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: 'q\u0000x', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, false);
// script kept
r = normalizeQuiz({ schema: 'bdu-quiz/v1', questions: [{ question: '<script>alert(1)</script>', options: ['a','b'], correct: 'A' }] });
assert.equal(r.ok, true);
assert.equal(r.quiz.questions[0].question, '<script>alert(1)</script>');

// publicQuizQuestions
const pq = publicQuizQuestions([{ id: 'q1', question: 'Q', options: ['a','b'], correct: 'A', explanation: 'E' }]);
assert.deepEqual(pq, [{ id: 'q1', question: 'Q', options: ['a','b'] }]);

// gradeQuizResponse: response là nội dung option, trim + case-insensitive
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, 'B'), true);
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, '  b  '), true);
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, 'a'), false);
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, 'z'), false);
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, ''), false);
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'b' }, null), false);
// response đúng correct nhưng không phải option hợp lệ -> false
assert.equal(gradeQuizResponse({ options: ['a','b'], correct: 'c' }, 'c'), false);
// chữ cái không còn là đáp án
assert.equal(gradeQuizResponse({ options: ['Hàng đợi','Ngăn xếp'], correct: 'Ngăn xếp' }, 'B'), false);
// response CRLF phải khớp option đã chuẩn hóa newline (\n)
assert.equal(
  gradeQuizResponse({ options: ['a\nb'], correct: 'a\nb' }, 'a\r\nb'),
  true,
  'response CRLF phải khớp option đã chuẩn hóa newline'
);

// gradeQuizResponses: response text, canonical hóa, bỏ entry không hợp lệ/trùng/lạ
const gq = gradeQuizResponses(
  [
    { id: 'a', options: ['a','b'], correct: 'a' },
    { id: 'b', options: ['Hàng đợi','Ngăn xếp'], correct: 'Ngăn xếp' },
    { id: 'c', options: ['a','b'], correct: 'b' }
  ],
  [
    { id: 'a', response: 'A' },
    { id: 'b', response: 'ngăn xếp', correct: true },
    { id: 'x', response: 'a' },
    { id: 'a', response: 'b' },
    { id: 'c', response: 'z' },
    { id: 'c', response: 'B' },
    { id: 'b', response: 1 },
    'junk'
  ]
);
assert.deepEqual(gq.entries, [
  { id: 'a', response: 'a', correct: true },
  { id: 'b', response: 'Ngăn xếp', correct: true },
  { id: 'c', response: 'b', correct: true }
]);
assert.equal(gq.answered, 3);
assert.equal(gq.correct, 3);

// response sai nhưng hợp lệ: giữ entry, correct=false, không tin cờ client
const gqWrong = gradeQuizResponses(
  [{ id: 'q1', options: ['a','b'], correct: 'b' }],
  [{ id: 'q1', response: 'a', correct: true }]
);
assert.deepEqual(gqWrong.entries, [{ id: 'q1', response: 'a', correct: false }]);
assert.equal(gqWrong.answered, 1);
assert.equal(gqWrong.correct, 0);

// remainingSeconds
assert.equal(remainingSeconds(null, 0), null);
const now = 1000000;
assert.equal(remainingSeconds(null, 600, now), 600);
const start = now - 60000;
assert.equal(remainingSeconds(start, 600, now), 540);
const start2 = now - 700000;
assert.equal(remainingSeconds(start2, 600, now), 0);
// Date object
assert.equal(remainingSeconds(new Date(start), 600, now), 540);

// quizTemplateJson: correct là nội dung option, không phải chữ cái
const tpl = quizTemplateJson();
const parsed = JSON.parse(tpl);
assert.equal(parsed.schema, 'bdu-quiz/v1');
assert.equal(typeof parsed.questions[0].correct, 'string');
assert.ok(parsed.questions[0].options.includes(parsed.questions[0].correct), 'correct mẫu phải nằm trong options');
assert.equal(normalizeQuiz(parsed).ok, true, 'template phải validate được');

console.log('✅ quiz-data OK');
