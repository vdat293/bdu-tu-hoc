import crypto from 'node:crypto';
import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { CommunityService } from './community.service.js';
import { IdentityPresentationService } from './identity-presentation.service.js';
import { PUBLIC_GAME_METAS, engineFor, GAME_ENGINES } from './games/index.js';
import { earnedGameTitles } from '../config/game-titles.js';
import { error } from './games/shared.js';

const GAME_TYPES = new Set(GAME_ENGINES.keys());
const ROOM_STATUSES = new Set(['waiting', 'active', 'finished', 'expired', 'cancelled']);
const DEFAULT_ROOM_TTL_SECONDS = 6 * 60 * 60;
const MIN_ROOM_TTL_SECONDS = 60;
const MAX_ROOM_TTL_SECONDS = 24 * 60 * 60;
const MAX_PAGE_SIZE = 100;
// Phòng đã kết thúc vẫn giữ cho hai người bấm "Chơi lại" trong 3 phút.
const REMATCH_TIMEOUT_SECONDS = 180;
const DEFAULT_TURN_SECONDS = 60;
const MIN_TURN_SECONDS = 10;
const MAX_TURN_SECONDS = 600;
const MAX_TIMEOUT_SWEEP = 50;
const MAX_CHAT_LENGTH = 200;

function cleanMssv(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizedGameType(value) {
  return engineFor(value).meta.id;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ttlSeconds(value) {
  const ttl = positiveInteger(value, DEFAULT_ROOM_TTL_SECONDS);
  if (ttl < MIN_ROOM_TTL_SECONDS || ttl > MAX_ROOM_TTL_SECONDS) {
    throw error(`Thời hạn phòng phải từ ${MIN_ROOM_TTL_SECONDS} đến ${MAX_ROOM_TTL_SECONDS} giây.`);
  }
  return ttl;
}

function challengeTtlSeconds(value) {
  const ttl = positiveInteger(value, 30 * 60);
  if (ttl < 60 || ttl > 7 * 24 * 60 * 60) {
    throw error('Thời hạn challenge phải từ 60 giây đến 7 ngày.');
  }
  return ttl;
}

// 0 = không giới hạn thời gian mỗi nước.
function turnSeconds(value, fallback = DEFAULT_TURN_SECONDS) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  if (parsed <= 0) return 0;
  if (parsed < MIN_TURN_SECONDS || parsed > MAX_TURN_SECONDS) {
    throw error(`Thời gian mỗi nước phải từ ${MIN_TURN_SECONDS} đến ${MAX_TURN_SECONDS} giây (hoặc 0 để không giới hạn).`);
  }
  return parsed;
}

function randomRoomCode() {
  return crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, 'X');
}

function randomInviteCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeRoomRef(value) {
  const ref = String(value ?? '').trim();
  if (!ref || ref.length > 32 || !/^[A-Za-z0-9_-]+$/.test(ref)) throw error('Mã phòng không hợp lệ.', 400, 'ROOM_INVALID');
  return ref.toUpperCase();
}

