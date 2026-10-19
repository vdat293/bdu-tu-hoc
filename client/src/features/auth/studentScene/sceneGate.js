// Cổng điều kiện cho cảnh 3D của trang đăng nhập.
//
// Cảnh three.js chỉ chạy khi màn hình rộng hơn đúng breakpoint mobile hiện có
// (900px, xem `@media (max-width: 900px)` trong public/css/style.css) và người
// dùng không bật giảm chuyển động. Mọi trường hợp còn lại rơi về 4 blob CSS cũ
// để điện thoại/máy yếu giữ nguyên trải nghiệm như trước.
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
  return describeStudentSceneSupport(scope) === 'ok';
}

// Lý do cổng đóng — dùng cho chẩn đoán (`?scene3d-debug`) để biết ngay vì sao
// không có cảnh 3D thay vì đoán: 'ok' | 'narrow' | 'reduced-motion'.
export function describeStudentSceneSupport(scope = window) {
  if (!queryMatches(scope, WIDTH_QUERY)) return 'narrow';
  if (queryMatches(scope, MOTION_QUERY)) return 'reduced-motion';
  return 'ok';
}

// Gọi `onChange` mỗi khi bề rộng hoặc thiết lập giảm chuyển động đổi, trả về
// hàm gỡ đăng ký. Dùng cho trường hợp người dùng kéo cửa sổ qua lại breakpoint.
export function watchStudentSceneSupport(scope, onChange) {
  if (!scope?.matchMedia) return () => {};
  const lists = [WIDTH_QUERY, MOTION_QUERY]
    .map((query) => {
      try {
        return scope.matchMedia(query);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const handler = () => onChange(shouldUseStudentScene(scope));
  const unsubscribe = lists.map((list) => {
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', handler);
      return () => list.removeEventListener('change', handler);
    }
    if (typeof list.addListener === 'function') {
      list.addListener(handler);
      return () => list.removeListener(handler);
    }
    return () => {};
  });
  return () => unsubscribe.forEach((off) => off());
}
