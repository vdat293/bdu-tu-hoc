/**
 * 6b. Thông báo cập nhật website qua Discord DM (Admin Tool)
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerBroadcastRoutes(router, deps = {}) {
  router.get('/admin/broadcast', ApiController.requireIdentityAdmin, ApiController.getAdminBroadcast);
  router.post('/admin/broadcast', ApiController.requireIdentityAdmin, ApiController.sendAdminBroadcast);
  router.get('/admin/avatars', ApiController.requireIdentityAdmin, ApiController.getAdminAvatars);
  router.get('/admin/avatars/:mssv', ApiController.requireIdentityAdmin, ApiController.getAdminAvatar);
  router.delete('/admin/avatars/:mssv', ApiController.requireIdentityAdmin, ApiController.deleteAdminAvatar);
}
