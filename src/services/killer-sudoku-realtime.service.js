/**
 * Killer Sudoku Realtime PvP Duel Service
 * Quản lý phòng đấu Solo 1v1 đối kháng trực tiếp qua WebSocket:
 * - Chế độ Cùng 1 Map (Same Map) hoặc Mỗi người 1 Map (Different Map)
 * - Cập nhật tiến độ giải ô (% hoàn thành, số lỗi) của đối thủ thời gian thực
 * - Phân định Thắng / Thua, Tái đấu (Rematch), Ghép trận nhanh (Quick Match)
 */

import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const WS_PATH = '/ws/killer-sudoku';
const MAX_PAYLOAD = 32 * 1024;
const WS_OPEN = 1;

// Load Official Puzzles dataset
let PUZZLES_POOL = null;
function getPuzzlesPool() {
  if (!PUZZLES_POOL) {
    try {
      const puzzleFilePath = path.join(ROOT_DIR, 'public', 'killer-sudoku', 'js', 'puzzles.js');
      const content = fs.readFileSync(puzzleFilePath, 'utf8');
      const sandbox = {};
      const run = new Function('window', 'globalThis', content);
      run(sandbox, sandbox);
      PUZZLES_POOL = sandbox.KILLER_PUZZLES_RAW || {};
    } catch (err) {
      console.error('[KillerSudokuPvP] Error loading puzzles dataset:', err);
      PUZZLES_POOL = { easy: [], medium: [], hard: [], expert: [] };
    }
  }
  return PUZZLES_POOL;
}

