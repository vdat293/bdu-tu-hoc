/**
 * 4. Moodle English Exercise Automation
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerEnglishRoutes(router, deps = {}) {
  router.get('/english/answers', ApiController.getEnglishAnswers);
  router.post('/english/answers', ApiController.addEnglishAnswer);
  router.delete('/english/answers/:id', ApiController.deleteEnglishAnswer);
  router.post('/english/login', ApiController.loginEnglish);
  router.get('/english/:sessionId/courses', ApiController.getEnglishCourses);
  router.get('/english/:sessionId/activities', ApiController.getEnglishActivities);
  router.post('/english/:sessionId/start', ApiController.startEnglishExercise);
  router.post('/english/:sessionId/finish-course', ApiController.startEnglishCourseFinish);
  router.post('/english/:sessionId/stop', ApiController.stopEnglishExercise);
  router.delete('/english/:sessionId', ApiController.closeEnglishSession);
  router.get('/english/:sessionId/stream', ApiController.streamEnglishExercise);
}
