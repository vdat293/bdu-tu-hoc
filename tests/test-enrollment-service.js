import assert from 'node:assert/strict';
import { EnrollmentService, EnrollmentBduError, classifyRegisterResult } from '../src/modules/enrollment/enrollment.service.js';

const BASE = 'https://sv.bdu.edu.vn/public/api';
const TOKEN = 'test-token';

const catalogRaw = {
  hoc_ky_dang_ky: 'Học kỳ 2 - Năm học 2026 - 2027',
  trong_thoi_gian_dang_ky: false,
  dien_giai_enable_chung: 'Ngoài thời gian cho phép đăng ký',
  data: {
    hoc_ky_dang_ky: 'Học kỳ 2 - Năm học 2026 - 2027',
    trong_thoi_gian_dang_ky: false,
    dien_giai_enable_chung: 'Ngoài thời gian cho phép đăng ký',
    ds_mon_hoc: [{ ma: 'INF1383', ten: 'Tin học cơ sở' }],
    ds_nhom_to: [
      {
        id_to_hoc: '-4995667586224615747',
        ma_mon: 'ACT0032',
        ten_mon: 'Tin học chuyên ngành 2',
        nhom_to: '01',
        to: '',
        lop: '27KT01',
        so_tc: '2',
        so_tc_so: 2,
        sl_cp: 60,
        sl_cl: 42,
        tkb: 'Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27',
        enable: false,
        gc_enable: 'Ngoài thời gian cho phép đăng ký',
        is_ctdt: true,
        is_chctdt: false,
        is_rot: true,
        ds_lop: ['27KT01', '27TH03']
      }
    ]
  }
};

function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  };
}

function createFetchMock(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const key = `${options.method || 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error('Unexpected request: ' + key);
    const value = typeof handler === 'function' ? handler(options) : handler;
    return jsonResponse(value.body ?? value, value.status ?? 200);
  };
  return { calls, fetchImpl };
}

const catalogKey = `POST ${BASE}/dkmh/w-locdsnhomto`;

const section = async (name, fn) => {
  try { await fn(); console.log('  ok -', name); } catch (error) { console.error('  FAIL -', name); throw error; }
};

console.log('enrollment.service');

await section('getCatalog posts the official envelope and normalizes ds_mon_hoc/ds_nhom_to', async () => {
  const { calls, fetchImpl } = createFetchMock({ [catalogKey]: catalogRaw });
  const service = new EnrollmentService({ fetchImpl });
  const catalog = await service.getCatalog(TOKEN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/dkmh/w-locdsnhomto`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].options.headers.idpc, '0');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.is_CVHT, false);
  assert.deepEqual(body.additional.paging, { limit: 99999, page: 1 });
  assert.equal(catalog.hocKyDangKy, 'Học kỳ 2 - Năm học 2026 - 2027');
  assert.equal(catalog.trongThoiGianDangKy, false);
  assert.equal(catalog.dsMonHoc[0].ma, 'INF1383');
  const g = catalog.dsNhomTo[0];
  assert.equal(g.idToHoc, '-4995667586224615747');
  assert.equal(g.maMon, 'ACT0032');
  assert.equal(g.nhomTo, '01');
  assert.equal(g.slCp, 60);
  assert.equal(g.slCl, 42);
  assert.equal(g.soTc, 2);
  assert.equal(g.enable, false);
  assert.equal(g.gcEnable, 'Ngoài thời gian cho phép đăng ký');
  assert.equal(g.isCtdt, true);
  assert.equal(g.isChctdt, false);
  assert.equal(g.isRot, true);
  assert.deepEqual(g.dsLop, ['27KT01', '27TH03']);
});

await section('getStudentClass reads lop from the student profile', async () => {
  const profileKey = `POST ${BASE}/dkmh/w-locsinhvieninfo`;
  const { calls, fetchImpl } = createFetchMock({
    [profileKey]: { code: 200, data: [{ lop: '27TH03', ten_lop: 'CNTT' }] }
  });
  const service = new EnrollmentService({ fetchImpl });
  assert.equal(await service.getStudentClass(TOKEN), '27TH03');
  assert.equal(calls[0].url, `${BASE}/dkmh/w-locsinhvieninfo`);
});

