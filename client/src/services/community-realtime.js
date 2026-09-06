export class CommunityRealtime {
  constructor({ token, onEvent } = {}) {
    this.token = token;
    this.onEvent = onEvent;
    this.socket = null;
    this.timer = null;
    this.attempt = 0;
    this.closed = false;
    this.seen = new Set();
  }

  connect() {
    if (this.closed || !this.token || typeof WebSocket === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0;
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    });
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.eventId) {
        if (this.seen.has(message.eventId)) return;
        this.seen.add(message.eventId);
        if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
      }
      this.onEvent?.(message);
    });
    socket.addEventListener('close', () => {
      if (this.closed || socket !== this.socket) return;
      this.attempt = Math.min(6, this.attempt + 1);
      this.timer = window.setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.attempt));
    });
  }

  subscribe(room) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'subscribe', room }));
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.seen.clear();
  }
}
