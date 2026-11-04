import assert from 'node:assert/strict';
import { EnrollmentRunManager, EnrollmentRunService } from '../src/modules/enrollment/enrollment-run.service.js';

let clock = 1_000_000;
const now = () => clock;
const sleep = async (ms) => { clock += ms; await new Promise((resolve) => setImmediate(resolve)); };

const waitForStatus = async (manager, runId, mssv, statuses) => {
  for (let i = 0; i < 3000; i += 1) {
    const serialized = manager.getForStudent(runId, mssv);
    if (serialized && statuses.includes(serialized.status)) return serialized;
    await sleep(500);
  }
  return manager.getForStudent(runId, mssv);
};

const chinhA = { maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-MAIN', nhomTo: '01', lop: '27KT01', loai: 'chinh', thuTu: 1, tkb: 'Thứ 2,tiết 1->3,Ph X,GV G,01/03/27 đến 30/04/27' };
const chinhB = { maMon: 'BBB', tenMon: 'Mon B', idToHoc: 'B-MAIN', nhomTo: '02', lop: '27KT02', loai: 'chinh', thuTu: 2, tkb: 'Thứ 3,tiết 4->6,Ph Y,GV G,01/03/27 đến 30/04/27' };
const conflictB = { ...chinhB, thuTu: 2, tkb: 'Thứ 2,tiết 1->3,Ph Y,GV G,01/03/27 đến 30/04/27' };
const backupA2 = { maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-BACKUP-2', nhomTo: '02', lop: '27KT01', loai: 'du_phong', thuTu: 3, tkb: 'Thứ 4,tiết 1->3,Ph Z,GV G,01/03/27 đến 30/04/27' };
const backupA3 = { maMon: 'AAA', tenMon: 'Mon A', idToHoc: 'A-BACKUP-3', nhomTo: '03', lop: '27KT01', loai: 'du_phong', thuTu: 4, tkb: 'Thứ 5,tiết 1->3,Ph W,GV G,01/03/27 đến 30/04/27' };

const okResponse = (idRs) => ({
  httpStatus: 200,
  code: 200,
  isThanhCong: true,
  isChoose: false,
  idRs,
  idToHocXoa: '',
  thongBaoLoi: '',
  thongBaoTienQuyet: '',
  rawMessage: 'Đăng ký thành công'
});

const failResponse = (thongBaoLoi, message = thongBaoLoi) => ({
  httpStatus: 200,
  code: 200,
  isThanhCong: false,
  isChoose: false,
  idRs: 'RS-FAIL',
  idToHocXoa: '',
  thongBaoLoi,
  thongBaoTienQuyet: '',
  rawMessage: message
});

const section = async (name, fn) => {
  try {
    await fn();
    console.log('  ok -', name);
  } catch (error) {
    console.error('  FAIL -', name);
    throw error;
  }
};

const makeManager = ({ gateSequence = [true], register = null } = {}) => {
  const calls = { register: [], insertRun: [], updateRun: [] };
  const registerImpl = register || (async () => okResponse('RS-' + calls.register.length));
  let gateIndex = 0;
  const service = {
    getGateStatus: async () => gateSequence[Math.min(gateIndex++, gateSequence.length - 1)],
    registerGroup: async (token, args) => {
      calls.register.push(args);
      return registerImpl(args, calls.register.length);
    },
    verifyOtp: async (token, code) => ({ ok: code === '123456' })
  };
  const store = {
    insertRun: async (row) => { calls.insertRun.push(row); },
    updateRun: async (id, fields) => { calls.updateRun.push({ id, fields }); },
    getRun: async () => null,
    listPriorities: async () => [],
    replacePriorities: async () => []
  };
  const manager = new EnrollmentRunManager({ service, store, now, sleep });
  return { manager, calls };
};

console.log('enrollment-run');

await section('a) gate never opens: no register call, run failed after deadline', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['failed']);
  assert.equal(final.status, 'failed');
  assert.equal(calls.register.length, 0, 'cổng chưa mở thì không được bắn request đăng ký');
  assert.ok(String(final.error).includes('Cổng chưa mở'));
});

