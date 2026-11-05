import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EnrollmentController } from '../src/modules/enrollment/enrollment.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { priorityStore } from '../src/modules/enrollment/priority-store.js';
import { EnrollmentRunService } from '../src/modules/enrollment/enrollment-run.service.js';
import { enrollmentService } from '../src/modules/enrollment/enrollment.service.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalStore = { ...priorityStore };
const originalMgr = { start: EnrollmentRunService.start, stop: EnrollmentRunService.stop, getForStudent: EnrollmentRunService.getForStudent, getLatestForStudent: EnrollmentRunService.getLatestForStudent, hasRun: EnrollmentRunService.hasRun, subscribe: EnrollmentRunService.subscribe };
const originalBdu = {
  getCatalog: enrollmentService.getCatalog,
  getRegistered: enrollmentService.getRegistered,
  getFilters: enrollmentService.getFilters,
  registerGroup: enrollmentService.registerGroup,
  getStudentClass: enrollmentService.getStudentClass
};

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    chunks: [],
    flushed: false,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    flushHeaders() { this.flushed = true; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.ended = true; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const reqWith = ({ authorization = 'Bearer tok', params, body, query } = {}) => {
  let closeHandler = null;
  const request = {
    headers: authorization ? { authorization } : {},
    params,
    body,
    query,
    on(event, cb) { if (event === 'close') { closeHandler = cb; if (closeHandler) closeHandler(); } },
    close() { if (closeHandler) closeHandler(); }
  };
  return request;
};

const chinhA = { ma_mon: 'AAA', ten_mon: 'Mon A', id_to_hoc: 'A-MAIN', loai: 'chinh', nhom_to: '01', lop: '27KT01', so_tc: 3 };

const restore = () => {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  Object.assign(priorityStore, originalStore);
  Object.assign(EnrollmentRunService, originalMgr);
  Object.assign(enrollmentService, originalBdu);
};
const section = async (name, fn) => {
  try { await fn(); console.log('  ok -', name); } catch (error) { console.error('  FAIL -', name); throw error; }
};

console.log('enrollment.controller');

try {
  await section('401 when bearer is missing/invalid', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => { throw Object.assign(new Error('Vui lòng đăng nhập'), { status: 401, code: 'AUTH_REQUIRED' }); };
    const res = response();
    await EnrollmentController.getPriority(reqWith({ authorization: '' }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.result, false);
  });

  await section('replacePriority 400 when dự phòng thuộc môn khác môn chính', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    const res = response();
    await EnrollmentController.replacePriority(reqWith({
      body: {
        items: [
          { maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh' },
          { maMon: 'BBB', idToHoc: 'B-BACKUP', loai: 'du_phong' }
        ]
      }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.result, false);
  });

  await section('replacePriority assigns thu_tu by array order and returns saved list', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    enrollmentService.getCatalog = async () => ({
      dsNhomTo: [
        { idToHoc: 'B-MAIN', tkb: 'Thứ 2,tiết 1->3,Ph X,GV G,01/03/27 đến 30/04/27' },
        { idToHoc: 'A-MAIN', tkb: 'Thứ 2,tiết 2->4,Ph X,GV G,01/03/27 đến 30/04/27' }
      ]
    });
    let received = null;
    priorityStore.replacePriorities = async (mssv, items) => {
      received = { mssv, items };
      return items.map((item, index) => ({ ...item, thuTu: index + 1 }));
    };
    const res = response();
    await EnrollmentController.replacePriority(reqWith({
      body: {
        items: [
          { maMon: 'BBB', tenMon: 'Mon B', idToHoc: 'B-MAIN', loai: 'chinh', thuTu: 99 },
          { maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 },
          { maMon: 'BBB', tenMon: 'Mon B', idToHoc: 'B-BACKUP', loai: 'du_phong', thuTu: 50 }
        ]
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(received.items.length, 3);
    assert.equal(received.items[0].idToHoc, 'B-MAIN');
    assert.equal(received.items[1].idToHoc, 'A-MAIN');
    assert.equal(received.items[2].idToHoc, 'B-BACKUP');
    assert.deepEqual(received.items.map((i) => i.thuTu), [1, 2, 3], 'server tự gán thu_tu theo thứ tự mảng, không tin thu_tu client gửi');
    const saved = res.body.data.items;
    assert.deepEqual(saved.map((i) => i.thuTu), [1, 2, 3]);
    assert.deepEqual(saved.map((i) => i.idToHoc), ['B-MAIN', 'A-MAIN', 'B-BACKUP']);
    assert.deepEqual(res.body.data.conflicts, [{
      a: { maMon: 'BBB', tenMon: 'Mon B' },
      b: { maMon: 'AAA', tenMon: 'Mon A' }
    }], 'trả cặp môn chính trùng lịch để UI cảnh báo');
  });

  await section('replacePriority still saves when the catalog lookup fails', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    enrollmentService.getCatalog = async () => { throw new Error('BDU down'); };
    priorityStore.replacePriorities = async (mssv, items) => items.map((item, index) => ({ ...item, thuTu: index + 1 }));
    const res = response();
    await EnrollmentController.replacePriority(reqWith({
      body: { items: [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh' }] }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.conflicts, []);
  });

  await section('startRun 400 when priority list is empty', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /ưu tiên/i);
  });

  await section('startRun 400 for unknown roundId', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', roundId: 'khong_ton_tai' } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Đợt đăng ký/);
  });

  await section('startRun 400 when password is missing', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /mật khẩu/i);
  });

  await section('startRun 400 for triggerAt too far in past', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', triggerAt: new Date(Date.now() - 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 400);
  });

  await section('startRun 409 when an active run exists for the student', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    EnrollmentRunService.start = async () => ({ run: { runId: 'run-1', status: 'running' }, reused: true });
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 409);
  });

  await section('startRun 202 returns runId', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1, tkb: 'Thứ 2,tiết 1->3,Ph X,GV G,01/03/27 đến 30/04/27' }];
    EnrollmentRunService.start = async () => ({ run: { runId: 'run-abc', status: 'scheduled' }, reused: false });
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', triggerAt: new Date(Date.now() + 3600_000).toISOString(), autoFixScheduleConflict: true } }), res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.data.runId, 'run-abc');
  });

  await section('getRun 404 when run belongs to another student', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    EnrollmentRunService.getForStudent = () => null;
    const res = response();
    await EnrollmentController.getRun(reqWith({ params: { id: 'run-x' } }), res);
    assert.equal(res.statusCode, 404);
  });

  await section('stopRun 404 when run belongs to another student', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    EnrollmentRunService.stop = () => null;
    const res = response();
    await EnrollmentController.stopRun(reqWith({ params: { id: 'run-x' } }), res);
    assert.equal(res.statusCode, 404);
  });

  await section('withdraw 400 when id_to_hoc missing', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    const res = response();
    await EnrollmentController.withdraw(reqWith({ body: {} }), res);
    assert.equal(res.statusCode, 400);
  });

  await section('withdraw 502 with original message when BDU rejects', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    enrollmentService.registerGroup = async () => ({ httpStatus: 200, code: 200, isThanhCong: false, rawMessage: 'Ngoài thời gian cho phép đăng ký' });
    const res = response();
    await EnrollmentController.withdraw(reqWith({ body: { id_to_hoc: 'A-MAIN' } }), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.message, /Ngoài thời gian/);
  });

  await section('submitOtp and its route are gone', async () => {
    assert.equal(EnrollmentController.submitOtp, undefined);
    const routes = readFileSync(new URL('../src/routes/enrollment.routes.js', import.meta.url), 'utf8');
    assert.doesNotMatch(routes, /\/otp/);
  });

  await section('streamRunEvents returns 404 for unknown run', async () => {
    EnrollmentRunService.hasRun = () => false;
    const res = response();
    await EnrollmentController.streamRunEvents(reqWith({ params: { id: 'nope' } }), res);
    assert.equal(res.statusCode, 404);
  });

  await section('streamRunEvents sets SSE headers and writes connected banner', async () => {
    EnrollmentRunService.hasRun = () => true;
    EnrollmentRunService.subscribe = (id, listener) => { listener({ type: 'snapshot', run: { runId: id } }); return () => {}; };
    const res = response();
    await EnrollmentController.streamRunEvents(reqWith({ params: { id: 'run-1' } }), res);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.equal(res.headers['Cache-Control'], 'no-cache, no-transform');
    assert.equal(res.flushed, true);
    assert.ok(res.chunks.some((chunk) => chunk.includes(': connected')));
    assert.ok(res.chunks.some((chunk) => chunk.includes('"type":"snapshot"') || chunk.includes('"type": "snapshot"')));
  });

  await section('getEnrollmentSchedule returns the hardcoded semester window for the student cohort', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => '24050126';
    enrollmentService.getStudentClass = async () => '27TH03';
    const res = response();
    await EnrollmentController.getEnrollmentSchedule(reqWith({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.primary.opensAt, '2026-11-05T09:00');
    assert.equal(res.body.data.primary.closesAt, '2026-11-05T20:00');
    assert.equal(res.body.data.cohortYear, 2024);
    assert.equal(res.body.data.studentClass, '27TH03');
  });

  await section('getFilters returns the BDU filter list', async () => {
    enrollmentService.getFilters = async () => [{ value: 10, label: 'Lọc theo môn học', isDefault: true }];
    const res = response();
    await EnrollmentController.getFilters(reqWith({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.filters[0].value, 10);
  });

  await section('getFilters 401 without a bearer token', async () => {
    const res = response();
    await EnrollmentController.getFilters(reqWith({ authorization: '' }), res);
    assert.equal(res.statusCode, 401);
  });

  await section('getCatalog sets private cache window and returns catalog', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    enrollmentService.getCatalog = async () => ({ hocKyDangKy: 'HK2', trongThoiGianDangKy: false, dienGiaiEnableChung: 'Ngoài thời gian', dsMonHoc: [], dsNhomTo: [] });
    const res = response();
    await EnrollmentController.getCatalog(reqWith({ query: { loai_loc: '2' } }), res);
    assert.equal(res.headers['Cache-Control'], 'private, max-age=30');
    assert.equal(res.body.data.hocKyDangKy, 'HK2');
  });

  await section('getLatestRun returns the stored run for the student', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    let asked = null;
    EnrollmentRunService.getLatestForStudent = async (mssv) => {
      asked = mssv;
      return { runId: 'run-latest', status: 'done', logs: [], summary: null };
    };
    const res = response();
    await EnrollmentController.getLatestRun(reqWith({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(asked, 'SV001', 'phải đọc theo mssv resolve từ token, không tin client');
    assert.equal(res.body.data.runId, 'run-latest');
  });

  await section('getLatestRun 404 when the student has no run yet', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    EnrollmentRunService.getLatestForStudent = async () => null;
    const res = response();
    await EnrollmentController.getLatestRun(reqWith({}), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.result, false);
  });

  await section('checkSession reports a live token and the gate state', async () => {
    enrollmentService.getCatalog = async () => ({ trongThoiGianDangKy: true, hocKyDangKy: 'HK2 2026-2027' });
    const res = response();
    await EnrollmentController.checkSession(reqWith({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.alive, true);
    assert.equal(res.body.data.gateOpen, true);
    assert.equal(res.body.data.hocKy, 'HK2 2026-2027');
  });

  await section('checkSession 401 when BDU rejects the token', async () => {
    enrollmentService.getCatalog = async () => { throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'), { status: 401, code: 'AUTH_EXPIRED' }); };
    const res = response();
    await EnrollmentController.checkSession(reqWith({}), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'AUTH_EXPIRED');
  });
} finally {
  restore();
}

console.log('OK');
