// Vite deletes the previous hashed chunks on every build (`emptyOutDir`), so a
// tab that still holds the old index.html will fail to import a chunk that no
// longer exists. The browser cannot be pushed a new document, but a single
// guarded reload fetches the fresh HTML and its matching chunk names.
const RELOAD_GUARD_KEY = 'bdu:stale-chunk-reload-at';
const RELOAD_COOLDOWN_MS = 30 * 1000;

const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|chunkloaderror|loading chunk \d+ failed/i;

export function isChunkLoadError(error) {
  const message = typeof error === 'string' ? error : String(error?.message || '');
  return CHUNK_ERROR_PATTERN.test(message);
}

export function canAutoReloadForStaleChunk(now = Date.now(), storage = sessionStorage) {
  try {
    const lastReloadAt = Number(storage.getItem(RELOAD_GUARD_KEY) || 0);
    return !lastReloadAt || now - lastReloadAt > RELOAD_COOLDOWN_MS;
  } catch {
    return true;
  }
}

export function reloadForStaleChunk({
  storage = sessionStorage,
  now = Date.now(),
  reload = () => window.location.reload()
} = {}) {
  if (!canAutoReloadForStaleChunk(now, storage)) return false;
  try {
    storage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // Storage bị chặn (chế độ riêng tư nghiêm ngặt): vẫn reload, chỉ mất guard.
  }
  reload();
  return true;
}

export function installPreloadErrorRecovery(target = window, reloadOptions = {}) {
  target.addEventListener('vite:preloadError', (event) => {
    // preventDefault stops Vite from rethrowing so the reload is the only
    // recovery path; when the guard blocks it the error reaches the boundary.
    if (reloadForStaleChunk(reloadOptions)) event.preventDefault();
  });
}
