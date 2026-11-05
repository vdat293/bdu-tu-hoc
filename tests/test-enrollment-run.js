import assert from 'node:assert/strict';
import { EnrollmentRunManager, EnrollmentRunService, createBduLimiter } from '../src/modules/enrollment/enrollment-run.service.js';

let clock = 1_000_000;
const now = () => clock;
const sleep = async (ms) => { clock += ms; await new Promise((resolve) => setImmediate(resolve)); };

const waitForStatus = async (manager, runId, mssv, statuses, maxIterations = 3000) => {
  for (let i = 0; i < maxIterations; i += 1) {
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

const makeManager = ({ gateSequence = [true], register = null, gateImpl = null, refresh = null, catalog = null, latestRow = null, login = null, activeRows = null, credentialPassword = null } = {}) => {
  const calls = { register: [], insertRun: [], updateRun: [], refresh: [], notify: [], gate: 0, catalog: 0, login: [], deleteCredential: [], deletePriorities: [], credentials: new Map() };
  const registerImpl = register || (async () => okResponse('RS-' + calls.register.length));
  let gateIndex = 0;
  const service = {
    getGateStatus: async (token) => {
      calls.gate += 1;
      if (gateImpl) return gateImpl(token, calls.gate);
      return gateSequence[Math.min(gateIndex++, gateSequence.length - 1)];
    },
    registerGroup: async (token, args) => {
      calls.register.push({ token, ...args });
      return registerImpl(args, calls.register.length);
    },
    login: async (mssv, password) => {
      calls.login.push({ mssv, password });
      if (login) return login(mssv, password, calls.login.length);
      return { token: 'tok-login', refreshToken: 'ref-login' };
    },
    refreshSession: async (refreshToken) => {
      calls.refresh.push(refreshToken);
      if (refresh) return refresh(refreshToken);
      return { token: 'tok-refreshed', refreshToken };
    }
  };
  if (catalog) {
    service.getCatalog = async () => {
      calls.catalog += 1;
      return { dsNhomTo: typeof catalog === 'function' ? catalog(calls.catalog) : catalog };
    };
  }
  const store = {
    insertRun: async (row) => { calls.insertRun.push(row); },
    insertRunWithCredential: async (row) => {
      calls.insertRun.push({ ...row, password: undefined });
      calls.credentials.set(String(row.id), row.password);
    },
    getRunPassword: async (id) => {
      if (calls.credentials.has(String(id))) return calls.credentials.get(String(id));
      return credentialPassword;
    },
    deleteCredential: async (id) => {
      calls.deleteCredential.push(String(id));
      calls.credentials.delete(String(id));
      return true;
    },
    listActiveRuns: async () => activeRows ?? [],
    deleteOrphanCredentials: async () => 0,
    updateRun: async (id, fields) => { calls.updateRun.push({ id, fields }); },
    getRun: async () => null,
    getLatestRun: async (mssv) => { calls.latestMssv = mssv; return latestRow; },
    listPriorities: async () => [],
    replacePriorities: async () => [],
    deletePrioritiesBySubjects: async (mssv, maMons) => {
      calls.deletePriorities.push({ mssv, maMons });
      return maMons.length;
    }
  };
  const notify = {
    notifyRunDone: async (payload) => { calls.notify.push({ kind: 'done', ...payload }); return true; },
    notifyRunFailed: async (payload) => { calls.notify.push({ kind: 'failed', ...payload }); return true; }
  };
  const manager = new EnrollmentRunManager({ service, store, now, sleep, notify });
  return { manager, calls };
};

console.log('enrollment-run');

await section('a1) start rejects a missing password', async () => {
  const { manager } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  await assert.rejects(
    () => manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt: new Date(clock).toISOString() }),
    (error) => error.status === 400 && /mật khẩu/i.test(error.message)
  );
});

