/**
 * 3. Survey Automation Tool (Server-Sent Events)
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerSurveyRoutes(router, deps = {}) {
  router.get('/survey/forms', ApiController.getSurveyForms);
  router.post('/survey/runs', ApiController.startSurveyRun);
  router.get('/survey/runs/:runId', ApiController.getSurveyRun);
  // Keep the SSE path neutral so browser content filters do not mistake it for
  // an external tracking/survey endpoint. It only observes an existing run.
  router.get('/tool-runs/:runId/events', ApiController.streamSurveyRun);
  // Legacy static portal compatibility. The React portal uses the run API above.
  router.get('/survey/stream', ApiController.streamSurvey);
}
