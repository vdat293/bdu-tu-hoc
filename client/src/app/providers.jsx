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

export function useAuth() { return useContext(AuthContext); }
export function useToasts() { return useContext(ToastContext); }

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
  const [state, setState] = useState(() => {
    const stored = readStoredSession();
    if (!stored?.token || stored.expired || stored.invalid) return { status: 'initializing', token: null, user: null, expiresAt: null };
    return { status: 'authenticated', token: stored.token, user: stored.user, expiresAt: stored.expiresAt };
  });

  useEffect(() => {
    if (state.status !== 'authenticated' || !state.token) return undefined;
    const realtime = new CommunityRealtime({ token: state.token, onEvent: (event) => window.dispatchEvent(new CustomEvent('bdu:realtime', { detail: event })) });
    realtime.connect();
    return () => realtime.close();
  }, [state.status, state.token]);

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
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function storageForSession(remember) { return remember ? window.localStorage : window.sessionStorage; }

export function AppProviders({ children }) {
  return <QueryClientProvider client={queryClient}><ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider></QueryClientProvider>;
}