await section('getStudentClass returns empty string when the profile call fails', async () => {
  const service = new EnrollmentService({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await service.getStudentClass(TOKEN), '');
  assert.equal(await service.getStudentClass(''), '');
});

await section('getCatalog backfills ten_mon from ds_mon_hoc when the API leaves it empty', async () => {
  const withNames = {
    ...catalogRaw,
    data: {
      ...catalogRaw.data,
      ds_mon_hoc: [{ ma: 'ACT0032', ten: 'Tin học chuyên ngành 2' }],
      ds_nhom_to: catalogRaw.data.ds_nhom_to.map((g) => ({ ...g, ten_mon: '' }))
    }
  };
  const { fetchImpl } = createFetchMock({ [catalogKey]: withNames });
  const service = new EnrollmentService({ fetchImpl });
  const catalog = await service.getCatalog(TOKEN);
  assert.equal(catalog.dsNhomTo[0].tenMon, 'Tin học chuyên ngành 2');
});

await section('getCatalog caches per (token, loaiLoc) for catalogTtlMs', async () => {
  const { calls, fetchImpl } = createFetchMock({ [catalogKey]: catalogRaw });
  const service = new EnrollmentService({ fetchImpl, catalogTtlMs: 60_000 });
  await service.getCatalog(TOKEN, { loaiLoc: 2 });
  await service.getCatalog(TOKEN, { loaiLoc: 2 });
  assert.equal(calls.length, 1, 'lần gọi thứ 2 phải dùng cache');
  await service.getCatalog(TOKEN, { loaiLoc: 6 });
  assert.equal(calls.length, 2, 'loaiLoc khác phải fetch lại');
});

await section('getCatalog forceRefresh bypasses the cache', async () => {
  const { calls, fetchImpl } = createFetchMock({ [catalogKey]: catalogRaw });
  const service = new EnrollmentService({ fetchImpl });
  await service.getCatalog(TOKEN, { forceRefresh: true });
  await service.getCatalog(TOKEN, { forceRefresh: true });
  assert.equal(calls.length, 2);
});

await section('getCatalog caps the per-token cache instead of leaking one entry per session', async () => {
  const { calls, fetchImpl } = createFetchMock({ [catalogKey]: catalogRaw });
  const service = new EnrollmentService({ fetchImpl, catalogTtlMs: 60_000 });
  for (let i = 0; i < 25; i += 1) {
    await service.getCatalog(`token-${i}`);
  }
  assert.equal(calls.length, 25, 'mỗi token mới phải fetch một lần');
  await service.getCatalog('token-24');
  assert.equal(calls.length, 25, 'token vừa dùng vẫn còn trong cache');
  await service.getCatalog('token-0');
  assert.equal(calls.length, 26, 'token cũ nhất phải bị đẩy khỏi cache để tránh phình bộ nhớ');
});

await section('getGateStatus reflects trong_thoi_gian_dang_ky', async () => {
  const openCatalog = { ...catalogRaw, data: { ...catalogRaw.data, trong_thoi_gian_dang_ky: true } };
  const { fetchImpl } = createFetchMock({ [catalogKey]: openCatalog });
  const service = new EnrollmentService({ fetchImpl });
  assert.equal(await service.getGateStatus(TOKEN), true);

  const closed = createFetchMock({ [catalogKey]: catalogRaw });
  const service2 = new EnrollmentService({ fetchImpl: closed.fetchImpl });
  assert.equal(await service2.getGateStatus(TOKEN), false);
});

await section('getRegistered posts the official body and normalizes', async () => {
  const registeredRaw = {
    code: 200,
    result: true,
    data: { so_tin_chi_min: 6, ds_kqdkmh: [{ id_kqdk: '1', to_hoc: { ma_mon: 'INF1383' } }] }
  };
  const { calls, fetchImpl } = createFetchMock({ [`POST ${BASE}/dkmh/w-locdskqdkmhsinhvien`]: registeredRaw });
  const service = new EnrollmentService({ fetchImpl });
  const result = await service.getRegistered(TOKEN);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, { is_CVHT: false, is_Clear: false });
  assert.equal(result.soTinChiMin, 6);
  assert.equal(result.dsKqdkmh.length, 1);
});