await section('a2) serialize/DB writes never expose the password', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const { run } = await manager.start({
    password: 'super-secret',
    mssv: 'SV001',
    token: 'tok',
    items: [chinhA],
    triggerAt: new Date(clock + 60_000).toISOString()
  });
  const serialized = manager.getForStudent(run.runId, 'SV001');
  assert.ok(!JSON.stringify(serialized).includes('super-secret'));
  manager.stop(run.runId, 'SV001');
  await waitForStatus(manager, run.runId, 'SV001', ['stopped']);
  assert.ok(!JSON.stringify(calls.insertRun).includes('super-secret'), 'insertRun không được chứa mật khẩu');
  assert.ok(!JSON.stringify(calls.updateRun).includes('super-secret'), 'updateRun không được chứa mật khẩu');
});

const startWithPassword = async (overrides = {}) => {
  const made = makeManager({ gateSequence: [true], ...overrides });
  clock = 1_000_000;
  const offsetMs = overrides.offsetMs ?? 10 * 60_000;
  const { run } = await made.manager.start({
    password: 'pw',
    mssv: 'SV001',
    token: 'tok-old',
    items: [chinhA],
    triggerAt: new Date(clock + offsetMs).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed', 'stopped']);
  return { ...made, run, final };
};

await section('a3) logs in 5 minutes before the trigger and uses the new token', async () => {
  const { final, calls } = await startWithPassword();
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.login, [{ mssv: 'SV001', password: 'pw' }]);
  assert.equal(calls.register[0].token, 'tok-login');
});

await section('a4) a wrong password fails the run before the gate opens', async () => {
  const login = async () => { throw Object.assign(new Error('bad'), { status: 401, code: 'INVALID_CREDENTIALS' }); };
  const { final, calls } = await startWithPassword({ login });
  assert.match(String(final.error), /Mật khẩu BDU không đúng/);
  assert.equal(calls.register.length, 0);
});

await section('a5) a transient login failure at T-5 is retried at the trigger time', async () => {
  const loginTimes = [];
  const login = async () => {
    loginTimes.push(clock);
    if (loginTimes.length === 1) throw Object.assign(new Error('offline'), { status: 502 });
    return { token: 'tok-late', refreshToken: '' };
  };
  const { final, calls, run } = await startWithPassword({ login });
  const triggerMs = new Date(run.triggerAt).getTime();
  assert.equal(final.status, 'done');
  assert.equal(calls.login.length, 2);
  assert.equal(calls.register[0].token, 'tok-late');
  assert.ok(loginTimes[1] >= triggerMs, 'lần thử lại phải rơi đúng triggerAt, không phải T-5+5s');
});

await section('a8) a 12-hour wait still logs in at T-5 (success does not burn the budget)', async () => {
  const loginTimes = [];
  const login = async () => {
    loginTimes.push(clock);
    return { token: 'tok-' + loginTimes.length, refreshToken: '' };
  };
  const made = makeManager({ gateSequence: [true], login, refresh: async () => { throw new Error('refresh dead'); } });
  clock = 1_000_000;
  const triggerMs = clock + 12 * 60 * 60_000;
  const { run } = await made.manager.start({
    password: 'pw',
    mssv: 'SV001',
    token: 'tok-old',
    refreshToken: 'ref',
    items: [chinhA],
    triggerAt: new Date(triggerMs).toISOString()
  });
  let final = null;
  for (let i = 0; i < 20_000; i += 1) {
    const status = made.manager.getForStudent(run.runId, 'SV001');
    if (status && ['done', 'failed'].includes(status.status)) { final = status; break; }
    // eslint-disable-next-line no-await-in-loop
    await sleep(5_000);
  }
  assert.ok(final, 'run phải kết thúc sau 12 giờ chờ');
  assert.equal(final.status, 'done');
  assert.ok(
    loginTimes.some((time) => time >= triggerMs - 5 * 60_000 && time <= triggerMs),
    'phải có lần login trong cửa sổ T-5 dù lịch chờ dài'
  );
  assert.equal(made.calls.register[0].token, 'tok-' + loginTimes.length);
});

await section('a6) starting late logs in immediately before polling the gate', async () => {
  const { calls, final } = await startWithPassword({ offsetMs: -10 * 60_000 });
  assert.equal(final.status, 'done');
  assert.equal(calls.login.length, 1);
  assert.equal(calls.register[0].token, 'tok-login');
});

await section('a7) finishRun wipes the password from RAM', async () => {
  const { manager, run } = await startWithPassword({ offsetMs: 1_000 });
  assert.equal(manager.runs.get(run.runId).password, null);
});

await section('a) gate never opens: no register call, run failed after deadline', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['failed']);
  assert.equal(final.status, 'failed');
  assert.equal(calls.register.length, 0, 'cổng chưa mở thì không được bắn request đăng ký');
  assert.ok(String(final.error).includes('Cổng chưa mở'));
});

