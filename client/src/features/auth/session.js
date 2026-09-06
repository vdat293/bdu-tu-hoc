export const SESSION_KEYS = ['bdu_token', 'bdu_user', 'bdu_token_expires_at'];

function storageForRemember(remember) {
  return remember ? window.localStorage : window.sessionStorage;
}

function tokenExpiry(token, expiresIn) {
  const seconds = Number(expiresIn);
  if (Number.isFinite(seconds) && seconds > 0) return Date.now() + seconds * 1000;
  if (typeof token === 'string' && token.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (Number.isFinite(payload.exp)) return payload.exp * 1000;
    } catch { /* opaque BDU token */ }
  }
  return Date.now() + 24 * 60 * 60 * 1000;
}

function readFromStorage(storage) {
  try {
    const token = storage.getItem('bdu_token');
    const rawUser = storage.getItem('bdu_user');
    if (!token || !rawUser) return null;
    const expiresAt = Number(storage.getItem('bdu_token_expires_at'));
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return { expired: true, storage };
    const user = JSON.parse(rawUser);
    if (!user || typeof user !== 'object') return { invalid: true, storage };
    return { token, user, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null, storage };
  } catch {
    return { invalid: true, storage };
  }
}

export function readStoredSession() {
  const local = readFromStorage(window.localStorage);
  if (local?.token) return local;
  const session = readFromStorage(window.sessionStorage);
  if (session?.token) return session;
  return local?.expired || local?.invalid ? local : session?.expired || session?.invalid ? session : null;
}

export function persistSession({ token, user, expiresIn, remember }) {
  clearStoredSession();
  const storage = storageForRemember(remember);
  storage.setItem('bdu_token', token);
  storage.setItem('bdu_user', JSON.stringify(user));
  storage.setItem('bdu_token_expires_at', String(tokenExpiry(token, expiresIn)));
}

export function clearStoredSession() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of SESSION_KEYS) storage.removeItem(key);
  }
}

export function isInternalReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
}
