import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { loginStudent } from '../api/academics.js';
import { clearStoredSession, persistSession, readStoredSession } from '../features/auth/session.js';
import { CommunityRealtime } from '../services/community-realtime.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => error?.status !== 401 && failureCount < 1
    },
    mutations: { retry: false }
  }
});

const AuthContext = createContext(null);
const ToastContext = createContext(null);
const RealtimeContext = createContext(null);

export function useAuth() { return useContext(AuthContext); }
export function useToasts() { return useContext(ToastContext); }
export function useRealtimeStatus() { return useContext(RealtimeContext)?.status || 'unavailable'; }

// WebSocket events are deliberately lossy across a deploy, a proxy reload, or
// a sleeping laptop. Once authentication succeeds again, stale active screens
// must fetch their source of truth instead of waiting for an event that may
// have happened while the connection was down.
const REALTIME_RECOVERY_QUERY_ROOTS = new Set([
  'clan', 'clan-post-comments', 'clans', 'confession', 'course-posts',
  'identity-presentation', 'post-comments'
]);

export function isRealtimeRecoveryQuery(query) {
  return Array.isArray(query?.queryKey) && REALTIME_RECOVERY_QUERY_ROOTS.has(query.queryKey[0]);
}

export function invalidateRealtimeQueriesAfterReady(client) {
  return client.invalidateQueries({
    refetchType: 'active',
    predicate: isRealtimeRecoveryQuery
  });
}

export function shouldRefetchAfterRealtimeRecovery(event) {
  return event?.type === 'realtime.recovered' && typeof event.data?.reconnected === 'boolean';
}

function invalidateQueryPrefix(client, queryKey) {
  return client.invalidateQueries({ queryKey, refetchType: 'active' });
}

function isPostCommentsQuery(query, postId) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'post-comments'
    && String(key[key.length - 1]) === String(postId);
}

function isClanPostsQuery(query, clanId) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'clan'
    && key[3] === 'posts'
    && String(key[2]) === String(clanId);
}

function isCoursePostsQuery(query, courseCode) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'course-posts'
    && String(key[2] || '').trim().toUpperCase() === String(courseCode || '').trim().toUpperCase();
}

// Keep mutation/recovery cache policy at the authenticated app boundary. A
// route may be unmounted while an event arrives; marking its cache stale here
// makes the next visit fetch immediately instead of trusting five-minute data.
export function syncRealtimeCache(client, event) {
  if (shouldRefetchAfterRealtimeRecovery(event)) return invalidateRealtimeQueriesAfterReady(client);

  const type = String(event?.type || '');
  const data = event?.data || {};
  const scope = String(data.scope || '').toLowerCase();
  const work = [];
  if (type.startsWith('community.')) {
    if (scope === 'school' || scope === 'faculty' || scope === 'institute' || !scope) {
      work.push(invalidateQueryPrefix(client, ['confession']));
    } else if (scope === 'course') {
      work.push(client.invalidateQueries({
        refetchType: 'active',
        predicate: (query) => isCoursePostsQuery(query, data.courseCode || data.scopeId)
      }));
    } else if (scope === 'clan') {
      work.push(client.invalidateQueries({
        refetchType: 'active',
        predicate: (query) => isClanPostsQuery(query, data.scopeId)
      }));
    }
    if (data.postId != null && type.startsWith('community.comment.')) {
      work.push(client.invalidateQueries({
        refetchType: 'active',
        predicate: (query) => isPostCommentsQuery(query, data.postId)
      }));
    }
    if (data.postId != null && scope === 'clan' && type.startsWith('community.comment.')) {
      work.push(client.invalidateQueries({ queryKey: ['clan-post-comments', String(data.postId)], refetchType: 'active' }));
    }
  } else if (type === 'identity.entitlements.changed') {
    work.push(invalidateQueryPrefix(client, ['identity-presentation']));
  } else if (type === 'identity.presentation.changed') {
    work.push(invalidateQueryPrefix(client, ['confession']));
  }
  return Promise.all(work);
}

