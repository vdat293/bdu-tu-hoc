/**
 * Bản đồ route SPA -> nhóm tính năng, dùng cho việc khoá bảo trì theo nhóm.
 *
 * Vì sao cần file này: phía server chặn API theo `featureForPath`
 * (`src/config/feature-groups.js`), nhưng màn hình bảo trì phải biết TRANG đang mở
 * thuộc nhóm nào thì mới biết có bị khoá hay không. Router không mang theo id nhóm
 * nên phải suy ra từ `pathname`.
 *
 * Vì sao bản đồ phải ĐỒNG BỘ với `src/config/feature-groups.js`: đó là nguồn sự thật
 * duy nhất khai `pagePrefixes` của từng nhóm. Nếu thêm một nhóm hoặc đổi tiền tố
 * trang ở server mà quên cập nhật ở đây thì client và server "nói khác nhau": API bị
 * chặn 503 nhưng giao diện vẫn tải bình thường (hoặc ngược lại). Test
 * `tests/test-service-groups-map.js` đối chiếu trực tiếp với taxonomy server để bắt
 * lệch này.
 *
 * Cố tình KHÔNG import gì: file là ESM thuần nên test Node import thẳng được, không
 * kéo theo React/react-router.
 */

// Các cặp tiền tố -> id nhóm, giữ đúng id mà `feature-groups.js` dùng. Chỉ khai
// nhóm có route trang thật; `games` không có route SPA nên không xuất hiện.
const ROUTE_GROUPS = [
  { prefix: '/wordfmt', group: 'wordfmt' },
  { prefix: '/survey', group: 'survey' },
  { prefix: '/training-score', group: 'training' },
  { prefix: '/english', group: 'english' },
  { prefix: '/learning', group: 'learning' },
  { prefix: '/clans', group: 'clubs' },
  { prefix: '/confession', group: 'community' },
  { prefix: '/vocab', group: 'vocab' },
  { prefix: '/grammar', group: 'grammar' },
  { prefix: '/ttcds', group: 'ttcds' }
];

// Sắp giảm dần theo độ dài tiền tố để hàm tra cứu chỉ cần lấy kết quả khớp đầu tiên.
// Vì sao: quy tắc "tiền tố DÀI NHẤT thắng"; sắp sẵn một lần lúc nạp module thay vì
// so sánh độ dài ở mỗi lần gọi.
const SORTED_ROUTE_GROUPS = [...ROUTE_GROUPS].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Trả về id nhóm tính năng của một đường dẫn trang SPA, hoặc `null` nếu không khớp.
 *
 * Vì sao trả `null` chứ không phải 'other': phía client chỉ cần phân biệt "trang này
 * thuộc nhóm khoá được hay không". Trả `null` cho `/gpa`, `/login`... giúp
 * MaintenanceGate bỏ qua, tránh vô tình hiện màn bảo trì cho các trang không khoá.
 */
export function featureForRoute(pathname) {
  let path = String(pathname == null ? '' : pathname);

  // Cắt query/hash phòng khi nơi gọi truyền cả chuỗi URL; pathname của router thường
  // đã sạch nhưng cắt ở đây rẻ và giữ hành vi khớp với `featureForPath` phía server.
  const cut = path.search(/[?#]/);
  if (cut !== -1) {
    path = path.slice(0, cut);
  }

  for (const { prefix, group } of SORTED_ROUTE_GROUPS) {
    // Khớp theo ranh giới đoạn: '/vocab' khớp '/vocab/set/x' nhưng KHÔNG khớp
    // '/vocabulary'. Dùng startsWith trần sẽ gộp sai hai path khác đoạn.
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return group;
    }
  }

  return null;
}
