/**
 * 9. Giải trí: online game rooms, challenges and move history
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 * @param {object} [deps] Reserved for dependency-injection overrides.
 */
import { ApiController } from './_shared/http-deps.js';

export function registerGamesRoutes(router, deps = {}) {
  router.get('/entertainment/games', ApiController.getEntertainmentGames);
  router.get('/entertainment/rooms', ApiController.listEntertainmentRooms);
  router.post('/entertainment/rooms', ApiController.createEntertainmentRoom);
  router.get('/entertainment/rooms/:roomRef', ApiController.getEntertainmentRoom);
  router.post('/entertainment/rooms/:roomRef/join', ApiController.joinEntertainmentRoom);
  router.post('/entertainment/rooms/:roomRef/leave', ApiController.leaveEntertainmentRoom);
  router.post('/entertainment/rooms/:roomRef/rematch', ApiController.rematchEntertainmentRoom);
  router.get('/entertainment/rooms/:roomRef/moves', ApiController.listEntertainmentMoves);
  router.post('/entertainment/rooms/:roomRef/moves', ApiController.makeEntertainmentMove);
  router.post('/entertainment/rooms/:roomRef/challenges', ApiController.createEntertainmentChallenge);
  router.get('/entertainment/challenges/:challengeId', ApiController.getEntertainmentChallenge);
  router.post('/entertainment/challenges/:challengeId/accept', ApiController.acceptEntertainmentChallenge);
}
