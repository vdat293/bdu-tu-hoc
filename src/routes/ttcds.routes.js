/**
 * 8b. Trung tâm Chuyển đổi số — "Sinh viên của tôi" (`/api/ttcds/*`).
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { TtcdsController } from '../modules/ttcds/ttcds.controller.js';

export function registerTtcdsRoutes(router, deps = {}) {
  const controller = deps.ttcdsController || TtcdsController;
  // `/students/search` phải đăng ký TRƯỚC `/students/:mssv` để "search"
  // không bị khớp nhầm thành MSSV.
  router.get('/ttcds/capabilities', controller.getCapabilities);
  router.get('/ttcds/groups', controller.listGroups);
  router.post('/ttcds/groups', controller.createGroup);
  router.delete('/ttcds/groups/:id', controller.deleteGroup);
  router.get('/ttcds/groups/:id/members', controller.listMembers);
  router.post('/ttcds/groups/:id/members', controller.addMember);
  router.delete('/ttcds/groups/:id/members/:mssv', controller.removeMember);
  router.get('/ttcds/students/search', controller.searchStudents);
  router.get('/ttcds/students/:mssv', controller.getStudent);
  router.get('/ttcds/students/:mssv/diem-danh', controller.getAttendance);
  router.get('/ttcds/permissions', controller.listPermissions);
  router.put('/ttcds/permissions', controller.setPermission);
  router.get('/ttcds/audit', controller.listAuditLogs);
}
