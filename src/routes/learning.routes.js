/**
 * 5. Learning Hub Resources
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerLearningRoutes(router, deps = {}) {
  router.get('/learning/resources', ApiController.getLearningResources);
  router.get('/learning/courses/:courseCode/posts', ApiController.getCourseLearningPosts);
  router.post('/learning/courses/:courseCode/posts', ApiController.createCourseLearningPost);
  router.delete('/learning/courses/:courseCode/posts/:postId', ApiController.deleteCourseLearningPost);
  router.post('/learning/courses/:courseCode/posts/:postId/like', ApiController.toggleCourseLearningPostLike);
  router.get('/learning/courses/:courseCode/posts/:postId/comments', ApiController.getCourseLearningPostComments);
  router.post('/learning/courses/:courseCode/posts/:postId/comments', ApiController.addCourseLearningPostComment);
  router.get('/learning/courses/:courseCode/posts/:postId/quiz', ApiController.getCourseQuiz);
}