await section('b) gate opens at 3rd poll: fires in thuTu order and chains idRs', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false, false, true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhB, chinhA], triggerAt });
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
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB, backupA2, backupA3], triggerAt });
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
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, backupA2, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'B-MAIN'], 'dự phòng cùng môn có tiên quyết cũng không được gọi');
  assert.equal(final.summary.that_bai.length, 1);
  assert.match(final.summary.that_bai[0].ly_do, /tiên quyết/i);
});

await section('d2) over-credit failure reports BDU’s cap and skips same-subject fallbacks', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return failResponse('Quá tín chỉ tối đa: 22/ 19');
    if (args.idToHoc === 'B-MAIN') return okResponse('RS-B');
    throw new Error('unexpected ' + args.idToHoc);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, backupA2, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'B-MAIN'], 'vượt tín chỉ thì đổi nhóm cùng môn cũng vô ích');
  assert.equal(final.summary.that_bai.length, 1);
  assert.match(final.summary.that_bai[0].ly_do, /Quá tín chỉ tối đa: 22\/ 19/);
  assert.ok(final.logs.some((entry) => entry.message.includes('Quá tín chỉ tối đa: 22/ 19')), 'log phải nêu rõ lý do vượt tín chỉ');
});

await section('e) refresh failure falls back to a password login', async () => {
  let attempts = 0;
  const login = async () => { attempts += 1; return { token: 'tok-pw', refreshToken: '' }; };
  const register = async (args, count) => {
    if (count === 1) throw Object.assign(new Error('expired'), { status: 401 });
    return okResponse('RS-' + count);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], login, register, refresh: async () => { throw new Error('refresh dead'); } });
  clock = 1_000_000;
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', refreshToken: 'ref', items: [chinhA], triggerAt: new Date(clock + 1_000).toISOString() });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.at(-1).token, 'tok-pw');
});

await section('f2) 412 logs in again and retries the item exactly once', async () => {
  let res412 = 1;
  const register = async () => (res412-- > 0
    ? { httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' }
    : okResponse('RS-ok'));
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt: new Date(clock + 1_000).toISOString() });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.length, 2);
  assert.ok(calls.login.length >= 1);
});

await section('f3) 412 twice fails the item but lets the next subject run (no 5-minute wait)', async () => {
  const register = async (args) => (args.idToHoc === 'A-MAIN'
    ? { httpStatus: 412, code: null, isThanhCong: false, isChoose: false, idRs: '', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: '' }
    : okResponse('RS-B'));
  const { manager } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const started = clock;
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt: new Date(clock + 1_000).toISOString() });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.match(final.summary.that_bai[0].ly_do, /OTP/);
  assert.equal(final.summary.thanh_cong.length, 1);
  assert.ok(clock - started < 60_000);
});

await section('f) transient 5xx retries 3 times then item fails but run continues', async () => {
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return { httpStatus: 503, code: null, isThanhCong: false, isChoose: false, idRs: 'RS-ERR', idToHocXoa: '', thongBaoLoi: '', thongBaoTienQuyet: '', rawMessage: 'Server bận' };
    return okResponse('RS-B');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
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
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, conflictB], triggerAt, autoFixScheduleConflict: true });
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
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, broken], triggerAt, autoFixScheduleConflict: true });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.filter((c) => c.isChecked === false).length, 0, 'TKB không parse được thì không tự rút');
});

await section('h) second start for same mssv reuses the active run', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const first = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const second = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok2', items: [chinhB], triggerAt });
  assert.equal(second.reused, true);
  assert.equal(second.run.runId, first.run.runId);
});

await section('i) serialized run never contains the token', async () => {
  const { manager } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'super-secret-token', items: [chinhA], triggerAt });
  await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  const serialized = manager.getForStudent(run.runId, 'SV001');
  assert.ok(!JSON.stringify(serialized).includes('super-secret-token'), 'token không được rò ra snapshot');
});

