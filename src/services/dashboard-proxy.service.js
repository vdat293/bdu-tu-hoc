/**
 * Dashboard Proxy Service
 *
 * Server-to-server proxy sang Dashboard BE (Fastify) cho tính năng
 * "Sinh viên của tôi" của Trung tâm Chuyển đổi số. Backend Hub đăng nhập bằng
 * MỘT tài khoản dịch vụ (không passthrough token của sinh viên) rồi giữ cookie
 * phiên `bdudash_session` trong bộ nhớ.
 *
 * QUAN TRỌNG (không enforce trong code): tài khoản dịch vụ
 * `DASHBOARD_USER`/`DASHBOARD_PASSWORD` PHẢI mang role scope toàn trường
 * (ví dụ `admin`/`lanh_dao_truong`). Nếu role bị giới hạn theo khoa/ngành,
 * Dashboard trả 403 "Bạn không có quyền xem sinh viên này" cho sinh viên ngoài
 * phạm vi — proxy passthrough nguyên 403 đó cho caller.
 *
 * Dashboard API contract (đã verify từ source Dashboard BE):
 *   POST {BE}/api/dang-nhap {ten_dang_nhap, mat_khau}
 *     -> 200 set-cookie bdudash_session=<JWT>, body {ok:true, nguoi_dung}; 401 sai creds.
 *   GET  {BE}/api/sinh-vien/:mssv                 -> 400/403/200 traCuuSinhVien
 *   GET  {BE}/api/tim-sinh-vien?q=&limit=         -> 400 (<2 ký tự)/200 {ket_qua}
 *   GET  {BE}/api/sinh-vien/:mssv/diem-danh?...    -> 400/403/404/200 NhatKyDiemDanh
 *
 * Quy ước lỗi: lỗi mang `.status`. Dashboard 400/403/404 passthrough nguyên
 * message `{loi}`. Dashboard chết/timeout (8000ms) -> 503 `retryable=true`
 * (cùng pattern `profileUnavailableError` của `bdu.service.js`).
 */

const DEFAULT_BASE_URL = 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 8000;
const SESSION_COOKIE_NAME = 'bdudash_session';
const STUDENT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_UNAVAILABLE_MESSAGE = 'Dịch vụ Dashboard tạm thời không phản hồi. Vui lòng thử lại.';

let sessionCookie = null;
let loginInFlight = null;
const studentCache = new Map();

function baseUrl() {
  const configured = String(process.env.DASHBOARD_BE_URL ?? '').trim();
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

/** Lỗi passthrough từ Dashboard, giữ đúng HTTP status + message `{loi}`. */
function upstreamError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Dashboard không phản hồi/timeout/sai cấu hình phiên: 503 retryable. */
function dashboardUnavailableError(message = DEFAULT_UNAVAILABLE_MESSAGE) {
  const error = new Error(message);
  error.status = 503;
  error.code = 'DASHBOARD_UNAVAILABLE';
  error.retryable = true;
  return error;
}

/** Fetch doubles cũ có thể bỏ `status`; coi như 200 giống `bdu.service.js`. */
function effectiveStatus(response) {
  const status = Number(response?.status);
  return Number.isFinite(status) && status > 0 ? status : 200;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function defaultUpstreamMessage(status) {
  if (status === 403) return 'Bạn không có quyền xem sinh viên này';
  if (status === 404) return 'Không tìm thấy sinh viên';
  return 'Yêu cầu không hợp lệ';
}

function buildUrl(path, params) {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      query.set(key, String(value));
    }
  }
  const suffix = query.toString();
  return `${baseUrl()}${path}${suffix ? `?${suffix}` : ''}`;
}

/** Chỉ lấy giá trị cookie bdudash_session, bỏ mọi attribute (Path/HttpOnly...). */
function extractSessionCookie(response) {
  const raw = response?.headers?.get?.('set-cookie');
  if (!raw) return null;
  const match = String(raw).match(/(?:^|;\s*)bdudash_session=([^;]+)/);
  return match ? `${SESSION_COOKIE_NAME}=${match[1].trim()}` : null;
}

