import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { query } from '../db/database.js';
import { BduIdentityService } from './bdu-identity.service.js';
import { normalizeCourseCode } from './learning.service.js';

const WS_PATH = '/ws/community';
const MAX_PAYLOAD = 16 * 1024;

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
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function postRoom(postId) {
  return `post:${String(postId)}`;
}

function clanRoom(clanId) {
  return `clan:${String(clanId)}`;
}

function courseRoom(courseCode) {
  return `course:${normalizeCourseCode(courseCode)}`;
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

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (client.isAlive === false) {
          client.ws.terminate();
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
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
      rooms: new Set(),
      isAlive: true,
      authTimer: setTimeout(() => {
        if (!client.authenticated) ws.close(1008, 'Thiếu xác thực socket');
      }, 10_000)
    };
    this.clients.add(client);
    ws.on('pong', () => { client.isAlive = true; });
    ws.on('message', (raw) => this.handleMessage(client, raw).catch((error) => {
      jsonSend(ws, {
        type: 'error',
        code: error?.status === 401 ? 'AUTH_INVALID' : 'INTERNAL_ERROR',
        message: error.message
      });
      if (error?.status === 401) ws.close(1008, 'Phiên không hợp lệ');
    }));
    ws.on('close', () => this.removeClient(client));
    ws.on('error', () => this.removeClient(client));
    jsonSend(ws, { type: 'hello', protocol: 1, requiresAuthMessage: true });
  }

  async handleMessage(client, raw) {
    if (raw.length > MAX_PAYLOAD) {
      client.ws.close(1009, 'Payload quá lớn');
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
      if (client.authenticated) return;
      const token = String(message.token || '').trim();
      if (!token) {
        const error = new Error('Thiếu mã xác thực socket.');
        error.status = 401;
        throw error;
      }
      client.mssv = normalizeMssv(await BduIdentityService.resolveVerifiedMssv(`Bearer ${token}`));
      client.authenticated = true;
      clearTimeout(client.authTimer);
      await this.join(client, 'forum');
      jsonSend(client.ws, { type: 'auth.ok', mssv: client.mssv, rooms: [...client.rooms] });
      return;
    }

    if (!client.authenticated) {
      jsonSend(client.ws, { type: 'error', code: 'AUTH_REQUIRED', message: 'Cần xác thực socket trước.' });
      return;
    }
    if (message.type === 'subscribe') {
      const room = String(message.room || '').trim();
      if (await this.canJoin(client, room)) {
        await this.join(client, room);
        jsonSend(client.ws, { type: 'subscribed', room });
      } else {
        jsonSend(client.ws, { type: 'error', code: 'ROOM_FORBIDDEN', room, message: 'Không có quyền theo dõi room này.' });
      }
      return;
    }
    if (message.type === 'unsubscribe') {
      this.leave(client, String(message.room || '').trim());
      return;
    }
    if (message.type === 'ping') jsonSend(client.ws, { type: 'pong', at: new Date().toISOString() });
  }

  async canJoin(client, room) {
    if (room === 'forum') return true;
    const postMatch = room.match(/^post:(\d+)$/);
    if (postMatch) {
      const result = await query(`
        SELECT scope, scope_id
        FROM community_posts
        WHERE id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT 'course' AS scope, courses.normalized_code AS scope_id
        FROM course_posts
        JOIN courses ON courses.id = course_posts.course_id
        WHERE course_posts.id = $1
        LIMIT 1
      `,
        [postMatch[1]]
      );
      if (!result.rowCount) return false;
      const post = result.rows[0];
      if (post.scope === 'course') return this.isCourseMember(client.mssv, post.scope_id);
      if (post.scope !== 'clan') return true;
      return this.isClanMember(client.mssv, post.scope_id);
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

  async join(client, room) {
    if (!room || client.rooms.has(room)) return;
    client.rooms.add(room);
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(client);
  }

  leave(client, room) {
    if (!room || !client.rooms.has(room)) return;
    client.rooms.delete(room);
    const members = this.rooms.get(room);
    members?.delete(client);
    if (members && members.size === 0) this.rooms.delete(room);
  }

  removeClient(client) {
    if (!this.clients.has(client)) return;
    clearTimeout(client.authTimer);
    for (const room of [...client.rooms]) this.leave(client, room);
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
    const rooms = [postRoom(postId)];
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
    this.emitToRooms([postRoom(postId), scopeRoom(scope, scopeId)], 'community.reaction.updated', {
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
    this.emitToRooms([postRoom(postId), courseRoom(normalizedCode)], 'community.reaction.updated', {
      postId: String(postId), likeCount: Number(likeCount || 0), scope: 'course',
      scopeId: normalizedCode, courseCode: normalizedCode
    });
  }

  publishCourseCommentChanged({ type, postId, commentId, parentId = null, commentCount = null, courseCode }) {
    const normalizedCode = normalizeCourseCode(courseCode);
    this.emitToRooms([postRoom(postId), courseRoom(normalizedCode)], `community.comment.${type}`, {
      postId: String(postId), commentId: commentId ? String(commentId) : null,
      parentId: parentId ? String(parentId) : null,
      commentCount: commentCount === null ? null : Number(commentCount),
      scope: 'course', scopeId: normalizedCode, courseCode: normalizedCode
    });
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

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) client.ws.close(1001, 'Server đang dừng');
    this.clients.clear();
    this.rooms.clear();
    this.wss?.close();
    this.wss = null;
  }
}

export const CommunityRealtime = new CommunityRealtimeGateway();
export const CommunityRealtimeInternals = {
  WS_PATH, postRoom, clanRoom, courseRoom, scopeRoom, isAllowedOrigin, trustsProxyHeaders
};
