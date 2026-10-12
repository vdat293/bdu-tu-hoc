// Cửa chặn bảo trì: middleware Express chặn mọi request khi công tắc khóa dịch vụ
// đang bật, trừ danh sách miễn trừ (xem EXEMPT_PATHS/EXEMPT_PREFIXES bên dưới).
//
// Vì sao nhận getStatus qua tham số thay vì import ServiceLockService: giữ
// middleware thuần, test được bằng hàm giả và tránh phụ thuộc vòng khi app.js
// vừa import service vừa import guard.
//
// Vì sao tự chuẩn hoá path: Express CHỈ cắt tiền tố mount khỏi req.path khi
// middleware được mount tại '/api'. Guard không được phép phụ thuộc vào chi tiết
// đó, nên nó tự bỏ tiền tố '/api' trước khi so miễn trừ để đúng hợp đồng dù được
// mount ở đâu (nhận cả '/health' lẫn '/api/health'). Nếu so sai, /api/health sẽ
// bị chặn lúc đang khóa, deploy.sh tưởng app chết và tự rollback, còn admin
// không đăng nhập lại được.

// So trên path đã cắt tiền tố '/api' (theo Global Constraints của plan).
const EXEMPT_PATHS = new Set(['/health', '/version', '/status']);

// Miễn trừ theo tiền tố: toàn bộ khu vực quản trị phải vào được để còn tắt khóa.
const EXEMPT_PREFIXES = ['/admin/dashboard'];

function normalizePath(rawPath) {
  const path = typeof rawPath === 'string' ? rawPath : '';
  return path.startsWith('/api') ? path.slice(4) : path;
}

function isExemptPath(path) {
  if (EXEMPT_PATHS.has(path)) return true;
  return EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function createServiceLockGuard({ getStatus } = {}) {
  // Trả về Promise để tầng test có thể await; Express 4 bỏ qua giá trị trả về
  // của middleware nên việc này không ảnh hưởng luồng thật.
  return async function serviceLockGuard(req, res, next) {
    if (isExemptPath(normalizePath(req && req.path))) {
      next();
      return;
    }

    let status;
    try {
      status = await getStatus();
    } catch {
      // Fail-open: lỗi đọc trạng thái (DB hỏng, chưa cấu hình DATABASE_URL...)
      // không được biến thành sự cố toàn site. Coi như không khóa.
      next();
      return;
    }

    if (status && status.locked === true) {
      try {
        res.status(503).json({
          result: false,
          code: 'MAINTENANCE',
          title: status.title,
          message: status.message
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