async function performLogin() {
  const user = String(process.env.DASHBOARD_USER ?? '').trim();
  const password = process.env.DASHBOARD_PASSWORD ?? '';
  if (!user || !password) {
    throw dashboardUnavailableError('Chưa cấu hình tài khoản dịch vụ Dashboard (DASHBOARD_USER/DASHBOARD_PASSWORD).');
  }

  let response;
  try {
    response = await fetch(`${baseUrl()}/api/dang-nhap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ten_dang_nhap: user, mat_khau: password }),
      signal: timeoutSignal()
    });
  } catch (cause) {
    // Không echo request/URL ra ngoài: body login chứa mật khẩu.
    const error = dashboardUnavailableError();
    error.cause = cause;
    throw error;
  }

  const status = effectiveStatus(response);
  if (status < 200 || status >= 300) {
    // Sai creds / Dashboard lỗi: coi là sự cố phía server, KHÔNG lộ body login.
    throw dashboardUnavailableError();
  }

  const cookie = extractSessionCookie(response);
  if (!cookie) throw dashboardUnavailableError();
  return cookie;
}

/** Đăng nhập mới; gộp các lần login đồng thời để chỉ login 1 lần. */
async function login() {
  if (loginInFlight) return loginInFlight;
  sessionCookie = null;
  loginInFlight = performLogin()
    .then((cookie) => {
      sessionCookie = cookie;
      return cookie;
    })
    .finally(() => {
      loginInFlight = null;
    });
  return loginInFlight;
}

function ensureSession() {
  return sessionCookie ?? login();
}

async function fetchWithCookie(url, cookie) {
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Cookie: cookie, Accept: 'application/json' },
      signal: timeoutSignal()
    });
  } catch (cause) {
    const error = dashboardUnavailableError();
    error.cause = cause;
    throw error;
  }
}

async function handleResponse(response) {
  const status = effectiveStatus(response);
  if (status >= 200 && status < 300) {
    const data = await readJson(response);
    if (data === null) throw dashboardUnavailableError();
    return data;
  }
  if (status === 400 || status === 403 || status === 404) {
    const data = await readJson(response);
    const message = data && typeof data.loi === 'string' && data.loi.trim()
      ? data.loi
      : defaultUpstreamMessage(status);
    throw upstreamError(message, status);
  }
  // 401 còn lại sau khi đã login lại (sai/hết hạn tài khoản dịch vụ) hoặc 5xx
  // upstream: đây là sự cố phía Hub/Dashboard, không phải lỗi của sinh viên.
  throw dashboardUnavailableError();
}

/** GET có cookie phiên; gặp 401 thì login lại 1 lần rồi retry đúng 1 lần. */
async function authedGet(path, params) {
  const url = buildUrl(path, params);
  let cookie = await ensureSession();
  let response = await fetchWithCookie(url, cookie);
  if (effectiveStatus(response) === 401) {
    cookie = await login();
    response = await fetchWithCookie(url, cookie);
  }
  return handleResponse(response);
}

function readStudentCache(key) {
  const entry = studentCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    studentCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeStudentCache(key, value) {
  studentCache.set(key, { value, expiresAt: Date.now() + STUDENT_CACHE_TTL_MS });
}

export const DashboardProxy = {
  /** Tìm sinh viên theo tên/MSSV; passthrough `{ ket_qua }` của Dashboard. */
  async searchStudents(q, { limit } = {}) {
    const params = { q: String(q ?? '').trim() };
    if (limit !== undefined && limit !== null && limit !== '') params.limit = limit;
    return authedGet('/api/tim-sinh-vien', params);
  },

  /**
   * Chi tiết `traCuuSinhVien` (passthrough, gồm `ren_luyen`). Cache in-memory
   * 5 phút để mở group nhiều SV không nã Dashboard liên tục.
   */
  async getStudent(mssv) {
    const key = String(mssv ?? '').trim();
    const cached = readStudentCache(key);
    if (cached) return cached;

    const data = await authedGet(`/api/sinh-vien/${encodeURIComponent(key)}`);
    writeStudentCache(key, data);
    return data;
  },

  /** Nhật ký điểm danh theo môn/nhóm/năm học kỳ; passthrough NhatKyDiemDanh. */
  async getAttendance(mssv, { ma_mon_hoc, ma_nhom, nkhk } = {}) {
    const key = String(mssv ?? '').trim();
    return authedGet(`/api/sinh-vien/${encodeURIComponent(key)}/diem-danh`, { ma_mon_hoc, ma_nhom, nkhk });
  }
};
