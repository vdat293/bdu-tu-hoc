/**
 * Enrollment routes — mounted from api.routes.js.
 * The SSE events endpoint is intentionally unauthenticated (runId uuid is the
 * stream capability, same model as /tool-runs/:runId/events).
 */
import { ApiController } from './_shared/http-deps.js';

export function registerEnrollmentRoutes(router) {
  router.get('/enrollment/priority', ApiController.getPriority);
  router.put('/enrollment/priority', ApiController.replacePriority);
  router.get('/enrollment/catalog', ApiController.getCatalog);
  router.get('/enrollment/registered', ApiController.getRegistered);
  router.post('/enrollment/withdraw', ApiController.withdraw);
  router.post('/enrollment/runs', ApiController.startRun);
  router.get('/enrollment/runs/:id', ApiController.getRun);
  router.post('/enrollment/runs/:id/stop', ApiController.stopRun);
  router.post('/enrollment/runs/:id/otp', ApiController.submitOtp);
  router.get('/enrollment/runs/:id/events', ApiController.streamRunEvents);
}
