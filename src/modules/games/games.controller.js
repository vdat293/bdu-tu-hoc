import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { EntertainmentGameService, EntertainmentGameInternals, viewerStateFor } from '../../services/entertainment-game.service.js';
import { KillerSudokuService } from '../../services/killer-sudoku.service.js';
import { TtcdsService } from '../../services/ttcds.service.js';

export const GamesController = {
  // 10b. Entertainment games: database-backed rooms + server-authoritative moves
  getEntertainmentGames(req, res) {
    return res.json({
      result: true,
      data: {
        games: EntertainmentGameInternals.PUBLIC_GAME_METAS.map((game) => ({
          id: game.id,
          label: game.label,
          tagline: game.tagline || '',
          players: game.players || 2,
          clock: game.clock !== false,
          order: game.order || 0
        })),
        realtime: { websocket_path: '/ws/community', room_prefix: 'game:' }
      }
    });
  },

  async listEntertainmentRooms(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      const data = await EntertainmentGameService.listRooms({
        mssv,
        gameType: req.query.gameType || req.query.game_type,
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LIST_FAILED', message: err.message || 'Không thể tải danh sách phòng.' });
    }
  },

  async createEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.createRoom({
        mssv,
        gameType: req.body?.gameType || req.body?.game_type,
        visibility: req.body?.visibility,
        name: req.body?.name,
        allowSpectators: req.body?.allowSpectators ?? req.body?.allow_spectators,
        allowChat: req.body?.allowChat ?? req.body?.allow_chat,
        turnSeconds: req.body?.turnSeconds ?? req.body?.turn_seconds,
        ttlSeconds: req.body?.ttlSeconds || req.body?.ttl_seconds
      });
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_CREATE_FAILED', message: err.message || 'Không thể tạo phòng.' });
    }
  },

  async getEntertainmentRoom(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      // Không cần tham số role: service tự xác định người chơi hay khán giả theo mssv.
      const data = await EntertainmentGameService.getRoom(req.params.roomRef, { mssv });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LOAD_FAILED', message: err.message || 'Không thể tải phòng.' });
    }
  },

  async joinEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.joinRoom(req.params.roomRef, mssv);
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_JOIN_FAILED', message: err.message || 'Không thể tham gia phòng.' });
    }
  },

  async leaveEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.leaveRoom(req.params.roomRef, mssv);
      // State trả cho người vừa rời cũng phải che theo ghế (battleship).
      const safeData = data.state ? { ...data, state: viewerStateFor(data.game_type, data.state, data.seat) } : data;
      if (data.deleted) {
        CommunityRealtime.publishGameRoomClosed(data.room_code, {
          reason: 'player_left',
          actor: mssv,
          message: 'Người tạo phòng đã rời đi. Phòng đã tự động đóng.'
        });
      } else if (data.forfeited) {
        CommunityRealtime.publishGameForfeited(data);
        CommunityRealtime.publishGameRoomUpdated({ room_code: data.room_code, status: 'finished', state_version: data.state_version, players: null });
      }
      return res.json({ result: true, data: safeData });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LEAVE_FAILED', message: err.message || 'Không thể rời phòng.' });
    }
  },

  async rematchEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.requestRematch(req.params.roomRef, mssv);
      if (data.ready) {
        CommunityRealtime.publishGameRematchStarted(data.room_code, data);
      } else {
        CommunityRealtime.publishGameRematchRequested(data.room_code, data);
      }
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'REMATCH_FAILED', message: err.message || 'Không thể gửi yêu cầu đánh lại.' });
    }
  },

  async makeEntertainmentMove(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.makeMove(req.params.roomRef, mssv, req.body?.move || req.body, {
        clientMoveId: req.body?.clientMoveId || req.body?.client_move_id
      });
      // Broadcast state đầy đủ (đã che theo từng client trong gateway), còn phản hồi
      // HTTP cho người đi chỉ chứa state theo góc nhìn của chính họ.
      CommunityRealtime.publishGameMove(data);
      return res.json({
        result: true,
        data: {
          ...data,
          state: viewerStateFor(data.game_type, data.state, data.seat)
        }
      });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'MOVE_REJECTED', message: err.message || 'Nước đi không được chấp nhận.' });
    }
  },

  async listEntertainmentMoves(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      const data = await EntertainmentGameService.listMoves(req.params.roomRef, { after: req.query.after, limit: req.query.limit, mssv });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'MOVE_HISTORY_FAILED', message: err.message || 'Không thể tải lịch sử nước đi.' });
    }
  },

  async createEntertainmentChallenge(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.createChallenge(req.params.roomRef, mssv, {
        challengedMssv: req.body?.challengedMssv || req.body?.challenged_mssv,
        expiresInSeconds: req.body?.expiresInSeconds || req.body?.expires_in_seconds,
        postToConfession: req.body?.postToConfession ?? req.body?.post_to_confession,
        confessionAnonymous: req.body?.confessionAnonymous ?? req.body?.confession_anonymous
      });
      CommunityRealtime.publishGameChallengeCreated(data);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_CREATE_FAILED', message: err.message || 'Không thể tạo challenge.' });
    }
  },

  async acceptEntertainmentChallenge(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.acceptChallenge(req.params.challengeId, mssv, req.body?.inviteCode || req.body?.code || req.query?.code);
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_ACCEPT_FAILED', message: err.message || 'Không thể nhận challenge.' });
    }
  },

  async getEntertainmentChallenge(req, res) {
    try {
      const data = await EntertainmentGameService.getChallenge(req.params.challengeId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_LOAD_FAILED', message: err.message || 'Không thể tải challenge.' });
    }
  },
  async getKillerSudokuProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      // Luật cứng section TTCDS: chỉ tag Trung tâm CĐS (ttcds:access) mới đọc tiến độ.
      await TtcdsService.requireAccess(mssv);
      const data = await KillerSudokuService.getProgress(mssv, req.query.difficulty);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        code: err.code || 'KILLER_SUDOKU_PROGRESS_FAILED',
        message: err.message || 'Không thể tải tiến độ Killer Sudoku.'
      });
    }
  },

  async saveKillerSudokuProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      // Luật cứng section TTCDS: chỉ tag Trung tâm CĐS (ttcds:access) mới ghi tiến độ.
      await TtcdsService.requireAccess(mssv);
      const { difficulty, levelId, timeSeconds, mistakes } = req.body || {};
      const data = await KillerSudokuService.recordCompletion({
        mssv,
        difficulty,
        levelId,
        timeSeconds,
        mistakes
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        code: err.code || 'KILLER_SUDOKU_SAVE_FAILED',
        message: err.message || 'Không thể lưu tiến độ Killer Sudoku.'
      });
    }
  },
};
