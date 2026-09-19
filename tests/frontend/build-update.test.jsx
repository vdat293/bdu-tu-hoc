import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppErrorBoundary from '../../client/src/app/AppErrorBoundary.jsx';
import {
  canAutoReloadForStaleChunk,
  installPreloadErrorRecovery,
  isChunkLoadError,
  reloadForStaleChunk
} from '../../client/src/app/chunk-recovery.js';
import { fetchServerBuildId } from '../../client/src/app/useBuildUpdate.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stale chunk recovery', () => {
  it('nhận diện lỗi dynamic import từ các trình duyệt', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://hub/app-assets/Gpa-x.js'))).toBe(true);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
    expect(isChunkLoadError('Loading chunk 12 failed.')).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('chỉ tự reload một lần trong cooldown 30 giây', () => {
    const reload = vi.fn();
    const now = 1_000_000;
    expect(reloadForStaleChunk({ now, reload })).toBe(true);
    expect(reloadForStaleChunk({ now: now + 10_000, reload })).toBe(false);
    expect(reloadForStaleChunk({ now: now + 31_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('vẫn reload khi sessionStorage bị chặn', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    const reload = vi.fn();
    expect(canAutoReloadForStaleChunk(Date.now(), blocked)).toBe(true);
    expect(reloadForStaleChunk({ storage: blocked, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('vite:preloadError được chặn lan khi reload chạy, và thả lỗi khi guard chặn', () => {
    const target = new EventTarget();
    const storage = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
    const reload = vi.fn();
    installPreloadErrorRecovery(target, { storage, reload });
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('build update detection', () => {
  it('đọc build id từ /api/version', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: true, build_id: '20260920153000' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    await expect(fetchServerBuildId(fetcher)).resolves.toBe('20260920153000');
    expect(fetcher).toHaveBeenCalledWith('/api/version', expect.objectContaining({ cache: 'no-store' }));
  });

  it('trả null khi lỗi mạng, HTTP lỗi hoặc thiếu build id', async () => {
    await expect(fetchServerBuildId(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toBeNull();
    await expect(fetchServerBuildId(vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))).resolves.toBeNull();
    await expect(fetchServerBuildId(vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ result: true }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )))).resolves.toBeNull();
  });
});

describe('AppErrorBoundary', () => {
  it('hiện nút tải lại cho lỗi render thường', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom() { throw new Error('boom'); }
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại trang' })).toBeInTheDocument();
  });

  it('báo bản mới khi chunk cũ lỗi mà guard vừa reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('bdu:stale-chunk-reload-at', String(Date.now()));
    function Boom() { throw new Error('Failed to fetch dynamically imported module: /app-assets/Gpa-x.js'); }
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByText('Ứng dụng vừa được cập nhật')).toBeInTheDocument();
  });
});
