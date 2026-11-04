import assert from 'node:assert/strict';
import { EnrollmentController } from '../src/modules/enrollment/enrollment.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { priorityStore } from '../src/modules/enrollment/priority-store.js';
import { EnrollmentRunService } from '../src/modules/enrollment/enrollment-run.service.js';
import { enrollmentService } from '../src/modules/enrollment/enrollment.service.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalStore = { ...priorityStore };
const originalMgr = { start: EnrollmentRunService.start, stop: EnrollmentRunService.stop, getForStudent: EnrollmentRunService.getForStudent, submitOtp: EnrollmentRunService.submitOtp, hasRun: EnrollmentRunService.hasRun, subscribe: EnrollmentRunService.subscribe };
const originalBdu = {
  getCatalog: enrollmentService.getCatalog,
  getRegistered: enrollmentService.getRegistered,
  registerGroup: enrollmentService.registerGroup
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
  });

  await section('startRun 400 when priority list is empty', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /ưu tiên/i);
  });

  await section('startRun 400 for triggerAt too far in past', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() - 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 400);
  });

  await section('startRun 409 when an active run exists for the student', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
    EnrollmentRunService.start = async () => ({ run: { runId: 'run-1', status: 'running' }, reused: true });
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
    assert.equal(res.statusCode, 409);
  });

  await section('startRun 202 returns runId', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [{ maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1, tkb: 'Thứ 2,tiết 1->3,Ph X,GV G,01/03/27 đến 30/04/27' }];
    EnrollmentRunService.start = async () => ({ run: { runId: 'run-abc', status: 'scheduled' }, reused: false });
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() + 3600_000).toISOString(), autoFixScheduleConflict: true } }), res);
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

  await section('submitOtp 400 for malformed code', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    const res = response();
    await EnrollmentController.submitOtp(reqWith({ params: { id: 'run-1' }, body: { code: '12' } }), res);
    assert.equal(res.statusCode, 400);
  });

  await section('submitOtp 409 when run is not waiting for OTP', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    EnrollmentRunService.submitOtp = async () => { throw Object.assign(new Error('Phiên đăng ký không ở trạng thái chờ OTP.'), { status: 409 }); };
    const res = response();
    await EnrollmentController.submitOtp(reqWith({ params: { id: 'run-1' }, body: { code: '123456' } }), res);
    assert.equal(res.statusCode, 409);
  });

  await section('submitOtp 501 when OTP is not configured yet', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    EnrollmentRunService.submitOtp = async () => { throw Object.assign(new Error('Chức năng OTP chưa được kích hoạt'), { status: 501, code: 'OTP_NOT_CONFIGURED' }); };
    const res = response();
    await EnrollmentController.submitOtp(reqWith({ params: { id: 'run-1' }, body: { code: '123456' } }), res);
    assert.equal(res.statusCode, 501);
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

  await section('getCatalog sets private cache window and returns catalog', async () => {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    enrollmentService.getCatalog = async () => ({ hocKyDangKy: 'HK2', trongThoiGianDangKy: false, dienGiaiEnableChung: 'Ngoài thời gian', dsMonHoc: [], dsNhomTo: [] });
    const res = response();
    await EnrollmentController.getCatalog(reqWith({ query: { loai_loc: '2' } }), res);
    assert.equal(res.headers['Cache-Control'], 'private, max-age=30');
    assert.equal(res.body.data.hocKyDangKy, 'HK2');
  });
} finally {
  restore();
}

console.log('OK');