await section('registerGroup posts the official filter body and normalizes the response', async () => {
  const apiRaw = {
    code: 200,
    result: true,
    message: 'Đăng ký thành công',
    data: { is_thanh_cong: true, is_choose: false, id_rs: 'RS-1', id_to_hoc_xoa: '', thong_bao_loi: '', thong_bao_tien_quyet: '' }
  };
  const { calls, fetchImpl } = createFetchMock({ [`POST ${BASE}/dkmh/w-xulydkmhsinhvien`]: apiRaw });
  const service = new EnrollmentService({ fetchImpl });
  const result = await service.registerGroup(TOKEN, { idToHoc: '-499', isChecked: true, idRs: 'RS-0' });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    filter: { id_to_hoc: '-499', is_checked: true, sv_nganh: 1, id_rs: 'RS-0' }
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.code, 200);
  assert.equal(result.isThanhCong, true);
  assert.equal(result.idRs, 'RS-1');
  assert.equal(result.rawMessage, 'Đăng ký thành công');
});

await section('registerGroup isChecked:false performs a withdraw', async () => {
  const apiRaw = { code: 200, result: true, data: { is_thanh_cong: true, id_rs: 'RS-2', id_to_hoc_xoa: '-499' } };
  const { calls, fetchImpl } = createFetchMock({ [`POST ${BASE}/dkmh/w-xulydkmhsinhvien`]: apiRaw });
  const service = new EnrollmentService({ fetchImpl });
  await service.registerGroup(TOKEN, { idToHoc: '-499', isChecked: false, idRs: 'RS-1' });
  assert.equal(JSON.parse(calls[0].options.body).filter.is_checked, false);
});

await section('fetchServerTime parses ISO string', async () => {
  const { fetchImpl } = createFetchMock({ [`GET ${BASE}/hsba/w-gettimeserver`]: { raw: '2026-11-04T10:00:00+07:00' } });
  // route handler nhận options; trả text ISO thay vì JSON
  const service = new EnrollmentService({ fetchImpl: async (url, options) => {
    assert.equal(url, `${BASE}/hsba/w-gettimeserver`);
    return { status: 200, ok: true, async json() { return '2026-11-04T10:00:00+07:00'; }, async text() { return '2026-11-04T10:00:00+07:00'; } };
  } });
  const time = await service.fetchServerTime();
  assert.ok(time instanceof Date);
  assert.equal(time.toISOString(), '2026-11-04T03:00:00.000Z');
  void fetchImpl;
});

await section('fetchServerTime parses epoch seconds and milliseconds', async () => {
  for (const [raw, expected] of [
    [Math.floor(Date.UTC(2025, 10, 4) / 1000), Date.UTC(2025, 10, 4)],
    [Date.UTC(2025, 10, 4), Date.UTC(2025, 10, 4)]
  ]) {
    const service = new EnrollmentService({ fetchImpl: async () => ({ status: 200, ok: true, async json() { return raw; }, async text() { return String(raw); } }) });
    const time = await service.fetchServerTime();
    assert.equal(time.getTime(), expected);
  }
});

await section('fetchServerTime parses nested { data: { time } } payloads', async () => {
  const payload = { data: { serverTime: '2026-11-04T10:00:00+07:00' } };
  const service = new EnrollmentService({ fetchImpl: async () => ({ status: 200, ok: true, async json() { return payload; }, async text() { return JSON.stringify(payload); } }) });
  const time = await service.fetchServerTime();
  assert.ok(time instanceof Date);
});

await section('fetchServerTime returns null on garbage instead of throwing', async () => {
  const service = new EnrollmentService({ fetchImpl: async () => ({ status: 200, ok: true, async json() { return { hello: 'world' }; }, async text() { return '{"hello":"world"}'; } }) });
  assert.equal(await service.fetchServerTime(), null);
});

await section('network errors raise EnrollmentBduError', async () => {
  const service = new EnrollmentService({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(() => service.getCatalog(TOKEN), (error) => {
    assert.ok(error instanceof EnrollmentBduError);
    assert.equal(error.status, 502);
    return true;
  });
});

await section('refreshSession exchanges a refresh token for a fresh access token', async () => {
  const calls = [];
  const service = new EnrollmentService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = new URLSearchParams(String(options.body || ''));
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-abc');
      return {
        status: 200,
        ok: true,
        async json() { return { access_token: 'new-token', refresh_token: 'refresh-new', expires_in: 17999 }; },
        async text() { return '{}'; }
      };
    }
  });
  const next = await service.refreshSession('refresh-abc');
  assert.equal(calls[0].url, `${BASE}/auth/login`);
  assert.equal(next.token, 'new-token');
  assert.equal(next.refreshToken, 'refresh-new');
});

