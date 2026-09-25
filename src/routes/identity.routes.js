/**
 * Student identity routes.
 *
 * Tách thành 4 hàm register vì file gốc xen identity với notifications và
 * broadcast (xem src/routes/api.routes.js). Giữ 4 hàm riêng cho phép
 * `api.routes.js` gọi lại đúng THỨ TỰ DÒNG của file gốc, thay vì gom tất cả
 * identity vào một chỗ rồi hy vọng không xung đột prefix với domain khác.
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 */
import { ApiController, avatarUpload, requireVerifiedMssv } from './_shared/http-deps.js';

/** Dòng 119-124: trang bày danh tính + tra cứu sinh viên. */
export function registerIdentityPortalRoutes(router) {
  router.get('/students/me/presentation', ApiController.getMyIdentityPresentation);
  router.put('/students/me/presentation', ApiController.updateMyIdentityPresentation);
  router.put('/students/me/cosmetics/frame', ApiController.updateMyEquippedFrame);
  router.get('/identity/frames', ApiController.getIdentityFrames);
  router.get('/students/search', ApiController.searchActiveStudents);
  router.get('/students/:mssv/profile', ApiController.getStudentProfile);
}

/** Dòng 142-152: quản trị danh tính + system role (kiểm tra quyền server-side). */
export function registerIdentityAdminRoutes(router) {
  router.get('/admin/identity/items', ApiController.getAdminIdentityItems);
  router.post('/admin/identity/items', ApiController.createAdminIdentityItem);
  router.put('/admin/identity/items/:id', ApiController.updateAdminIdentityItem);
  router.delete('/admin/identity/items/:id', ApiController.deleteAdminIdentityItem);
  router.get('/admin/identity/students/:mssv/grants', ApiController.getAdminIdentityGrants);
  router.post('/admin/identity/grants', ApiController.createAdminIdentityGrant);
  router.delete('/admin/identity/grants/:grantId', ApiController.revokeAdminIdentityGrant);
  router.get('/admin/identity/audit', ApiController.getAdminIdentityAudit);
  router.post('/admin/system-roles', ApiController.grantAdminSystemRole);
  router.delete('/admin/system-roles/:mssv/:role', ApiController.revokeAdminSystemRole);
}

/** Dòng 154-156: kéo bài Facebook về Confession (kiểm duyệt viên). */
export function registerFacebookImportRoutes(router) {
  router.get('/admin/facebook-import/status', ApiController.requireCommunityModerator, ApiController.getFacebookImportStatus);
  router.post('/admin/facebook-import/run', ApiController.requireCommunityModerator, ApiController.runFacebookImport);
}

/** Dòng 165-167: avatar tự upload (ảnh lưu trên Cloudflare R2). */
export function registerIdentityAvatarRoutes(router) {
  router.post('/me/avatar', requireVerifiedMssv, avatarUpload.single('avatar'), ApiController.uploadMyAvatar);
  router.delete('/me/avatar', ApiController.deleteMyAvatar);
}
