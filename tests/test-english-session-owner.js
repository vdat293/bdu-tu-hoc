import assert from 'node:assert/strict';
import { EnglishExerciseService } from '../src/services/english-exercise.service.js';
import { MoodleClient } from '../src/services/moodle.service.js';

const originalLogin = MoodleClient.prototype.login;
const originalCourses = MoodleClient.prototype.getEnrolledCourses;

try {
  MoodleClient.prototype.login = async () => true;
  MoodleClient.prototype.getEnrolledCourses = async () => [];

  const session = await EnglishExerciseService.login({
    username: 'student',
    password: 'password',
    ownerMssv: 'OWNER001'
  });
  assert.ok(session.sessionId);
  assert.ok(session.streamToken);

  await assert.rejects(
    () => EnglishExerciseService.courses(session.sessionId, 'OTHER999'),
    (error) => error.status === 403
  );
  assert.equal(EnglishExerciseService.authorizeStream(session.sessionId, session.streamToken), true);
  assert.throws(
    () => EnglishExerciseService.authorizeStream(session.sessionId, 'wrong-token'),
    (error) => error.status === 403
  );
  assert.equal(EnglishExerciseService.close(session.sessionId, 'OWNER001'), true);

  console.log('✅ English sessions are owner-bound and stream tokens are scoped.');
} finally {
  MoodleClient.prototype.login = originalLogin;
  MoodleClient.prototype.getEnrolledCourses = originalCourses;
}
