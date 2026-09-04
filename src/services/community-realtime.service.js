import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { query } from '../db/database.js';
import { BduIdentityService } from './bdu-identity.service.js';

const WS_PATH = '/ws/community';
const MAX_PAYLOAD = 16 * 1024;

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
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== url.host) {
            socket.destroy();
            return;
          }
        } catch {
          socket.destroy();
          return;
        }
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
      if (token) {
        client.mssv = normalizeMssv(await BduIdentityService.resolveVerifiedMssv(`Bearer ${token}`));
      }
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
      const result = await query(
        'SELECT scope, scope_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
        [postMatch[1]]
      );
      if (!result.rowCount) return false;
      const post = result.rows[0];
      if (post.scope !== 'clan') return true;
      return this.isClanMember(client.mssv, post.scope_id);
    }
    const clanMatch = room.match(/^clan:(\d+)$/);
    if (clanMatch) return this.isClanMember(client.mssv, clanMatch[1]);
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
    const rooms = post.scope === 'clan' ? [clanRoom(post.scope_id)] : ['forum'];
    this.emitToRooms(rooms, 'community.post.created', {
      postId: String(post.id), scope: post.scope, scopeId: post.scope_id || null,
      category: post.category || 'discussion'
    });
  }

  publishPostDeleted(post) {
    const rooms = post.scope === 'clan' ? [clanRoom(post.scope_id)] : ['forum'];
    this.emitToRooms(rooms, 'community.post.deleted', {
      postId: String(post.id), scope: post.scope, scopeId: post.scope_id || null
    });
  }

  publishCommentChanged({ type, postId, commentId, parentId = null, commentCount = null, scope = 'school', scopeId = null }) {
    const rooms = [postRoom(postId)];
    rooms.push(scope === 'clan' ? clanRoom(scopeId) : 'forum');
    this.emitToRooms(rooms, `community.comment.${type}`, {
      postId: String(postId), commentId: commentId ? String(commentId) : null,
      parentId: parentId ? String(parentId) : null,
      commentCount: commentCount === null ? null : Number(commentCount)
    });
  }

  publishPostLikeChanged({ postId, likeCount }) {
    this.emitToRooms([postRoom(postId)], 'community.reaction.updated', {
      postId: String(postId), likeCount: Number(likeCount || 0)
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
export const CommunityRealtimeInternals = { WS_PATH, postRoom, clanRoom };