await section('refreshSession rejects when BDU refuses the refresh token', async () => {
  const service = new EnrollmentService({
    fetchImpl: async () => ({ status: 400, ok: false, async json() { return { error: 'invalid_grant' }; }, async text() { return '{}'; } })
  });
  await assert.rejects(() => service.refreshSession('dead-refresh'), (error) => {
    assert.equal(error.status, 401);
    return true;
  });
});

await section('login exchanges MSSV + password for a token', async () => {
  const { calls, fetchImpl } = createFetchMock({
    [`POST ${BASE}/auth/login`]: { access_token: 'tok-new', refresh_token: 'ref-new' }
  });
  const result = await new EnrollmentService({ fetchImpl }).login('24050126', 'secret');
  assert.deepEqual(result, { token: 'tok-new', refreshToken: 'ref-new' });
  assert.equal(calls[0].url, `${BASE}/auth/login`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('grant_type'), 'password');
  assert.equal(body.get('username'), '24050126');
  assert.equal(body.get('password'), 'secret');
});

await section('login maps a rejected password to 401 INVALID_CREDENTIALS', async () => {
  const { fetchImpl } = createFetchMock({
    [`POST ${BASE}/auth/login`]: { body: { message: 'Sai mật khẩu' }, status: 400 }
  });
  await assert.rejects(() => new EnrollmentService({ fetchImpl }).login('24050126', 'wrong'), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.message, 'Sai mật khẩu');
    return true;
  });
});

await section('login maps a network failure to 502 BDU_UNREACHABLE', async () => {
  const service = new EnrollmentService({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(() => service.login('24050126', 'secret'), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, 'BDU_UNREACHABLE');
    return true;
  });
});

const classify = (body, status = 200) => classifyRegisterResult({
  httpStatus: status,
  code: body?.code ?? null,
  isThanhCong: body?.data?.is_thanh_cong === true,
  isChoose: body?.data?.is_choose === true,
  idRs: body?.data?.id_rs ?? '',
  idToHocXoa: body?.data?.id_to_hoc_xoa ?? '',
  thongBaoLoi: body?.data?.thong_bao_loi ?? '',
  thongBaoTienQuyet: body?.data?.thong_bao_tien_quyet ?? '',
  rawMessage: body?.message ?? body?.data?.thong_bao_loi ?? ''
});

const cases = [
  ['412 → otp', classify({}, 412), 'otp'],
  ['401 → auth', classify({}, 401), 'auth'],
  ['426 → auth', classify({}, 426), 'auth'],
  ['429 → rate_limit', classify({}, 429), 'rate_limit'],
  ['503 → transient', classify({}, 503), 'transient'],
  ['500 → transient', classify({}, 500), 'transient'],
  ['Ngoài thời gian → gate_closed', classify({ code: 200, message: 'Ngoài thời gian cho phép đăng ký' }), 'gate_closed'],
  ['hết chỉ tiêu → seat_full', classify({ code: 200, data: { is_thanh_cong: false, thong_bao_loi: 'Đã hết chỉ tiêu tuyển' } }), 'seat_full'],
  ['tiên quyết → prereq', classify({ code: 200, data: { is_thanh_cong: false, thong_bao_loi: 'Không đủ điều kiện tiên quyết' } }), 'prereq'],
  ['vi phạm học trước → prereq', classify({ code: 200, data: { is_thanh_cong: false, thong_bao_loi: 'Vi phạm học trước:  INF1063' } }), 'prereq'],
  ['trùng thời khóa biểu → schedule_conflict', classify({ code: 200, data: { is_thanh_cong: false, thong_bao_loi: 'Trùng thời khóa biểu' } }), 'schedule_conflict'],
  ['unknown → rejected', classify({ code: 200, data: { is_thanh_cong: false, thong_bao_loi: 'Lỗi khó hiểu' } }), 'rejected'],
  ['code != 200 → rejected', classify({ code: 999, message: 'x' }), 'rejected'],
  ['is_thanh_cong=true → thanh_cong', classify({ code: 200, data: { is_thanh_cong: true } }), 'thanh_cong']
];
for (const [name, actual, expected] of cases) {
  assert.equal(actual, expected, name);
}
console.log('  ok - classifyRegisterResult (' + cases.length + ' cases)');

console.log('OK');
