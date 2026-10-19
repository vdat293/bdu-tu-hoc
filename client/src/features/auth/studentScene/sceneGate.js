// Cổng điều kiện cho cảnh 3D của trang đăng nhập.
//
// Cảnh three.js chạy khi màn hình rộng hơn đúng breakpoint mobile hiện có (900px,
// xem `@media (max-width: 900px)` trong public/css/style.css). Màn hình hẹp rơi về
// 4 blob CSS cũ.
//
// Giảm chuyển động KHÔNG tắt cảnh nữa: người bật `prefers-reduced-motion` vẫn thấy
// cảnh 3D nhưng ở chế độ tĩnh — cảnh tự đọc `shouldReduceMotion` và bỏ hết phần
// chuyển động (không camera trôi theo con trỏ, không phóng vật khi hover, không lật
// trang, nhân vật đứng yên ở tư thế thay vì chạy animation).
//
// WebGL không kiểm tra ở đây: cảnh tự báo qua `onUnsupported` khi tạo renderer
// thất bại, nhờ vậy không phải dựng một context dùng-một-lần chỉ để dò.
export const SCENE_MIN_WIDTH = 901;

const WIDTH_QUERY = `(min-width: ${SCENE_MIN_WIDTH}px)`;
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function queryMatches(scope, query) {
  try {
    return scope?.matchMedia?.(query)?.matches === true;
  } catch {
    return false;
  }
}

export function shouldUseStudentScene(scope = window) {
  return queryMatches(scope, WIDTH_QUERY);
}

// Người dùng có yêu cầu giảm chuyển động không — cảnh dùng cờ này để chuyển sang
// chế độ tĩnh.
export function shouldReduceMotion(scope = window) {
  return queryMatches(scope, MOTION_QUERY);
}

// Gọi `onChange` mỗi khi bề rộng đổi (kéo cửa sổ qua lại breakpoint), trả về hàm gỡ
// đăng ký.
export function watchStudentSceneSupport(scope, onChange) {
  if (!scope?.matchMedia) return () => {};
  let list;
  try {
    list = scope.matchMedia(WIDTH_QUERY);
  } catch {
    return () => {};
  }
  const handler = () => onChange(shouldUseStudentScene(scope));
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }
  if (typeof list.addListener === 'function') {
    list.addListener(handler);
    return () => list.removeListener(handler);
  }
  return () => {};
}