await section('j) stop() prevents remaining items from firing', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['stopped', 'done', 'failed']);
  assert.equal(final.status, 'stopped');
  assert.equal(calls.register.length, 0);
});

await section('k) stop() while waiting for the gate ends the run as stopped', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt: new Date(clock + 60_000).toISOString() });
  manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['stopped', 'done', 'failed']);
  assert.equal(final.status, 'stopped');
  assert.equal(calls.register.length, 0);
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
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, conflictB], triggerAt, autoFixScheduleConflict: true });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(calls.register.filter((c) => c.isChecked === false).length, 1, 'vẫn thử rút');
  assert.equal(final.summary.rut.length, 0, 'rút thất bại thì không được ghi như đã rút');
});

await section('n) long wait keeps the token fresh by refreshing proactively', async () => {
  const gateSequence = [...Array(13).fill(false), true];
  const { manager, calls } = makeManager({
    gateSequence,
    login: async () => ({ token: 'tok-refreshed', refreshToken: 'refresh-1' })
  });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 9 * 60 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', refreshToken: 'refresh-1', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed'], 20_000);
  assert.equal(final.status, 'done');
  assert.ok(calls.refresh.length >= 1, 'phải refresh token trong lúc chờ dài');
  assert.equal(calls.register[0].token, 'tok-refreshed', 'đăng ký phải dùng token mới');
});

await section('o) 401 while polling the gate refreshes the session and continues', async () => {
  const gateImpl = (token, count) => {
    if (count === 1) throw Object.assign(new Error('expired'), { status: 401, code: 'AUTH_EXPIRED' });
    return true;
  };
  const { manager, calls } = makeManager({ gateImpl });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', refreshToken: 'refresh-1', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.ok(calls.refresh.length >= 1);
  assert.equal(calls.register[0].token, 'tok-refreshed');
});

await section('p) token expiry without a working refresh or password fails the run and alerts Discord', async () => {
  const gateImpl = () => { throw Object.assign(new Error('expired'), { status: 401, code: 'AUTH_EXPIRED' }); };
  const refresh = async () => { throw new Error('refresh token dead'); };
  const login = async () => { throw Object.assign(new Error('bad password'), { status: 401, code: 'INVALID_CREDENTIALS' }); };
  const { manager, calls } = makeManager({ gateImpl, refresh, login });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', refreshToken: 'refresh-dead', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['failed']);
  assert.equal(final.status, 'failed');
  assert.match(String(final.error), /Mật khẩu BDU không đúng/);
  assert.equal(calls.notify.length, 1, 'phải enqueue cảnh báo Discord');
  assert.equal(calls.notify[0].kind, 'failed');
  assert.equal(calls.notify[0].mssv, 'SV001');
  assert.equal(calls.notify[0].runId, run.runId);
});

await section('q) 401 during a register call refreshes and retries the same item', async () => {
  let attempts = 0;
  const register = async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('expired'), { status: 401, code: 'AUTH_EXPIRED' });
    return okResponse('RS-retry');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', refreshToken: 'refresh-1', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.length, 2);
  assert.equal(calls.register[1].token, 'tok-refreshed');
});

await section('r) a gate that is already open before the scheduled time does not fire early', async () => {
  const registerClock = [];
  const gateClock = [];
  const register = async () => { registerClock.push(clock); return okResponse('RS'); };
  const gateImpl = () => { gateClock.push(clock); return true; };
  const { manager } = makeManager({ gateImpl, register });
  clock = 1_000_000;
  const triggerMs = clock + 60_000;
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt: new Date(triggerMs).toISOString() });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(registerClock.length, 1);
  assert.ok(registerClock[0] >= triggerMs, 'chỉ bắn đăng ký khi đã tới giờ hẹn');
  assert.ok(gateClock.every((t) => t >= triggerMs), 'không poll cổng trước giờ hẹn');
});

await section('s) a completed run notifies Discord with the success summary', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.notify[0].kind, 'done');
  assert.match(calls.notify[0].message, /2 thành công/);
  assert.equal(calls.notify[0].mssv, 'SV001');
  assert.equal(calls.notify[0].runId, run.runId);
});

