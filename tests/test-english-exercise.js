import assert from 'node:assert/strict';
import { MoodleClient } from '../src/services/moodle.service.js';
import {
  EnglishExerciseService,
  EnglishExerciseInternals,
  learnEnglishAnswersFromReview,
  matchEnglishOption,
  normalizeEnglishQuestion
} from '../src/services/english-exercise.service.js';

const attemptHtml = `
  <form id="responseform" action="/mod/quiz/processattempt.php">
    <input type="hidden" name="attempt" value="456">
    <input type="hidden" name="sesskey" value="session-key">
    <div id="question-1" class="que multichoice">
      <div class="qtext">1. Choose the correct answer: She ___ to school.</div>
      <input type="hidden" name="q1:sequencecheck" value="1">
      <div class="answer">
        <div><input type="radio" name="q1_answer" value="0"><label>a. go</label></div>
        <div><input type="radio" name="q1_answer" value="1"><label>b. goes</label></div>
      </div>
    </div>
    <div id="question-2" class="que shortanswer">
      <div class="qtext">Complete: I ___ a student.</div>
      <div class="answer"><input class="form-control" type="text" name="q2_answer"></div>
    </div>
    <input type="hidden" name="finishattempt" value="1">
  </form>`;

const client = new MoodleClient();
const parsed = client.parseAttemptPage(attemptHtml);

assert.equal(parsed.sesskey, 'session-key');
assert.equal(parsed.formInputs.attempt, '456');
assert.equal(parsed.isLastPage, true);
assert.equal(parsed.questions.length, 2);
assert.equal(parsed.questions[0].type, 'multichoice');
assert.equal(parsed.questions[0].hiddenInputs['q1:sequencecheck'], '1');
assert.equal(parsed.questions[0].options.length, 2);
assert.equal(parsed.questions[1].type, 'shortanswer');
assert.equal(parsed.questions[1].options[0].inputType, 'text');

assert.equal(normalizeEnglishQuestion('  12.  Hello   WORLD '), 'hello world');
assert.equal(
  matchEnglishOption(parsed.questions[0].options, 'goes')?.value,
  '1'
);
assert.equal(matchEnglishOption(parsed.questions[0].options, 'unknown'), undefined);

const manual = EnglishExerciseService.addAnswer('__codex_test_question__', '__codex_test_answer__');
assert.equal(EnglishExerciseService.listAnswers().some(item => item.id === manual.id), true);
assert.equal(EnglishExerciseService.deleteAnswer(manual.id), true);

const learned = learnEnglishAnswersFromReview(`
  <div class="que">
    <div class="qtext">__codex_review_question__</div>
    <div class="rightanswer">The correct answer is: reviewed answer</div>
  </div>`);
assert.equal(learned[0].correctAnswer, 'reviewed answer');
assert.equal(learned[0].source, 'moodle-review');
assert.equal(EnglishExerciseService.deleteAnswer(learned[0].id), true);

const firstSeed = EnglishExerciseService.addAnswer('__runner_question_one__', 'goes');
const secondSeed = EnglishExerciseService.addAnswer('__runner_question_two__', 'am');
const submittedPages = [];
let finishedAttempts = 0;
const fakeClient = {
  async getQuizDetails() {
    return { title: 'Mock English Quiz', sesskey: 'mock-key', canStart: true };
  },
  async startOrResumeAttempt() {
    return { attemptId: '9001', html: 'page-one', resumed: false };
  },
  parseAttemptPage(html) {
    if (html === 'page-one') {
      return {
        sesskey: 'mock-key', formInputs: { thispage: '0', nextpage: '1' }, isLastPage: false,
        questions: [{
          index: 1, text: '__runner_question_one__', hiddenInputs: { 'q1:sequencecheck': '1' },
          options: [
            { name: 'q1_answer', value: '0', text: 'go', inputType: 'radio' },
            { name: 'q1_answer', value: '1', text: 'goes', inputType: 'radio' }
          ]
        }]
      };
    }
    return {
      sesskey: 'mock-key', formInputs: { thispage: '1', nextpage: '-1' }, isLastPage: true,
      questions: [{
        index: 2, text: '__runner_question_two__', hiddenInputs: { 'q2:sequencecheck': '1' },
        options: [{ name: 'q2_answer', value: '', text: 'Text Input', inputType: 'text' }]
      }]
    };
  },
  async submitPageAnswers(_attemptId, _sesskey, formData) {
    submittedPages.push({ ...formData });
    return submittedPages.length === 1 ? 'page-two' : 'summary';
  },
  async finishAttempt() {
    finishedAttempts++;
  },
  async getReviewPage() {
    return '<div class="que"><div class="qtext">__runner_review__</div><div class="rightanswer">The correct answer is: learned</div></div>';
  }
};
const fakeSession = { client: fakeClient, logs: [], subscribers: new Set() };
const fakeJob = { cancelled: false, controller: new AbortController() };
const runResult = await EnglishExerciseInternals.runQuiz(fakeSession, fakeJob, {
  cmid: '123', delaySeconds: 0, autoSubmit: true
});
assert.equal(runResult.answered, 2);
assert.equal(runResult.submitted, true);
assert.equal(submittedPages.length, 2, 'Trang cuối phải được lưu trước khi nộp');
assert.equal(submittedPages[0].q1_answer, '1');
assert.equal(submittedPages[1].q2_answer, 'am');
assert.equal(finishedAttempts, 1);
assert.equal(runResult.learned, 1);

EnglishExerciseService.deleteAnswer(firstSeed.id);
EnglishExerciseService.deleteAnswer(secondSeed.id);
const runnerLearned = EnglishExerciseService.listAnswers().find(item => item.question === '__runner_review__');
if (runnerLearned) EnglishExerciseService.deleteAnswer(runnerLearned.id);

console.log('✓ English parser, local answer bank and two-page auto-submit runner tests passed');
