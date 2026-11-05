/**
 * Lưu runId của lượt auto đăng ký để F5 / mở tab khác vẫn khôi phục được.
 *
 * Key theo MSSV để hai tài khoản dùng chung trình duyệt không đọc nhầm lượt của
 * nhau. localStorage (không phải sessionStorage) vì lượt chạy nằm ở server:
 * đóng tab rồi mở lại vẫn phải thấy để còn dừng/theo dõi.
 */
const LEGACY_KEY = 'bdu_enrollment_run_id';
const PREFIX = 'bdu_enrollment_run_id:';
const HIDDEN_PREFIX = 'bdu_enrollment_run_hidden:';

function pickStorage(provided, name) {
  if (provided) return provided;
  try {
    return typeof window === 'undefined' ? null : window[name] ?? null;
  } catch {
    return null;
  }
}

export function runStorageKey(mssv) {
  const id = String(mssv ?? '').trim();
  return `${PREFIX}${id || 'anonymous'}`;
}

function hiddenKey(mssv) {
  return `${HIDDEN_PREFIX}${String(mssv ?? '').trim() || 'anonymous'}`;
}

function tryRead(storage, key) {
  try { return storage?.getItem(key) ?? ''; } catch { return ''; }
}

function tryWrite(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* storage đầy/bị chặn: bỏ qua */ }
}

function tryRemove(storage, key) {
  try { storage?.removeItem(key); } catch { /* bỏ qua */ }
}

export function readRunId(mssv, { local, session } = {}) {
  const localStore = pickStorage(local, 'localStorage');
  const sessionStore = pickStorage(session, 'sessionStorage');
  const key = runStorageKey(mssv);

  const current = tryRead(localStore, key);
  if (current) return current;

  // Tương thích key cũ (chỉ nằm trong sessionStorage) để không mất lượt đang có.
  const legacy = tryRead(sessionStore, LEGACY_KEY) || tryRead(localStore, LEGACY_KEY);
  if (!legacy) return '';
  tryWrite(localStore, key, legacy);
  tryRemove(sessionStore, LEGACY_KEY);
  return legacy;
}

export function saveRunId(mssv, runId, { local, session } = {}) {
  const localStore = pickStorage(local, 'localStorage');
  const sessionStore = pickStorage(session, 'sessionStorage');
  const value = String(runId ?? '').trim();
  if (!value) return '';
  tryWrite(localStore, runStorageKey(mssv), value);
  tryRemove(sessionStore, LEGACY_KEY);
  tryRemove(localStore, LEGACY_KEY);
  return value;
}

export function clearRunId(mssv, { local, session } = {}) {
  const localStore = pickStorage(local, 'localStorage');
  const sessionStore = pickStorage(session, 'sessionStorage');
  tryRemove(localStore, runStorageKey(mssv));
  tryRemove(localStore, LEGACY_KEY);
  tryRemove(sessionStore, LEGACY_KEY);
}

// Lượt đã bấm "Ẩn kết quả": vẫn còn trong DB nhưng không tự bật lại sau F5.
export function readHiddenRunId(mssv, { local } = {}) {
  return tryRead(pickStorage(local, 'localStorage'), hiddenKey(mssv));
}

export function saveHiddenRunId(mssv, runId, { local } = {}) {
  const localStore = pickStorage(local, 'localStorage');
  const value = String(runId ?? '').trim();
  if (!value) {
    tryRemove(localStore, hiddenKey(mssv));
    return '';
  }
  tryWrite(localStore, hiddenKey(mssv), value);
  return value;
}
