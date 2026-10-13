// Cửa chặn bảo trì theo NHÓM tính năng: middleware Express chặn request khi
// nhóm mà path thuộc về đang bị khoá bảo trì.
//
// Vì sao nhận getStatus qua tham số thay vì import ServiceLockService: giữ
// middleware thuần, test được bằng hàm giả và tránh phụ thuộc vòng khi app.js
// vừa import service vừa import guard.
//
// Vì sao KHÔNG còn danh sách miễn trừ cứng (EXEMPT_PATHS/EXEMPT_PREFIXES): trước
// đây guard tự khai một danh sách path "không bao giờ chặn" (health/version/
// status + vùng admin). Khi chuyển sang khoá theo nhóm, chính taxonomy
// `feature-groups.js` đã mã hoá thông tin đó qua cờ `lockable`:
//   - Portal (đăng nhập, /profile, /grades...) là nhóm `lockable:false` ⇒ không
//     bao giờ bị chặn, người dùng luôn còn cách tự thoát khỏi màn bảo trì thay vì
//     phải can thiệp DB/rollback.
//   - Health/version/status và vùng admin không thuộc nhóm tính năng nào nên rơi
//     vào OTHER_FEATURE ⇒ cũng không bị chặn.
// Giữ hai nguồn sự thật (danh sách cứng cạnh taxonomy) sẽ lệch âm thầm mỗi khi
// thêm route/nhóm mới, nên quy tắc nhóm `lockable` thay thế hoàn toàn.
//
// Vì sao tự tra nhóm bằng featureForPath: hàm này đã tự bỏ tiền tố '/api' và
// query/hash, khớp tiền tố DÀI NHẤT (ví dụ /community/clans thuộc `clubs` chứ
// không phải `community`), nên guard không cần tự chuẩn hoá path và luôn khớp
// với cách phân tích traffic_logs dùng cùng taxonomy.

import { featureForPath, OTHER_FEATURE } from '../config/feature-groups.js';

export function createServiceLockGuard({ getStatus } = {}) {
  // Trả về Promise để tầng test có thể await; Express 4 bỏ qua giá trị trả về
  // của middleware nên việc này không ảnh hưởng luồng thật.
  return async function serviceLockGuard(req, res, next) {
    const group = featureForPath(req && req.path);

    // Nhóm "khác" (đăng nhập, identity, meta, admin...) và nhóm không cho khoá
    // (portal) KHÔNG bao giờ bị chặn: quy tắc nhóm `lockable` thay thế danh sách
    // miễn trừ cứng cũ, tránh lệch giữa hai nguồn sự thật.
    if (group === OTHER_FEATURE || !group.lockable) {
      next();
      return;
    }

    let status;
    try {
      status = await getStatus();
    } catch {
      // Fail-open: lỗi đọc trạng thái (DB hỏng, chưa cấu hình DATABASE_URL...)
      // không được biến thành sự cố toàn site. Coi như không khoá.
      next();
      return;
    }

    // Chỉ chặn khi nhóm của path đang khoá thật (thiếu nhóm trong map cũng coi
    // như mở để fail-open, tránh chặn oan khi map thiếu khoá).
    const entry = status && status.groups ? status.groups[group.id] : null;
    if (entry && entry.locked === true) {
      try {
        res.status(503).json({
          result: false,
          code: 'MAINTENANCE',
          group: group.id,
          title: entry.title,
          message: entry.message
        });
      } catch {
        // Phòng khi response không đủ API (shape lạ trong test): thà cho qua còn
        // hơn để middleware ném lỗi ra ngoài và làm sập tiến trình.
        next();
      }
      return;
    }

    next();
  };
}
