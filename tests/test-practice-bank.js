import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePracticeBankPayload } from '../src/modules/learning/practice-bank.parser.js';
import { PracticeBankInternals, PracticeBankService } from '../src/modules/learning/practice-bank.service.js';
import { PracticeBankController } from '../src/modules/learning/practice-bank.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeResponse() {
  const state = { statusCode: 200, body: null, headers: {} };
  const res = {
    setHeader(name, value) {
      state.headers[name] = value;
    },
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(body) {
      state.body = body;
      return res;
    }
  };
  return { res, state };
}

// 1. Validate dataset thực tế INF0983.json (300 câu, 6 chương × 50 câu).
const datasetPath = path.join(ROOT, 'data', 'practice-banks', 'INF0983.json');
assert.equal(fs.existsSync(datasetPath), true, 'Phải có file data/practice-banks/INF0983.json');
const rawDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const parsed = parsePracticeBankPayload(rawDataset, 'inf0983');

assert.equal(parsed.courseCode, 'INF0983');
assert.equal(parsed.questions.length, 300, 'INF0983 phải có đúng 300 câu');
assert.equal(parsed.chapters.length, 6, 'INF0983 phải có đúng 6 chương');
for (const ch of parsed.chapters) {
  assert.equal(ch.count, 50, `Chương ${ch.index} phải có đúng 50 câu`);
}
for (const q of parsed.questions) {
  assert.ok(['A', 'B', 'C', 'D'].includes(q.correct_answer));
  assert.ok(q.explanation.length > 0, `Câu #${q.external_id} phải có giải thích`);
}

// 2. Reject invalid parser payloads.
assert.throws(
  () => parsePracticeBankPayload({ title: 'Test', questions: [{ id: 1, chapter: 'Chương 1', question: 'Q', options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'E' }] }, 'INF0983'),
  /không hợp lệ/
);
assert.throws(
  () => parsePracticeBankPayload({
    title: 'Test',
    questions: [
      { id: 1, chapter: 'Chương 1', question: 'Q1', options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'A' },
      { id: 1, chapter: 'Chương 1', question: 'Q2', options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'B' }
    ]
  }, 'INF0983'),
  /Trùng mã câu hỏi/
);

// 3. Test balanced exam sampling & grading helpers.
const sampleRows = [];
for (let ch = 1; ch <= 6; ch += 1) {
  for (let i = 1; i <= 20; i += 1) {
    const id = (ch - 1) * 20 + i;
    sampleRows.push({
      id,
      external_id: id,
      chapter_index: ch,
      chapter_title: `Chương ${ch}`,
      question_text: `Câu ${id}`,
      options: { A: 'A', B: 'B', C: 'C', D: 'D' },
      correct_answer: 'A',
      explanation: `Giải thích ${id}`
    });
  }
}

const picked = PracticeBankInternals.selectBalancedExamQuestions(sampleRows, 18, () => 0.5);
assert.equal(picked.length, 18);
const chapterCounts = new Map();
for (const row of picked) {
  chapterCounts.set(row.chapter_index, (chapterCounts.get(row.chapter_index) || 0) + 1);
}
assert.equal(chapterCounts.size, 6, 'Đề thi thử 18 câu phải phủ đều 6 chương');
for (let ch = 1; ch <= 6; ch += 1) {
  assert.equal(chapterCounts.get(ch), 3, `Mỗi chương nên có 3 câu khi chọn 18 câu / 6 chương`);
}

const qMap = new Map(sampleRows.slice(0, 4).map((r) => [String(r.id), r]));
const graded = PracticeBankInternals.gradeExamSubmission(
  [
    { questionId: '1', selectedAnswer: 'A' },
    { questionId: '2', selectedAnswer: 'B' },
    { questionId: '3', selectedAnswer: 'A' },
    { questionId: '4', selectedAnswer: null }
  ],
  qMap
);
assert.equal(graded.total_questions, 4);
assert.equal(graded.correct_count, 2);
assert.equal(graded.wrong_count, 1);
assert.equal(graded.skipped_count, 1);
assert.equal(graded.score_percent, 50);
assert.equal(graded.chapter_breakdown.length, 1);
assert.equal(graded.chapter_breakdown[0].accuracy_percent, 50);

// 4. Verify migration 077 & learning routes isolation.
const migrationSql = fs.readFileSync(path.join(ROOT, 'migrations', '077_course_practice_bank.sql'), 'utf8');
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS course_practice_banks/);
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS course_practice_questions/);
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS course_practice_progress/);
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS course_practice_exam_attempts/);
const migrationStatements = migrationSql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
assert.equal(/course_quiz_sets|course_quiz_progress/i.test(migrationStatements), false, 'Migration 077 không được chạm bảng quiz cũ');

const routesSrc = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'learning.routes.js'), 'utf8');
assert.match(routesSrc, /\/learning\/courses\/:courseCode\/practice-bank/);
assert.match(routesSrc, /\/learning\/courses\/:courseCode\/practice-bank\/questions\/:questionId\/answer/);
assert.match(routesSrc, /\/learning\/courses\/:courseCode\/practice-bank\/exam\/submit/);

// 5. Controller contract checks (auth + cache headers + error status propagation).
const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalGetSummary = PracticeBankService.getSummary;
const originalAnswerQuestion = PracticeBankService.answerQuestion;

try {
  BduIdentityService.resolveVerifiedMssv = async () => '24050001';
  PracticeBankService.getSummary = async (mssv, courseCode) => {
    assert.equal(mssv, '24050001');
    assert.equal(courseCode, 'INF0983');
    return { enabled: true, bank: { course_code: 'INF0983' } };
  };

  const okSummary = fakeResponse();
  await PracticeBankController.getPracticeBankSummary(
    { headers: { authorization: 'Bearer ok' }, params: { courseCode: 'INF0983' } },
    okSummary.res
  );
  assert.equal(okSummary.state.statusCode, 200);
  assert.equal(okSummary.state.headers['Cache-Control'], 'private, no-store');
  assert.equal(okSummary.state.headers.Vary, 'Authorization');
  assert.equal(okSummary.state.body.result, true);
  assert.equal(okSummary.state.body.data.enabled, true);

  PracticeBankService.getSummary = async () => {
    const err = new Error('Môn học này không có trong dữ liệu học phần BDU của bạn.');
    err.status = 403;
    throw err;
  };
  const forbidden = fakeResponse();
  await PracticeBankController.getPracticeBankSummary(
    { headers: { authorization: 'Bearer ok' }, params: { courseCode: 'INF0983' } },
    forbidden.res
  );
  assert.equal(forbidden.state.statusCode, 403);
  assert.equal(forbidden.state.body.result, false);

  PracticeBankService.answerQuestion = async (_mssv, _courseCode, questionId, selectedAnswer) => ({
    question_id: questionId,
    selected_answer: selectedAnswer,
    is_correct: true,
    correct_answer: 'D',
    explanation: 'Đúng rồi.'
  });
  const ansRes = fakeResponse();
  await PracticeBankController.answerPracticeBankQuestion(
    {
      headers: { authorization: 'Bearer ok' },
      params: { courseCode: 'INF0983', questionId: '1' },
      body: { selectedAnswer: 'D' }
    },
    ansRes.res
  );
  assert.equal(ansRes.state.statusCode, 200);
  assert.equal(ansRes.state.body.data.is_correct, true);
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  PracticeBankService.getSummary = originalGetSummary;
  PracticeBankService.answerQuestion = originalAnswerQuestion;
}

console.log('✅ Practice bank parser, helpers, migration isolation & controller tests passed.');
