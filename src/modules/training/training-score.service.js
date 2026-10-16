/**
 * Điểm rèn luyện (DGRL) - cổng sinh viên BDU.
 *
 * Ba bước đúng như trang /public/#/danhgiarenluyensv:
 *   1. report/w-locdanhsachhockydgrl   -> danh sách học kỳ có thể đánh giá
 *   2. sms/w-locdanhsachcauhoidgrl     -> bộ tiêu chí + điểm hiện tại của một học kỳ
 *   3. sms/w-luuketquadgrl             -> lưu lại nguyên object tiêu chí đã chỉnh
 *
 * Chỉ cần Bearer token; các endpoint này không đòi thêm header `ua`/cookie.
 */

const BDU_BASE_URL = 'https://sv.bdu.edu.vn/public/api';
const SEMESTERS_ENDPOINT = `${BDU_BASE_URL}/report/w-locdanhsachhockydgrl`;
const CRITERIA_ENDPOINT = `${BDU_BASE_URL}/sms/w-locdanhsachcauhoidgrl`;
const SAVE_ENDPOINT = `${BDU_BASE_URL}/sms/w-luuketquadgrl`;

// Mục 5 là phần duy nhất sinh viên tự khai mà cổng không thể suy ra từ dữ liệu
// học tập, nên công cụ chỉ hỏi về mục 5 và giữ nguyên các mục còn lại.
const MUC5_GROUP = '5';
const MUC5_PENALTY_CODE = '5.5';
const MUC5_PENALTY_DIEM = -10;

// App CDS (BDU Student) là hệ thống khác, xác thực bằng tk-mk riêng. Ta chỉ
// dùng nó để đồng bộ tiêu chí 6.16 (hoạt động văn hóa/văn nghệ/thể thao).
const CDS_BASE_URL = 'https://cds.bdu.edu.vn/student/api/v1';
const CDS_LOGIN_ENDPOINT = `${CDS_BASE_URL}/odp/auth/login`;
const CDS_TRAIN_SCORE_ENDPOINT = `${CDS_BASE_URL}/system/ren-luyen/train-score`;
const BONUS_616_CODE = '6.16';

// Thứ tự hiển thị cố định; điểm lấy theo `diem_toi_da` của cổng khi có.
const MUC5_ROLES = [
  { code: '5.1', diem: 10, label: 'BCH Đoàn Thanh niên/Hội Sinh viên cấp Trường, Chi ủy viên Chi bộ Đảng sinh viên' },
  { code: '5.2', diem: 8, label: 'BCH Đoàn/Hội cấp Khoa/Viện, Chủ nhiệm CLB sinh viên, Ban cán sự lớp (Lớp trưởng)' },
  { code: '5.3', diem: 7, label: 'Ban chủ nhiệm CLB sinh viên, Ban cán sự lớp (Lớp phó/Bí thư)' },
  { code: '5.4', diem: 3, label: 'Thành viên CLB/đội nhóm trực thuộc Trường quản lý' }
];

function bearer(token) {
  const value = String(token || '').trim();
  return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
}

function apiError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isExpiredPayload(payload, status) {
  return status === 401 || status === 402 || payload?.code === 401 || payload?.code === 402
    || payload?.message === 'loggedoff' || /logged.?off|hết hạn|expired/i.test(String(payload?.message || ''));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function postJson(url, token, body) {
  if (!token) throw apiError('Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.', 401);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: bearer(token),
        Accept: 'application/json, text/plain, */*',
        idpc: '0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body ?? {})
    });
  } catch (cause) {
    const error = apiError('Không thể kết nối máy chủ điểm rèn luyện BDU.', 503);
    error.cause = cause;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = apiError('BDU trả về dữ liệu điểm rèn luyện không hợp lệ.', 502);
    error.cause = cause;
    throw error;
  }

  if (isExpiredPayload(payload, response.status)) {
    throw apiError('Phiên đăng nhập BDU đã hết hạn. Vui lòng đăng nhập lại.', 401);
  }
  if (!response.ok || (payload && payload.result === false) || (payload?.code && payload.code !== 200)) {
    throw apiError(payload?.message || 'BDU không xử lý được yêu cầu điểm rèn luyện.', response.status || 400);
  }
  return payload;
}

