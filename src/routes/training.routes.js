/**
 * 3b. Training Score (điểm rèn luyện) - tự chấm mục 5 rồi lưu lên cổng BDU.
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerTrainingRoutes(router, deps = {}) {
  router.get('/training-score/semesters', ApiController.getTrainingSemesters);
  router.get('/training-score/criteria', ApiController.getTrainingCriteria);
  router.post('/training-score/cds-sync', ApiController.syncTraining616);
  router.get('/training-score/cds-credentials', ApiController.getTrainingCdsCredentials);
  router.delete('/training-score/cds-credentials', ApiController.deleteTrainingCdsCredentials);
  router.post('/training-score/submit', ApiController.submitTrainingScore);
}
