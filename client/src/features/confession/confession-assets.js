// Ảnh nền/khung của khu vực Confession. Tách riêng để cả phần nạp trước
// (prefetch) lẫn màn hình chờ đều dùng đúng một danh sách.
//
// Ảnh nền trùng với khai báo trong public/css/style.css:
// .forum-hero-banner[data-frame-family="anime-sukuna"] .forum-banner-bg.
// 4 layer hero (-layer-0*.png), seal và mắt chỉ tồn tại trong timeline mở khung
// (opacity 0 khi không có .frame-cinematic-active), nên không đưa vào danh sách
// chờ trang. Nếu đưa vào, người dùng phải tải thêm vài MB cho ảnh không hiện.
export const SUKUNA_HERO_BACKGROUND = '/assets/images/sukuna-ngutrutu-confession-hero.png';

/**
 * Ảnh tĩnh thực sự hiện ngay khi mở trang: artwork khung + nhân vật + ảnh nền
 * hero. Các asset chỉ dùng cho timeline mở khung (seal, mắt, 4 layer) nằm ngoài
 * danh sách này để không bắt người dùng chờ thêm vài MB vô ích.
 */
export function confessionFrameAssetUrls(frame) {
  if (!frame) return [];
  const urls = [frame.src, frame.character];
  if (frame.family === 'anime-sukuna') urls.push(SUKUNA_HERO_BACKGROUND);
  return urls.filter(Boolean);
}
