// Phiên đăng nhập BDU dùng chung key với portal: token + user được lưu trong
// localStorage/sessionStorage, hết hạn thì coi như chưa đăng nhập.

const TOKEN_KEYS = ['bdu_token', 'bdu_user', 'bdu_token_expires_at'];

export function clearSession() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of TOKEN_KEYS) storage.removeItem(key);
  }
}

export function getSession() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const token = storage.getItem('bdu_token');
    if (!token) continue;
    const expiresAt = Number(storage.getItem('bdu_token_expires_at'));
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    try {
      return { token, user: JSON.parse(storage.getItem('bdu_user') || '{}') };
    } catch {
      return { token, user: {} };
    }
  }
  return null;
}

export function currentMssv() {
  return String(getSession()?.user?.mssv || '').trim().toUpperCase();
}

export function currentName() {
  const user = getSession()?.user || {};
  return user.full_name || user.name || user.ho_ten || user.student_name || currentMssv() || 'Sinh viên';
}

// Token hết hiệu lực: quay về trang đăng nhập kèm returnTo để vào lại đúng phòng.
export function recoverInvalidSession() {
  clearSession();
  if (window.location.pathname.startsWith('/login')) return;
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?returnTo=${returnTo}`);
}

export function loginUrl(returnTo = window.location.pathname + window.location.search) {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
  return next;
}

export function applyTheme(theme, persist = false) {
  const clean = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = clean;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', clean === 'light' ? '#eef4f7' : '#0f1b26');
  if (persist) {
    try { window.localStorage.setItem('bdu_theme', clean); } catch {}
  }
}

export function initTheme() {
  let stored = null;
  try { stored = window.localStorage.getItem('bdu_theme'); } catch {}
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
  applyTheme(stored || (prefersLight ? 'light' : 'dark'));
}
