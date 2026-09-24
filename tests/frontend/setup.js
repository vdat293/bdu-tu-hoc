import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] || null,
    get length() { return values.size; }
  };
}

for (const name of ['localStorage', 'sessionStorage']) {
  const storage = window[name];
  if (!storage || typeof storage.clear !== 'function' || typeof storage.removeItem !== 'function') {
    Object.defineProperty(window, name, { configurable: true, value: createMemoryStorage() });
  }
}

// jsdom chưa hỗ trợ object URL cho ảnh xem trước (avatar, media composer).
if (typeof window.URL.createObjectURL !== 'function') {
  Object.defineProperty(window.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob) => `blob:mock/${Math.random().toString(36).slice(2)}-${blob?.size ?? 0}`
  });
}
if (typeof window.URL.revokeObjectURL !== 'function') {
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => {}
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
