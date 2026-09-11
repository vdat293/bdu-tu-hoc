import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { query } from '../db/database.js';
import { BduIdentityService } from './bdu-identity.service.js';
import { normalizeCourseCode } from './learning.service.js';
import { EntertainmentGameService } from './entertainment-game.service.js';

const WS_PATH = '/ws/community';
const MAX_PAYLOAD = 16 * 1024;
const WS_OPEN = 1;
const DEFAULT_AUTH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function authTimeoutMs() {
  return positiveInteger(process.env.WS_AUTH_TIMEOUT_MS, DEFAULT_AUTH_TIMEOUT_MS);
}

function maxBufferedBytes() {
  return positiveInteger(process.env.WS_MAX_BUFFERED_BYTES, DEFAULT_MAX_BUFFERED_BYTES);
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '')
    .split(',')[0]
    .trim();
}

function getForwardedHost(request) {
  const xForwardedHost = firstHeaderValue(request.headers['x-forwarded-host']);
  if (xForwardedHost) return xForwardedHost;

  const forwarded = firstHeaderValue(request.headers.forwarded);
  const hostPart = forwarded.split(';').find((part) => part.trim().toLowerCase().startsWith('host='));
  return hostPart ? hostPart.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '') : '';
}

function normalizeHost(value, protocol) {
  if (!value) return '';
  try {
    return new URL(`${protocol}//${value}`).host;
  } catch {
    return '';
  }
}

function configuredOrigins() {
  return String(process.env.WS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

function trustsProxyHeaders() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.WS_TRUST_PROXY || '').toLowerCase());
}

function isAllowedOrigin(request) {
  const origin = firstHeaderValue(request.headers.origin);
  // Non-browser clients may omit Origin. They are still required to authenticate
  // with a bearer token before they can receive any room events.
  if (!origin) return true;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(originUrl.protocol)) return false;

  const allowedOrigins = configuredOrigins();
  // An explicit allowlist is authoritative. This supports a frontend served
  // from another origin without making a forged Host header meaningful.
  if (allowedOrigins.length) return allowedOrigins.includes(originUrl.origin);

  // Reverse proxies commonly replace Host with their upstream address while
  // preserving the public host in X-Forwarded-Host or Forwarded. Only compare
  // that value when deployment has explicitly marked the proxy as trusted.
  const requestHosts = [normalizeHost(firstHeaderValue(request.headers.host), originUrl.protocol)];
  if (trustsProxyHeaders()) {
    requestHosts.push(normalizeHost(getForwardedHost(request), originUrl.protocol));
  }
  return requestHosts.filter(Boolean).includes(originUrl.host);
}

function jsonSend(ws, payload) {
  if (!ws || ws.readyState !== WS_OPEN) return false;
  // A slow client can otherwise make each broadcast retain more memory until
  // the VPS is killed. Its next reconnect will receive a recovery refetch.
  if (ws.bufferedAmount > maxBufferedBytes()) {
    try { ws.terminate(); } catch {}
    return false;
  }
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    try { ws.terminate(); } catch {}
    return false;
  }
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function communityPostRoom(postId) {
  return `community-post:${String(postId)}`;
}

function coursePostRoom(postId) {
  return `course-post:${String(postId)}`;
}

function clanRoom(clanId) {
  return `clan:${String(clanId)}`;
}

function courseRoom(courseCode) {
  return `course:${normalizeCourseCode(courseCode)}`;
}

function gameRoom(roomCode) {
  return `game:${String(roomCode || '').trim().toUpperCase()}`;
}

function scopeRoom(scope, scopeId) {
  if (scope === 'clan') return clanRoom(scopeId);
  if (scope === 'course') return courseRoom(scopeId);
  return 'forum';
}

class CommunityRealtimeGateway {
  constructor() {
    this.wss = null;
    this.httpServer = null;
    this.clients = new Set();
    this.rooms = new Map();
    this.heartbeat = null;
  }

