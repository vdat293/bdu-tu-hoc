/**
 * Toán thuần cho khung cắt avatar vuông (kiểu Zalo): ảnh luôn phủ kín khung,
 * người dùng kéo để dịch và zoom để chọn vùng hiển thị. Tách riêng khỏi
 * component để unit test được không cần canvas/DOM.
 */

export const MIN_AVATAR_ZOOM = 1;
export const MAX_AVATAR_ZOOM = 4;
export const AVATAR_OUTPUT_SIZE = 512;

export function coverScale(naturalWidth, naturalHeight, stageSize) {
  if (!naturalWidth || !naturalHeight || !stageSize) return 1;
  return Math.max(stageSize / naturalWidth, stageSize / naturalHeight);
}

export function displaySize(naturalWidth, naturalHeight, stageSize, zoom) {
  const scale = coverScale(naturalWidth, naturalHeight, stageSize) * zoom;
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
    scale
  };
}

/**
 * Giữ ảnh luôn phủ kín khung: offset bị chặn theo phần dư của ảnh so với khung.
 */
export function clampOffset(offset, displayedWidth, displayedHeight, stageSize) {
  const maxX = Math.max(0, (displayedWidth - stageSize) / 2);
  const maxY = Math.max(0, (displayedHeight - stageSize) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, Number(offset?.x) || 0)),
    y: Math.min(maxY, Math.max(-maxY, Number(offset?.y) || 0))
  };
}

/**
 * Vùng cắt trên ảnh gốc (pixel) tương ứng đúng phần đang thấy trong khung.
 */
export function cropRect({ naturalWidth, naturalHeight, stageSize, zoom, offset }) {
  const { scale } = displaySize(naturalWidth, naturalHeight, stageSize, zoom);
  const size = stageSize / scale;
  const centerX = naturalWidth / 2 - (stageSize / 2 + (Number(offset?.x) || 0)) / scale;
  const centerY = naturalHeight / 2 - (stageSize / 2 + (Number(offset?.y) || 0)) / scale;
  return {
    sx: Math.max(0, Math.min(naturalWidth - size, centerX)),
    sy: Math.max(0, Math.min(naturalHeight - size, centerY)),
    size
  };
}
