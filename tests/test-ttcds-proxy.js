import assert from 'node:assert/strict';
import { DashboardProxy } from '../src/services/dashboard-proxy.service.js';

// Pure unit test: no DB, no real Dashboard. The service reads its base URL and
// service-account credentials from env at call time, so set them here instead of
// requiring any environment to run `node tests/test-ttcds-proxy.js`.
const BASE_URL = 'http://dashboard.test';
const SERVICE_USER = 'svc-user';
const SERVICE_PASSWORD = 'super-secret-password';
process.env.DASHBOARD_BE_URL = BASE_URL;
process.env.DASHBOARD_USER = SERVICE_USER;
process.env.DASHBOARD_PASSWORD = SERVICE_PASSWORD;

const originalFetch = globalThis.fetch;
const captured = [];
let loginCount = 0;
let detail2405Calls = 0;
let detail5555Calls = 0;
// Khi bật, response login CHỈ expose cookie qua getSetCookie() (không có
// header `set-cookie` dạng string) — mô phỏng undici khi Dashboard set nhiều cookie.
let loginCookieViaArrayOnly = false;
let arrayOnlyLogins = 0;

const STUDENT_A = {
  tim_thay: true,
  ho_so: { mssv: '22050006', ho_ten: 'Nguyễn Văn A', lop: 'K29-CNTT' },
  gpa_hoc_ky: [{ nkhk: '20251', gpa: 3.2, tong_tin_chi: 18 }],
  diem_danh: [{ nkhk: '20251', ty_le_chuyen_can: 95 }],
  bang_diem: [{ ma_mon_hoc: 'INF1203', diem: 8.5 }],
  diem_danh_mon: [],
  thoi_khoa_bieu: [],
  ren_luyen: [{ nkhk: '20251', diem_ren_luyen: 88, xep_loai: 'Tốt' }],
  su_kien: [{ ten_su_kien: 'Hội thảo AI', ngay: '2026-10-01' }]
};
const STUDENT_B = {
  tim_thay: true,
  ho_so: { mssv: '24050126', ho_ten: 'Trần Thị B' },
  gpa_hoc_ky: [],
  diem_danh: [],
  bang_diem: [],
  diem_danh_mon: [],
  thoi_khoa_bieu: [],
  ren_luyen: [{ nkhk: '20251', diem_ren_luyen: 75, xep_loai: 'Khá' }],
  su_kien: []
};
const SEARCH_RESULT = { ket_qua: [{ mssv: '22050006', ho_ten: 'Nguyễn Văn A' }] };
const ATTENDANCE = { tong_so_buoi: 15, so_buoi_vang: 1, nhat_ky: [] };
const STUDENT_C = {
  tim_thay: true,
  ho_so: { mssv: '55555555', ho_ten: 'Lê Văn C' },
  gpa_hoc_ky: [],
  diem_danh: [],
  bang_diem: [],
  diem_danh_mon: [],
  thoi_khoa_bieu: [],
  ren_luyen: [{ nkhk: '20251', diem_ren_luyen: 60, xep_loai: 'Trung bình' }],
  su_kien: []
};

const consoleCalls = [];
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) {
  console[level] = (...args) => {
    consoleCalls.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    originalConsole[level](...args);
  };
}

