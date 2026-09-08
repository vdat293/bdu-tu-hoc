import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityRealtime, reconnectDelay } from '../../client/src/services/community-realtime.js';
import {
  invalidateActiveQueriesAfterRealtimeRecovery,
  isRealtimeRecoveryQuery,
  shouldRefetchAfterRealtimeRecovery
} from '../../client/src/app/providers.jsx';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = new Map();
    this.send = vi.fn();
    this.close = vi.fn(() => { this.readyState = MockWebSocket.CLOSED; });
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), handler]);
  }

  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
}

function sent(socket) {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockWebSocket.instances = [];
});

describe('community realtime recovery', () => {
  it('only resets backoff after auth.ok and emits recovery after subscription ACKs', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const received = [];
    const realtime = new CommunityRealtime({ token: 'token', onEvent: (event) => received.push(event) });
    realtime.attempt = 3;
    realtime.subscribe('forum');
    realtime.subscribe('forum');
    realtime.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('open');
    expect(realtime.attempt).toBe(3);
    expect(sent(socket)).toEqual([{ type: 'auth', token: 'token' }]);

    socket.emit('message', { data: JSON.stringify({ type: 'auth.ok' }) });
    expect(realtime.attempt).toBe(0);
    expect(sent(socket)).toContainEqual({ type: 'subscribe', room: 'forum' });
    expect(received).not.toContainEqual(expect.objectContaining({ type: 'realtime.recovered' }));

    socket.emit('message', { data: JSON.stringify({ type: 'subscribed', room: 'forum' }) });
    expect(received).toContainEqual(expect.objectContaining({ type: 'realtime.recovered', data: { reconnected: false } }));

    realtime.unsubscribe('forum');
    expect(sent(socket).filter((message) => message.type === 'unsubscribe')).toHaveLength(0);
    realtime.unsubscribe('forum');
    expect(sent(socket)).toContainEqual({ type: 'unsubscribe', room: 'forum' });
  });

  it('signals a confirmed invalid session exactly once without browser-initiated close', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const expired = vi.fn();
    window.addEventListener('bdu:session_expired', expired);
    const realtime = new CommunityRealtime({ token: 'token' });
    realtime.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ type: 'error', code: 'AUTH_INVALID', message: 'expired' }) });
    socket.emit('message', { data: JSON.stringify({ type: 'error', code: 'AUTH_INVALID', message: 'expired again' }) });

    expect(expired).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();
    expect(realtime.authInvalid).toBe(true);
    window.removeEventListener('bdu:session_expired', expired);
  });

  it('settles recovery when a desired room is forbidden instead of waiting forever', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const received = [];
    const realtime = new CommunityRealtime({ token: 'token', onEvent: (event) => received.push(event) });
    realtime.subscribe('clan:9');
    realtime.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ type: 'auth.ok' }) });
    expect(received).not.toContainEqual(expect.objectContaining({ type: 'realtime.recovered' }));
    socket.emit('message', { data: JSON.stringify({ type: 'error', code: 'ROOM_FORBIDDEN', room: 'clan:9' }) });
    expect(received).toContainEqual(expect.objectContaining({ type: 'realtime.recovered' }));
  });

  it('uses a jittered retry with a non-hot floor when the proxy drops a socket', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const realtime = new CommunityRealtime({ token: 'token' });
    realtime.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('close');

    expect(realtime.attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(reconnectDelay(1, () => 0)).toBeGreaterThanOrEqual(250);
    expect(reconnectDelay(1, () => 0.5)).toBeGreaterThan(250);
    expect(reconnectDelay(1, () => 0.999)).toBeLessThanOrEqual(1000);
    expect(reconnectDelay(6, () => 0.5)).toBeGreaterThan(250);
    expect(reconnectDelay(6, () => 0.5)).toBeLessThanOrEqual(30_000);
  });

  it('invalidates and refetches only active realtime query families after a reconnection', async () => {
    const client = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateActiveQueriesAfterRealtimeRecovery(client);
    expect(client.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ type: 'active', refetchType: 'active', predicate: expect.any(Function) }));
    expect(isRealtimeRecoveryQuery({ queryKey: ['confession', '24050001'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['course-posts', '24050001', 'INF101'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['identity-presentation', '24050001'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['grades', '24050001'] })).toBe(false);
    expect(isRealtimeRecoveryQuery({ queryKey: ['profile', '24050001'] })).toBe(false);
    expect(isRealtimeRecoveryQuery({ queryKey: ['academic-ranking', '24050001'] })).toBe(false);
    expect(shouldRefetchAfterRealtimeRecovery({ type: 'realtime.recovered', data: { reconnected: false } })).toBe(false);
    expect(shouldRefetchAfterRealtimeRecovery({ type: 'realtime.recovered', data: { reconnected: true } })).toBe(true);
  });
});