function playerColor(seat) {
  return Number(seat) === 1 ? 'white' : 'black';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDatabase() {
  if (!isDatabaseConfigured()) throw error('Database chưa được cấu hình.', 503, 'GAME_DATABASE_NOT_CONFIGURED');
}

function safeStateForViewer(gameType, state, seat) {
  const engine = engineFor(gameType);
  if (typeof engine.stateForViewer !== 'function') return state;
  try {
    return engine.stateForViewer(state, seat);
  } catch (err) {
    // Fail-closed: thà từ chối request còn hơn trả nguyên state có thông tin ẩn.
    console.error('[entertainment] stateForViewer failed:', err?.message);
    throw error('Không thể hiển thị trạng thái ván đấu.', 500, 'GAME_STATE_INVALID');
  }
}

function safeLegalMoves(room, seat) {
  if (!seat || room.status !== 'active') return null;
  const engine = engineFor(room.game_type);
  if (typeof engine.legalMoves !== 'function') return null;
  if (room.state?.result || room.state?.winner_seat) return null;
  if (Number(room.state?.current_seat) !== Number(seat)) return null;
  try {
    return engine.legalMoves(room.state, Number(seat));
  } catch {
    return null;
  }
}

function nextDeadline(row, state) {
  const seconds = Number(row.turn_seconds || 0);
  if (seconds <= 0) return null;
  const engine = engineFor(row.game_type);
  if (engine.meta?.clock === false) return null;
  if (state?.result || state?.winner_seat) return null;
  if (!state?.current_seat) return null;
  // Pha đặt tàu của battleship không tính giờ; chỉ pha bắn mới có deadline.
  if (state?.phase === 'placing') return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// Đầu hàng là nước đi đặc biệt dùng chung cho mọi game: không phụ thuộc lượt.
function applyMoveOrResign(gameType, state, move, seat) {
  if (move?.resign === true) {
    if (state.result || state.winner_seat) throw error('Ván đấu đã kết thúc.', 409, 'GAME_FINISHED');
    const next = clone(state);
    next.winner_seat = Number(seat) === 1 ? 2 : 1;
    next.result = 'win';
    next.resigned_seat = Number(seat);
    return next;
  }
  return engineFor(gameType).applyMove(state, move, seat);
}

function mapPlayer(row) {
  const name = row.full_name || row.name || row.mssv;
  return {
    mssv: row.mssv,
    name,
    full_name: name,
    seat: Number(row.seat),
    color: playerColor(row.seat),
    joined_at: row.joined_at
  };
}

// Thống kê thắng/thua toàn Game Hub (migration 045). Trả Map theo mssv; người
// chưa từng chơi không có dòng trong DB nên được coi là 0.
async function gameStatsFor(mssvs) {
  const stats = new Map();
  if (!Array.isArray(mssvs) || !mssvs.length || !isDatabaseConfigured()) return stats;
  try {
    const result = await query(`
      SELECT mssv, games_played, wins, losses, draws
      FROM game_player_stats
      WHERE mssv = ANY($1::text[])
    `, [mssvs.map((mssv) => cleanMssv(mssv)).filter(Boolean)]);
    for (const row of result.rows) {
      stats.set(String(row.mssv).toUpperCase(), {
        games_played: Number(row.games_played || 0),
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        draws: Number(row.draws || 0)
      });
    }
  } catch {}
  return stats;
}

// Ghi kết quả ván vào thống kê, idempotent theo (room, state_version, ghế).
// Chỉ cộng stat khi marker được chèn mới, nên retry/race không làm sai số liệu.
async function recordMatchResult(client, room, state, players, stateVersion) {
  if (!room?.id || !Number(stateVersion) || !Array.isArray(players) || !players.length) return;
  const winnerSeat = Number(state?.winner_seat || 0);
  const draw = !winnerSeat || state?.result === 'draw';
  for (const player of players) {
    const seat = Number(player.seat);
    if (seat !== 1 && seat !== 2) continue;
    const outcome = draw ? 'draw' : (seat === winnerSeat ? 'win' : 'loss');
    const inserted = await client.query(`
      INSERT INTO game_match_results (room_id, state_version, seat, mssv, game_type, outcome)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (room_id, state_version, seat) DO NOTHING
      RETURNING 1
    `, [room.id, Number(stateVersion), seat, player.mssv, room.game_type, outcome]);
    if (!inserted.rowCount) continue;
    await client.query(`
      INSERT INTO game_player_stats (mssv, games_played, wins, losses, draws, updated_at)
      VALUES ($1, 1, $2, $3, $4, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        games_played = game_player_stats.games_played + 1,
        wins = game_player_stats.wins + EXCLUDED.wins,
        losses = game_player_stats.losses + EXCLUDED.losses,
        draws = game_player_stats.draws + EXCLUDED.draws,
        updated_at = NOW()
    `, [player.mssv, outcome === 'win' ? 1 : 0, outcome === 'loss' ? 1 : 0, outcome === 'draw' ? 1 : 0]);
  }
}

// Gắn khung, danh hiệu trưng bày, thống kê thắng/thua và danh hiệu Game Hub vào
// payload phòng. Lỗi danh tính/thống kê không được làm hỏng phòng chơi.
async function enrichPlayers(players) {
  if (!Array.isArray(players) || !players.length) return players;
  const mssvs = players.map((player) => player.mssv);
  const [presentations, statsByMssv] = await Promise.all([
    IdentityPresentationService.getPresentations(mssvs).catch(() => new Map()),
    gameStatsFor(mssvs)
  ]);
  const byMssv = new Map([...presentations.entries()].map(([key, value]) => [String(key).toUpperCase(), value]));
  return players.map((player) => {
    const key = String(player.mssv).toUpperCase();
    const presentation = byMssv.get(key);
    const stats = statsByMssv.get(key) || { games_played: 0, wins: 0, losses: 0, draws: 0 };
    const titles = Array.isArray(presentation?.selected_titles) ? presentation.selected_titles : [];
    return {
      ...player,
      ...(presentation ? {
        name: presentation.name || player.name,
        full_name: presentation.name || player.full_name,
        avatar_url: presentation.avatar_url || null,
        avatar_source: presentation.avatar_source || 'initials',
        equipped_frame_id: presentation.equipped_frame_id || null,
        titles: titles.slice(0, 4).map((title) => ({
          id: title.id,
          label: title.label,
          tone: title.tone || null,
          rarity: title.rarity || null,
          asset_key: title.asset_key || null,
          gem_asset: title.gem_asset || null
        }))
      } : {}),
      stats,
      game_titles: earnedGameTitles(stats)
    };
  });
}

function mapRoom(row, { players = [], spectatorCount = 0, includeState = true, state, role = null, viewerSeat = null, legalMoves = null } = {}) {
  return {
    id: String(row.id),
    room_code: row.room_code,
    name: row.name || null,
    game_type: row.game_type,
    visibility: row.visibility,
    allow_spectators: row.allow_spectators !== false,
    allow_chat: row.allow_chat !== false,
    status: row.status,
    created_by_mssv: row.created_by_mssv,
    state_version: Number(row.state_version || 0),
    state: includeState ? state : undefined,
    winner_seat: row.winner_seat === null || row.winner_seat === undefined ? null : Number(row.winner_seat),
    result: row.result || null,
    turn_seconds: row.turn_seconds === null || row.turn_seconds === undefined ? 0 : Number(row.turn_seconds),
    turn_deadline: row.turn_deadline || null,
    expires_at: row.expires_at,
    last_activity_at: row.last_activity_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    players,
    spectator_count: Number(spectatorCount || 0),
    role,
    viewer_seat: viewerSeat,
    legal_moves: legalMoves
  };
}

// Dựng payload phòng theo góc nhìn người gọi: che state (battleship) và chỉ
// trả legal_moves cho đúng ghế đang tới lượt.
function roomView(row, players, { spectatorCount = 0, includeState = true, role = null, viewerSeat = null } = {}) {
  const seat = viewerSeat === null || viewerSeat === undefined ? null : Number(viewerSeat);
  const state = includeState ? safeStateForViewer(row.game_type, row.state, seat) : undefined;
  return mapRoom(row, {
    players,
    spectatorCount,
    includeState,
    state,
    role,
    viewerSeat: seat,
    legalMoves: includeState ? safeLegalMoves(row, seat) : null
  });
}

function spectatorCountFor(roomCode, players) {
  return typeof EntertainmentGameService.getSpectatorCount === 'function'
    ? EntertainmentGameService.getSpectatorCount(roomCode, players.map((player) => player.mssv))
    : 0;
}

async function roomAndPlayers(roomRef, client = null, lock = false) {
  const runner = client || { query };
  const suffix = lock ? ' FOR UPDATE' : '';
  const room = await runner.query(`SELECT * FROM game_rooms WHERE room_code = $1 OR id::text = $1 LIMIT 1${suffix}`, [normalizeRoomRef(roomRef)]);
  if (!room.rowCount) throw error('Không tìm thấy phòng.', 404, 'ROOM_NOT_FOUND');
  const players = await runner.query(`
    SELECT p.mssv, p.seat, p.joined_at, COALESCE(NULLIF(s.full_name, ''), p.mssv) AS full_name
    FROM game_room_players p
    LEFT JOIN students s ON s.mssv = p.mssv
    WHERE p.room_id = $1 AND p.left_at IS NULL
    ORDER BY p.seat
  `, [room.rows[0].id]);
  return { room: room.rows[0], players: players.rows };
}

async function ensureStudent(client, mssv) {
  await client.query(`INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE) ON CONFLICT (mssv) DO NOTHING`, [mssv]);
}

// Kết thúc ván do hết giờ: người đang tới lượt bị xử thua.
async function finishTimedOutRoom(room) {
  const state = clone(room.state || {});
  if (state.result || state.winner_seat) return null;
  const loserSeat = Number(state.current_seat) === 1 ? 1 : 2;
  const winnerSeat = loserSeat === 1 ? 2 : 1;
  state.winner_seat = winnerSeat;
  state.result = 'win';
  state.timed_out_seat = loserSeat;
  const nextVersion = Number(room.state_version || 0) + 1;
  return transaction(async (client) => {
    const updated = await client.query(`
      UPDATE game_rooms
      SET state = $2::jsonb, state_version = $3, status = 'finished', winner_seat = $4, result = 'timeout',
          finished_at = NOW(), turn_deadline = NULL, updated_at = NOW(), last_activity_at = NOW()
      WHERE id = $1 AND status = 'active' AND turn_deadline IS NOT NULL AND turn_deadline <= NOW()
      RETURNING *
    `, [room.id, JSON.stringify(state), nextVersion, winnerSeat]);
    if (!updated.rowCount) return null;
    const players = await client.query(`SELECT mssv, seat, joined_at FROM game_room_players WHERE room_id = $1 AND left_at IS NULL`, [room.id]);
    await recordMatchResult(client, updated.rows[0], state, players.rows, nextVersion);
    return updated.rows[0];
  });
}

export function viewerStateFor(gameType, state, seat) {
  return safeStateForViewer(gameType, state, seat);
}

// Dùng cho gateway khi broadcast: chỉ ghế đang tới lượt mới nhận gợi ý nước đi.
export function viewerLegalMovesFor(gameType, state, seat) {
  if (!seat) return null;
  const engine = engineFor(gameType);
  if (typeof engine.legalMoves !== 'function') return null;
  if (state?.result || state?.winner_seat) return null;
  if (Number(state?.current_seat) !== Number(seat)) return null;
  try {
    return engine.legalMoves(state, Number(seat));
  } catch {
    return null;
  }
}

export const EntertainmentGameService = {
  async createRoom({ mssv, gameType, visibility = 'private', name = null, allowSpectators = true, allowChat = true, turnSeconds: requestedTurnSeconds, ttlSeconds: requestedTtl }) {
    assertDatabase();
    const owner = cleanMssv(mssv);
    if (!owner) throw error('MSSV người tạo là bắt buộc.', 401, 'AUTH_REQUIRED');
    const engine = engineFor(gameType);
    const type = engine.meta.id;
    const cleanVisibility = String(visibility).toLowerCase() === 'public' ? 'public' : 'private';
    const finalAllowSpectators = allowSpectators !== false;
    const cleanName = String(name || '').trim().slice(0, 80) || null;
    const ttl = ttlSeconds(requestedTtl);
    const turn = engine.meta.clock === false ? 0 : turnSeconds(requestedTurnSeconds, DEFAULT_TURN_SECONDS);
    return transaction(async (client) => {
      await ensureStudent(client, owner);
      let room;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          room = await client.query(`
            INSERT INTO game_rooms (room_code, name, game_type, visibility, allow_spectators, allow_chat, turn_seconds, created_by_mssv, state, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW() + ($10 * INTERVAL '1 second'))
            RETURNING *
          `, [randomRoomCode(), cleanName, type, cleanVisibility, finalAllowSpectators, allowChat !== false, turn, owner, JSON.stringify(engine.initialState()), ttl]);
          break;
        } catch (err) {
          if (err.code !== '23505' || attempt === 2) throw err;
        }
      }
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, 1)', [room.rows[0].id, owner]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [owner]);
      const fullName = studentNameRes.rows[0]?.full_name || owner;
      const players = await enrichPlayers([{ mssv: owner, full_name: fullName, seat: 1, joined_at: new Date().toISOString() }].map(mapPlayer));
      return roomView(room.rows[0], players, { role: 'player', viewerSeat: 1 });
    });
  },

  async getRoom(roomRef, { mssv = null, includeState = true } = {}) {
    assertDatabase();
    await this.expireStale();
    const { room, players } = await roomAndPlayers(roomRef);
    const cleanUser = cleanMssv(mssv);
    const me = players.find((player) => player.mssv === cleanUser) || null;
    if (room.allow_spectators === false && !me) {
      throw error('Phòng này không cho phép khán giả.', 403, 'ROOM_FORBIDDEN');
    }
    const enriched = await enrichPlayers(players.map(mapPlayer));
    return roomView(room, enriched, {
      includeState,
      role: me ? 'player' : (cleanUser ? 'spectator' : null),
      viewerSeat: me ? Number(me.seat) : null,
      spectatorCount: spectatorCountFor(room.room_code, players)
    });
  },

  async listRooms({ mssv = null, gameType = null, status = null, limit = 50, offset = 0 } = {}) {
    assertDatabase();
    await this.expireStale();
    const params = [];
    const conditions = [`r.status IN ('waiting', 'active')`];
    if (gameType) { params.push(normalizedGameType(gameType)); conditions.push(`r.game_type = $${params.length}`); }
    if (status) {
      const cleanStatus = String(status).toLowerCase();
      if (!ROOM_STATUSES.has(cleanStatus)) throw error('Trạng thái phòng không hợp lệ.');
      params.push(cleanStatus);
      conditions.push(`r.status = $${params.length}`);
    }
    params.push(Math.min(MAX_PAGE_SIZE, Math.max(1, positiveInteger(limit, 50))));
    const limitIndex = params.length;
    params.push(Math.max(0, Number.parseInt(offset, 10) || 0));
    const offsetIndex = params.length;
    const result = await query(`
      SELECT r.*, COUNT(p.mssv)::int AS player_count
      FROM game_rooms r
      LEFT JOIN game_room_players p ON p.room_id = r.id AND p.left_at IS NULL
      WHERE ${conditions.join(' AND ')} AND (r.visibility = 'public' OR r.created_by_mssv = $${params.length + 1})
      GROUP BY r.id
      ORDER BY r.status ASC, r.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, [...params, cleanMssv(mssv) || null]);
    const rooms = result.rows.map((row) => ({ ...mapRoom(row, { includeState: false }), player_count: Number(row.player_count || 0) }));
    return { rooms, limit: params[limitIndex - 1], offset: params[offsetIndex - 1] };
  },

  // Người đầu tiên mở link chiếm ghế trống (đối thủ); khi đã đủ 2 người,
  // người vào sau chỉ được xem và không tạo bản ghi người chơi.
  async joinRoom(roomRef, mssv) {
    assertDatabase();
    const player = cleanMssv(mssv);
    if (!player) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true);
      const room = found.room;
      const players = found.players;
      const existing = players.find((item) => item.mssv === player);
      if (existing) {
        const enriched = await enrichPlayers(players.map(mapPlayer));
        return roomView(room, enriched, { role: 'player', viewerSeat: Number(existing.seat), spectatorCount: spectatorCountFor(room.room_code, players) });
      }
      const canTakeSeat = (room.status === 'waiting' || room.status === 'active') && players.length < 2;
      if (!canTakeSeat) {
        if (room.allow_spectators === false) throw error('Phòng này không cho phép khán giả.', 403, 'ROOM_FORBIDDEN');
        const enriched = await enrichPlayers(players.map(mapPlayer));
        return roomView(room, enriched, { role: 'spectator', viewerSeat: null, spectatorCount: spectatorCountFor(room.room_code, players) });
      }
      await ensureStudent(client, player);
      const seat = players.some((item) => Number(item.seat) === 1) ? 2 : 1;
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, $3)', [room.id, player, seat]);
      const seconds = Number(room.turn_seconds || 0);
      const placing = room.state?.phase === 'placing';
      const updated = await client.query(`
        UPDATE game_rooms
        SET status = 'active',
            turn_deadline = CASE WHEN $2::int > 0 AND status = 'waiting' AND $3::boolean = FALSE THEN NOW() + ($2 * INTERVAL '1 second') ELSE turn_deadline END,
            updated_at = NOW(), last_activity_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [room.id, seconds, placing]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [player]);
      const fullName = studentNameRes.rows[0]?.full_name || player;
      const enriched = await enrichPlayers([...players, { mssv: player, full_name: fullName, seat, joined_at: new Date().toISOString() }].map(mapPlayer));
      return roomView(updated.rows[0], enriched, { role: 'player', viewerSeat: seat, spectatorCount: spectatorCountFor(room.room_code, players) });
    });
  },

  async makeMove(roomRef, mssv, move, { clientMoveId = null } = {}) {
    assertDatabase();
    const actor = cleanMssv(mssv);
    if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true);
      const room = found.room;
      const players = found.players;
      const player = players.find((item) => item.mssv === actor);
      if (!player) throw error('Bạn không phải người chơi trong phòng này.', 403, 'PLAYER_FORBIDDEN');
      const cleanClientMoveId = clientMoveId ? String(clientMoveId).trim().slice(0, 128) : null;
      // Kiểm tra idempotency TRƯỚC khi chặn theo trạng thái phòng: một nước đi
      // đã commit (kể cả nước quyết định kết thúc ván) phải trả lại đúng kết quả
      // khi client retry, thay vì báo lỗi "phòng đã kết thúc".
      if (cleanClientMoveId) {
        const duplicate = await client.query('SELECT move_number, actor_mssv, move, resulting_state FROM game_room_moves WHERE room_id = $1 AND client_move_id = $2', [room.id, cleanClientMoveId]);
        if (duplicate.rowCount && duplicate.rows[0].actor_mssv === actor) {
          return {
            id: String(room.id),
            room_code: room.room_code,
            game_type: room.game_type,
            move_number: Number(duplicate.rows[0].move_number),
            move: duplicate.rows[0].move,
            state: duplicate.rows[0].resulting_state,
            state_version: Number(duplicate.rows[0].move_number),
            idempotent: true,
            status: room.status,
            seat: Number(player.seat),
            turn_deadline: room.turn_deadline || null
          };
        }
      }
      if (room.status !== 'active') throw error('Phòng chưa bắt đầu hoặc đã kết thúc.', 409, 'ROOM_NOT_ACTIVE');
      // Đồng hồ chạy theo sweep 5s, nhưng nước đi sau hạn vẫn phải bị từ chối
      // ngay; sweeper sẽ chốt ván ngay sau khi transaction này rollback.
      // Pha đặt tàu của battleship được miễn deadline hoàn toàn.
      const placingPhase = room.state?.phase === 'placing';
      if (!placingPhase && Number(room.turn_seconds || 0) > 0 && room.turn_deadline && new Date(room.turn_deadline).getTime() <= Date.now()) {
        Promise.resolve().then(() => this.expireStale()).catch(() => {});
        throw error('Bạn đã hết thời gian mỗi nước.', 409, 'TURN_TIMEOUT');
      }
      // Đầu hàng được xử riêng trong applyMoveOrResign vì không phụ thuộc lượt đi.
      const engine = engineFor(room.game_type);
      const nextState = applyMoveOrResign(room.game_type, room.state, move, Number(player.seat));
      // Lịch sử/broadcast chỉ lưu bản công khai của nước đi (battleship giấu đội tàu).
      const storedMove = typeof engine.redactMove === 'function' ? engine.redactMove(move, Number(player.seat)) : move;
      const moveNumber = Number(room.state_version) + 1;
      const nextStatus = nextState.result ? 'finished' : 'active';
      const deadline = nextStatus === 'active' ? nextDeadline(room, nextState) : null;
      const updated = await client.query(`
        UPDATE game_rooms
        SET state = $2::jsonb, state_version = $3, status = $4, winner_seat = $5, result = $6,
            finished_at = CASE WHEN $4 = 'finished' THEN NOW() ELSE NULL END,
            turn_deadline = $7, last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [room.id, JSON.stringify(nextState), moveNumber, nextStatus, nextState.winner_seat, nextState.result, deadline]);
      await client.query(`INSERT INTO game_room_moves (room_id, move_number, actor_mssv, move, resulting_state, client_move_id) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`, [room.id, moveNumber, actor, JSON.stringify(storedMove), JSON.stringify(nextState), cleanClientMoveId]);
      if (nextStatus === 'finished') {
        // Thống kê chỉ cộng một lần cho mỗi ván nhờ marker (room_id, state_version, seat).
        await recordMatchResult(client, room, nextState, players, moveNumber);
        this.startRematchCountdown(room.room_code);
      }
      return {
        id: String(room.id),
        room_code: room.room_code,
        game_type: room.game_type,
        move_number: moveNumber,
        move: storedMove,
        state: nextState,
        state_version: moveNumber,
        status: updated.rows[0].status,
        winner_seat: nextState.winner_seat,
        result: nextState.result,
        actor_mssv: actor,
        seat: Number(player.seat),
        turn_deadline: deadline,
        legal_moves: nextStatus === 'active' ? safeLegalMoves({ ...room, state: nextState, status: 'active' }, Number(player.seat)) : null,
        idempotent: false
      };
    });
  },

  clearRematchTimer(roomCode) {
    if (this.rematchTimers?.has(roomCode)) {
      clearTimeout(this.rematchTimers.get(roomCode));
      this.rematchTimers.delete(roomCode);
    }
  },

  startRematchCountdown(roomRef) {
    const code = normalizeRoomRef(roomRef);
    this.clearRematchTimer(code);
    if (!this.rematchTimers) this.rematchTimers = new Map();

    const timer = setTimeout(async () => {
      this.rematchTimers?.delete(code);
      this.rematchRequests?.delete(code);
      try {
        const { room } = await roomAndPlayers(code);
        if (room && room.status === 'finished') {
          await query(`DELETE FROM game_rooms WHERE id = $1`, [room.id]);
          if (typeof this.onRoomClosed === 'function') {
            this.onRoomClosed(code, {
              reason: 'rematch_timeout',
              message: `Hết ${REMATCH_TIMEOUT_SECONDS} giây chờ đánh lại. Phòng đã tự động đóng.`
            });
          }
        }
      } catch {}
    }, REMATCH_TIMEOUT_SECONDS * 1000);
    timer.unref?.();
    this.rematchTimers.set(code, timer);
  },

  // Rời phòng khi ván đang chơi = xử thua (đối thủ thắng), phòng được giữ lại
  // ngắn hạn để khán giả thấy kết quả và hai người có thể chơi lại.
  async leaveRoom(roomRef, mssv) {
    assertDatabase();
    const actor = cleanMssv(mssv);
    if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true);
      const room = found.room;
      const players = found.players;
      const player = players.find((item) => item.mssv === actor);
      if (!player) {
        return { room_code: room.room_code, is_player: false, deleted: false, actor };
      }
      if (room.status === 'waiting') {
        await client.query(`DELETE FROM game_rooms WHERE id = $1`, [room.id]);
        this.clearRematchTimer(room.room_code);
        this.rematchRequests?.delete(room.room_code);
        return { id: String(room.id), room_code: room.room_code, is_player: true, deleted: true, actor };
      }
      if (room.status === 'active') {
        const seat = Number(player.seat);
        const winnerSeat = seat === 1 ? 2 : 1;
        const nextState = clone(room.state || {});
        nextState.winner_seat = winnerSeat;
        nextState.result = 'win';
        nextState.forfeited_seat = seat;
        const moveNumber = Number(room.state_version || 0) + 1;
        const updated = await client.query(`
          UPDATE game_rooms
          SET state = $2::jsonb, state_version = $3, status = 'finished', winner_seat = $4, result = 'forfeit',
              finished_at = NOW(), turn_deadline = NULL, updated_at = NOW(), last_activity_at = NOW()
          WHERE id = $1 AND status = 'active'
          RETURNING *
        `, [room.id, JSON.stringify(nextState), moveNumber, winnerSeat]);
        if (!updated.rowCount) return { id: String(room.id), room_code: room.room_code, is_player: true, deleted: false, actor };
        await recordMatchResult(client, room, nextState, players, moveNumber);
        this.startRematchCountdown(room.room_code);
        return {
          id: String(room.id),
          room_code: room.room_code,
          game_type: room.game_type,
          is_player: true,
          deleted: false,
          forfeited: true,
          actor,
          seat,
          winner_seat: winnerSeat,
          state: nextState,
          status: 'finished',
          result: 'forfeit',
          state_version: moveNumber
        };
      }
      return { id: String(room.id), room_code: room.room_code, is_player: true, deleted: false, actor };
    });
  },

  async requestRematch(roomRef, mssv) {
    assertDatabase();
    const actor = cleanMssv(mssv);
    if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');

    const found = await roomAndPlayers(roomRef);
    const room = found.room;
    const players = found.players;
    const player = players.find((item) => item.mssv === actor);
    if (!player) throw error('Bạn không phải người chơi trong phòng này.', 403, 'PLAYER_FORBIDDEN');
    if (room.status !== 'finished') throw error('Chỉ có thể yêu cầu đánh lại khi ván đấu đã kết thúc.', 400, 'REMATCH_NOT_ALLOWED');

    const code = room.room_code;
    if (!this.rematchRequests) this.rematchRequests = new Map();
    let votes = this.rematchRequests.get(code);
    if (!votes) {
      votes = new Set();
      this.rematchRequests.set(code, votes);
    }
    votes.add(actor);

    if (votes.size < 2) {
      // Một người đã đồng ý: gia hạn thêm một chu kỳ để đối thủ kịp quyết định,
      // tránh việc phòng tự đóng ngay sau khi có phiếu đầu tiên.
      this.startRematchCountdown(code);
    }

    if (votes.size >= 2) {
      this.clearRematchTimer(code);
      this.rematchRequests.delete(code);

      return transaction(async (client) => {
        const engine = engineFor(room.game_type);
        const nextState = engine.initialState();
        const nextVersion = Number(room.state_version) + 1;
        const deadline = Number(room.turn_seconds || 0) > 0 && engine.meta.clock !== false && nextState.current_seat && nextState.phase !== 'placing'
          ? new Date(Date.now() + Number(room.turn_seconds) * 1000).toISOString()
          : null;
        const updated = await client.query(
          `UPDATE game_rooms SET state = $2::jsonb, state_version = $3, status = 'active', winner_seat = NULL, result = NULL, finished_at = NULL, turn_deadline = $4, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
          [room.id, JSON.stringify(nextState), nextVersion, deadline]
        );
        await client.query(`DELETE FROM game_room_moves WHERE room_id = $1`, [room.id]);
        const enriched = await enrichPlayers(players.map(mapPlayer));
        return {
          room_code: code,
          ready: true,
          room: roomView(updated.rows[0], enriched, { viewerSeat: Number(player.seat) })
        };
      });
    }

    return { room_code: code, ready: false, votes: [...votes], actor };
  },

  async createChallenge(roomRef, mssv, { challengedMssv = null, expiresInSeconds = null, postToConfession = false, confessionAnonymous = true } = {}) {
    assertDatabase();
    const creator = cleanMssv(mssv);
    const target = challengedMssv ? cleanMssv(challengedMssv) : null;
    const ttl = challengeTtlSeconds(expiresInSeconds);
    const inviteCode = randomInviteCode();
    const challengeId = crypto.randomUUID();
    const result = await transaction(async (client) => {
      const { room, players } = await roomAndPlayers(roomRef, client, true);
      if (!players.some((item) => item.mssv === creator)) throw error('Chỉ người chơi trong phòng mới được tạo challenge.', 403, 'PLAYER_FORBIDDEN');
      if (room.status !== 'waiting') throw error('Chỉ có thể tạo challenge khi phòng đang chờ đối thủ.', 409, 'ROOM_NOT_JOINABLE');
      if (target === creator) throw error('Không thể tự thách đấu chính mình.');
      if (target) await ensureStudent(client, target);
      await client.query(`INSERT INTO game_challenges (id, room_id, created_by_mssv, challenged_mssv, invite_code_hash, expires_at) VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 second'))`, [challengeId, room.id, creator, target, sha256(inviteCode), ttl]);
      return { id: challengeId, room, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    });
    let confessionPost = null;
    if (postToConfession) {
      const publicBase = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
      const inviteUrl = `${publicBase || ''}/games/challenges/${result.id}?code=${encodeURIComponent(inviteCode)}`;
      confessionPost = await CommunityService.createPost({ authorMssv: creator, title: `Thách đấu ${result.room.game_type}`, content: `Mời tham gia phòng ${result.room.room_code}. Link mời có hạn đến ${result.expiresAt}: ${inviteUrl}`, scope: 'school', isAnonymous: Boolean(confessionAnonymous), category: 'confession' });
      await query('UPDATE game_challenges SET confession_post_id = $2, updated_at = NOW() WHERE id = $1', [result.id, confessionPost.id]);
    }
    return { id: result.id, room_code: result.room.room_code, game_type: result.room.game_type, invite_code: inviteCode, expires_at: result.expiresAt, confession_post_id: confessionPost?.id || null };
  },

  async getChallenge(challengeId) {
    assertDatabase();
    await this.expireStale();
    const result = await query(`
      SELECT c.id, c.status, c.expires_at, c.created_at, c.confession_post_id,
        r.room_code, r.game_type, r.status AS room_status
      FROM game_challenges c
      JOIN game_rooms r ON r.id = c.room_id
      WHERE c.id = $1
      LIMIT 1
    `, [String(challengeId)]);
    if (!result.rowCount) throw error('Không tìm thấy challenge.', 404, 'CHALLENGE_NOT_FOUND');
    const row = result.rows[0];
    return {
      id: String(row.id),
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      room_code: row.room_code,
      game_type: row.game_type,
      room_status: row.room_status,
      confession_post_id: row.confession_post_id ? String(row.confession_post_id) : null
    };
  },

  async acceptChallenge(challengeId, mssv, inviteCode = null) {
    assertDatabase();
    const player = cleanMssv(mssv);
    return transaction(async (client) => {
      const challenge = await client.query(`SELECT c.*, r.room_code, r.status AS room_status FROM game_challenges c JOIN game_rooms r ON r.id = c.room_id WHERE c.id = $1 FOR UPDATE`, [String(challengeId)]);
      if (!challenge.rowCount) throw error('Không tìm thấy challenge.', 404, 'CHALLENGE_NOT_FOUND');
      const row = challenge.rows[0];
      if (row.status !== 'pending' || new Date(row.expires_at).getTime() <= Date.now()) throw error('Challenge đã hết hạn hoặc không còn hiệu lực.', 410, 'CHALLENGE_EXPIRED');
      if (row.challenged_mssv && row.challenged_mssv !== player) throw error('Challenge này dành cho sinh viên khác.', 403, 'CHALLENGE_FORBIDDEN');
      if (!inviteCode || row.invite_code_hash !== sha256(inviteCode)) throw error('Mã mời không hợp lệ.', 403, 'CHALLENGE_FORBIDDEN');
      await client.query(`UPDATE game_challenges SET status = 'accepted', accepted_by_mssv = $2, accepted_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id, player]);
      const room = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [row.room_id]);
      if (!room.rowCount || room.rows[0].status !== 'waiting') throw error('Phòng không còn ở trạng thái chờ người chơi.', 409, 'ROOM_NOT_JOINABLE');
      const players = await client.query(`
        SELECT p.mssv, p.seat, p.joined_at, COALESCE(NULLIF(s.full_name, ''), p.mssv) AS full_name
        FROM game_room_players p
        LEFT JOIN students s ON s.mssv = p.mssv
        WHERE p.room_id = $1 AND p.left_at IS NULL
        ORDER BY p.seat FOR UPDATE
      `, [row.room_id]);
      if (players.rows.some((item) => item.mssv === player)) return roomView(room.rows[0], await enrichPlayers(players.rows.map(mapPlayer)), { role: 'player', viewerSeat: Number(players.rows.find((item) => item.mssv === player).seat) });
      if (players.rows.length >= 2) throw error('Phòng đã đủ người chơi.', 409, 'ROOM_FULL');
      await ensureStudent(client, player);
      const seat = players.rows.some((item) => Number(item.seat) === 1) ? 2 : 1;
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, $3)', [row.room_id, player, seat]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [player]);
      const fullName = studentNameRes.rows[0]?.full_name || player;
      const seconds = Number(room.rows[0].turn_seconds || 0);
      const placing = room.rows[0].state?.phase === 'placing';
      const updated = await client.query(`
        UPDATE game_rooms
        SET status = 'active',
            turn_deadline = CASE WHEN $2::int > 0 AND status = 'waiting' AND $3::boolean = FALSE THEN NOW() + ($2 * INTERVAL '1 second') ELSE turn_deadline END,
            updated_at = NOW(), last_activity_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [row.room_id, seconds, placing]);
      const enriched = await enrichPlayers([...players.rows, { mssv: player, full_name: fullName, seat, joined_at: new Date().toISOString() }].map(mapPlayer));
      return roomView(updated.rows[0], enriched, { role: 'player', viewerSeat: seat });
    });
  },

  async expireStale() {
    if (!isDatabaseConfigured()) return { challenges: [], rooms: [], timeouts: [] };
    const expiredChallenges = await query(`UPDATE game_challenges SET status = 'expired', updated_at = NOW() WHERE status = 'pending' AND expires_at <= NOW() RETURNING id, room_id, confession_post_id`);
    const expiredRooms = await query(`UPDATE game_rooms SET status = 'expired', result = 'expired', updated_at = NOW(), finished_at = COALESCE(finished_at, NOW()), turn_deadline = NULL WHERE status IN ('waiting', 'active') AND expires_at <= NOW() RETURNING id, room_code`);
    for (const row of expiredChallenges.rows) {
      if (row.confession_post_id) await query(`UPDATE community_posts SET deleted_at = COALESCE(deleted_at, NOW()), deleted_by_mssv = NULL, delete_reason = 'challenge_expired', updated_at = NOW() WHERE id = $1`, [row.confession_post_id]);
    }
    const challengeEvents = [];
    for (const row of expiredChallenges.rows) {
      const room = await query('SELECT room_code FROM game_rooms WHERE id = $1', [row.room_id]);
      challengeEvents.push({ id: String(row.id), room_id: String(row.room_id), room_code: room.rows[0]?.room_code || null });
    }
    const staleTurns = await query(`SELECT * FROM game_rooms WHERE status = 'active' AND turn_deadline IS NOT NULL AND turn_deadline <= NOW() AND COALESCE(state->>'phase', '') <> 'placing' LIMIT ${MAX_TIMEOUT_SWEEP}`);
    const timeouts = [];
    for (const row of staleTurns.rows) {
      const updated = await finishTimedOutRoom(row);
      if (updated) {
        this.startRematchCountdown(updated.room_code);
        timeouts.push({
          room_code: updated.room_code,
          game_type: updated.game_type,
          state: updated.state,
          winner_seat: Number(updated.winner_seat),
          result: updated.result,
          state_version: Number(updated.state_version),
          status: updated.status,
          reason: 'turn_timeout'
        });
      }
    }
    return {
      challenges: challengeEvents,
      rooms: expiredRooms.rows.map((row) => ({ id: String(row.id), room_code: row.room_code })),
      timeouts
    };
  },

  async listMoves(roomRef, { after = 0, limit = 100, mssv = null } = {}) {
    assertDatabase();
    const { room, players } = await roomAndPlayers(roomRef);
    const safeAfter = Math.max(0, Number.parseInt(after, 10) || 0);
    const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(limit, 10) || 100));
    const cleanUser = cleanMssv(mssv);
    const player = players.find((item) => item.mssv === cleanUser) || null;
    if (room.allow_spectators === false && !player) {
      throw error('Phòng này không cho phép khán giả.', 403, 'ROOM_FORBIDDEN');
    }
    const viewerSeat = player ? Number(player.seat) : null;
    const result = await query(`SELECT move_number, actor_mssv, move, resulting_state, created_at FROM game_room_moves WHERE room_id = $1 AND move_number > $2 ORDER BY move_number ASC LIMIT $3`, [room.id, safeAfter, safeLimit]);
    return {
      room_code: room.room_code,
      moves: result.rows.map((row) => ({
        move_number: Number(row.move_number),
        actor_mssv: row.actor_mssv,
        move: row.move,
        state: safeStateForViewer(room.game_type, row.resulting_state, viewerSeat),
        created_at: row.created_at
      }))
    };
  },

  // Chat trong phòng chỉ chạy qua WebSocket, không lưu DB; đây là nơi chuẩn hoá
  // nội dung để gateway dùng chung.
  sanitizeChat(message) {
    const kind = String(message?.kind || 'text').toLowerCase() === 'emoji' ? 'emoji' : 'text';
    const text = String(message?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) throw error('Tin nhắn trống.', 400, 'CHAT_EMPTY');
    return { kind, text };
  },

  start({ onEvent } = {}) {
    this.stop();
    this.expiryTimer = setInterval(async () => {
      try {
        const expired = await this.expireStale();
        if (onEvent) {
          expired.challenges.forEach((item) => onEvent({ type: 'challenge.expired', data: item }));
          expired.rooms.forEach((item) => onEvent({ type: 'room.expired', data: item }));
          (expired.timeouts || []).forEach((item) => onEvent({ type: 'turn.timeout', data: item }));
        }
      } catch (err) {
        console.error('[entertainment] expiry sweep failed:', err.message);
      }
    }, 5_000);
    this.expiryTimer.unref?.();
    return this;
  },

  stop() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
  }
};

EntertainmentGameService.expiryTimer = null;

export const EntertainmentGameInternals = {
  GAME_TYPES,
  ROOM_STATUSES,
  PUBLIC_GAME_METAS,
  initialState: (gameType) => engineFor(gameType).initialState(),
  applyMove: (gameType, state, move, seat) => applyMoveOrResign(gameType, state, move, seat),
  // Export cho test: pha placing của battleship phải được miễn deadline.
  nextDeadline: (row, state) => nextDeadline(row, state),
  normalizedGameType,
  normalizeRoomRef,
  challengeTtlSeconds,
  ttlSeconds,
  turnSeconds,
  MAX_CHAT_LENGTH
};
