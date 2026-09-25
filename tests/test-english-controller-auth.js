import assert from 'node:assert/strict';
import { ApiController } from '../src/controllers/api.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { EnglishExerciseService } from '../src/services/english-exercise.service.js';
import { PermissionService } from '../src/services/permission.service.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalService = { ...EnglishExerciseService };
const originalRequire = PermissionService.require;
const calls = [];

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    flushHeaders() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

try {
  BduIdentityService.resolveVerifiedMssv = async () => 'OWNER001';
  EnglishExerciseService.login = async (input) => {
    calls.push(['login', input]);
    return { sessionId: 'session-1', streamToken: 'stream-secret', courses: [] };
  };
  EnglishExerciseService.courses = async (...args) => {
    calls.push(['courses', args]);
    return [];
  };
  EnglishExerciseService.authorizeStream = () => { throw Object.assign(new Error('bad stream'), { status: 403 }); };
  PermissionService.require = async (...args) => {
    calls.push(['permission', args]);
  };

  const loginRes = response();
  await ApiController.loginEnglish({
    headers: { authorization: 'Bearer owner-token' },
    body: { username: 'student', password: 'secret' }
  }, loginRes);
  assert.equal(loginRes.statusCode, 200);
  assert.equal(calls[0][1].ownerMssv, 'OWNER001');

  const coursesRes = response();
  await ApiController.getEnglishCourses({
    headers: { authorization: 'Bearer owner-token' },
    params: { sessionId: 'session-1' }
  }, coursesRes);
  assert.equal(coursesRes.statusCode, 200);
  assert.deepEqual(calls[1][1], ['session-1', 'OWNER001']);

  const streamRes = response();
  await ApiController.streamEnglishExercise({
    headers: {},
    query: { streamToken: 'wrong' },
    params: { sessionId: 'session-1' }
  }, streamRes);
  assert.equal(streamRes.statusCode, 403);
  assert.equal(streamRes.body.result, false);

  const answersRes = response();
  await ApiController.getEnglishAnswers({
    headers: { authorization: 'Bearer owner-token' }
  }, answersRes);
  assert.equal(answersRes.statusCode, 200);
  assert.deepEqual(calls.at(-1)[1][0], 'OWNER001');
  assert.equal(calls.at(-1)[1][1], 'moodle:answers:manage');

  console.log('✅ English controller binds sessions and answer-bank access to verified owners.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  for (const [key, value] of Object.entries(originalService)) EnglishExerciseService[key] = value;
  PermissionService.require = originalRequire;
}
