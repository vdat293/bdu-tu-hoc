/**
 * Admin Traffic & Logs Dashboard
 *
 * Thứ tự BẮT BUỘC: route login đứng trước `router.use('/admin/dashboard', ...)`
 * vì `router.use()` là prefix-match và sẽ chặn mọi request dưới prefix này.
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { AdminDashboardController } from './_shared/http-deps.js';

export function registerAdminRoutes(router, deps = {}) {
  router.post('/admin/dashboard/login', AdminDashboardController.login);
  router.use('/admin/dashboard', AdminDashboardController.requireAdmin);
  router.get('/admin/dashboard/overview', AdminDashboardController.getOverview);
  router.get('/admin/dashboard/timeline', AdminDashboardController.getTimeline);
  router.get('/admin/dashboard/endpoints', AdminDashboardController.getEndpoints);
  router.get('/admin/dashboard/users', AdminDashboardController.getUsers);
  router.get('/admin/dashboard/visited-students', AdminDashboardController.getVisitedStudents);
  router.get('/admin/dashboard/devices', AdminDashboardController.getDevices);
  router.get('/admin/dashboard/logs', AdminDashboardController.getLogs);
  router.get('/admin/dashboard/routes', AdminDashboardController.getRoutes);
  router.get('/admin/dashboard/users/:mssv/activity', AdminDashboardController.getUserActivity);
  router.get('/admin/dashboard/system', AdminDashboardController.getSystem);
  router.get('/admin/dashboard/ranking-sync', AdminDashboardController.getRankingSync);
  router.put('/admin/dashboard/ranking-sync', AdminDashboardController.updateRankingSync);
  router.get('/admin/dashboard/service-lock', AdminDashboardController.getServiceLock);
  router.put('/admin/dashboard/service-lock', AdminDashboardController.setServiceLock);
  router.get('/admin/dashboard/insights/features', AdminDashboardController.getInsightsFeatures);
  router.get('/admin/dashboard/insights/hours', AdminDashboardController.getInsightsHours);
  router.get('/admin/dashboard/insights/cohort', AdminDashboardController.getInsightsCohort);
  router.get('/admin/dashboard/insights/quality', AdminDashboardController.getInsightsQuality);
  router.get('/admin/dashboard/insights/users/:mssv/journey', AdminDashboardController.getInsightsJourney);
  router.post('/admin/dashboard/purge', AdminDashboardController.purgeLogs);
}