function normalizeSemesters(payload) {
  const list = Array.isArray(payload?.data?.ds_hoc_ky) ? payload.data.ds_hoc_ky : [];
  return list
    .map((item) => ({
      hocKy: item?.hoc_ky ?? null,
      ten: String(item?.ten_hoc_ky || ''),
      startDate: String(item?.ngay_bat_dau_hk || ''),
      endDate: String(item?.ngay_ket_thuc_hk || ''),
      hienThiDiem: toNumber(item?.hiendiensv) === 1
    }))
    .filter((item) => item.hocKy !== null && item.hocKy !== undefined);
}

function normalizeCriteria(data) {
  const groups = Array.isArray(data?.ds_nhom_cau_hoi) ? data.ds_nhom_cau_hoi : [];
  const normalizedGroups = groups.map((group) => {
    const cauHoi = (Array.isArray(group?.ds_cau_hoi) ? group.ds_cau_hoi : []).map((question) => ({
      so: String(question?.so_thu_tu ?? ''),
      noiDung: String(question?.noi_dung || ''),
      diemToiDa: toNumber(question?.diem_toi_da),
      diem: toNumber(question?.diem_tu_danh_gia),
      isEnable: question?.is_enable !== false,
      laDiemCong: Boolean(question?.is_tieu_chi_diem_cong),
      ghiChu: String(question?.ghi_chu_DGRL || '')
    }));
    return {
      so: String(group?.so_thu_tu ?? ''),
      noiDung: String(group?.noi_dung || ''),
      diemToiDa: toNumber(group?.tong_diem_toi_da),
      diem: toNumber(group?.tong_diem_tu_danh_gia),
      cauHoi
    };
  });

  const rawTotal = normalizedGroups.reduce((sum, group) => sum + group.diem, 0);

  return {
    hocKy: data?.hoc_ky ?? null,
    isReadOnly: Boolean(data?.is_ReadOnly),
    isSvNhapHoatDong: Boolean(data?.is_sv_nhap_hoat_dong),
    diemRenLuyen: toNumber(data?.diem_ren_luyen),
    xepLoai: String(data?.xep_loai_ren_luyen || ''),
    ghiChuSv: String(data?.ghi_chu_sv || ''),
    groups: normalizedGroups,
    total: Math.min(100, rawTotal),
    muc5: normalizedGroups.find((group) => group.so === MUC5_GROUP) || null
  };
}

function findGroup(data, soNhom) {
  const groups = Array.isArray(data?.ds_nhom_cau_hoi) ? data.ds_nhom_cau_hoi : [];
  return groups.find((group) => String(group?.so_thu_tu ?? '') === String(soNhom)) || null;
}

function roleMeta(code) {
  return MUC5_ROLES.find((role) => role.code === code) || null;
}

/** Đọc lựa chọn mục 5 đang lưu trên cổng để pre-fill giao diện. */
function detectMuc5Selection(data) {
  const group = findGroup(data, MUC5_GROUP);
  const selection = { roles: [], penalty: false };
  if (!group) return selection;
  for (const question of group.ds_cau_hoi || []) {
    const so = String(question?.so_thu_tu ?? '');
    const value = toNumber(question?.diem_tu_danh_gia);
    if (so === MUC5_PENALTY_CODE) {
      if (value < 0) selection.penalty = true;
      continue;
    }
    if (roleMeta(so) && value > 0) selection.roles.push(so);
  }
  selection.roles.sort((a, b) => MUC5_ROLES.findIndex((r) => r.code === a) - MUC5_ROLES.findIndex((r) => r.code === b));
  return selection;
}

function recomputeGroupTotal(group) {
  if (!group) return;
  const sum = (group.ds_cau_hoi || []).reduce((total, question) => total + toNumber(question?.diem_tu_danh_gia), 0);
  const max = toNumber(group.tong_diem_toi_da);
  group.tong_diem_tu_danh_gia = sum >= max ? max : sum;
}

function findQuestionInData(data, soThuTu) {
  const groups = Array.isArray(data?.ds_nhom_cau_hoi) ? data.ds_nhom_cau_hoi : [];
  for (const group of groups) {
    for (const question of group.ds_cau_hoi || []) {
      if (String(question?.so_thu_tu ?? '') === String(soThuTu)) return { group, question };
    }
  }
  return null;
}

