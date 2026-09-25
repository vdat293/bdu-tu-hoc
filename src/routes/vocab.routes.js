/**
 * 8. Luyện từ vựng (clone luyentu, trừ Listening/Đặc biệt)
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerVocabRoutes(router, deps = {}) {
  router.get('/vocab/themes', ApiController.listVocabThemes);
  router.get('/vocab/themes/:slug', ApiController.getVocabTheme);
  router.get('/vocab/themes/:slug/sets', ApiController.listVocabSets);
  router.get('/vocab/sets/:setId', ApiController.getVocabSet);
  router.get('/vocab/sets/:setId/words', ApiController.listVocabWords);
  router.post('/vocab/progress', ApiController.saveVocabProgress);
  router.get('/vocab/review/summary', ApiController.getVocabReviewSummary);
  router.get('/vocab/review/words', ApiController.listVocabReviewWords);
  router.post('/vocab/review', ApiController.reviewVocabWord);
}
