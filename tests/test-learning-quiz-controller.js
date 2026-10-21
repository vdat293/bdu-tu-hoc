import assert from 'node:assert/strict';
import { QuizSetController } from '../src/modules/learning/quiz-set.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { QuizSetService } from '../src/modules/learning/quiz-set.service.js';

// Khóa rate limit là quiz-set-create:<mssv>; dùng MSSV duy nhất mỗi lần chạy
// để bucket in-memory không ảnh hưởng lẫn nhau giữa các lần test.
const TEST_MSSV = `TEST_QUIZSET_RATE_${Date.now()}_${process.pid}`;

const originalResolveVerifiedMssv = BduIdentityService.resolveVerifiedMssv;
const originalCreateSet = QuizSetService.createSet;

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

function createRequest() {
  return {
    headers: { authorization: 'Bearer test-token' },
    params: { courseCode: 'TESTQUIZ01' },
    body: {
      title: 'Bộ đề kiểm thử',
      questions: [{ question: 'Q?', options: ['A', 'B'], correct: 'A' }],
      maxQuestionsPerPart: 20,
      minutesPerPart: 30
    }
  };
}

try {
  BduIdentityService.resolveVerifiedMssv = async () => TEST_MSSV;
  QuizSetService.createSet = async (mssv, courseCode, input) => ({
    id: 1000,
    title: input.title,
    course: courseCode,
    author: { mssv }
  });

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const { res, state } = fakeResponse();
    await QuizSetController.createQuizSet(createRequest(), res);
    assert.equal(state.statusCode, 201, `Lượt tạo bộ đề ${attempt}/20 phải trả 201`);
    assert.equal(state.body.result, true);
  }

  const blocked = fakeResponse();
  await QuizSetController.createQuizSet(createRequest(), blocked.res);
  assert.equal(blocked.state.statusCode, 429, 'Lượt tạo bộ đề thứ 21 phải bị chặn 429');
  assert.equal(blocked.state.body.result, false);
  assert.equal(blocked.state.body.code, 'RATE_LIMITED');
  assert.match(blocked.state.body.message, /quá nhanh/);

  console.log('✓ Quiz set controller: 20 lượt tạo bộ đề/60 phút, lượt 21 trả 429 RATE_LIMITED.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolveVerifiedMssv;
  QuizSetService.createSet = originalCreateSet;
}
