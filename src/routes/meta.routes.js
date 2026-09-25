/**
 * Health & Metrics check
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController, WordFmtService } from './_shared/http-deps.js';

export function registerMetaRoutes(router, deps = {}) {
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      queue: WordFmtService.getQueueStats()
    });
  });
  router.get('/queue-status', ApiController.getQueueStatus);
  router.get('/version', ApiController.getVersion);
}