await section('b) gate opens at 3rd poll: fires in thuTu order and chains idRs', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false, false, true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhB, chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.length, 2);
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'B-MAIN'], 'phải bắn theo thu_tu, không theo thứ tự mảng truyền vào');
  assert.equal(calls.register[0].idRs, '', 'request đầu tiên chain từ id_rs rỗng');
  assert.equal(calls.register[1].idRs, 'RS-1', 'request sau chain id_rs của response trước');
});

await section('c) seat_full on main: fallback same mon fired, other mon never touched', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return failResponse('Đã hết chỉ tiêu');
    if (args.idToHoc === 'A-BACKUP-2') return failResponse('Đã hết chỉ tiêu');
    if (args.idToHoc === 'A-BACKUP-3') return okResponse('RS-A3');
    if (args.idToHoc === 'B-MAIN') return okResponse('RS-B');
    throw new Error('unexpected ' + args.idToHoc);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, chinhB, backupA2, backupA3], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'A-BACKUP-2', 'A-BACKUP-3', 'B-MAIN']);
  assert.ok(final.summary.thanh_cong.some((s) => (s.id_to_hoc ?? s.idToHoc) === 'A-BACKUP-3'), 'dự phòng A-BACKUP-3 phải được đăng ký thành công');
  assert.ok(final.summary.fallback.some((f) => (f.sang_id_to_hoc ?? f.sangIdToHoc) === 'A-BACKUP-3'));
});

await section('d) prereq failure stops that subject but lets other subjects through', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return failResponse('Không đủ điều kiện tiên quyết');
    if (args.idToHoc === 'B-MAIN') return okResponse('RS-B');
    throw new Error('unexpected ' + args.idToHoc);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, backupA2, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'B-MAIN'], 'dự phòng cùng môn có tiên quyết cũng không được gọi');
  assert.equal(final.summary.that_bai.length, 1);
  assert.match(final.summary.that_bai[0].ly_do, /tiên quyết/i);
});

await section('e) 412 -> otp_required; wrong OTP 5 times -> failed; pending item not re-issued', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN' && args.idRs === '') {
      return { httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' };
    }
    return okResponse('RS-A');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const waiting = await waitForStatus(manager, run.runId, 'SV001', ['otp_required']);
  assert.equal(waiting.status, 'otp_required');

  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await manager.submitOtp(run.runId, 'SV001', '000000');
    assert.equal(result.ok, false);
  }
  const final = await waitForStatus(manager, run.runId, 'SV001', ['failed']);
  assert.equal(final.status, 'failed');
  assert.equal(calls.register.length, 1, 'item đang dở không được bắn lại sau khi OTP thất bại');
});

await section('e2) 412 -> correct OTP resumes the pending item exactly once', async () => {
  const state = { otpOk: false };
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN' && !state.otpOk) {
      return { httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' };
    }
    return okResponse('RS-A');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  manager.service.verifyOtp = async (token, code) => {
    if (code === '123456') state.otpOk = true;
    return { ok: code === '123456' };
  };
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  await waitForStatus(manager, run.runId, 'SV001', ['otp_required']);
  const result = await manager.submitOtp(run.runId, 'SV001', '123456');
  assert.equal(result.ok, true);
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.length, 2, 'item dở phải được re-issue sau khi OTP đúng');
  assert.equal(calls.register[1].idToHoc, 'A-MAIN');
});

