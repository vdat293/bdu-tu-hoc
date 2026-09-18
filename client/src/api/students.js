import { request, SessionExpiredError, unwrap } from './http.js';

/**
 * Chuẩn hoá một record sinh viên từ API về dạng { mssv, full_name }.
 * Backend có thể trả về key khác nhau (mssv / ma_sinh_vien, full_name / ho_ten
 * / name) nên map defensively; record thiếu MSSV bị loại bỏ.
 */
export function normalizeStudent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mssv = raw.mssv ?? raw.ma_sinh_vien ?? raw.ma_sv ?? raw.username ?? '';
  if (!String(mssv).trim()) return null;
  const fullName = raw.full_name ?? raw.ho_ten ?? raw.name ?? raw.ho_va_ten ?? '';
  return {
    mssv: String(mssv).trim(),
    full_name: String(fullName || mssv).trim()
  };
}

/**
 * Tìm sinh viên đang hoạt động (is_active=TRUE do backend lọc) để tag @mention.
 *
 * GET /api/students/search?q=...&limit=8 → { result: true, data: [{ mssv, full_name }] }
 *
 * Defensive: backend đang làm song song nên mọi lỗi (404 route chưa có, 500,
 * network, q < 2 ký tự, payload lạ) đều trả [] thay vì throw — dropdown
 * mention chỉ đơn giản không hiện gợi ý, không vỡ composer/comment.
 * Ngoại lệ duy nhất được throw tiếp là SessionExpiredError để luồng
 * hết-phiên đăng nhập (đã broadcast `bdu:session_expired` trong request())
 * vẫn diễn ra bình thường.
 */
export async function searchActiveStudents(token, q, { limit = 8, signal } = {}) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(20, Number(limit))) : 8;
  try {
    const params = new URLSearchParams({ q: query, limit: String(safeLimit) });
    const data = await request(`/api/students/search?${params}`, {
      token,
      signal,
      defaultMessage: 'Không thể tìm kiếm sinh viên.'
    });
    const list = unwrap(data, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeStudent).filter(Boolean).slice(0, safeLimit);
  } catch (error) {
    if (error instanceof SessionExpiredError) throw error;
    return [];
  }
}

/**
 * Hồ sơ công khai của một sinh viên: presentation (avatar/khung/danh hiệu/clan)
 * + học lực tích lũy (GPA hệ 10/4, tín chỉ, xếp loại, thứ hạng nổi bật).
 *
 * GET /api/students/:mssv/profile → { result: true, data: {...} }
 */
export async function getStudentProfile(token, mssv, { signal } = {}) {
  const cleanMssv = String(mssv || '').trim();
  if (!cleanMssv) throw new Error('Thiếu MSSV cần xem hồ sơ.');
  const data = await request(`/api/students/${encodeURIComponent(cleanMssv)}/profile`, {
    token,
    signal,
    defaultMessage: 'Không thể tải hồ sơ sinh viên.'
  });
  return unwrap(data, null);
}
