/**
 * 1. Auth & Portal
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerAuthRoutes(router, deps = {}) {
  router.post('/login', ApiController.login);
  router.post('/grades', ApiController.getGrades);
  router.get('/rankings/me', ApiController.getMyAcademicRanking);
  router.get('/rankings/leaderboard', ApiController.getAcademicLeaderboard);
  router.get('/rankings/status', ApiController.getAcademicRankingStatus);
  router.post('/profile', ApiController.getProfile);
  router.get('/schedule', ApiController.getSchedule);
  router.post('/schedule', ApiController.getSchedule);
}