await section('t) ids saved before the round opened are re-mapped to the current catalog', async () => {
  const catalog = [
    { maMon: 'AAA', nhomTo: '01', lop: '27KT01', idToHoc: 'A-FRESH', tkb: chinhA.tkb },
    { maMon: 'BBB', nhomTo: '02', lop: '27KT99', idToHoc: 'B-FRESH', tkb: chinhB.tkb }
  ];
  const { manager, calls } = makeManager({ gateSequence: [true], catalog });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-FRESH', 'B-FRESH'], 'phải dùng id_to_hoc mới, không dùng id đã lưu');
  assert.ok(final.logs.some((log) => /cấp lại mã lớp/.test(log.message)), 'phải ghi log khi id thay đổi');
  assert.equal(final.summary.thanh_cong.length, 2);
});

await section('u) re-mapping matches mã môn + nhóm tổ even when the class code changes', async () => {
  const catalog = [{ maMon: 'AAA', nhomTo: '01', lop: '27KHAC', idToHoc: 'A-FRESH', tkb: 'lịch khác' }];
  const { manager, calls } = makeManager({ gateSequence: [true], catalog });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register[0].idToHoc, 'A-FRESH');
});

await section('v) a "Warning" rejection refreshes the catalog and retries the item once', async () => {
  const catalog = () => {
    const idToHoc = catalog.calls === 0 ? 'A-MAIN' : 'A-NEW';
    catalog.calls += 1;
    return [{ maMon: 'AAA', nhomTo: '01', lop: '27KT01', idToHoc, tkb: chinhA.tkb }];
  };
  catalog.calls = 0;
  const register = async (args) => {
    if (args.idToHoc === 'A-MAIN') return failResponse('Warning');
    return okResponse('RS-OK');
  };
  const { manager, calls } = makeManager({ gateSequence: [true], catalog, register });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((c) => c.idToHoc), ['A-MAIN', 'A-NEW']);
  assert.equal(final.summary.thanh_cong.length, 1);
});

await section('w) an unmappable "Warning" is reported meaningfully, not as the raw portal text', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true], catalog: [], register: async () => failResponse('Warning') });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register.length, 1, 'không map được thì không retry vô ích');
  assert.match(final.summary.that_bai[0].ly_do, /mã lớp đã đổi/);
});

await section('x) ambiguous nhóm tổ duplicates are left untouched instead of grabbing the wrong tổ', async () => {
  const catalog = [
    { maMon: 'AAA', nhomTo: '01', lop: '27KT01', idToHoc: 'A-TO-1', tkb: 'Thứ 6,tiết 1->5,Ph Z' },
    { maMon: 'AAA', nhomTo: '01', lop: '27KT01', idToHoc: 'A-TO-2', tkb: 'Thứ 6,tiết 6->10,Ph Z' }
  ];
  const { manager, calls } = makeManager({ gateSequence: [true], catalog });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.register[0].idToHoc, 'A-MAIN', 'không đủ căn cứ thì giữ nguyên id đã lưu');
});

await section('y) finishRun persists the log tail and error to the DB row', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, chinhB], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  const stored = calls.updateRun.filter((call) => call.fields.status === 'done').at(-1);
  assert.ok(stored, 'phải ghi trạng thái cuối xuống DB');
  assert.ok(Array.isArray(stored.fields.logs), 'logs phải được lưu');
  assert.ok(stored.fields.logs.some((log) => /✔ AAA/.test(log.message)), 'log phải có kết quả từng môn');
  assert.equal(stored.fields.error, null);
});

await section('z) recordItem logs each subject exactly once (no duplicate log lines)', async () => {
  const { manager } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  const lines = final.logs.filter((log) => /✔ AAA/.test(log.message));
  assert.equal(lines.length, 1, 'mỗi môn chỉ một dòng kết quả');
});

await section('aa) getLatestForStudent prefers the live in-memory run', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  manager.store.getLatestRun = async () => ({ id: run.runId, mssv: 'SV001', status: 'scheduled' });
  const latest = await manager.getLatestForStudent('SV001');
  assert.equal(latest.runId, run.runId);
  assert.equal(latest.status, 'scheduled');
  manager.stop(run.runId, 'SV001');
});

