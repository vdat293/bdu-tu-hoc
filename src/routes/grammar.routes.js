/**
 * 8b. Luyện ngữ pháp (clone luyennguphap: lý thuyết + bài tập + đọc hiểu)
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerGrammarRoutes(router, deps = {}) {
  router.get('/grammar/groups', ApiController.listGrammarGroups);
  router.get('/grammar/paths/:pathId', ApiController.getGrammarPath);
  router.get('/grammar/lessons/:lessonId', ApiController.getGrammarLesson);
  router.post('/grammar/progress', ApiController.saveGrammarProgress);
  router.post('/grammar/extra-progress', ApiController.saveGrammarExtraProgress);
  router.post('/grammar/answer', ApiController.checkGrammarAnswer);
}
