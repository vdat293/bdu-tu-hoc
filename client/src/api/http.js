export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.') {
    super(message, { status: 401, code: 401 });
    this.name = 'SessionExpiredError';
  }
}

// Dịch vụ bị khóa để bảo trì: khác lỗi HTTP thường ở chỗ đây là trạng thái toàn
// hệ thống, người dùng không sửa được bằng cách thao tác lại. Mang thêm title để
// màn hình bảo trì (Task 7) có tiêu đề hiển thị, còn message đã có từ ApiError.
export class MaintenanceError extends ApiError {
  constructor(message = 'Hệ thống đang bảo trì, vui lòng quay lại sau.', { title = null } = {}) {
    super(message, { status: 503, code: 'MAINTENANCE' });
    this.name = 'MaintenanceError';
    this.title = title;
  }
}

function notifySessionExpired(message) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bdu:session_expired', { detail: { message } }));
  }
}

// Phát sự kiện thay vì để component tự import lớp lỗi: tầng HTTP và tầng UI không
// phụ thuộc trực tiếp vào nhau, màn hình bảo trì chỉ cần nghe 'bdu:maintenance'.
function notifyMaintenance(details) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bdu:maintenance', { detail: details }));
  }
}

async function parseResponse(response, responseType) {
  if (responseType === 'blob') return response.blob();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return await response.json(); } catch { return null; }
  }
  return response.text();
}

export async function request(path, {
  token,
  method = 'GET',
  body,
  headers = {},
  signal,
  responseType = 'json',
  defaultMessage = 'Thao tác không thành công.'
} = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (body && !(body instanceof FormData) && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: body && !(body instanceof FormData) && typeof body !== 'string' ? JSON.stringify(body) : body,
    signal
  });
  const data = await parseResponse(response, responseType);
  const message = typeof data === 'object' && data?.message ? data.message : defaultMessage;
  // A 401 from the login endpoint means incorrect credentials, not an expired
  // authenticated session. Let the login form present a useful inline error.
  const isLoginRequest = path === '/api/login';
  const isExpired = !isLoginRequest && (response.status === 401 || data?.code === 401 || /hết hạn|expired/i.test(message));
  if (isExpired) {
    notifySessionExpired(message);
    throw new SessionExpiredError(message);
  }
  // Nhánh bảo trì phải đứng TRƯỚC nhánh !response.ok bên dưới: nếu để sau, 503 sẽ
  // bị nhánh chung bắt trước và ném ApiError thuần, màn hình bảo trì không bao giờ
  // hiện. Chỉ đúng mã MAINTENANCE mới kích hoạt; một 503 khác (proxy/quá tải) vẫn
  // là lỗi thường.
  if (response.status === 503 && data?.code === 'MAINTENANCE') {
    const title = typeof data?.title === 'string' && data.title ? data.title : null;
    notifyMaintenance({ title, message });
    throw new MaintenanceError(message, { title });
  }
  if (!response.ok || (data && typeof data === 'object' && data.result === false)) {
    throw new ApiError(message, { status: response.status, code: data?.code, details: data });
  }
  return data;
}

export function unwrap(data, fallback = data) {
  if (data && typeof data === 'object' && 'data' in data) return data.data;
  return fallback;
}
