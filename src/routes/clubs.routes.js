/**
 * 7. CLB & Nhóm Học Tập (Clans/Guilds)
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerClubsRoutes(router, deps = {}) {
  router.get('/community/clans', ApiController.getClans);
  router.post('/community/clans', ApiController.createClan);
  router.patch('/community/clans/:id', ApiController.updateClan);
  router.delete('/community/clans/:id', ApiController.disbandClan);
  router.post('/community/clans/:id/join', ApiController.joinClan);
  router.delete('/community/clans/:id/join-requests', ApiController.cancelClanJoinRequest);
  router.get('/community/clans/:id/join-requests', ApiController.getClanJoinRequests);
  router.post('/community/clans/:id/join-requests/:requestId/review', ApiController.reviewClanJoinRequest);
  router.post('/community/clans/:id/leave', ApiController.leaveClan);
  router.get('/community/clans/:id/members', ApiController.getClanMembers);
  router.patch('/community/clans/:id/members/:mssv/role', ApiController.updateClanMemberRole);
  router.delete('/community/clans/:id/members/:mssv', ApiController.kickClanMember);
  router.get('/community/clans/:id/documents', ApiController.getClanDocuments);
  router.get('/community/clans/:id/roles', ApiController.getClanRoles);
  router.put('/community/clans/:id/roles', ApiController.updateClanRoles);
  router.get('/community/clans/:id/quiz', ApiController.getClanQuiz);
  router.put('/community/clans/:id/quiz', ApiController.updateClanQuiz);
  router.post('/community/polls/:pollId/vote', ApiController.voteClanPoll);
}