await section('f) transient 5xx retries 3 times then item fails but run continues', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return { httpStatus: 503, code: null, isThanhCong: false, isChoose: false, idRs: 'RS-ERR', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: 'Server bận' };
    return okResponse('RS-B');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.filter((c) => c.idToHoc === 'A-MAIN').length, 4, '1 lần gọi + 3 retry');
  assert.equal(calls.register.filter((c) => c.idToHoc === 'B-MAIN').length, 1, 'môn kế tiếp vẫn phải được bắn');
  assert.equal(final.summary.that_bai.length, 1);
});

await section('g) autoFixScheduleConflict withdraws the lower-priority overlapping subject', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true], register: async (args) => okResponse('RS-' + args.idToHoc) });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, conflictB], triggerAt, autoFixScheduleConflict: true });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  const withdraws = calls.register.filter((c) => c.isChecked === false);
  assert.equal(withdraws.length, 1, 'phải tự rút đúng 1 môn bị trùng lịch');
  assert.equal(withdraws[0].idToHoc, 'B-MAIN', 'môn ưu tiên thấp hơn (thu_tu lớn hơn) bị rút');
  assert.ok(final.summary.rut.some((r) => (r.id_to_hoc ?? r.idToHoc) === 'B-MAIN'));
});

await section('g2) autoFixScheduleConflict skips pairs whose TKB cannot be parsed', async () => {
  const broken = { ...conflictB, tkb: 'không đọc được lịch' };
  const { manager, calls } = makeManager({ gateSequence: [true], register: async (args) => okResponse('RS-' + args.idToHoc) });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, broken], triggerAt, autoFixScheduleConflict: true });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.filter((c) => c.isChecked === false).length, 0, 'TKB không parse được thì không tự rút');
});

await section('h) second start for same mssv reuses the active run', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const first = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const second = await manager.start({ mssv: 'SV001', token: 'tok2', items: [chinhB], triggerAt });
  assert.equal(second.reused, true);
  assert.equal(second.run.runId, first.run.runId);
});

await section('i) serialized run never contains the token', async () => {
  const { manager } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'super-secret-token', items: [chinhA], triggerAt });
  await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  const serialized = manager.getForStudent(run.runId, 'SV001');
  assert.ok(!JSON.stringify(serialized).includes('super-secret-token'), 'token không được rò ra snapshot');
});

await section('j) stop() prevents remaining items from firing', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['stopped', 'done', 'failed']);
  assert.equal(final.status, 'stopped');
  assert.equal(calls.register.length, 0);
});

await section('k) stop() while waiting for OTP ends the run as stopped, not failed', async () => {
  const register = async () => ({ httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' });
  const { manager } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  await waitForStatus(manager, run.runId, 'SV001', ['otp_required']);
  manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['stopped', 'failed']);
  assert.equal(final.status, 'stopped');
});

await section('l) 412 during a fallback attempt fails the run with OTP context instead of "hết chỗ"', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return failResponse('Đã hết chỉ tiêu');
    if (args.idToHoc === 'A-BACKUP-2') {
      return { httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' };
    }
    return okResponse('RS-B');
  };
  const { manager } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, backupA2], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'failed');
  assert.match(String(final.error), /OTP/i);
});

await section('m) autoFix only records withdrawn courses when BDU confirms the withdraw', async () => {
  const register = async (args) => {
    if (args.isChecked === false) {
      return { httpStatus: 200, code: 200, isThanhCong: false, isChoose: false, idRs: 'RS-W', idToHocXoa: '', thongBaoLoi: 'Không thể rút', thongBaoTienQuyet: '', rawMessage: 'Không thể rút' };
    }
    return okResponse('RS-' + args.idToHoc);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA, conflictB], triggerAt, autoFixScheduleConflict: true });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(calls.register.filter((c) => c.isChecked === false).length, 1, 'vẫn thử rút');
  assert.equal(final.summary.rut.length, 0, 'rút thất bại thì không được ghi như đã rút');
});

await section('singleton export exists', async () => {
  assert.ok(EnrollmentRunService, 'EnrollmentRunService singleton phải tồn tại');
});

console.log('OK');