function jsonResponse(body, { status = 200, setCookie, setCookies } = {}) {
  const headers = new Map();
  if (setCookie) headers.set('set-cookie', setCookie);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => headers.get(String(name).toLowerCase()) ?? null,
      ...(Array.isArray(setCookies) ? { getSetCookie: () => setCookies } : {})
    },
    async json() {
      return body;
    }
  };
}

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  captured.push({ url: target, options });

  if (target.startsWith(`${BASE_URL}/api/dang-nhap`)) {
    loginCount += 1;
    const body = JSON.parse(options.body);
    if (body.ten_dang_nhap !== SERVICE_USER || body.mat_khau !== SERVICE_PASSWORD) {
      return jsonResponse({ loi: 'Tên đăng nhập hoặc mật khẩu không đúng' }, { status: 401 });
    }
    if (loginCookieViaArrayOnly) {
      arrayOnlyLogins += 1;
      return jsonResponse(
        { ok: true, nguoi_dung: { ten_dang_nhap: SERVICE_USER } },
        { setCookies: [`bdudash_session=JWT-ARRAY-${loginCount}; Path=/; HttpOnly; SameSite=Lax`] }
      );
    }
    return jsonResponse(
      { ok: true, nguoi_dung: { ten_dang_nhap: SERVICE_USER } },
      { setCookie: `bdudash_session=JWT-${loginCount}; Path=/; HttpOnly; SameSite=Lax` }
    );
  }

  if (target.includes('/api/tim-sinh-vien')) {
    if (/[?&]q=a(?:&|$)/.test(target)) {
      return jsonResponse({ loi: 'Nhập ít nhất 2 ký tự' }, { status: 400 });
    }
    return jsonResponse(SEARCH_RESULT);
  }

  if (target.includes('/api/sinh-vien/24050126/diem-danh')) {
    return jsonResponse(ATTENDANCE);
  }
  if (target.includes('/api/sinh-vien/24050126')) {
    detail2405Calls += 1;
    if (detail2405Calls === 1) {
      return jsonResponse({ loi: 'Phiên đăng nhập đã hết hạn' }, { status: 401 });
    }
    return jsonResponse(STUDENT_B);
  }
  if (target.includes('/api/sinh-vien/99999999')) {
    return jsonResponse({ loi: 'Bạn không có quyền xem sinh viên này' }, { status: 403 });
  }
  if (target.includes('/api/sinh-vien/55555555')) {
    detail5555Calls += 1;
    if (detail5555Calls === 1) {
      return jsonResponse({ loi: 'Phiên đăng nhập đã hết hạn' }, { status: 401 });
    }
    return jsonResponse(STUDENT_C);
  }
  if (target.includes('/api/sinh-vien/77777777')) {
    throw new Error(`ECONNREFUSED ${BASE_URL}`);
  }
  if (target.includes('/api/sinh-vien/22050006')) {
    return jsonResponse(STUDENT_A);
  }

  throw new Error(`Unexpected fetch call: ${target}`);
};

async function expectRejects(promise, check) {
  let error = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'Kỳ vọng promise reject');
  check(error);
}