function getRandomPuzzle(difficulty = 'easy') {
  const pool = getPuzzlesPool();
  const list = pool[difficulty] || pool['easy'] || [];
  if (!list || list.length === 0) return null;
  const randIdx = Math.floor(Math.random() * list.length);
  return {
    raw: list[randIdx],
    index: randIdx,
    difficulty
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function jsonSend(ws, payload) {
  if (!ws || ws.readyState !== WS_OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    return false;
  }
}

class KillerSudokuRealtimeService {
  constructor() {
    this.wss = null;
    this.rooms = new Map(); // roomCode -> Room
    this.clientRoomMap = new WeakMap(); // ws -> roomCode
  }

  attach(httpServer) {
    if (this.wss) return this;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

    httpServer.on('upgrade', (request, socket, head) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        if (url.pathname !== WS_PATH) return;

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } catch (err) {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.playerId = 'p_' + Math.random().toString(36).substring(2, 9);

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (err) {
          console.error('[KillerSudokuPvP] Malformed client message:', err);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });
    });

    // Heartbeat check every 30s
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      });
      this.cleanupOldRooms();
    }, 30000);

    console.log('[KillerSudokuPvP] WebSocket service attached at', WS_PATH);
    return this;
  }

  handleClientMessage(ws, data) {
    const { action, payload = {} } = data;

    switch (action) {
      case 'CREATE_ROOM':
        this.createRoom(ws, payload);
        break;
      case 'JOIN_ROOM':
        this.joinRoom(ws, payload);
        break;
      case 'QUICK_MATCH':
        this.quickMatch(ws, payload);
        break;
      case 'PLAYER_READY':
        this.setPlayerReady(ws, payload);
        break;
      case 'UPDATE_PROGRESS':
        this.updateProgress(ws, payload);
        break;
      case 'PLAYER_FINISHED':
        this.playerFinished(ws, payload);
        break;
      case 'PLAYER_MISTAKE':
        this.playerMistake(ws, payload);
        break;
      case 'REQUEST_REMATCH':
        this.requestRematch(ws);
        break;
      case 'LEAVE_ROOM':
        this.leaveRoom(ws);
        break;
      default:
        break;
    }
  }

  createRoom(ws, payload) {
    const { playerName = 'Sinh Viên', mode = 'same_map', difficulty = 'easy', isPrivate = true } = payload;
    let roomCode = generateRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const initialPuzzle = getRandomPuzzle(difficulty);

    const room = {
      code: roomCode,
      mode, // 'same_map' or 'diff_map'
      difficulty,
      isPrivate: Boolean(isPrivate),
      puzzleMaster: initialPuzzle,
      status: 'waiting', // waiting, starting, playing, finished
      winner: null,
      createdAt: Date.now(),
      players: [
        {
          id: ws.playerId,
          ws,
          name: playerName.slice(0, 24),
          ready: false,
          puzzle: initialPuzzle,
          solvedCount: 0,
          mistakes: 0,
          finished: false,
          timeSpent: 0
        }
      ]
    };

    this.rooms.set(roomCode, room);
    this.clientRoomMap.set(ws, roomCode);

    jsonSend(ws, {
      type: 'ROOM_CREATED',
      room: this.serializeRoom(room, ws.playerId)
    });
  }

  joinRoom(ws, payload) {
    const { roomCode, playerName = 'Đối thủ' } = payload;
    const cleanCode = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return jsonSend(ws, { type: 'ERROR', message: `Phòng ${cleanCode} không tồn tại hoặc đã đóng!` });
    }
    if (room.players.length >= 2) {
      return jsonSend(ws, { type: 'ERROR', message: `Phòng ${cleanCode} đã đầy (2/2 người chơi)!` });
    }
    if (room.status !== 'waiting') {
      return jsonSend(ws, { type: 'ERROR', message: `Phòng ${cleanCode} đang trong trận đấu!` });
    }

    const playerPuzzle = room.mode === 'same_map' ? room.puzzleMaster : getRandomPuzzle(room.difficulty);

    const newPlayer = {
      id: ws.playerId,
      ws,
      name: playerName.slice(0, 24),
      ready: false,
      puzzle: playerPuzzle,
      solvedCount: 0,
      mistakes: 0,
      finished: false,
      timeSpent: 0
    };

    room.players.push(newPlayer);
    this.clientRoomMap.set(ws, cleanCode);

    // Notify both players
    this.broadcastToRoom(room, {
      type: 'ROOM_UPDATED',
      room: null // serialized per player in broadcast
    });
  }

  quickMatch(ws, payload) {
    const { playerName = 'Người chơi', difficulty = 'easy', mode = 'same_map' } = payload;

    // Look for existing waiting public room with same difficulty and mode
    for (const [code, r] of this.rooms.entries()) {
      if (!r.isPrivate && r.status === 'waiting' && r.players.length === 1 && r.difficulty === difficulty && r.mode === mode) {
        return this.joinRoom(ws, { roomCode: code, playerName });
      }
    }

    // No available room -> create public room
    this.createRoom(ws, { playerName, mode, difficulty, isPrivate: false });
  }

  setPlayerReady(ws, payload) {
    const roomCode = this.clientRoomMap.get(ws);
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === ws.playerId);
    if (!player) return;

    player.ready = Boolean(payload.ready ?? true);

    this.broadcastToRoom(room, {
      type: 'ROOM_UPDATED'
    });

    // If both ready and 2 players, start game countdown
    if (room.players.length === 2 && room.players.every(p => p.ready) && room.status === 'waiting') {
      this.startCountdown(room);
    }
  }

  startCountdown(room) {
    room.status = 'starting';
    let count = 3;

    this.broadcastToRoom(room, {
      type: 'COUNTDOWN',
      count
    });

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        this.broadcastToRoom(room, {
          type: 'COUNTDOWN',
          count
        });
      } else {
        clearInterval(timer);
        room.status = 'playing';
        room.startTime = Date.now();
        this.broadcastToRoom(room, {
          type: 'MATCH_STARTED',
          startTime: room.startTime
        });
      }
    }, 1000);
  }

  updateProgress(ws, payload) {
    const roomCode = this.clientRoomMap.get(ws);
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === ws.playerId);
    if (!player) return;

    player.solvedCount = Number(payload.solvedCount) || 0;
    player.percent = Math.min(100, Math.round((player.solvedCount / 81) * 100));

    // Send update to opponent
    const opponent = room.players.find(p => p.id !== ws.playerId);
    if (opponent) {
      jsonSend(opponent.ws, {
        type: 'OPPONENT_PROGRESS',
        solvedCount: player.solvedCount,
        percent: player.percent,
        mistakes: player.mistakes
      });
    }
  }

  playerMistake(ws, payload) {
    const roomCode = this.clientRoomMap.get(ws);
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === ws.playerId);
    if (!player) return;

    player.mistakes = Number(payload.mistakes) || (player.mistakes + 1);

    const opponent = room.players.find(p => p.id !== ws.playerId);
    if (opponent) {
      jsonSend(opponent.ws, {
        type: 'OPPONENT_MISTAKE',
        mistakes: player.mistakes
      });
    }

    // Check mistake elimination (3 mistakes)
    if (player.mistakes >= 3) {
      room.status = 'finished';
      room.winner = opponent ? opponent.id : null;

      jsonSend(player.ws, {
        type: 'MATCH_END',
        result: 'defeat',
        reason: 'mistakes_limit',
        message: 'Bạn đã phạm quá 3 lỗi! Trận đấu kết thúc.'
      });

      if (opponent) {
        jsonSend(opponent.ws, {
          type: 'MATCH_END',
          result: 'victory',
          reason: 'opponent_eliminated',
          message: 'Đối thủ phạm quá 3 lỗi! Bạn đã giành CHIẾN THẮNG!'
        });
      }
    }
  }

  playerFinished(ws, payload) {
    const roomCode = this.clientRoomMap.get(ws);
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === ws.playerId);
    if (!player || player.finished) return;

    player.finished = true;
    player.timeSpent = Number(payload.timeSpent) || Math.floor((Date.now() - room.startTime) / 1000);

    room.status = 'finished';
    room.winner = player.id;

    const opponent = room.players.find(p => p.id !== ws.playerId);

    jsonSend(player.ws, {
      type: 'MATCH_END',
      result: 'victory',
      timeSpent: player.timeSpent,
      message: 'XUẤT SẮC! Bạn đã giải xong bảng Sudoku trước và giành CHIẾN THẮNG!'
    });

    if (opponent) {
      jsonSend(opponent.ws, {
        type: 'MATCH_END',
        result: 'defeat',
        opponentTime: player.timeSpent,
        message: 'Đối thủ đã hoàn thành trước bạn! Hãy thử lại ở ván đấu sau.'
      });
    }
  }

  requestRematch(ws) {
    const roomCode = this.clientRoomMap.get(ws);
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'finished') return;

    const player = room.players.find(p => p.id === ws.playerId);
    if (!player) return;
    player.rematchRequested = true;

    const opponent = room.players.find(p => p.id !== ws.playerId);
    if (opponent && opponent.rematchRequested) {
      // Both want rematch -> reset room with new puzzle
      room.status = 'waiting';
      room.winner = null;
      room.puzzleMaster = getRandomPuzzle(room.difficulty);

      room.players.forEach(p => {
        p.ready = true;
        p.rematchRequested = false;
        p.solvedCount = 0;
        p.mistakes = 0;
        p.finished = false;
        p.puzzle = room.mode === 'same_map' ? room.puzzleMaster : getRandomPuzzle(room.difficulty);
      });

      this.startCountdown(room);
    } else if (opponent) {
      jsonSend(opponent.ws, {
        type: 'REMATCH_OFFERED',
        message: `${player.name} vừa yêu cầu tái đấu ván mới!`
      });
    }
  }

  leaveRoom(ws) {
    const roomCode = this.clientRoomMap.get(ws);
    if (!roomCode) return;

    const room = this.rooms.get(roomCode);
    this.clientRoomMap.delete(ws);

    if (!room) return;

    const remaining = room.players.filter(p => p.id !== ws.playerId);
    if (remaining.length === 0) {
      this.rooms.delete(roomCode);
    } else {
      room.players = remaining;
      room.status = 'waiting';
      this.broadcastToRoom(room, {
        type: 'OPPONENT_LEFT',
        message: 'Đối thủ đã rời khỏi phòng đấu!'
      });
    }
  }

  handleDisconnect(ws) {
    this.leaveRoom(ws);
  }

  broadcastToRoom(room, messageObj) {
    room.players.forEach(p => {
      const payload = { ...messageObj };
      payload.room = this.serializeRoom(room, p.id);
      jsonSend(p.ws, payload);
    });
  }

  serializeRoom(room, forPlayerId) {
    const me = room.players.find(p => p.id === forPlayerId);
    const opponent = room.players.find(p => p.id !== forPlayerId);

    return {
      code: room.code,
      mode: room.mode,
      difficulty: room.difficulty,
      status: room.status,
      isPrivate: room.isPrivate,
      me: me ? {
        id: me.id,
        name: me.name,
        ready: me.ready,
        solvedCount: me.solvedCount,
        mistakes: me.mistakes,
        puzzleRaw: me.puzzle ? me.puzzle.raw : null
      } : null,
      opponent: opponent ? {
        id: opponent.id,
        name: opponent.name,
        ready: opponent.ready,
        solvedCount: opponent.solvedCount,
        mistakes: opponent.mistakes
      } : null
    };
  }

  cleanupOldRooms() {
    const now = Date.now();
    for (const [code, r] of this.rooms.entries()) {
      if (now - r.createdAt > 3 * 3600 * 1000) { // 3 hours
        this.rooms.delete(code);
      }
    }
  }
}

export const KillerSudokuRealtime = new KillerSudokuRealtimeService();
