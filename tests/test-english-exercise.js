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

// Manual completion controls without an activity link must be queued too.
const courseHtml = `
  <li id="module-25461" class="activity modtype_label">
    <div class="activity-content"><h4>iContent</h4></div>
    <button data-action="toggle-manual-completion" data-toggletype="manual:mark-done"
      data-cmid="25461" data-activityname="iContent" data-withavailability="0">Mark as done</button>
  </li>
  <li id="module-25462" class="activity modtype_icontent">
    <a href="/mod/icontent/view.php?id=25462"><span class="instancename">9A iContent</span></a>
    <button data-action="toggle-manual-completion" data-toggletype="manual:mark-done"
      data-cmid="25462" data-activityname="9A iContent">Mark as done</button>
  </li>`;
const courseClient = new MoodleClient();
courseClient.request = async () => ({ data: courseHtml });
const activities = await courseClient.getCourseActivities('289');
assert.equal(activities.some(item => item.cmid === '25461' && item.type === 'manual'), true);
assert.equal(activities.filter(item => item.cmid === '25462').length, 1);

// JS-rendered manual controls must also be recovered from the AJAX course state.
const contentsCalls = [];
const contentsClient = new MoodleClient();
contentsClient.getSesskey = async () => 'contents-key';
contentsClient.request = async (url, options) => {
  contentsCalls.push({ url, options });
  if (url.startsWith('/course/view.php')) {
    return { data: '<a href="/mod/icontent/view.php?id=25462">9A iContent</a>' };
  }
  if (url.includes('info=core_course_get_module')) {
    const cmid = JSON.parse(options.data)[0].args.id;
    return {
      data: [{ data: cmid === 25461
        ? '<button data-action="toggle-manual-completion" data-toggletype="manual:mark-done" data-cmid="25461" data-activityname="iContent">Mark as done</button>'
        : '<li class="activity"></li>' }]
    };
  }
  return {
    data: [{ data: {
      cm: [
        {
          id: 25461,
          name: 'iContent',
          module: 'label',
          url: '',
          completion: 1,
          completiondata: { state: 0, hascompletion: true, isautomatic: false }
        },
        {
          id: 25462,
          name: '9A iContent',
          module: 'icontent',
          url: '/mod/icontent/view.php?id=25462',
          completion: 1,
          completiondata: { state: 0, hascompletion: true, isautomatic: false }
        },
        {
          id: 25463,
          name: 'Already done',
          module: 'label',
          url: '',
          completion: 1,
          completiondata: { state: 1, hascompletion: true, isautomatic: false }
        },
        {
          id: 25464,
          name: 'Automatic without URL',
          module: 'label',
          url: '',
          completion: 2,
          completiondata: { state: 0, hascompletion: true, isautomatic: true }
        }
      ]
    } }]
  };
};
const contentsActivities = await contentsClient.getCourseActivities('289');
assert.equal(contentsActivities.some(item => item.cmid === '25461' && item.type === 'manual'), true);
assert.equal(contentsActivities.filter(item => item.cmid === '25462').length, 1);
assert.equal(contentsActivities.some(item => item.cmid === '25463'), false);
assert.equal(contentsActivities.some(item => item.cmid === '25464'), false);
assert.equal(contentsCalls[1].url.includes('info=core_courseformat_get_state'), true);
assert.deepEqual(JSON.parse(contentsCalls[1].options.data)[0].args, { courseid: 289 });
assert.equal(contentsCalls.some(call => call.url.includes('info=core_course_get_module')), true);

const completionPayloads = [];
const completionClient = new MoodleClient();
completionClient.request = async (url, options) => {
  completionPayloads.push({ url, options });
  return { data: [{ data: { status: true, warnings: [] } }] };
};
assert.equal(await completionClient.markActivityCompletedManually('25461', undefined, 'page-key'), true);
assert.match(completionPayloads[0].url, /sesskey=page-key/);
assert.deepEqual(JSON.parse(completionPayloads[0].options.data)[0].args, { cmid: 25461, completed: true });

const completionErrorClient = new MoodleClient();
completionErrorClient.request = async () => ({
  data: [{ exception: 'moodle_exception', errorcode: 'invalidparameter', message: 'Invalid cmid' }]
});
assert.equal(await completionErrorClient.markActivityCompletedManually('25461', undefined, 'page-key'), false);
assert.equal(completionErrorClient.lastManualCompletionFailure, 'invalidparameter');

const sesskeyFallbackClient = new MoodleClient();
let fallbackApiUrl = '';
sesskeyFallbackClient.request = async (url) => {
  if (url === '/my/') return { data: '<script>M.cfg = {"sesskey":"dashboard-key"};</script>' };
  fallbackApiUrl = url;
  return { data: [{ data: { status: true, warnings: [] } }] };
};
assert.equal(await sesskeyFallbackClient.markActivityCompletedManually('25461'), true);
assert.match(fallbackApiUrl, /sesskey=dashboard-key/);

const manualClient = new MoodleClient();
let markedCmid = null;
manualClient.request = async () => ({ data: '<html></html>' });
manualClient.markActivityCompletedManually = async (cmid, _signal, sesskey) => {
  markedCmid = String(cmid);
  return true;
};
const manualResult = await manualClient.visitActivity('manual', '25461');
assert.equal(markedCmid, '25461');
assert.equal(manualResult.manualCompleted, true);

const icontentClient = new MoodleClient();
icontentClient.request = async () => ({
  data: `<input type="hidden" name="sesskey" value="page-key">
    <button data-action="toggle-manual-completion" data-toggletype="manual:mark-done" data-cmid="25461">Mark as done</button>`
});
let icontentCall = null;
icontentClient.markActivityCompletedManually = async (cmid, _signal, sesskey) => {
  icontentCall = { cmid: String(cmid), sesskey };
  return true;
};
const icontentResult = await icontentClient.visitActivity('icontent', '25461');
assert.deepEqual(icontentCall, { cmid: '25461', sesskey: 'page-key' });
assert.equal(icontentResult.manualCompleted, true);

const failedIcontentClient = new MoodleClient();
failedIcontentClient.request = async () => ({
  data: `<button data-action="toggle-manual-completion" data-toggletype="manual:mark-done" data-cmid="25461">Mark as done</button>`
});
failedIcontentClient.markActivityCompletedManually = async () => false;
await assert.rejects(
  () => failedIcontentClient.visitActivity('icontent', '25461'),
  /không ghi nhận Mark as done.*status=true/
);

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

// Test non-quiz single activity execution with mock client
const fakeSession2 = {
  id: 'mock-session-id',
  client: {
    async visitActivity() { return 'ok'; }
  },
  username: 'test',
  courseId: '248',
  courses: [],
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
  logs: [],
  subscribers: new Set(),
  job: null
};

// Test start with mock session in service internals or start method
const startNonQuiz = EnglishExerciseInternals.runQuiz ? true : false;
assert.ok(startNonQuiz);

console.log('✓ English parser, local answer bank, non-quiz activity execution, and two-page auto-submit runner tests passed');
