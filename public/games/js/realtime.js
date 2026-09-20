import { getSession } from './session.js';

// Client WebSocket cho một phòng game: xác thực, subscribe, tự kết nối lại với
// backoff và chuyển tiếp mọi sự kiện của phòng cho view.
export class RoomRealtime {
  constructor({ roomCode, onEvent = () => {}, onStatus = () => {} }) {
    this.roomCode = String(roomCode || '').toUpperCase();
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.socket = null;
    this.closedByUser = false;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.status = 'idle';
  }

  setStatus(status) {
    this.status = status;
    this.onStatus(status);
  }

  connect() {
    this.closedByUser = false;
    const session = getSession();
    if (!session?.token || !this.roomCode) return;
    this.disconnect(false);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
    this.socket = socket;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    socket.addEventListener('open', () => {
      this.sendRaw({ type: 'auth', token: session.token });
    });

    socket.addEventListener('message', (event) => {
      let message = null;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'auth.ok') {
        this.attempt = 0;
        this.setStatus('ready');
        this.sendRaw({ type: 'subscribe', room: `game:${this.roomCode}` });
        this.startPing();
        return;
      }
      if (message.type === 'error' && (message.code === 'AUTH_INVALID' || message.code === 'AUTH_REQUIRED')) {
        this.setStatus('auth-error');
      }
      this.onEvent(message);
    });

    socket.addEventListener('close', () => {
      this.stopPing();
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.setStatus('reconnecting');
      const delay = Math.min(20000, 700 * (2 ** Math.min(5, this.attempt)));
      this.attempt += 1;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    });

    socket.addEventListener('error', () => {
      try { socket.close(); } catch {}
    });
  }

  startPing() {
    this.stopPing();
    // Ping 25s/lần giữ kết nối sống qua proxy/CDN hay đóng idle socket.
    this.pingTimer = window.setInterval(() => this.sendRaw({ type: 'ping' }), 25000);
  }

  stopPing() {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendRaw(payload) {
    if (this.socket?.readyState === 1) {
      try { this.socket.send(JSON.stringify(payload)); return true; } catch { return false; }
    }
    return false;
  }

  sendMove(move, clientMoveId) {
    return this.sendRaw({
      type: 'game.move',
      roomCode: this.roomCode,
      move,
      clientMoveId
    });
  }

  sendChat(kind, text) {
    return this.sendRaw({
      type: 'game.chat',
      roomCode: this.roomCode,
      kind,
      text
    });
  }

  sendRematch() {
    return this.sendRaw({ type: 'game.rematch', roomCode: this.roomCode });
  }

  disconnect(markClosed = true) {
    window.clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (markClosed) this.closedByUser = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.close(); } catch {}
    }
  }
}
