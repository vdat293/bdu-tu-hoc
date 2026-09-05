/** Session-scoped request deduplication for read-only feature data. */
(() => {
  const cache = new Map();
  const inflight = new Map();
  const abortError = () => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  };

  window.BDUResourceLoader = {
    get(key, loader, { force = false, ttl = 15_000, signal } = {}) {
      const now = Date.now();
      const cached = cache.get(key);
      const withSignal = promise => {
        if (!signal) return promise;
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise((resolve, reject) => {
          const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
          signal.addEventListener('abort', abort, { once: true });
          promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
        });
      };
      if (!force && cached && cached.expiresAt > now) return withSignal(Promise.resolve(cached.value));
      if (!force && inflight.has(key)) return withSignal(inflight.get(key));
      const request = Promise.resolve().then(loader).then(value => {
        cache.set(key, { value, expiresAt: Date.now() + Math.max(0, ttl) });
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, request);
      return withSignal(request);
    },
    clear(prefix = '') {
      for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key);
      for (const key of inflight.keys()) if (!prefix || key.startsWith(prefix)) inflight.delete(key);
    },
    snapshot() { return { cacheSize: cache.size, inflightSize: inflight.size }; }
  };
})();
