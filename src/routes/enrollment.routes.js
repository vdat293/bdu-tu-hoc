/**
 * Enrollment routes — mounted from api.routes.js.
 * The SSE events endpoint is intentionally unauthenticated (runId uuid is the
 * stream capability, same model as /tool-runs/:runId/events).
 */
import { ApiController } from './_shared/http-deps.js';

export function registerEnrollmentRoutes(router) {
  router.get('/enrollment/priority', ApiController.getPriority);
  router.get('/enrollment/schedule', ApiController.getSchedule);
  router.put('/enrollment/priority', ApiController.replacePriority);
  router.get('/enrollment/catalog', ApiController.getCatalog);
  router.get('/enrollment/filters', ApiController.getFilters);
  router.get('/enrollment/registered', ApiController.getRegistered);
  router.post('/enrollment/withdraw', ApiController.withdraw);
  router.post('/enrollment/runs', ApiController.startRun);
  // Phải đứng trước '/enrollment/runs/:id' để "latest" không bị hiểu là id.
  router.get('/enrollment/runs/latest', ApiController.getLatestRun);
  router.get('/enrollment/runs/:id', ApiController.getRun);
  router.post('/enrollment/runs/:id/stop', ApiController.stopRun);
  router.get('/enrollment/runs/:id/events', ApiController.streamRunEvents);
  router.get('/enrollment/session', ApiController.checkSession);
}