export function useRealtimeRoom(room, enabled = true) {
  const realtime = useContext(RealtimeContext)?.realtime;
  useEffect(() => {
    if (!realtime || !enabled || !room) return undefined;
    realtime.subscribe(room);
    return () => realtime.unsubscribe(room);
  }, [enabled, realtime, room]);
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, type }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id} role="status">{toast.message}</div>)}
    </div>
  </ToastContext.Provider>;
}

function AuthProvider({ children }) {
  const client = useQueryClient();
  const { notify } = useToasts();
  const [realtime, setRealtime] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting');
  const [state, setState] = useState(() => {
    const stored = readStoredSession();
    if (!stored?.token || stored.expired || stored.invalid) return { status: 'initializing', token: null, user: null, expiresAt: null };
    return { status: 'authenticated', token: stored.token, user: stored.user, expiresAt: stored.expiresAt };
  });

  useEffect(() => {
    if (state.status !== 'authenticated' || !state.token) return undefined;
    let active = true;
    setRealtimeStatus('connecting');
    const instance = new CommunityRealtime({
      token: state.token,
      onEvent: (event) => {
        syncRealtimeCache(client, event).catch(() => {});
        window.dispatchEvent(new CustomEvent('bdu:realtime', { detail: event }));
      },
      onStatusChange: (nextStatus) => {
        if (active) setRealtimeStatus(nextStatus);
      }
    });
    // Forum is the public community stream. Keep one provider-owned reference
    // for the authenticated session so events can stale inactive forum/comment
    // caches after the route unmounts; page hooks add/remove only extra refs.
    instance.subscribe('forum');
    setRealtime(instance);
    instance.connect();
    return () => {
      active = false;
      instance.close();
      setRealtime((current) => current === instance ? null : current);
    };
  }, [client, state.status, state.token]);

  const logout = useCallback(({ message = 'Đã đăng xuất tài khoản.', expired = false, broadcast = true } = {}) => {
    clearStoredSession();
    client.clear();
    setState({ status: 'anonymous', token: null, user: null, expiresAt: null });
    if (broadcast) window.dispatchEvent(new CustomEvent('bdu:logout', { detail: { expired } }));
    notify(message, expired ? 'warning' : 'info');
  }, [client, notify]);

  useEffect(() => {
    const onExpired = (event) => {
      if (state.status === 'authenticated') logout({ message: event.detail?.message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', expired: true });
    };
    const onStorage = (event) => {
      if (event.key === 'bdu_token' && event.newValue === null && state.status === 'authenticated') logout({ message: 'Phiên đăng nhập đã kết thúc trên một tab khác.', broadcast: false });
    };
    window.addEventListener('bdu:session_expired', onExpired);
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => {
      if (state.expiresAt && Date.now() >= state.expiresAt) logout({ message: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', expired: true });
    }, 30000);
    return () => {
      window.removeEventListener('bdu:session_expired', onExpired);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [logout, state.expiresAt, state.status]);

  useEffect(() => {
    const stored = readStoredSession();
    if (state.status === 'initializing') {
      if (stored?.token && !stored.expired && !stored.invalid) setState({ status: 'authenticated', token: stored.token, user: stored.user, expiresAt: stored.expiresAt });
      else setState({ status: 'anonymous', token: null, user: null, expiresAt: null });
    }
  }, [state.status]);

  const login = useCallback(async (username, password, remember) => {
    const result = await loginStudent(username, password);
    const user = { name: result.name, mssv: result.mssv, email: result.email, roles: result.roles, idsv: result.idsv || '' };
    persistSession({ token: result.token, user, expiresIn: result.expires_in, remember });
    client.clear();
    setState({ status: 'authenticated', token: result.token, user, expiresAt: Number(storageForSession(remember).getItem('bdu_token_expires_at')) });
    notify(`Xin chào, ${result.name}!`, 'success');
    return user;
  }, [client, notify]);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  const realtimeValue = useMemo(() => ({ realtime, status: realtimeStatus }), [realtime, realtimeStatus]);
  return <AuthContext.Provider value={value}><RealtimeContext.Provider value={realtimeValue}>{children}</RealtimeContext.Provider></AuthContext.Provider>;
}

function storageForSession(remember) { return remember ? window.localStorage : window.sessionStorage; }

export function AppProviders({ children }) {
  return <QueryClientProvider client={queryClient}><ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider></QueryClientProvider>;
}
