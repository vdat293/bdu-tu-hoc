export class CommunityRealtime {
  constructor({ token, onEvent } = {}) {
    this.token = token;
    this.onEvent = onEvent;
    this.socket = null;
    this.timer = null;
    this.attempt = 0;
    this.closed = false;
    this.authenticated = false;
    this.authInvalid = false;
    this.desiredRooms = new Set();
    this.seen = new Set();
  }

  connect() {
    if (this.closed || this.authInvalid || !this.token || typeof WebSocket === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket || this.closed) return;
      this.attempt = 0;
      this.authenticated = false;
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || this.closed) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'auth.ok') {
        this.authenticated = true;
        this.flushRooms();
      } else if (message.type === 'error' && message.code === 'AUTH_INVALID') {
        this.authenticated = false;
        this.authInvalid = true;
        window.clearTimeout(this.timer);
        this.timer = null;
        socket.close(1008, 'Phiên không hợp lệ');
      }
      if (message.eventId) {
        if (this.seen.has(message.eventId)) return;
        this.seen.add(message.eventId);
        if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
      }
      this.onEvent?.(message);
    });
    socket.addEventListener('close', () => {
      if (this.closed || socket !== this.socket) return;
      this.authenticated = false;
      if (this.authInvalid) return;
      this.attempt = Math.min(6, this.attempt + 1);
      this.timer = window.setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.attempt));
    });
  }

  subscribe(room) {
    const cleanRoom = String(room || '').trim();
    if (!cleanRoom) return;
    this.desiredRooms.add(cleanRoom);
    if (this.authenticated && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'subscribe', room: cleanRoom }));
    }
  }

  unsubscribe(room) {
    const cleanRoom = String(room || '').trim();
    if (!cleanRoom) return;
    this.desiredRooms.delete(cleanRoom);
    if (this.authenticated && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'unsubscribe', room: cleanRoom }));
    }
  }

  flushRooms() {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return;
    for (const room of this.desiredRooms) {
      this.socket.send(JSON.stringify({ type: 'subscribe', room }));
    }
  }

  close() {
    this.closed = true;
    this.authenticated = false;
    window.clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.seen.clear();
  }
}
