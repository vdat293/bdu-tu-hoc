import {
  confessionFeedQueryOptions,
  confessionPresentationQueryOptions,
  confessionProfileQueryOptions,
  confessionRankingQueryOptions
} from '../features/confession/confession-queries.js';
import { confessionFrameAssetUrls } from '../features/confession/confession-assets.js';

/**
 * Nạp trước tài nguyên của khu vực BDU Confession.
 *
 * Mục tiêu: khi người dùng bấm vào mục trong sidebar thì chunk JS, feed và
 * danh tính đã nằm trong cache, nên trang dựng ngay thay vì hiện skeleton rồi
 * mới đi tải. Chỉ nạp dữ liệu khi có dấu hiệu người dùng sắp mở trang (hover,
 * focus, chạm) để người không dùng Confession không phát sinh request feed.
 */

// Ảnh khung/hero dùng chung danh sách với màn hình chờ (confession-assets.js).

const preloadedImages = new Set();

export function loadConfessionPage() {
  return import('../features/confession/ConfessionPage.jsx');
}

function preloadImage(url) {
  if (!url || typeof window === 'undefined' || typeof window.Image !== 'function') return;
  if (preloadedImages.has(url)) return;
  preloadedImages.add(url);
  const image = new window.Image();
  image.decoding = 'async';
  image.src = url;
  // `decode()` giúp ảnh vào bộ đệm đã giải mã, tránh nháy khung khi hero đổi
  // family ngay sau khi trang mount.
  if (typeof image.decode === 'function') image.decode().catch(() => {});
}

/**
 * Chỉ tải đúng bộ ảnh của khung đang trang bị. Người dùng khung thường hoặc
 * chưa có khung không phải tải 2-3 MB ảnh Sukuna.
 */
export async function preloadFrameAssets(presentation) {
  const frameId = presentation?.equipped_frame_id;
  if (!frameId) return;
  const { getEquippedFrame } = await import('../components/identity/Identity.jsx');
  const frame = getEquippedFrame(frameId);
  if (!frame) return;

  const urls = confessionFrameAssetUrls(frame);
  urls.forEach(preloadImage);
}

/**
 * Nạp trước chunk + các query mà trang Confession cần để thoát skeleton.
 * React Query tự gộp request trùng nên hover nhiều lần không nhân đôi tải.
 */
export function prefetchConfession(client, { token, mssv, idsv, photoUrl } = {}) {
  if (!client || !token) return Promise.resolve();

  const chunk = loadConfessionPage();
  const feed = client.prefetchQuery(confessionFeedQueryOptions({ token, mssv }));
  const presentation = client.prefetchQuery(confessionPresentationQueryOptions({ token, mssv }));
  const profile = client.prefetchQuery(confessionProfileQueryOptions({ token, mssv, idsv }));
  preloadImage(photoUrl);

  const identityExtras = presentation.then(() => {
    const data = client.getQueryData(['identity-presentation', mssv]);
    preloadImage(data?.avatar_url);
    // `prefetchQuery` không tôn trọng `enabled`, nên tự chặn ở đây: đã có khung
    // trang bị thì không cần gọi API xếp hạng.
    const ranking = data?.equipped_frame_id
      ? undefined
      : client.prefetchQuery(
        confessionRankingQueryOptions({ token, mssv, equippedFrameId: data?.equipped_frame_id })
      );
    preloadFrameAssets(data).catch(() => {});
    return ranking;
  });

  return Promise.allSettled([chunk, feed, profile, identityExtras]);
}