/** Áp các giá trị điểm vào từng câu hỏi rồi tính lại tổng các nhóm bị ảnh hưởng. */
function applyScores(data, scores = {}) {
  const clone = JSON.parse(JSON.stringify(data ?? {}));
  const touched = new Set();
  for (const [so, value] of Object.entries(scores)) {
    if (!Number.isFinite(Number(value))) continue;
    const found = findQuestionInData(clone, so);
    if (!found) continue;
    found.question.diem_tu_danh_gia = Number(value);
    touched.add(found.group);
  }
  touched.forEach(recomputeGroupTotal);
  return clone;
}

function buildMuc5Scores(data, { roles = [], penalty = false } = {}) {
  const group = findGroup(data, MUC5_GROUP);
  const scores = {};
  if (!group) return scores;
  const selectedRoles = new Set((Array.isArray(roles) ? roles : []).filter((code) => roleMeta(code)));
  for (const question of group.ds_cau_hoi || []) {
    const so = String(question?.so_thu_tu ?? '');
    if (so === MUC5_PENALTY_CODE) {
      scores[so] = penalty ? MUC5_PENALTY_DIEM : 0;
      continue;
    }
    const meta = roleMeta(so);
    if (!meta) continue;
    const max = toNumber(question.diem_toi_da);
    scores[so] = selectedRoles.has(so) ? (max > 0 ? max : meta.diem) : 0;
  }
  return scores;
}

/** Điểm 6.16 lấy nguyên từ app sinh viên (không chặn theo điểm tối đa của tiêu chí). */
function buildBonusScores(data, bonus616) {
  if (bonus616 === null || bonus616 === undefined || bonus616 === '') return {};
  const found = findQuestionInData(data, BONUS_616_CODE);
  if (!found) return {};
  let value = toNumber(bonus616);
  if (value < 0) value = 0;
  return { [BONUS_616_CODE]: value };
}

/**
 * Bản sao của data cổng trả về, chỉ đổi mục 5 theo lựa chọn. Các mục khác giữ
 * nguyên giá trị cổng đã tính (mặc định 20/25/25, điểm cộng = 0...).
 */
function applyMuc5Selection(data, selection = {}) {
  return applyScores(data, buildMuc5Scores(data, selection));
}

function describeSelection({ roles = [], penalty = false } = {}) {
  const parts = roles.length ? roles.join(', ') : 'không giữ chức vụ';
  return penalty ? `${parts} (có vi phạm 5.5)` : parts;
}

// --- App CDS (BDU Student) ---------------------------------------------------
// Cổng BDU mã học kỳ dạng <năm bắt đầu 4 số><kỳ> (20252 = HK2 2025-2026).
// App CDS dùng <2 số năm bắt đầu><2 số năm kết thúc><kỳ> (25262 = 2025-2026 HK2).
function mapSemesterToCdsCode(hocKy) {
  const value = Number(hocKy);
  if (!Number.isFinite(value) || value <= 0) return null;
  const startYear = Math.floor(value / 10);
  const semester = value % 10;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}${semester}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdsLogin({ mssv, password } = {}) {
  const numericMssv = Number(String(mssv ?? '').trim());
  if (!Number.isFinite(numericMssv) || numericMssv <= 0) {
    throw apiError('Không xác định được MSSV để đồng bộ app sinh viên.', 400);
  }
  if (!password) throw apiError('Vui lòng nhập mật khẩu app sinh viên.', 400);

  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(CDS_LOGIN_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ mssv: numericMssv, password: String(password) })
      });
      break;
    } catch (cause) {
      lastError = cause;
      await sleep(400 * attempt);
    }
  }
  if (!response) {
    const error = apiError('Không thể kết nối app sinh viên.', 503);
    error.cause = lastError;
    throw error;
  }

  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 401) throw apiError(payload?.error || 'Tài khoản hoặc mật khẩu app sinh viên không đúng.', 401);
  if (!response.ok || !payload?.access_token) {
    throw apiError(payload?.error || payload?.message || 'App sinh viên không xử lý được đăng nhập.', response.status || 400);
  }
  return payload.access_token;
}