  attach(httpServer) {
    if (this.wss) return this;
    this.httpServer = httpServer;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

    httpServer.on('upgrade', (request, socket, head) => {
      let url;
      try {
        url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== WS_PATH) return;
      if (!isAllowedOrigin(request)) {
        socket.destroy();
        return;
      }

      try {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } catch {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (client.isAlive === false) {
          try { client.ws.terminate(); } catch {}
          continue;
        }
        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          try { client.ws.terminate(); } catch {}
        }
      }
    }, 30_000);
    this.heartbeat.unref?.();
    return this;
  }

  handleConnection(ws) {
    const client = {
      ws,
      mssv: null,
      authenticated: false,
      authenticating: false,
      detached: false,
      generation: 0,
      rooms: new Set(),
      requestedRooms: new Set(),
      isAlive: true,
      authTimer: setTimeout(() => {
        // A process restart makes restored sessions re-verify against BDU.
        // Never sever a socket merely because that verification is still in
        // flight; BDU can be slower than an arbitrary local timeout.
        if (!client.detached && !client.authenticated && !client.authenticating) {
          try { ws.close(1008, 'Thiếu xác thực socket'); } catch {}
        }
      }, authTimeoutMs())
    };
    this.clients.add(client);
    ws.on('pong', () => { client.isAlive = true; });
    ws.on('message', (raw) => this.handleMessage(client, raw).catch((error) => this.handleMessageError(client, error)));
    ws.on('close', () => this.removeClient(client));
    ws.on('error', () => this.removeClient(client));
    jsonSend(ws, { type: 'hello', protocol: 1, requiresAuthMessage: true });
  }

  isClientAttached(client) {
    return Boolean(client && !client.detached && this.clients.has(client) && client.ws.readyState === WS_OPEN);
  }

  handleMessageError(client, error) {
    if (!this.isClientAttached(client)) return;
    const isInvalidAuth = error?.status === 401 || error?.code === 'AUTH_INVALID';
    const isUnavailable = error?.retryable || error?.status >= 500 || error?.code === 'AUTH_UNAVAILABLE';
    jsonSend(client.ws, {
      type: 'error',
      code: isInvalidAuth ? 'AUTH_INVALID' : (isUnavailable ? 'AUTH_UNAVAILABLE' : 'INTERNAL_ERROR'),
      message: error?.message || 'Lỗi xử lý socket.'
    });
    if (isInvalidAuth) {
      try { client.ws.close(1008, 'Phiên không hợp lệ'); } catch {}
    } else if (isUnavailable) {
      // 1013 explicitly tells browsers/proxies that reconnecting later is OK.
      try { client.ws.close(1013, 'Xác thực tạm thời không khả dụng'); } catch {}
    }
  }

  async handleMessage(client, raw) {
    if (!this.isClientAttached(client)) return;
    if (raw.length > MAX_PAYLOAD) {
      try { client.ws.close(1009, 'Payload quá lớn'); } catch {}
      return;
    }
    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      jsonSend(client.ws, { type: 'error', code: 'INVALID_JSON', message: 'Message không hợp lệ.' });
      return;
    }

    if (message.type === 'auth') {
      if (client.authenticated || client.authenticating) return;
      const token = String(message.token || '').trim();
      if (!token) {
        const error = new Error('Thiếu mã xác thực socket.');
        error.status = 401;
        throw error;
      }
      const generation = client.generation;
      client.authenticating = true;
      try {
        const mssv = normalizeMssv(await BduIdentityService.resolveVerifiedMssv(`Bearer ${token}`));
        // The socket may have closed while the external BDU lookup was in
        // flight. Do not resurrect it or leave a stale room subscriber.
        if (!this.isClientAttached(client) || client.generation !== generation) return;
        client.mssv = mssv;
        client.authenticated = true;
        clearTimeout(client.authTimer);
        this.join(client, 'forum');
        if (!this.isClientAttached(client) || client.generation !== generation) return;
        jsonSend(client.ws, { type: 'auth.ok', mssv: client.mssv, rooms: [...client.rooms] });
      } finally {
        if (client.generation === generation) client.authenticating = false;
      }
      return;
    }

    if (!client.authenticated) {
      jsonSend(client.ws, { type: 'error', code: 'AUTH_REQUIRED', message: 'Cần xác thực socket trước.' });
      return;
    }
    if (message.type === 'game.move' || message.type === 'game_move') {
      const roomRef = String(message.roomCode || message.room_code || message.room || '').replace(/^game(?::|-room:)/i, '').trim();
      const result = await EntertainmentGameService.makeMove(roomRef, client.mssv, message.move || message.payload, {
        clientMoveId: message.clientMoveId || message.client_move_id
      });
      if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'game.move.accepted', data: result });
      this.publishGameMove(result);
      return;
    }
    if (message.type === 'game.join' || message.type === 'game_join') {
      const roomRef = String(message.roomCode || message.room_code || message.room || '').replace(/^game(?::|-room:)/i, '').trim();
      const result = await EntertainmentGameService.joinRoom(roomRef, client.mssv, { inviteCode: message.inviteCode || message.invite_code || message.code });
      if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'game.join.accepted', data: result });
      this.publishGameRoomUpdated(result);
      return;
    }
    if (message.type === 'game.leave' || message.type === 'game_leave') {
      const roomRef = String(message.roomCode || message.room_code || message.room || '').replace(/^game(?::|-room:)/i, '').trim();
      const result = await EntertainmentGameService.leaveRoom(roomRef, client.mssv);
      if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'game.leave.accepted', data: result });
      if (result.deleted) {
        this.publishGameRoomClosed(result.room_code, {
          reason: 'player_left',
          actor: client.mssv,
          message: 'Một trong hai đối thủ đã rời phòng. Phòng đã tự động đóng.'
        });
      }
      return;
    }
    if (message.type === 'game.rematch' || message.type === 'game_rematch') {
      const roomRef = String(message.roomCode || message.room_code || message.room || '').replace(/^game(?::|-room:)/i, '').trim();
      const result = await EntertainmentGameService.requestRematch(roomRef, client.mssv);
      if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'game.rematch.accepted', data: result });
      if (result.ready) {
        this.publishGameRematchStarted(result.room_code, result);
      } else {
        this.publishGameRematchRequested(result.room_code, result);
      }
      return;
    }
    if (message.type === 'subscribe') {
      const room = String(message.room || '').trim();
      if (!room) {
        jsonSend(client.ws, { type: 'error', code: 'ROOM_INVALID', message: 'Room không hợp lệ.' });
        return;
      }
      client.requestedRooms.add(room);
      if (await this.canJoin(client, room)) {
        // `unsubscribe` may arrive while canJoin is waiting on PostgreSQL.
        // Honor the newest client intent rather than adding a ghost room.
        if (!this.isClientAttached(client) || !client.requestedRooms.has(room)) return;
        this.join(client, room);
        if (this.isClientAttached(client)) {
          jsonSend(client.ws, { type: 'subscribed', room });
          if (this.isGameRoom(room)) {
            try {
              const snapshot = await EntertainmentGameService.getRoom(this.gameRoomRef(room), { mssv: client.mssv });
              if (this.isClientAttached(client) && client.requestedRooms.has(room)) jsonSend(client.ws, { type: 'game.snapshot', data: snapshot });
            } catch (error) {
              if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'error', code: error.code || 'GAME_SNAPSHOT_FAILED', message: error.message });
            }
          }
        }
      } else {
        if (this.isClientAttached(client)) jsonSend(client.ws, { type: 'error', code: 'ROOM_FORBIDDEN', room, message: 'Không có quyền theo dõi room này.' });
      }
      return;
    }
    if (message.type === 'unsubscribe') {
      const room = String(message.room || '').trim();
      client.requestedRooms.delete(room);
      this.leave(client, room);
      return;
    }
    if (message.type === 'ping') jsonSend(client.ws, { type: 'pong', at: new Date().toISOString() });
  }

  async canJoin(client, room) {
    if (room === 'forum') return true;
    if (this.isGameRoom(room)) {
      const roomRef = this.gameRoomRef(room);
      const result = await query(`
        SELECT r.visibility, r.allow_spectators, p.mssv
        FROM game_rooms r
        LEFT JOIN game_room_players p ON p.room_id = r.id AND p.mssv = $2 AND p.left_at IS NULL
        WHERE (r.room_code = $1 OR r.id::text = $1) AND r.status IN ('waiting', 'active')
        LIMIT 1
      `, [roomRef, client.mssv]);
      if (!result.rowCount) return false;
      return Boolean(result.rows[0].mssv) || (result.rows[0].visibility === 'public' && result.rows[0].allow_spectators !== false);
    }
    const communityPostMatch = room.match(/^community-post:(\d+)$/);
    if (communityPostMatch) {
      const result = await query(`
        SELECT scope, scope_id
        FROM community_posts
        WHERE id = $1 AND deleted_at IS NULL
      `,
        [communityPostMatch[1]]
      );
      if (!result.rowCount) return false;
      const post = result.rows[0];
      if (post.scope !== 'clan') return true;
      return this.isClanMember(client.mssv, post.scope_id);
    }
    const coursePostMatch = room.match(/^course-post:(\d+)$/);
    if (coursePostMatch) {
      const result = await query(`
        SELECT courses.normalized_code AS course_code
        FROM course_posts
        JOIN courses ON courses.id = course_posts.course_id
        WHERE course_posts.id = $1
        LIMIT 1
      `, [coursePostMatch[1]]);
      return result.rowCount > 0 && this.isCourseMember(client.mssv, result.rows[0].course_code);
    }
    const clanMatch = room.match(/^clan:(\d+)$/);
    if (clanMatch) return this.isClanMember(client.mssv, clanMatch[1]);
    const courseMatch = room.match(/^course:(.+)$/);
    if (courseMatch) return this.isCourseMember(client.mssv, courseMatch[1]);
    return false;
  }

  async isClanMember(mssv, clanId) {
    if (!mssv) return false;
    const result = await query(
      'SELECT 1 FROM student_clans WHERE mssv = $1 AND clan_id = $2 LIMIT 1',
      [mssv, clanId]
    );
    return result.rowCount > 0;
  }

  async isCourseMember(mssv, courseCode) {
    if (!mssv) return false;
    const normalizedCode = normalizeCourseCode(courseCode);
    if (!normalizedCode) return false;
    const result = await query(`
      SELECT 1
      FROM courses c
      JOIN student_courses sc ON sc.course_id = c.id
      JOIN students s ON s.mssv = sc.mssv
      WHERE sc.mssv = $1
        AND c.normalized_code = $2
        AND s.course_synced_at IS NOT NULL
        AND sc.last_seen_at = s.course_synced_at
      LIMIT 1;
    `, [mssv, normalizedCode]);
    return result.rowCount > 0;
  }

  join(client, room) {
    if (!room || !this.isClientAttached(client)) return false;
    if (client.rooms.has(room)) return true;
    client.rooms.add(room);
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(client);
    if (this.isGameRoom(room)) {
      this.publishGameSpectatorCount(this.gameRoomRef(room));
    }
    return true;
  }

  leave(client, room) {
    if (!room || !client.rooms.has(room)) return;
    client.rooms.delete(room);
    const members = this.rooms.get(room);
    members?.delete(client);
    if (members && members.size === 0) this.rooms.delete(room);
    if (this.isGameRoom(room)) {
      this.publishGameSpectatorCount(this.gameRoomRef(room));
      if (client.mssv) {
        const roomRef = this.gameRoomRef(room);
        const mssv = client.mssv;
        setTimeout(async () => {
          try {
            const currentRoomClients = this.rooms.get(room);
            const stillConnected = currentRoomClients && [...currentRoomClients].some((c) => c.mssv === mssv);
            if (!stillConnected) {
              const res = await query(
                `SELECT r.id, r.room_code FROM game_rooms r JOIN game_room_players p ON p.room_id = r.id WHERE (r.room_code = $1 OR r.id::text = $1) AND p.mssv = $2 AND p.left_at IS NULL`,
                [roomRef, mssv]
              );
              if (res.rowCount > 0) {
                await query(`DELETE FROM game_rooms WHERE id = $1`, [res.rows[0].id]);
                EntertainmentGameService.clearRematchTimer?.(res.rows[0].room_code);
                this.publishGameRoomClosed(res.rows[0].room_code, {
                  reason: 'player_left',
                  actor: mssv,
                  message: 'Một trong hai đối thủ đã rời phòng. Phòng đã tự động đóng.'
                });
              }
            }
          } catch {}
        }, 4000);
      }
    }
  }

  removeClient(client) {
    if (!client || client.detached) return;
    client.detached = true;
    client.generation += 1;
    clearTimeout(client.authTimer);
    for (const room of [...client.rooms]) this.leave(client, room);
    client.requestedRooms.clear();
    this.clients.delete(client);
  }

  emitToRooms(rooms, type, data) {
    const envelope = {
      type,
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      data
    };
    const recipients = new Set();
    rooms.filter(Boolean).forEach((room) => {
      for (const client of this.rooms.get(room) || []) recipients.add(client);
    });
    recipients.forEach((client) => jsonSend(client.ws, envelope));
  }

  publishPostCreated(post) {
    const rooms = [scopeRoom(post.scope, post.scope_id)];
    this.emitToRooms(rooms, 'community.post.created', {
      postId: String(post.id), scope: post.scope, scopeId: post.scope_id || null,
      courseCode: post.scope === 'course' ? normalizeCourseCode(post.scope_id) : null,
      category: post.category || 'discussion'
    });
  }

  publishPostDeleted(post) {
    const rooms = [scopeRoom(post.scope, post.scope_id)];
    this.emitToRooms(rooms, 'community.post.deleted', {
      postId: String(post.id), scope: post.scope, scopeId: post.scope_id || null,
      courseCode: post.scope === 'course' ? normalizeCourseCode(post.scope_id) : null
    });
  }

  publishCommentChanged({ type, postId, commentId, parentId = null, commentCount = null, scope = 'school', scopeId = null }) {
    const rooms = [communityPostRoom(postId)];
    rooms.push(scopeRoom(scope, scopeId));
    this.emitToRooms(rooms, `community.comment.${type}`, {
      postId: String(postId), commentId: commentId ? String(commentId) : null,
      parentId: parentId ? String(parentId) : null,
      commentCount: commentCount === null ? null : Number(commentCount),
      scope,
      scopeId: scopeId || null,
      courseCode: scope === 'course' ? normalizeCourseCode(scopeId) : null
    });
  }

  publishPostLikeChanged({ postId, likeCount, scope = 'school', scopeId = null }) {
    this.emitToRooms([communityPostRoom(postId), scopeRoom(scope, scopeId)], 'community.reaction.updated', {
      postId: String(postId), likeCount: Number(likeCount || 0), scope, scopeId: scopeId || null,
      courseCode: scope === 'course' ? normalizeCourseCode(scopeId) : null
    });
  }

  publishCoursePostCreated({ postId, courseCode, category = 'discussion' }) {
    const normalizedCode = normalizeCourseCode(courseCode);
    this.emitToRooms([courseRoom(normalizedCode)], 'community.post.created', {
      postId: String(postId), scope: 'course', scopeId: normalizedCode,
      courseCode: normalizedCode, category
    });
  }

  publishCoursePostDeleted({ postId, courseCode }) {
    const normalizedCode = normalizeCourseCode(courseCode);
    this.emitToRooms([courseRoom(normalizedCode)], 'community.post.deleted', {
      postId: String(postId), scope: 'course', scopeId: normalizedCode, courseCode: normalizedCode
    });
  }

  publishCoursePostLikeChanged({ postId, courseCode, likeCount }) {
    const normalizedCode = normalizeCourseCode(courseCode);
    this.emitToRooms([coursePostRoom(postId), courseRoom(normalizedCode)], 'community.reaction.updated', {
      postId: String(postId), likeCount: Number(likeCount || 0), scope: 'course',
      scopeId: normalizedCode, courseCode: normalizedCode
    });
  }

  publishCourseCommentChanged({ type, postId, commentId, parentId = null, commentCount = null, courseCode }) {
    const normalizedCode = normalizeCourseCode(courseCode);
    this.emitToRooms([coursePostRoom(postId), courseRoom(normalizedCode)], `community.comment.${type}`, {
      postId: String(postId), commentId: commentId ? String(commentId) : null,
      parentId: parentId ? String(parentId) : null,
      commentCount: commentCount === null ? null : Number(commentCount),
      scope: 'course', scopeId: normalizedCode, courseCode: normalizedCode
    });
  }

  isGameRoom(room) {
    return /^game(?::|-room:)[A-Za-z0-9_-]+$/i.test(String(room || '').trim());
  }

  gameRoomRef(room) {
    return String(room || '').trim().replace(/^game(?::|-room:)/i, '');
  }

  publishGameRoomUpdated(room) {
    if (!room?.room_code) return;
    this.emitToRooms([gameRoom(room.room_code)], 'game.room.updated', {
      room_code: room.room_code,
      id: room.id ? String(room.id) : null,
      status: room.status || null,
      state_version: room.state_version === undefined ? null : Number(room.state_version),
      players: room.players || null
    });
  }

  publishGameMove(move) {
    if (!move?.room_code) return;
    this.emitToRooms([gameRoom(move.room_code)], 'game.move.applied', {
      room_code: move.room_code,
      move_number: Number(move.move_number),
      actor_mssv: move.actor_mssv || null,
      seat: move.seat === undefined ? null : Number(move.seat),
      move: move.move,
      state: move.state,
      state_version: Number(move.state_version || move.move_number),
      status: move.status,
      winner_seat: move.winner_seat === undefined ? null : move.winner_seat,
      result: move.result || null,
      idempotent: Boolean(move.idempotent)
    });
  }

  publishGameChallengeCreated(challenge) {
    if (!challenge?.room_code) return;
    this.emitToRooms([gameRoom(challenge.room_code)], 'game.challenge.created', {
      challenge_id: challenge.id,
      room_code: challenge.room_code,
      game_type: challenge.game_type,
      expires_at: challenge.expires_at,
      confession_post_id: challenge.confession_post_id || null
    });
  }

  publishGameExpiry({ type, data }) {
    if (type === 'room.expired' && data?.room_code) {
      this.emitToRooms([gameRoom(data.room_code)], 'game.room.expired', data);
    }
    if (type === 'challenge.expired' && data?.room_code) {
      this.emitToRooms([gameRoom(data.room_code)], 'game.challenge.expired', data);
    }
  }

  publishIdentityChanged(mssv, changes = {}) {
    const clean = normalizeMssv(mssv);
    for (const client of this.clients) {
      if (client.mssv === clean) {
        jsonSend(client.ws, {
          type: 'identity.entitlements.changed',
          eventId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          data: { mssv: clean }
        });
      }
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'avatarUrl')) {
      this.emitToRooms(['forum'], 'identity.presentation.changed', {
        mssv: clean,
        avatarUrl: changes.avatarUrl || null,
        avatarSource: changes.avatarSource || 'initials'
      });
    }
  }

  getSpectatorCount(roomCode, playerMssvs = []) {
    const r = gameRoom(roomCode);
    const clients = this.rooms.get(r);
    if (!clients) return 0;
    const playerSet = new Set((playerMssvs || []).map((m) => String(m).toUpperCase()));
    let count = 0;
    for (const client of clients) {
      if (client.mssv && !playerSet.has(String(client.mssv).toUpperCase())) {
        count += 1;
      }
    }
    return count;
  }

  async publishGameSpectatorCount(roomRef) {
    if (!roomRef) return;
    try {
      const res = await query(
        `SELECT p.mssv FROM game_room_players p JOIN game_rooms r ON r.id = p.room_id WHERE (r.room_code = $1 OR r.id::text = $1) AND p.left_at IS NULL`,
        [roomRef]
      );
      const playerMssvs = res.rows.map((r) => r.mssv);
      const count = this.getSpectatorCount(roomRef, playerMssvs);
      this.emitToRooms([gameRoom(roomRef)], 'game.spectators.updated', {
        room_code: roomRef,
        spectator_count: count
      });
    } catch {}
  }

  publishGameRoomClosed(roomCode, data = {}) {
    if (!roomCode) return;
    this.emitToRooms([gameRoom(roomCode)], 'game.room.closed', {
      room_code: roomCode,
      ...data
    });
  }

  publishGameRematchRequested(roomCode, data = {}) {
    if (!roomCode) return;
    this.emitToRooms([gameRoom(roomCode)], 'game.rematch.requested', {
      room_code: roomCode,
      ...data
    });
  }

  publishGameRematchStarted(roomCode, data = {}) {
    if (!roomCode) return;
    this.emitToRooms([gameRoom(roomCode)], 'game.rematch.started', {
      room_code: roomCode,
      ...data
    });
  }

  getStatus() {
    return {
      topology: 'single-process',
      attached: Boolean(this.wss),
      connected_clients: this.clients.size,
      active_rooms: this.rooms.size
    };
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of [...this.clients]) {
      this.removeClient(client);
      try { client.ws.close(1001, 'Server đang dừng'); } catch {}
    }
    this.wss?.close();
    this.wss = null;
  }
}

export const CommunityRealtime = new CommunityRealtimeGateway();
EntertainmentGameService.getSpectatorCount = (roomCode, players) => CommunityRealtime.getSpectatorCount(roomCode, players);
EntertainmentGameService.onRoomClosed = (roomCode, data) => CommunityRealtime.publishGameRoomClosed(roomCode, data);
export const CommunityRealtimeInternals = {
  WS_PATH, communityPostRoom, coursePostRoom, clanRoom, courseRoom, gameRoom, scopeRoom,
  isAllowedOrigin, trustsProxyHeaders, authTimeoutMs, maxBufferedBytes
};
