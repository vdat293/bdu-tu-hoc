/**
 * 2. Word Formatting Tool
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController, upload, requireVerifiedMssv } from './_shared/http-deps.js';

export function registerWordFmtRoutes(router, deps = {}) {
  router.post('/wordfmt/format', requireVerifiedMssv, upload.single('document'), ApiController.formatDocx);
  router.get('/wordfmt/download/:filename', requireVerifiedMssv, ApiController.downloadFormattedDocx);
}