// App CDS thỉnh thoảng trả lỗi tạm thời; thử lại vài lần trước khi bỏ cuộc.
async function fetchCdsTrainScore({ token, nkhk } = {}) {
  const url = `${CDS_TRAIN_SCORE_ENDPOINT}?nkhk=${encodeURIComponent(nkhk)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: bearer(token), Accept: 'application/json' } });
    } catch (cause) {
      lastError = apiError('Không thể kết nối app sinh viên.', 503);
      lastError.cause = cause;
      await sleep(400 * attempt);
      continue;
    }
    if (response.status === 401) throw apiError('Phiên app sinh viên không hợp lệ, vui lòng thử lại.', 401);
    if (response.ok) {
      const text = await response.text().catch(() => '');
      try { return JSON.parse(text); } catch { lastError = apiError('App sinh viên trả về dữ liệu không hợp lệ.', 502); }
    } else {
      lastError = apiError('App sinh viên không trả về dữ liệu rèn luyện.', response.status);
    }
    await sleep(400 * attempt);
  }
  throw lastError || apiError('Không thể kết nối app sinh viên.', 503);
}

function findCriterion(nodes, soThuTu) {
  const list = Array.isArray(nodes) ? nodes : [];
  for (const node of list) {
    if (String(node?.so_thu_tu ?? '') === String(soThuTu)) return node;
    const found = findCriterion(node?.children, soThuTu);
    if (found) return found;
  }
  return null;
}

function normalizeCriterion(node) {
  if (!node) return null;
  const max = toNumber(node.diem_toi_da);
  const raw = node.diem_thuc_te === null || node.diem_thuc_te === undefined ? 0 : toNumber(node.diem_thuc_te);
  const chiTiet = node?.minh_chung?.chi_tiet;
  return {
    so: String(node.so_thu_tu ?? ''),
    noiDung: String(node.noi_dung || ''),
    diemToiDa: max,
    diemThucTe: raw,
    giaTri: raw < 0 ? 0 : Math.min(raw, max),
    moTa: String(node?.minh_chung?.mo_ta || ''),
    capNhatCuoi: String(node?.minh_chung?.cap_nhat_cuoi || ''),
    minhChung: (Array.isArray(chiTiet) ? chiTiet : []).map((item) => ({
      id: item?.id ?? null,
      tieuDe: String(item?.tieu_de || ''),
      giaTri: String(item?.gia_tri || ''),
      phuDe: String(item?.phu_de || '')
    }))
  };
}

export const MUC5_ROLE_OPTIONS = MUC5_ROLES.map((role) => ({ ...role }));

export const TrainingScoreService = {
  async listSemesters({ token } = {}) {
    const payload = await postJson(SEMESTERS_ENDPOINT, token, {
      filter: { is_tieng_anh: null },
      additional: { paging: { limit: 100, page: 1 }, ordering: [{ name: 'hoc_ky', order_type: 1 }] }
    });
    return { items: normalizeSemesters(payload) };
  },

  async getCriteria({ token, hocKy, mssv } = {}) {
    if (!hocKy) throw apiError('Thiếu học kỳ cần đánh giá.', 400);
    if (!mssv) throw apiError('Không xác định được mã sinh viên đang đăng nhập.', 401);

    const payload = await postJson(CRITERIA_ENDPOINT, token, {
      nhhk: Number(hocKy),
      ma_sinh_vien: String(mssv),
      is_sinh_vien: true,
      is_cvht: false,
      is_can_bo_khoa: false
    });
    const data = payload?.data;
    if (!data || !Array.isArray(data.ds_nhom_cau_hoi)) {
      throw apiError('Cổng BDU không trả về tiêu chí rèn luyện cho học kỳ này.', 422);
    }
    return { raw: data, summary: normalizeCriteria(data), selection: detectMuc5Selection(data) };
  },

  async saveCriteria({ token, payload } = {}) {
    if (!payload || !Array.isArray(payload.ds_nhom_cau_hoi)) {
      throw apiError('Thiếu dữ liệu tiêu chí để lưu điểm rèn luyện.', 400);
    }
    const result = await postJson(SAVE_ENDPOINT, token, payload);
    return { raw: result?.data || payload, summary: normalizeCriteria(result?.data || payload) };
  },

  /**
   * Chấm mục 5 theo lựa chọn, giữ nguyên phần còn lại, lưu lên cổng rồi trả về
   * tổng điểm/xếp loại sau khi cổng ghi nhận. `bonus616` (nếu có) là điểm 6.16
   * đồng bộ từ app sinh viên, đã được chặn trong khoảng hợp lệ.
   */
  async autoScore({ token, hocKy, mssv, roles, penalty, bonus616, ghiChuSv, onLog } = {}) {
    const log = (message, type = 'info') => {
      if (typeof onLog === 'function') onLog({ message, type, timestamp: new Date().toLocaleTimeString('vi-VN') });
    };

    log(`🚀 Chuẩn bị chấm điểm rèn luyện học kỳ ${hocKy ?? ''}...`);
    const { raw, summary, selection } = await this.getCriteria({ token, hocKy, mssv });
    log(`📡 w-locdanhsachcauhoidgrl → ${summary.groups.length} nhóm tiêu chí, hiện tại ${summary.total} điểm${summary.xepLoai ? ` (${summary.xepLoai})` : ''}.`);

    if (summary.isReadOnly) {
      throw apiError('Học kỳ này đang ngoài thời gian cho phép sinh viên tự đánh giá.', 409);
    }

    const effective = {
      roles: Array.isArray(roles) ? roles : selection.roles,
      penalty: Boolean(penalty)
    };
    const scores = { ...buildMuc5Scores(raw, effective), ...buildBonusScores(raw, bonus616) };
    const payload = applyScores(raw, scores);
    if (typeof ghiChuSv === 'string') payload.ghi_chu_sv = ghiChuSv.slice(0, 2000);
    const after = normalizeCriteria(payload);
    const muc5 = after.muc5;

    log(`🎯 Mục 5 (${describeSelection(effective)}) → ${muc5 ? muc5.diem : 0}/10 điểm.`, 'muted');
    if (Object.prototype.hasOwnProperty.call(scores, BONUS_616_CODE)) {
      log(`🎯 Tiêu chí 6.16 (đồng bộ app sinh viên) → ${scores[BONUS_616_CODE]} điểm.`, 'muted');
    }
    log('💾 w-luuketquadgrl → đang lưu lên cổng BDU...');

    const saved = await this.saveCriteria({ token, payload });
    const finalSummary = saved.summary;
    log(`✅ Đã lưu. Tổng điểm tự đánh giá: ${finalSummary.total}/100${finalSummary.xepLoai ? ` · Xếp loại: ${finalSummary.xepLoai}` : ''}.`, 'success');

    return { success: true, summary: finalSummary, selection: effective };
  },

  /**
   * Đăng nhập app sinh viên bằng tk-mk sinh viên rồi đọc tiêu chí 6.16 của học kỳ.
   * Không lưu lại mật khẩu; access_token của CDS chỉ sống trong một lần gọi.
   */
  async syncCriterion616({ mssv, password, hocKy } = {}) {
    const nkhk = mapSemesterToCdsCode(hocKy);
    if (!nkhk) throw apiError('Học kỳ không hợp lệ để đồng bộ app sinh viên.', 400);

    const cdsToken = await cdsLogin({ mssv, password });
    const payload = await fetchCdsTrainScore({ token: cdsToken, nkhk });
    const node = findCriterion(payload?.chi_tiet, BONUS_616_CODE);
    if (!node) throw apiError('App sinh viên không có tiêu chí 6.16 cho học kỳ này.', 404);

    return {
      nkhk,
      sinhVien: payload?.sinh_vien || null,
      criterion: normalizeCriterion(node)
    };
  }
};

export const TrainingScoreServiceInternals = {
  normalizeSemesters,
  normalizeCriteria,
  detectMuc5Selection,
  applyMuc5Selection,
  applyScores,
  buildMuc5Scores,
  buildBonusScores,
  findQuestionInData,
  recomputeGroupTotal,
  describeSelection,
  mapSemesterToCdsCode,
  findCriterion,
  normalizeCriterion,
  MUC5_ROLES,
  MUC5_PENALTY_CODE,
  MUC5_PENALTY_DIEM,
  BONUS_616_CODE
};