await section('ab) getLatestForStudent hydrates a finished DB-only run', async () => {
  const latestRow = {
    id: 'stored-1',
    mssv: 'SV001',
    status: 'done',
    trigger_at: '2026-11-05T02:00:00.000Z',
    started_at: '2026-11-05T02:00:01.000Z',
    finished_at: '2026-11-05T02:00:09.000Z',
    created_at: '2026-11-04T10:00:00.000Z',
    snapshot: [{ maMon: 'AAA' }],
    summary: { thanh_cong: [{ ma_mon: 'AAA' }], that_bai: [], fallback: [], rut: [] },
    logs: [{ type: 'success', message: '✔ AAA', timestamp: '09:00:02' }],
    error: null
  };
  const { manager } = makeManager({ latestRow });
  const latest = await manager.getLatestForStudent('SV001');
  assert.equal(latest.runId, 'stored-1');
  assert.equal(latest.status, 'done');
  assert.equal(latest.snapshotCount, 1);
  assert.equal(latest.logs.length, 1);
  assert.equal(latest.summary.thanh_cong[0].ma_mon, 'AAA');
});

await section('ac) a DB-only active run is reported as failed after a server restart', async () => {
  const latestRow = {
    id: 'stored-2',
    mssv: 'SV001',
    status: 'running',
    trigger_at: '2026-11-05T02:00:00.000Z',
    started_at: '2026-11-05T02:00:01.000Z',
    finished_at: null,
    created_at: '2026-11-04T10:00:00.000Z',
    snapshot: [],
    summary: null,
    logs: [],
    error: null
  };
  const { manager, calls } = makeManager({ latestRow });
  const latest = await manager.getLatestForStudent('SV001');
  assert.equal(latest.status, 'failed');
  assert.match(latest.error, /khởi động lại/i);
  assert.equal(latest.summary.reason, 'server_restart');
  const write = calls.updateRun.at(-1);
  assert.equal(write.id, 'stored-2');
  assert.equal(write.fields.status, 'failed');
});

await section('ad) legacy rows without logs rebuild them from the summary', async () => {
  const latestRow = {
    id: 'stored-3',
    mssv: 'SV001',
    status: 'done',
    trigger_at: null,
    started_at: null,
    finished_at: '2026-11-05T02:00:09.000Z',
    created_at: '2026-11-04T10:00:00.000Z',
    snapshot: [],
    summary: {
      thanh_cong: [{ ma_mon: 'AAA' }],
      that_bai: [{ ma_mon: 'BBB', ly_do: 'thiếu tiên quyết' }],
      fallback: [],
      rut: []
    },
    logs: [],
    error: null
  };
  const { manager } = makeManager({ latestRow });
  const latest = await manager.getLatestForStudent('SV001');
  assert.equal(latest.logs.length, 2);
  assert.match(latest.logs[0].message, /✔ AAA/);
  assert.match(latest.logs[1].message, /✖ BBB.*tiên quyết/);
});

await section('ae) pressing Auto after the gate window still polls from now and registers', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock - 10 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done', 'bấm muộn nhưng cổng đang mở thì vẫn phải đăng ký');
  assert.equal(calls.register.length, 1);
  assert.ok(calls.gate >= 1, 'phải poll cổng lại từ lúc bắt đầu chạy');
});

await section('af) a late start with a closed gate still waits a fresh window before failing', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock - 10 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'failed');
  assert.ok(calls.gate > 1, 'không được fail ngay khi deadline cũ đã trôi qua');
  assert.equal(calls.register.length, 0);
});

await section('ag) testActiveCredentials reports no active run', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  const result = await manager.testActiveCredentials('SV999');
  assert.deepEqual(result, { active: false });
});

await section('ah) testActiveCredentials tests the stored password and returns a fresh token', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', items: [chinhA], triggerAt });
  const result = await manager.testActiveCredentials('SV001');
  assert.equal(result.active, true);
  assert.equal(result.status, 'active');
  assert.equal(result.token, 'tok-login');
  assert.deepEqual(calls.login.at(-1), { mssv: 'SV001', password: 'pw' });
  assert.equal(manager.runs.get(run.runId).token, 'tok-login');
  manager.stop(run.runId, 'SV001');
});

