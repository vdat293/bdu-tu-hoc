/**
 * Enrollment BDU adapter — the only place that knows how sv.bdu.edu.vn shapes
 * its registration API. Everything here uses the student's own bearer token;
 * the server never stores it. Response mapping is defensive because the
 * official portal is the source of truth, not our guesses.
 *
 * Note: the portal sends the exact envelope below; the "Lọc theo môn học"
 * dropdown is applied client-side from the flags already in ds_nhom_to
 * (is_ctdt / is_chctdt). `loaiLoc` is only a cache key — we do NOT invent
 * unconfirmed server-side filter fields.
 */

// The official registration page talks to /dkmh/api, not /public/api. The
// public alias does not see registrations created through the portal (it
// returned an empty list while the portal showed the same student's rows).
const BDU_BASE_URL = 'https://sv.bdu.edu.vn/dkmh/api';
const SERVER_TIME_URL = `${BDU_BASE_URL}/hsba/w-gettimeserver`;
// One cached catalog is ~500KB (306 môn + 555 nhóm). Capping the number of
// per-token entries keeps a long-running server from retaining a catalog for
// every session that ever logged in.
const MAX_CATALOG_CACHE_ENTRIES = 20;

const CATALOG_ENVELOPE = {
  is_CVHT: false,
  additional: {
    paging: { limit: 99999, page: 1 },
    ordering: [{ name: '', order_type: '' }]
  }
};
const REGISTERED_ENVELOPE = { is_CVHT: false, is_Clear: false };

export class EnrollmentBduError extends Error {
  constructor(message, { status = 502, code = 'BDU_ERROR' } = {}) {
    super(message);
    this.name = 'EnrollmentBduError';
    this.status = status;
    this.code = code;
  }
}

const toInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};
const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const pickString = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