try {
  console.log('🧪 Bắt đầu kiểm thử DashboardProxy (mock fetch, không cần Dashboard thật)...');

  console.log('--- [Test 1] login service-account + getStudent passthrough đủ field ---');
  const student = await DashboardProxy.getStudent('22050006');
  assert.deepEqual(student, STUDENT_A, 'getStudent phải passthrough nguyên payload traCuuSinhVien');
  assert.ok(Array.isArray(student.ren_luyen), 'ren_luyen phải được giữ nguyên');
  assert.ok(Array.isArray(student.gpa_hoc_ky) && Array.isArray(student.diem_danh) && Array.isArray(student.su_kien));

  assert.equal(loginCount, 1, 'Chỉ đăng nhập service-account đúng 1 lần');
  const loginCall = captured.find((entry) => entry.url.startsWith(`${BASE_URL}/api/dang-nhap`));
  assert.equal(loginCall.options.method, 'POST');
  assert.equal(loginCall.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(loginCall.options.body), { ten_dang_nhap: SERVICE_USER, mat_khau: SERVICE_PASSWORD });

  const detailCallA = captured.find((entry) => entry.url === `${BASE_URL}/api/sinh-vien/22050006`);
  assert.equal(detailCallA.options.headers.Cookie, 'bdudash_session=JWT-1', 'Detail dùng cookie phiên đã cache');
  assert.ok(
    detailCallA.options.signal instanceof AbortSignal,
    'Mọi request phải mang AbortSignal.timeout(8000ms)'
  );
  console.log('✅ PASSED: login 1 lần + passthrough đủ field + cookie + timeout signal.');

  console.log('--- [Test 2] cache in-memory: lần 2 không fetch thêm ---');
  const fetchBeforeCache = captured.length;
  const cached = await DashboardProxy.getStudent('22050006');
  assert.deepEqual(cached, STUDENT_A);
  assert.equal(captured.length, fetchBeforeCache, 'Lần 2 getStudent không được gọi fetch (cache hit)');
  assert.equal(loginCount, 1, 'Cache hit không được login lại');
  console.log('✅ PASSED: getStudent lần 2 đọc từ cache, không fetch.');

  console.log('--- [Test 3] searchStudents passthrough { ket_qua } ---');
  const search = await DashboardProxy.searchStudents(' 22 ', { limit: 5 });
  assert.deepEqual(search, SEARCH_RESULT, 'searchStudents phải passthrough { ket_qua }');
  const searchCall = captured.find((entry) => entry.url.includes('/api/tim-sinh-vien') && entry.url.includes('q=22'));
  assert.ok(searchCall, 'Phải gọi /api/tim-sinh-vien?q=22');
  assert.match(searchCall.url, /[?&]limit=5(?:&|$)/, 'limit phải được forward');
  assert.ok(searchCall.url.startsWith(`${BASE_URL}/api/tim-sinh-vien`));

  await expectRejects(DashboardProxy.searchStudents('a'), (error) => {
    assert.equal(error.status, 400, 'Dashboard 400 phải passthrough status');
    assert.equal(error.message, 'Nhập ít nhất 2 ký tự', 'Dashboard 400 phải passthrough message { loi }');
  });
  console.log('✅ PASSED: searchStudents passthrough + 400 { loi } giữ nguyên.');

  console.log('--- [Test 4] 401 giữa chừng -> login lại 1 lần rồi retry đúng 1 lần ---');
  const loginsBefore401 = loginCount;
  const detailBefore401 = detail2405Calls;
  const recovered = await DashboardProxy.getStudent('24050126');
  assert.deepEqual(recovered, STUDENT_B, 'Sau khi retry phải trả payload thành công');
  assert.equal(detail2405Calls - detailBefore401, 2, 'Detail phải được gọi 2 lần (401 rồi retry)');
  assert.equal(loginCount - loginsBefore401, 1, 'Chỉ login lại đúng 1 lần khi gặp 401');
  console.log('✅ PASSED: 401 giữa chừng tự login lại 1 lần + retry 1 lần.');

  console.log('--- [Test 5] getAttendance passthrough NhatKyDiemDanh ---');
  const attendance = await DashboardProxy.getAttendance('24050126', {
    ma_mon_hoc: 'INF1203',
    ma_nhom: '03',
    nkhk: '20251'
  });
  assert.deepEqual(attendance, ATTENDANCE);
  const attendanceCall = captured.find((entry) => entry.url.includes('/api/sinh-vien/24050126/diem-danh'));
  assert.ok(attendanceCall, 'Phải gọi endpoint điểm danh');
  assert.match(attendanceCall.url, /[?&]ma_mon_hoc=INF1203(?:&|$)/);
  assert.match(attendanceCall.url, /[?&]ma_nhom=03(?:&|$)/);
  assert.match(attendanceCall.url, /[?&]nkhk=20251(?:&|$)/);
  console.log('✅ PASSED: getAttendance forward đúng MSSV + ma_mon_hoc/ma_nhom/nkhk.');

  console.log('--- [Test 6] Dashboard 403 giữ status + message gốc ---');
  await expectRejects(DashboardProxy.getStudent('99999999'), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.message, 'Bạn không có quyền xem sinh viên này');
  });
  console.log('✅ PASSED: 403 passthrough nguyên status + message.');

  console.log('--- [Test 7] fetch throw/timeout -> 503 retryable, KHÔNG lộ mật khẩu ---');
  await expectRejects(DashboardProxy.getStudent('77777777'), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.retryable, true);
    assert.equal(error.message, 'Dịch vụ Dashboard tạm thời không phản hồi. Vui lòng thử lại.');
    assert.equal(
      String(error.message).includes(SERVICE_PASSWORD) || JSON.stringify(error.stack || '').includes(SERVICE_PASSWORD),
      false,
      'Mật khẩu không được xuất hiện trong lỗi ném ra'
    );
  });
  console.log('✅ PASSED: lỗi kết nối Dashboard -> 503 retryable, không lộ mật khẩu.');

  console.log('--- [Test 8] login cookie CHỈ có qua getSetCookie() vẫn đăng nhập được ---');
  loginCookieViaArrayOnly = true;
  const detailBeforeArray = detail5555Calls;
  const loginsBeforeArray = loginCount;
  const recoveredViaArray = await DashboardProxy.getStudent('55555555');
  assert.deepEqual(recoveredViaArray, STUDENT_C, 'getSetCookie() phải được đọc để login + retry thành công');
  assert.equal(detail5555Calls - detailBeforeArray, 2, '401 rồi retry sau khi relogin bằng cookie từ getSetCookie()');
  assert.equal(loginCount - loginsBeforeArray, 1, 'Chỉ login lại 1 lần');
  assert.equal(arrayOnlyLogins, 1, 'Login phải đi qua nhánh response getSetCookie()-only');
  loginCookieViaArrayOnly = false;
  console.log('✅ PASSED: set-cookie chỉ qua getSetCookie() -> login + retry OK.');

  console.log('--- [Test 9] mật khẩu không xuất hiện trong bất kỳ log nào ---');
  const loggedText = consoleCalls.join('\n');
  assert.equal(loggedText.includes(SERVICE_PASSWORD), false, 'Mật khẩu không được ghi log');
  assert.equal(
    captured.some((entry) => entry.url.includes(SERVICE_PASSWORD)),
    false,
    'Mật khẩu không được nằm trong URL'
  );
  console.log('✅ PASSED: không log/URL chứa mật khẩu.');

  console.log('🎉 TẤT CẢ BÀI KIỂM THỬ DASHBOARD PROXY ĐÃ ĐẠT!');
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