await section('ai) testActiveCredentials reports inactive on a wrong password', async () => {
  const login = async () => { throw Object.assign(new Error('Sai mật khẩu'), { status: 401, code: 'INVALID_CREDENTIALS' }); };
  const { manager } = makeManager({ gateSequence: [false], login });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'wrong', mssv: 'SV001', token: 'tok-old', items: [chinhA], triggerAt });
  const result = await manager.testActiveCredentials('SV001');
  assert.equal(result.active, true);
  assert.equal(result.status, 'inactive');
  assert.match(result.message, /Sai mật khẩu/);
  manager.stop(run.runId, 'SV001');
});

await section('aj) testActiveCredentials does not re-login while the run is registering', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 60 * 60_000).toISOString();
  const { run } = await manager.start({ password: 'pw', mssv: 'SV001', token: 'tok-old', items: [chinhA], triggerAt });
  manager.runs.get(run.runId).status = 'running';
  const result = await manager.testActiveCredentials('SV001');
  assert.equal(result.status, 'running');
  assert.equal(result.token, 'tok-old');
  assert.equal(calls.login.length, 0, 'đang chạy thì không login lại');
  manager.stop(run.runId, 'SV001');
});

await section('ak) start stores the credential and finish deletes it', async () => {
  const { manager, calls } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const { run } = await manager.start({
    password: 'pw',
    mssv: 'SV001',
    token: 'tok',
    items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString()
  });
  assert.equal(calls.credentials.get(run.runId), 'pw', 'credential phải được lưu khi start');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.ok(calls.deleteCredential.includes(run.runId), 'finish phải xoá credential');
  assert.equal(calls.credentials.has(run.runId), false);
});

const resumeRow = (overrides = {}) => ({
  id: 'run-resume-1',
  mssv: 'SV001',
  status: 'scheduled',
  trigger_at: new Date(clock + 1_000).toISOString(),
  snapshot: [chinhA],
  summary: null,
  logs: [],
  error: null,
  results: [],
  state: {},
  restart_count: 0,
  started_at: null,
  finished_at: null,
  created_at: new Date(clock).toISOString(),
  ...overrides
});

