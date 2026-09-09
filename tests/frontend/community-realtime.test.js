import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { CommunityRealtime, reconnectDelay } from '../../client/src/services/community-realtime.js';
import {
  invalidateRealtimeQueriesAfterReady,
  isRealtimeRecoveryQuery,
  shouldRefetchAfterRealtimeRecovery,
  syncRealtimeCache
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

  it('exposes connecting, ready, reconnecting, unavailable, and auth-invalid gateway states', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const states = [];
    const realtime = new CommunityRealtime({ token: 'token', onStatusChange: (status) => states.push(status) });
    realtime.subscribe('forum');
    realtime.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ type: 'auth.ok' }) });
    socket.emit('message', { data: JSON.stringify({ type: 'subscribed', room: 'forum' }) });
    socket.emit('close');
    expect(states).toContain('ready');
    expect(states).toContain('reconnecting');

    realtime.setStatus('unavailable');
    realtime.markAuthInvalid('expired');
    expect(states).toContain('unavailable');
    expect(states).toContain('auth-invalid');
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

  it('resyncs scoped realtime query families after both initial and reconnect ready events', async () => {
    const client = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateRealtimeQueriesAfterReady(client);
    expect(client.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ refetchType: 'active', predicate: expect.any(Function) }));
    expect(isRealtimeRecoveryQuery({ queryKey: ['confession', '24050001'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['course-posts', '24050001', 'INF101'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['identity-presentation', '24050001'] })).toBe(true);
    expect(isRealtimeRecoveryQuery({ queryKey: ['grades', '24050001'] })).toBe(false);
    expect(isRealtimeRecoveryQuery({ queryKey: ['profile', '24050001'] })).toBe(false);
    expect(isRealtimeRecoveryQuery({ queryKey: ['academic-ranking', '24050001'] })).toBe(false);
    expect(shouldRefetchAfterRealtimeRecovery({ type: 'realtime.recovered', data: { reconnected: false } })).toBe(true);
    expect(shouldRefetchAfterRealtimeRecovery({ type: 'realtime.recovered', data: { reconnected: true } })).toBe(true);
  });

  it('treats a second-tab forum event as a scoped active refetch and an inactive cache invalidation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const forumFetch = vi.fn().mockResolvedValue({ posts: [{ id: 'fresh' }] });
    const activeObserver = new QueryObserver(client, {
      queryKey: ['confession', '24050001', 'all'],
      queryFn: forumFetch
    });
    const unsubscribe = activeObserver.subscribe(() => {});
    await activeObserver.refetch();
    forumFetch.mockClear();
    client.setQueryData(['post-comments', '42'], [{ id: 'old-comment' }]);

    await syncRealtimeCache(client, {
      type: 'community.comment.created',
      data: { scope: 'faculty', postId: '42' }
    });

    expect(forumFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(['post-comments', '42'])?.isInvalidated).toBe(true);
    unsubscribe();
    client.clear();
  });

  it('refetches an active initial forum snapshot once the authenticated room is ready', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const forumFetch = vi.fn().mockResolvedValue({ posts: [{ id: 'fresh-after-ready' }] });
    const observer = new QueryObserver(client, {
      queryKey: ['confession', '24050001', 'all'],
      queryFn: forumFetch
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    forumFetch.mockClear();

    await syncRealtimeCache(client, { type: 'realtime.recovered', data: { reconnected: false } });
    expect(forumFetch).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.clear();
  });

  it('marks inactive forum data stale at initial ready so a remount does not keep a five-minute snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const key = ['confession', '24050001', 'all'];
    client.setQueryData(key, { posts: [{ id: 'old' }] });

    await syncRealtimeCache(client, { type: 'realtime.recovered', data: { reconnected: false } });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);

    const forumFetch = vi.fn().mockResolvedValue({ posts: [{ id: 'fresh' }] });
    const observer = new QueryObserver(client, { queryKey: key, queryFn: forumFetch });
    const unsubscribe = observer.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forumFetch).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.clear();
  });
});
