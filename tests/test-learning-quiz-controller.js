import assert from 'node:assert/strict';
import { LearningController } from '../src/modules/learning/learning.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { LearningService } from '../src/services/learning.service.js';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';

// Khóa rate limit là course-quiz-create:<mssv>; dùng MSSV duy nhất mỗi lần chạy
// để bucket in-memory không ảnh hưởng lẫn nhau giữa các lần test.
const TEST_MSSV = `TEST_QUIZ_RATE_${Date.now()}_${process.pid}`;

const originalResolveVerifiedMssv = BduIdentityService.resolveVerifiedMssv;
const originalCreateCoursePost = LearningService.createCoursePost;
const originalPublishCoursePostCreated = CommunityRealtime.publishCoursePostCreated;

function fakeResponse() {
  const state = { statusCode: 200, body: null };
  const res = {
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

function quizRequest() {
  return {
    headers: { authorization: 'Bearer test-token' },
    params: { courseCode: 'TESTQUIZ01' },
    body: { kind: 'quiz', title: 'Quiz kiểm thử', content: '', quiz: { questions: [] } }
  };
}

let published = 0;

try {
  BduIdentityService.resolveVerifiedMssv = async () => TEST_MSSV;
  LearningService.createCoursePost = async (mssv, courseCode, input) => ({
    id: 1000 + published,
    kind: input.kind,
    title: input.title || 'Quiz kiểm thử',
    quiz: input.kind === 'quiz'
      ? { question_count: 2, time_limit_seconds: 600, progress: null }
      : null
  });
  CommunityRealtime.publishCoursePostCreated = () => {
    published += 1;
  };

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const { res, state } = fakeResponse();
    await LearningController.createCourseLearningPost(quizRequest(), res);
    assert.equal(state.statusCode, 201, `Lượt quiz ${attempt}/20 phải trả 201`);
    assert.equal(state.body.result, true);
  }

  const blocked = fakeResponse();
  await LearningController.createCourseLearningPost(quizRequest(), blocked.res);
  assert.equal(blocked.state.statusCode, 429, 'Lượt quiz thứ 21 phải bị chặn 429');
  assert.equal(blocked.state.body.result, false);
  assert.equal(blocked.state.body.code, 'RATE_LIMITED');
  assert.match(blocked.state.body.message, /quá nhanh/);
  assert.equal(published, 20, 'Lượt bị chặn không được publish realtime');

  // Các kind cũ không dùng bucket course-quiz-create.
  const documentReq = quizRequest();
  documentReq.body = { kind: 'document', title: 'Tài liệu', url: 'https://github.com/example/doc' };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { res, state } = fakeResponse();
    await LearningController.createCourseLearningPost(documentReq, res);
    assert.equal(state.statusCode, 201, `Bài document ${attempt} không bị giới hạn bởi bucket quiz`);
  }
  assert.equal(published, 23, 'Mỗi bài tạo thành công phải publish realtime một lần');

  console.log('✓ Learning quiz controller: 20 lượt/60 phút, lượt 21 trả 429 RATE_LIMITED, kind cũ không bị ảnh hưởng.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolveVerifiedMssv;
  LearningService.createCoursePost = originalCreateCoursePost;
  CommunityRealtime.publishCoursePostCreated = originalPublishCoursePostCreated;
}
