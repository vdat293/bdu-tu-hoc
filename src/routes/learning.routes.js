/**
 * 5. Learning Hub Resources
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';
import { Inf1003DeployController } from '../modules/learning/inf1003-deploy.controller.js';
import { PracticeBankController } from '../modules/learning/practice-bank.controller.js';

export function registerLearningRoutes(router, deps = {}) {
  router.get('/learning/resources', ApiController.getLearningResources);
  router.get('/learning/courses/:courseCode/posts', ApiController.getCourseLearningPosts);
  router.post('/learning/courses/:courseCode/posts', ApiController.createCourseLearningPost);
  router.delete('/learning/courses/:courseCode/posts/:postId', ApiController.deleteCourseLearningPost);
  router.post('/learning/courses/:courseCode/posts/:postId/like', ApiController.toggleCourseLearningPostLike);
  router.get('/learning/courses/:courseCode/posts/:postId/comments', ApiController.getCourseLearningPostComments);
  router.post('/learning/courses/:courseCode/posts/:postId/comments', ApiController.addCourseLearningPostComment);

  router.get('/learning/courses/:courseCode/quiz-sets', ApiController.listQuizSets);
  router.post('/learning/courses/:courseCode/quiz-sets', ApiController.createQuizSet);
  router.delete('/learning/courses/:courseCode/quiz-sets/:setId', ApiController.deleteQuizSet);
  router.get('/learning/courses/:courseCode/quiz-sets/:setId/parts/:partIndex', ApiController.getQuizSetPart);
  router.post('/learning/courses/:courseCode/quiz-sets/:setId/parts/:partIndex/start', ApiController.startQuizSetPart);
  router.post('/learning/courses/:courseCode/quiz-sets/:setId/parts/:partIndex/answer', ApiController.answerQuizSetReview);
  router.post('/learning/courses/:courseCode/quiz-sets/:setId/parts/:partIndex/progress', ApiController.saveQuizSetProgress);

  // Ngân hàng ôn tập trắc nghiệm tách biệt (Claymorphism Practice Bank)
  router.get('/learning/courses/:courseCode/practice-bank', PracticeBankController.getPracticeBankSummary);
  router.get('/learning/courses/:courseCode/practice-bank/questions', PracticeBankController.getPracticeBankQuestions);
  router.post('/learning/courses/:courseCode/practice-bank/questions/:questionId/answer', PracticeBankController.answerPracticeBankQuestion);
  router.post('/learning/courses/:courseCode/practice-bank/questions/:questionId/bookmark', PracticeBankController.togglePracticeBankBookmark);
  router.post('/learning/courses/:courseCode/practice-bank/exam/start', PracticeBankController.startPracticeMockExam);
  router.post('/learning/courses/:courseCode/practice-bank/exam/submit', PracticeBankController.submitPracticeMockExam);
  router.delete('/learning/courses/:courseCode/practice-bank/progress', PracticeBankController.resetPracticeBankProgress);

  router.get('/learning/courses/:courseCode/guide', ApiController.getCourseGuide);
  router.get('/learning/courses/:courseCode/guides/:lessonId/progress', ApiController.getGuideProgress);
  router.post('/learning/courses/:courseCode/guides/:lessonId/progress', ApiController.saveGuideProgress);
  router.get('/learning/courses/:courseCode/guides/:lessonId/lab-result', ApiController.getLabResult);
  router.post('/learning/courses/:courseCode/guides/:lessonId/lab-result', ApiController.saveLabResult);
  router.delete('/learning/courses/:courseCode/guides/:lessonId/reset', ApiController.deleteGuideProgress);
  router.get('/learning/courses/INF1003/guides/bai-2/deployment', Inf1003DeployController.lesson);
  router.post('/learning/courses/INF1003/guides/bai-2/deployment/key', Inf1003DeployController.issue);
}
