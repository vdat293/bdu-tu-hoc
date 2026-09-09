const MAX_RECONNECT_DELAY_MS = 30_000;
const MIN_RECONNECT_DELAY_MS = 250;

export function reconnectDelay(attempt, random = Math.random) {
  const ceiling = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** Math.max(0, attempt - 1)));
  // Full jitter prevents every browser from reconnecting together after an
  // Nginx/app restart. Keep a tiny floor so a failed TCP handshake cannot turn
  // into a hot reconnect loop.
  if (ceiling <= MIN_RECONNECT_DELAY_MS) return ceiling;
  return Math.min(ceiling, Math.floor(MIN_RECONNECT_DELAY_MS + (random() * (ceiling - MIN_RECONNECT_DELAY_MS + 1))));
}

function closeSocket(socket) {
  try {
    socket?.close();
    return true;
  } catch {
    return false;
  }
}

export class CommunityRealtime {
  constructor({ token, onEvent, onStatusChange } = {}) {
    this.token = token;
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
    this.socket = null;
    this.timer = null;
    this.attempt = 0;
    this.closed = false;
    this.authenticated = false;
    this.authInvalid = false;
    this.sessionExpiredDispatched = false;
    this.hasAuthenticated = false;
    this.desiredRooms = new Map();
    this.subscribedRooms = new Set();
    this.pendingSubscriptionRooms = new Set();
    this.recoveryPending = null;
    this.seen = new Set();
    this.status = 'connecting';
  }

  connect() {
    if (this.closed || this.authInvalid || !this.token || typeof WebSocket === 'undefined') return;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    window.clearTimeout(this.timer);
    this.timer = null;
    this.setStatus(this.hasAuthenticated ? 'reconnecting' : 'connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try {
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
    } catch {
      this.setStatus('unavailable');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket || this.closed || this.authInvalid) return;
      this.authenticated = false;
      this.subscribedRooms.clear();
      this.pendingSubscriptionRooms.clear();
      if (!this.send({ type: 'auth', token: this.token }, socket)) {
        closeSocket(socket);
      }
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || this.closed) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }

      if (message.type === 'auth.ok') {
        const reconnected = this.hasAuthenticated;
        this.authenticated = true;
        this.hasAuthenticated = true;
        // A TCP open is not a healthy connection. Only a successful auth
        // resets the retry budget after a VPS restart or proxy failure.
        this.attempt = 0;
        this.recoveryPending = { reconnected };
        this.flushRooms();
        this.emitRecoveryWhenRoomsSettled();
      } else if (message.type === 'subscribed') {
        const room = String(message.room || '');
        this.pendingSubscriptionRooms.delete(room);
        if (this.desiredRooms.has(room)) this.subscribedRooms.add(room);
        else this.send({ type: 'unsubscribe', room });
        this.emitRecoveryWhenRoomsSettled();
      } else if (message.type === 'error' && message.code === 'ROOM_FORBIDDEN') {
        this.pendingSubscriptionRooms.delete(String(message.room || ''));
        this.emitRecoveryWhenRoomsSettled();
      } else if (message.type === 'error' && message.code === 'AUTH_UNAVAILABLE') {
        this.setStatus('unavailable');
      } else if (message.type === 'error' && message.code === 'AUTH_INVALID') {
        this.markAuthInvalid(message.message);
      }

      if (message.eventId) {
        if (this.seen.has(message.eventId)) return;
        this.seen.add(message.eventId);
        if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
      }
      this.onEvent?.(message);
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.authenticated = false;
      this.subscribedRooms.clear();
      this.pendingSubscriptionRooms.clear();
      this.recoveryPending = null;
      if (this.closed || this.authInvalid) return;
      if (this.status !== 'unavailable') this.setStatus('reconnecting');
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // The close event owns retry scheduling. Browsers emit both for many
      // proxy/TLS failures, so retrying here would create duplicate sockets.
    });
  }

  markAuthInvalid(message) {
    if (this.authInvalid) return;
    this.authenticated = false;
    this.authInvalid = true;
    this.setStatus('auth-invalid');
    window.clearTimeout(this.timer);
    this.timer = null;
    // Let the server close its invalid-auth connection. Calling close(1008)
    // from the browser can itself fail and used to hide the logout signal.
    if (!this.sessionExpiredDispatched && typeof window !== 'undefined') {
      this.sessionExpiredDispatched = true;
      window.dispatchEvent(new CustomEvent('bdu:session_expired', {
        detail: { message: message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
      }));
    }
  }

  scheduleReconnect() {
    if (this.closed || this.authInvalid || this.timer) return;
    this.attempt += 1;
    const delay = reconnectDelay(this.attempt);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  send(payload, socket = this.socket) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  subscribe(room) {
    const cleanRoom = String(room || '').trim();
    if (!cleanRoom) return;
    const current = this.desiredRooms.get(cleanRoom) || 0;
    this.desiredRooms.set(cleanRoom, current + 1);
    if (current === 0 && this.authenticated && !this.subscribedRooms.has(cleanRoom)) {
      this.sendSubscribe(cleanRoom);
    }
  }

  unsubscribe(room) {
    const cleanRoom = String(room || '').trim();
    if (!cleanRoom) return;
    const current = this.desiredRooms.get(cleanRoom) || 0;
    if (current <= 1) {
      this.desiredRooms.delete(cleanRoom);
      this.subscribedRooms.delete(cleanRoom);
      this.pendingSubscriptionRooms.delete(cleanRoom);
      if (current > 0 && this.authenticated) this.send({ type: 'unsubscribe', room: cleanRoom });
      this.emitRecoveryWhenRoomsSettled();
      return;
    }
    this.desiredRooms.set(cleanRoom, current - 1);
  }

  flushRooms() {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return;
    for (const room of this.desiredRooms.keys()) {
      if (!this.subscribedRooms.has(room) && !this.pendingSubscriptionRooms.has(room)) this.sendSubscribe(room);
    }
  }

  sendSubscribe(room) {
    this.pendingSubscriptionRooms.add(room);
    if (!this.send({ type: 'subscribe', room })) closeSocket(this.socket);
  }

  emitRecoveryWhenRoomsSettled() {
    if (!this.recoveryPending || this.pendingSubscriptionRooms.size > 0) return;
    const data = this.recoveryPending;
    this.recoveryPending = null;
    this.setStatus('ready');
    this.onEvent?.({
      type: 'realtime.recovered',
      data,
      occurredAt: new Date().toISOString()
    });
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }

  close() {
    this.closed = true;
    this.authenticated = false;
    window.clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    closeSocket(socket);
    this.subscribedRooms.clear();
    this.pendingSubscriptionRooms.clear();
    this.recoveryPending = null;
    this.seen.clear();
  }
}
