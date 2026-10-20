/**
 * Taxonomy tính năng — nguồn sự thật duy nhất cho việc gom nhóm theo tính năng.
 *
 * Vì sao gom ở một chỗ: bảng xếp hạng tính năng, phân tích phiên/heatmap và (sau
 * này) công tắc khoá dịch vụ theo nhóm đều phải nhìn cùng một danh mục. Nếu mỗi
 * nơi tự khai tiền tố riêng thì chỉ cần lệch một route là số liệu vỡ âm thầm.
 *
 * Khi làm công tắc khoá per-group, bảng này được tái dùng nguyên vẹn và bổ sung
 * cờ `lockable` cho từng mục (xem spec Phụ lục B) thay vì tách bảng riêng. Nhờ
 * vậy chỉ có MỘT nơi định nghĩa nhóm, tránh cảnh bảng khoá và bảng phân tích
 * lệch nhau âm thầm.
 */

// Mỗi tính năng: id (ổn định), label (hiển thị), apiPrefixes (so trên path API,
// đã bỏ tiền tố /api), pagePrefixes (so trên đường dẫn trang SPA đã tải).
// `lockable` cho biết nhóm có được phép bật khoá bảo trì hay không. Portal luôn
// false: khoá portal sẽ chặn cả đăng nhập nên người dùng không còn cách tự thoát
// khỏi màn bảo trì, buộc phải can thiệp DB/rollback.
export const FEATURE_GROUPS = [
  { id: 'portal', label: 'Cổng sinh viên', lockable: false, apiPrefixes: ['/profile', '/grades', '/schedule', '/rankings'], pagePrefixes: ['/gpa', '/info', '/schedule', '/leaderboard', '/enrollment'] },
  { id: 'wordfmt', label: 'Word Formatting', lockable: true, apiPrefixes: ['/wordfmt'], pagePrefixes: ['/wordfmt'] },
  { id: 'survey', label: 'Survey Automation', lockable: true, apiPrefixes: ['/survey', '/tool-runs'], pagePrefixes: ['/survey'] },
  { id: 'training', label: 'Điểm rèn luyện', lockable: true, apiPrefixes: ['/training-score'], pagePrefixes: ['/training-score'] },
  { id: 'english', label: 'English (Moodle)', lockable: true, apiPrefixes: ['/english'], pagePrefixes: ['/english'] },
  { id: 'learning', label: 'Learning Hub', lockable: true, apiPrefixes: ['/learning'], pagePrefixes: ['/learning'] },
  { id: 'community', label: 'Góc Tự Học Số', lockable: true, apiPrefixes: ['/community/posts', '/community/media'], pagePrefixes: ['/confession'] },
  { id: 'clubs', label: 'CLB & Nhóm học tập', lockable: true, apiPrefixes: ['/community/clans', '/community/polls'], pagePrefixes: ['/clans'] },
  { id: 'vocab', label: 'Luyện từ vựng', lockable: true, apiPrefixes: ['/vocab'], pagePrefixes: ['/vocab'] },
  { id: 'grammar', label: 'Luyện ngữ pháp', lockable: true, apiPrefixes: ['/grammar'], pagePrefixes: ['/grammar'] },
  { id: 'games', label: 'Giải trí (game)', lockable: true, apiPrefixes: ['/entertainment'], pagePrefixes: [] },
  { id: 'ttcds', label: 'Trung tâm Chuyển đổi số', lockable: true, apiPrefixes: ['/ttcds', '/games/killer-sudoku'], pagePrefixes: ['/ttcds', '/mystudent', '/killer-sudoku'] }
];

// Danh sách id các nhóm được phép khoá, giữ đúng thứ tự khai báo trong
// FEATURE_GROUPS. Suy ra từ chính bảng trên (thay vì khai tay) để bật/tắt
// `lockable` một mục là danh sách này tự khớp, không có nguồn sự thật thứ hai.
export const LOCKABLE_FEATURE_IDS = FEATURE_GROUPS
  .filter((group) => group.lockable)
  .map((group) => group.id);

// Nhóm mặc định cho mọi path không khớp tính năng nào (đăng nhập, identity, thông
// báo, admin, meta...). Vẫn được đếm trong tổng, chỉ không lên bảng xếp hạng.
export const OTHER_FEATURE = { id: 'other', label: 'Khác' };

/**
 * Bảng tra sẵn mọi tiền tố kèm nhóm sở hữu, sắp giảm dần theo độ dài tiền tố.
 *
 * Vì sao sắp sẵn: quy tắc "tiền tố DÀI NHẤT thắng" (ví dụ /community/clans thắng
 * /community/posts khi path là /community/clans/5). Sắp một lần lúc nạp module
 * để hàm tra cứu chỉ việc lấy kết quả khớp đầu tiên.
 */
const PREFIX_INDEX = FEATURE_GROUPS
  .flatMap((group) => [
    ...group.apiPrefixes.map((prefix) => ({ prefix, group })),
    ...group.pagePrefixes.map((prefix) => ({ prefix, group }))
  ])
  .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Chuẩn hoá path thô trước khi so tiền tố.
 *
 * Vì sao: dữ liệu traffic_logs lưu endpoint dạng có tiền tố /api và có thể kèm
 * query; cả hai đều không thuộc "danh tính" tính năng nên cần cắt trước. Bỏ 4 ký
 * tự '/api' khớp đúng cách guard bảo trì tự chuẩn hoá.
 */
function normalizePath(rawPath) {
  let path = String(rawPath == null ? '' : rawPath);
  // Cắt query/hash trước vì chúng luôn nằm cuối path.
  const cut = path.search(/[?#]/);
  if (cut !== -1) {
    path = path.slice(0, cut);
  }
  if (path.startsWith('/api')) {
    path = path.slice(4);
  }
  return path;
}

/**
 * Trả về nhóm tính năng khớp path, hoặc OTHER_FEATURE nếu không khớp gì.
 *
 * Hàm thuần, không đụng DB, để test và mọi tầng khác dùng chung.
 */
export function featureForPath(rawPath) {
  const path = normalizePath(rawPath);
  for (const { prefix, group } of PREFIX_INDEX) {
    // Khớp theo ranh giới đoạn: '/vocab' khớp '/vocab/sets' nhưng KHÔNG khớp
    // '/vocabulary'. Nếu chỉ dùng startsWith thì hai path đó bị gộp sai.
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return group;
    }
  }
  return OTHER_FEATURE;
}
