import assert from 'node:assert/strict';
import { normalizeQuizQuestions, parseQuizImport, scoreQuizSubmission, validateQuizConfig } from '../src/services/clan-quiz.service.js';
import { parseQuizText } from '../client/src/features/clans/quiz.js';

const questions = normalizeQuizQuestions([
  { question: '2 + 2 = ?', options: ['3', '4'], correctIndex: 1, explanation: 'Phép cộng cơ bản.' }
]);
assert.equal(questions[0].correct_index, 1);
assert.deepEqual(parseQuizImport(JSON.stringify(questions.map((item) => ({ ...item, correctIndex: item.correct_index })))), questions);
assert.equal(parseQuizImport('question,options,correctIndex,explanation\n"Thủ đô?","Hà Nội|Huế",0,"Việt Nam"', 'csv')[0].prompt, 'Thủ đô?');
assert.throws(() => validateQuizConfig({ enabled: true, minCorrect: 2, questions }), /từ 0 đến 1/);
assert.throws(() => normalizeQuizQuestions([{ question: 'Thiếu đáp án', options: ['A'] }]), /từ 2 đến/);

const scored = scoreQuizSubmission({ min_correct: 1, questions: [{ id: 7, options: ['A', 'B'], correct_index: 1, explanation: 'B đúng.' }] }, [{ questionId: 7, selectedIndex: 1 }]);
assert.equal(scored.score, 1);
assert.equal(scored.passed, true);
assert.equal(scored.results[0].correct_index, 1);
assert.deepEqual(parseQuizText('{"questions":[{"question":"Q","options":["A","B"],"correctIndex":0}]}'), [{ question: 'Q', options: ['A', 'B'], correctIndex: 0 }]);
console.log('✅ Clan quiz parser/validation/scoring tests passed.');