await section('al) resumeActiveRuns restores a scheduled run from DB', async () => {
  clock = 1_000_000;
  const row = resumeRow();
  const { manager, calls } = makeManager({ gateSequence: [true], activeRows: [row] });
  calls.credentials.set(row.id, 'pw');
  await manager.resumeActiveRuns();
  const live = manager.getForStudent(row.id, 'SV001');
  assert.ok(live, 'run phải được nạp lại vào RAM');
  assert.equal(live.status, 'scheduled');
  const final = await waitForStatus(manager, row.id, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(calls.login[0].password, 'pw', 'phải login lại bằng credential đã lưu');
  assert.equal(calls.register[0].idToHoc, 'A-MAIN');
  assert.ok(calls.deleteCredential.includes(row.id));
});

await section('am) resumeActiveRuns continues a running run and skips processed items', async () => {
  clock = 1_000_000;
  const row = resumeRow({
    id: 'run-resume-2',
    status: 'running',
    trigger_at: new Date(clock - 60_000).toISOString(),
    started_at: new Date(clock - 30_000).toISOString(),
    snapshot: [chinhA, chinhB],
    results: [{ maMon: 'AAA', idToHoc: 'A-MAIN', status: 'success' }],
    state: {
      autoFixScheduleConflict: false,
      svNganh: 1,
      summaryAcc: {
        thanh_cong: [{ ma_mon: 'AAA', id_to_hoc: 'A-MAIN' }],
        that_bai: [],
        fallback: [],
        rut: []
      }
    }
  });
  const { manager, calls } = makeManager({ gateSequence: [true], activeRows: [row] });
  calls.credentials.set(row.id, 'pw');
  await manager.resumeActiveRuns();
  const final = await waitForStatus(manager, row.id, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.deepEqual(calls.register.map((call) => call.idToHoc), ['B-MAIN'], 'môn đã xong trước restart phải được bỏ qua');
  assert.equal(calls.login[0].password, 'pw');
});

await section('an) resumeActiveRuns fails a run when the credential is missing', async () => {
  clock = 1_000_000;
  const row = resumeRow({ id: 'run-resume-3' });
  const { manager, calls } = makeManager({ activeRows: [row], credentialPassword: null });
  await manager.resumeActiveRuns();
  assert.equal(manager.getForStudent(row.id, 'SV001'), null);
  const failed = calls.updateRun.find((write) => write.id === row.id && write.fields.status === 'failed');
  assert.ok(failed, 'run thiếu credential phải bị đánh dấu failed');
  assert.match(String(failed.fields.error), /mật khẩu/i);
  assert.ok(calls.deleteCredential.includes(row.id));
});

await section('ao) gate polling is shared by every waiting run instead of per-run', async () => {
  const { manager, calls } = makeManager({ gateSequence: [false, true] });
  clock = 1_000_000;
  const triggerAt = new Date(clock + 1_000).toISOString();
  const started = [];
  for (let i = 0; i < 5; i += 1) {
    const mssv = `SV50${i}`;
    // eslint-disable-next-line no-await-in-loop
    const { run } = await manager.start({ password: 'pw', mssv, token: `tok-${i}`, items: [chinhA], triggerAt });
    started.push({ run, mssv });
  }
  for (const { run, mssv } of started) {
    // eslint-disable-next-line no-await-in-loop
    const final = await waitForStatus(manager, run.runId, mssv, ['done', 'failed']);
    assert.equal(final.status, 'done');
  }
  assert.equal(calls.register.length, 5);
  assert.ok(calls.gate <= 3, `5 run chỉ được dò cổng dùng chung, thực tế ${calls.gate} lần`);
});

await section('ap) BDU limiter caps concurrent requests and keeps FIFO order', async () => {
  const limit = createBduLimiter({ maxConcurrent: 2, minIntervalMs: 0, now: () => 0, sleep: async () => {} });
  const order = [];
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 6 }, (_, index) => limit(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(index);
    active -= 1;
    return index;
  })));
  assert.equal(peak, 2, 'không được có quá 2 request cùng lúc');
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5], 'thứ tự phải là FIFO');
});

await section('singleton export exists', async () => {
  assert.ok(EnrollmentRunService, 'EnrollmentRunService singleton phải tồn tại');
});

await section('w1) seat_full failures carry a machine-readable reason code', async () => {
  const { manager } = makeManager({ register: async () => failResponse('Lớp đã hết chỗ') });
  clock = 1_000_000;
  const { run } = await manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString()
  });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.summary.that_bai[0].code, 'seat_full');
  assert.equal(final.results[0].code, 'seat_full');
});

await section('w2) seatFullSubjects dedupes and ignores other reasons', async () => {
  const { manager } = makeManager();
  const subjects = manager.seatFullSubjects({
    summaryAcc: {
      that_bai: [
        { ma_mon: 'AAA', code: 'seat_full' },
        { ma_mon: 'BBB', code: 'prereq' },
        { ma_mon: 'AAA', code: 'seat_full' }
      ]
    }
  });
  assert.deepEqual(subjects, ['AAA']);
});

await section('w3) a successful run removes the whole subject group', async () => {
  const made = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok',
    items: [chinhA, backupA2],
    triggerAt: new Date(clock + 1_000).toISOString()
  });
  await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  assert.deepEqual(made.calls.deletePriorities.at(-1)?.maMons, ['AAA']);
});

await section('w4) cleanup failure does not fail the run', async () => {
  const made = makeManager({ gateSequence: [true] });
  made.manager.store.deletePrioritiesBySubjects = async () => { throw new Error('db down'); };
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
});

await section('w5) priority_updated is emitted once with removed subjects', async () => {
  const made = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const events = [];
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString()
  });
  made.manager.subscribe(run.runId, (event) => events.push(event));
  await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  const updates = events.filter((event) => event.type === 'priority_updated');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].removedMaMons, ['AAA']);
});

console.log('OK');
