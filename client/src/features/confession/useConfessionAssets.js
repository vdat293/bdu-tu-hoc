import { useEffect, useMemo, useState } from 'react';
import { confessionFrameAssetUrls } from './confession-assets.js';

const ASSET_TIMEOUT_MS = 8_000;

// Ảnh hero/khung là thứ nặng nhất của trang (nền Sukuna ~2MB). Nếu render sớm,
// trình duyệt sẽ vẽ từng ảnh khi tải xong và người dùng thấy trang "mọc" dần.
// Hook này giữ skeleton cho tới khi toàn bộ ảnh quan trọng đã tải xong.
//
// jsdom (test) không tải ảnh và không có Image.decode(); khi đó bỏ qua việc chờ
// để test không phải giả lập network. Trình duyệt thật đều có decode().
export function useConfessionAssetsReady({ frame, photoUrl } = {}) {
  const urls = useMemo(
    () => [...new Set([...confessionFrameAssetUrls(frame), photoUrl].filter(Boolean))],
    [frame, photoUrl]
  );
  const key = urls.join('|');
  const [readyKey, setReadyKey] = useState('');

  useEffect(() => {
    if (!key) return undefined;
    if (typeof window === 'undefined' || typeof window.Image !== 'function') {
      setReadyKey(key);
      return undefined;
    }

    let cancelled = false;
    let remaining = urls.length;
    const images = [];

    const finish = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) setReadyKey(key);
    };

    const timer = window.setTimeout(() => {
      if (!cancelled) setReadyKey(key);
    }, ASSET_TIMEOUT_MS);

    for (const url of urls) {
      const image = new window.Image();
      if (typeof image.decode !== 'function') {
        window.clearTimeout(timer);
        setReadyKey(key);
        return undefined;
      }
      images.push(image);
      let settled = false;
      const settle = (shouldDecode = true) => {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        if (shouldDecode) {
          Promise.resolve(image.decode()).then(finish, finish);
        } else {
          finish();
        }
      };
      image.onload = () => settle(true);
      image.onerror = () => settle(false);
      image.src = url;
      if (image.complete) settle(image.naturalWidth > 0);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [key, urls]);

  return !key || readyKey === key;
}