function tryParseDate(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{10}$/.test(trimmed)) return new Date(Number(trimmed) * 1000);
    if (/^\d{13}$/.test(trimmed)) return new Date(Number(trimmed));
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = tryParseDate(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export class EnrollmentService {
  constructor({ fetchImpl = fetch, catalogTtlMs = 60_000, now = () => Date.now() } = {}) {
    this.fetchImpl = fetchImpl;
    this.catalogTtlMs = catalogTtlMs;
    this.now = now;
    this.catalogCache = new Map();
  }

  async #post(token, path, body) {
    let response;
    try {
      response = await this.fetchImpl(`${BDU_BASE_URL}/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'idpc': '0'
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw new EnrollmentBduError('Không kết nối được tới sv.bdu.edu.vn.', { status: 502, code: 'BDU_UNREACHABLE' });
    }
    let data = null;
    try {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new EnrollmentBduError('Phản hồi từ BDU không hợp lệ (không phải JSON).', { status: 502, code: 'BDU_BAD_RESPONSE' });
    }
    return { httpStatus: response.status, data };
  }

  static #portalData(payload) {
    if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') return payload.data;
    return payload ?? {};
  }

  async getCatalog(token, { loaiLoc = 2, forceRefresh = false } = {}) {
    const cacheKey = `${token}:${loaiLoc}`;
    if (!forceRefresh) {
      const hit = this.catalogCache.get(cacheKey);
      if (hit && hit.expiresAt > this.now()) return hit.value;
    }

    const { httpStatus, data } = await this.#post(token, 'dkmh/w-locdsnhomto', CATALOG_ENVELOPE);
    if (httpStatus === 401 || httpStatus === 426 || [400, 401, 402].includes(data?.code)) {
      throw new EnrollmentBduError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', { status: 401, code: 'AUTH_EXPIRED' });
    }

    const portal = EnrollmentService.#portalData(data);
    const dsMonHoc = (Array.isArray(portal.ds_mon_hoc) ? portal.ds_mon_hoc : [])
      .map((m) => ({ ma: pickString(m?.ma), ten: pickString(m?.ten) }));
    // BDU leaves ds_nhom_to.ten_mon empty; the code->name map lives in ds_mon_hoc.
    const nameByCode = new Map(dsMonHoc.map((m) => [m.ma, m.ten]));
    const dsNhomTo = (Array.isArray(portal.ds_nhom_to) ? portal.ds_nhom_to : []).map((g) => ({
      idToHoc: pickString(g?.id_to_hoc),
      maMon: pickString(g?.ma_mon),
      tenMon: pickString(g?.ten_mon) || nameByCode.get(pickString(g?.ma_mon)) || '',
      nhomTo: pickString(g?.nhom_to),
      to: pickString(g?.to),
      lop: pickString(g?.lop),
      soTc: toNum(g?.so_tc_so ?? g?.so_tc),
      slCp: toInt(g?.sl_cp),
      slCl: toInt(g?.sl_cl),
      tkb: pickString(g?.tkb),
      enable: g?.enable === true,
      gcEnable: pickString(g?.gc_enable),
      isCtdt: g?.is_ctdt === true,
      isChctdt: g?.is_chctdt === true,
      isRot: g?.is_rot === true,
      dsLop: (Array.isArray(g?.ds_lop) ? g.ds_lop : []).map((lop) => pickString(lop)).filter(Boolean),
      dsKhoa: (Array.isArray(g?.ds_khoa) ? g.ds_khoa : []).map((khoa) => pickString(khoa)).filter(Boolean)
    }));

    const value = {
      hocKyDangKy: pickString(portal.hoc_ky_dang_ky, data?.hoc_ky_dang_ky),
      trongThoiGianDangKy: (portal.trong_thoi_gian_dang_ky ?? data?.trong_thoi_gian_dang_ky) === true,
      dienGiaiEnableChung: pickString(portal.dien_giai_enable_chung, data?.dien_giai_enable_chung),
      dsMonHoc,
      dsNhomTo
    };
    this.catalogCache.set(cacheKey, { value, expiresAt: this.now() + this.catalogTtlMs });
    if (this.catalogCache.size > MAX_CATALOG_CACHE_ENTRIES) {
      const oldestKey = this.catalogCache.keys().next().value;
      if (oldestKey !== undefined) this.catalogCache.delete(oldestKey);
    }
    return value;
  }

  async getGateStatus(token) {
    const catalog = await this.getCatalog(token, { forceRefresh: true });
    return catalog.trongThoiGianDangKy === true;
  }

  // Bộ lọc môn học do BDU trả theo từng tài khoản/kỳ (7 mục, một mục mặc định).
  async getFilters(token) {
    const { httpStatus, data } = await this.#post(token, 'dkmh/w-locdsdieukienloc', {});
    if (httpStatus === 401 || httpStatus === 426 || [400, 401, 402].includes(data?.code)) {
      throw new EnrollmentBduError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', { status: 401, code: 'AUTH_EXPIRED' });
    }
    const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    return list
      .map((filter) => ({
        value: toInt(filter?.gia_tri, NaN),
        label: pickString(filter?.mieu_ta),
        isDefault: filter?.is_mac_dinh === true
      }))
      .filter((filter) => Number.isFinite(filter.value) && filter.label);
  }

  /**
   * Lớp hành chính của sinh viên (vd "27TH03") — dùng cho bộ lọc "Môn học mở
   * theo lớp sinh viên". Endpoint hồ sơ cũng trả nhiều field khác nhưng ở đây
   * chỉ cần `lop`; lỗi mạng không được làm hỏng luồng đăng ký.
   */
  async getStudentClass(token) {
    if (!token) return '';
    try {
      const { httpStatus, data } = await this.#post(token, 'dkmh/w-locsinhvieninfo', {});
      if (httpStatus >= 400) return '';
      const portal = EnrollmentService.#portalData(data);
      const row = Array.isArray(portal) ? portal[0] : portal;
      return pickString(row?.lop);
    } catch {
      return '';
    }
  }

  async getRegistered(token) {
    const { httpStatus, data } = await this.#post(token, 'dkmh/w-locdskqdkmhsinhvien', REGISTERED_ENVELOPE);
    if (httpStatus === 401 || httpStatus === 426 || [400, 401, 402].includes(data?.code)) {
      throw new EnrollmentBduError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', { status: 401, code: 'AUTH_EXPIRED' });
    }
    const portal = EnrollmentService.#portalData(data);
    return {
      soTinChiMin: toNum(portal.so_tin_chi_min),
      dsKqdkmh: Array.isArray(portal.ds_kqdkmh) ? portal.ds_kqdkmh : []
    };
  }

  async fetchServerTime() {
    let response;
    try {
      response = await this.fetchImpl(SERVER_TIME_URL, { method: 'GET', headers: { 'Accept': 'application/json, text/plain, */*' } });
    } catch {
      return null;
    }
    try {
      const text = await response.text();
      try {
        return tryParseDate(JSON.parse(text));
      } catch {
        return tryParseDate(text);
      }
    } catch {
      return null;
    }
  }

  // BDU access tokens live ~5h. A run scheduled for tomorrow refreshes the
  // session with the refresh token (kept in RAM only) when the access token
  // expires, so the schedule can actually fire the next day.
  async refreshSession(refreshToken) {
    if (!refreshToken) {
      throw new EnrollmentBduError('Phiên đăng nhập BDU đã hết hạn và thiếu refresh token. Vui lòng đăng nhập lại.', { status: 401, code: 'AUTH_EXPIRED' });
    }
    let response;
    try {
      response = await this.fetchImpl(`${BDU_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
      });
    } catch {
      throw new EnrollmentBduError('Không kết nối được tới sv.bdu.edu.vn để làm mới phiên.', { status: 502, code: 'BDU_UNREACHABLE' });
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new EnrollmentBduError('Phản hồi làm mới phiên từ BDU không hợp lệ.', { status: 502, code: 'BDU_BAD_RESPONSE' });
    }
    if (!data?.access_token) {
      throw new EnrollmentBduError('Phiên đăng nhập BDU đã hết hạn. Vui lòng đăng nhập lại.', { status: 401, code: 'AUTH_EXPIRED' });
    }
    return { token: data.access_token, refreshToken: data.refresh_token || refreshToken };
  }

  // Đăng nhập lại bằng MSSV + mật khẩu (password grant). Mật khẩu chỉ đi qua
  // request này; service không lưu lại ở đâu.
  async login(username, password) {
    let response;
    try {
      response = await this.fetchImpl(`${BDU_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: String(username ?? ''),
          password: String(password ?? '')
        }).toString()
      });
    } catch {
      throw new EnrollmentBduError('Không kết nối được tới sv.bdu.edu.vn để đăng nhập.', { status: 502, code: 'BDU_UNREACHABLE' });
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new EnrollmentBduError('Phản hồi đăng nhập từ BDU không hợp lệ.', { status: 502, code: 'BDU_BAD_RESPONSE' });
    }
    if (!data?.access_token) {
      const httpStatus = Number(response.status) || 0;
      if (httpStatus >= 500 || httpStatus === 429) {
        throw new EnrollmentBduError('Máy chủ BDU tạm thời không đăng nhập được.', { status: 502, code: 'BDU_UNAVAILABLE' });
      }
      if ([400, 401, 403].includes(httpStatus)) {
        throw new EnrollmentBduError(
          pickString(data?.message, data?.error_description, 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.'),
          { status: 401, code: 'INVALID_CREDENTIALS' }
        );
      }
      throw new EnrollmentBduError('Phản hồi đăng nhập từ BDU không hợp lệ.', { status: 502, code: 'BDU_BAD_RESPONSE' });
    }
    return { token: data.access_token, refreshToken: data.refresh_token || '' };
  }

  async registerGroup(token, { idToHoc, isChecked, svNganh = 1, idRs = '' } = {}) {
    if (!idToHoc) throw new EnrollmentBduError('Thiếu id_to_hoc.', { status: 400, code: 'BAD_REQUEST' });
    const { httpStatus, data } = await this.#post(token, 'dkmh/w-xulydkmhsinhvien', {
      filter: {
        id_to_hoc: String(idToHoc),
        is_checked: isChecked === true,
        sv_nganh: Number(svNganh) || 1,
        id_rs: String(idRs ?? '')
      }
    });
    const portal = EnrollmentService.#portalData(data);
    return {
      httpStatus,
      code: data?.code ?? null,
      isThanhCong: portal.is_thanh_cong === true,
      isChoose: portal.is_choose === true,
      idRs: pickString(portal.id_rs),
      idToHocXoa: pickString(portal.id_to_hoc_xoa),
      thongBaoLoi: pickString(portal.thong_bao_loi),
      thongBaoTienQuyet: pickString(portal.thong_bao_tien_quyet),
      rawMessage: pickString(data?.message, portal.thong_bao_loi, portal.thong_bao_tien_quyet)
    };
  }
}

export const enrollmentService = new EnrollmentService();

export function classifyRegisterResult(res = {}) {
  const httpStatus = Number(res.httpStatus) || 200;
  if (httpStatus === 412) return 'otp';
  if (httpStatus === 401 || httpStatus === 426) return 'auth';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus >= 500 && httpStatus <= 599) return 'transient';

  const code = res.code === undefined ? null : res.code;
  if (code !== 200) return 'rejected';

  const message = [res.rawMessage, res.thongBaoLoi, res.thongBaoTienQuyet]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  if (/het\s*(cho|chi\s*tieu)|da\s*day|khong\s*con\s*cho/.test(message)) return 'seat_full';
  // BDU chặn khi tổng tín chỉ vượt trần, vd "Quá tín chỉ tối đa: 22/ 19".
  // "đ" không bị NFD tách nên chỉ khớp tới "tối" để không phụ thuộc chữ "đa".
  if (/qua\s*tin\s*chi\s*toi|vuot\s*qua\s*so\s*tin\s*chi/.test(message)) return 'over_credit';
  // BDU dùng cả "tiên quyết" và "vi phạm học trước" cho cùng một điều kiện.
  if (/tien\s*quyet|hoc\s*truoc/.test(message)) return 'prereq';
  if (/trung\s*(thoi\s*khoa\s*bieu|tkb|lich\s*hoc)/.test(message)) return 'schedule_conflict';
  if (/ngoai\s*thoi\s*gian|chua\s*den\s*gio|het\s*thoi\s*gian/.test(message)) return 'gate_closed';
  if (res.isThanhCong === true) return 'thanh_cong';
  return 'rejected';
}
