import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confessionFrameAssetUrls } from '../../client/src/features/confession/confession-assets.js';
import { useConfessionAssetsReady } from '../../client/src/features/confession/useConfessionAssets.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('confessionFrameAssetUrls', () => {
  it('chỉ gồm ảnh hiện ngay: artwork, nhân vật và nền Sukuna', () => {
    const urls = confessionFrameAssetUrls({
      family: 'anime-sukuna',
      src: '/frame.png',
      character: '/character.png',
      sealOpen: '/seal.png'
    });

    expect(urls).toEqual(expect.arrayContaining(['/frame.png', '/character.png']));
    expect(urls).toContain('/assets/images/sukuna-ngutrutu-confession-hero.png');
    expect(urls).not.toContain('/seal.png');
    expect(urls.filter((url) => url.includes('hero-layer'))).toHaveLength(0);
  });

  it('khung khác không kéo theo nền Sukuna', () => {
    const urls = confessionFrameAssetUrls({ family: 'anime-gojo', src: '/frame.png', eye: '/eye.png' });
    expect(urls).not.toContain('/assets/images/sukuna-ngutrutu-confession-hero.png');
    expect(urls).not.toContain('/assets/images/sukuna-ngutrutu-confession-hero-layer-01-ground.png');
  });
});

describe('useConfessionAssetsReady', () => {
  it('giữ chưa sẵn sàng cho tới khi toàn bộ ảnh tải xong', async () => {
    const instances = [];
    class FakeImage {
      constructor() {
        this.complete = false;
        instances.push(this);
      }

      decode() { return Promise.resolve(); }

      set src(value) { this._src = value; }

      get src() { return this._src; }
    }

    const originalImage = window.Image;
    window.Image = FakeImage;
    try {
      const frame = { family: 'anime-sukuna', src: '/frame.png', character: '/character.png', sealOpen: '/seal.png' };
      const { result } = renderHook(() => useConfessionAssetsReady({ frame, photoUrl: '/avatar.png' }));

      expect(result.current).toBe(false);
      await act(async () => {});

      // 3 artwork + nền + 4 layer + ảnh đại diện.
      expect(instances).toHaveLength(confessionFrameAssetUrls(frame).length + 1);

      act(() => {
        instances.forEach((image) => image.onload?.());
      });
      await waitFor(() => expect(result.current).toBe(true));
    } finally {
      window.Image = originalImage;
    }
  });

  it('không chặn trang khi môi trường không tải ảnh (jsdom)', () => {
    const { result } = renderHook(() => useConfessionAssetsReady({ frame: { src: '/frame.png' }, photoUrl: '/avatar.png' }));
    expect(result.current).toBe(true);
  });
});
