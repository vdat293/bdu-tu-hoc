# Thay OTP bằng MSSV + mật khẩu (tự đăng nhập lại trước giờ mở) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bỏ OTP, cho người dùng nhập MSSV + mật khẩu khi Kích hoạt Auto; server giữ mật khẩu trong RAM, tự đăng nhập lại trước giờ mở 5 phút và tự xoá khi run kết thúc.

**Architecture:** Thêm `EnrollmentService.login` (password grant); `POST /api/enrollment/runs` nhận thêm `password`; `EnrollmentRunManager` giữ `password` trong object run (RAM), login ở `triggerAt − 5 phút` hoặc ngay khi bắt đầu muộn, dùng làm fallback khi refresh/401, thay nhánh 412 bằng login + retry 1 lần, và wipe ở `finishRun`. Client thay modal OTP bằng modal MSSV + mật khẩu.

**Tech Stack:** Node 22 ESM, Express, React 19, Vite, Vitest, node:test-style script tests.

**Spec:** `docs/superpowers/specs/2026-11-05-enrollment-password-relogin-design.md`

## Global Constraints

- Mật khẩu **chỉ RAM**: không DB, không migration, không log, không SSE, không `serialize()`, không response, không localStorage/sessionStorage/cookie.
- Mật khẩu dài 1–200 ký tự sau `trim`; thiếu → HTTP 400.
- Login bằng mật khẩu tối đa **3 lần/run** (`MAX_LOGIN_ATTEMPTS = 3`).
- Login lại đúng `LOGIN_LEAD_MS = 5 * 60 * 1000` trước `triggerAt`; bắt đầu muộn hơn mốc thì login ngay trước khi poll cổng.
- Sai mật khẩu (login trả 401) → run `failed` với `Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.`
- 412 → thử login + đăng ký lại **1 lần**, vẫn 412 → môn đó `failed` với `BDU yêu cầu OTP — không thể tự xử lý, vui lòng đăng ký thủ công`.
- Xoá OTP khỏi hệ thống: modal, `submitOtp`, route `/runs/:id/otp`, `OtpUnavailableError`, `verifyOtp`, env `ENROLLMENT_OTP_VERIFY_URL`, trạng thái `otp_required`.
- Giữ nguyên: re-map `id_to_hoc`, cửa sổ canh cổng tính từ `max(triggerAt, now)`, Discord notify, khôi phục run sau F5, `logs`/`error` trong DB.

## Review Focus

- Mật khẩu lọt vào JSON trả client, log, snapshot/summary hoặc `updateRun` → test phải assert vắng mặt.
- Bấm Auto sau mốc T−5 (đặc biệt khi cổng đã mở) → login phải xảy ra ngay trước khi poll, không bị bỏ qua.
- Login lỗi mạng ở T−5 không được giết run → phải thử lại đúng `triggerAt`.
- 412 không được treo 5 phút như cũ → run phải kết thúc nhanh và báo rõ.
- Modal phải xoá mật khẩu khỏi state/không ghi storage sau Huỷ hoặc sau khi submit thành công.

---

### Task 1: `EnrollmentService.login` (password grant)

**Files:**
- Modify: `src/modules/enrollment/enrollment.service.js` (thêm `login` sau `refreshSession`)
- Test: `tests/test-enrollment-service.js`

**Interfaces:**
- Produces: `async login(username: string, password: string): Promise<{ token: string, refreshToken: string }>`
- Errors: `EnrollmentBduError` với `status: 401, code: 'INVALID_CREDENTIALS'` khi BDU từ chối; `status: 502, code: 'BDU_UNREACHABLE' | 'BDU_BAD_RESPONSE'` khi mạng/phản hồi hỏng.
- Consumes: `this.fetchImpl`, `BDU_BASE_URL`.

- [ ] **Step 1: Viết test fail cho login**

Thêm vào `tests/test-enrollment-service.js` (dùng `createFetchMock` sẵn có, key `POST ${BASE}/auth/login`):

```js
await section('login exchanges MSSV + password for a token', async () => {
  const { calls, fetchImpl } = createFetchMock({ [`POST ${BASE}/auth/login`]: { access_token: 'tok-new', refresh_token: 'ref-new' } });
  const result = await new EnrollmentService({ fetchImpl }).login('24050126', 'secret');
  assert.deepEqual(result, { token: 'tok-new', refreshToken: 'ref-new' });
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('grant_type'), 'password');
  assert.equal(body.get('username'), '24050126');
  assert.equal(body.get('password'), 'secret');
});
await section('login maps a rejected password to 401 INVALID_CREDENTIALS', async () => {
  const { fetchImpl } = createFetchMock({ [`POST ${BASE}/auth/login`]: { body: { message: 'Sai mật khẩu' }, status: 400 } });
  await assert.rejects(() => new EnrollmentService({ fetchImpl }).login('24050126', 'wrong'),
    (error) => error.status === 401 && error.code === 'INVALID_CREDENTIALS');
});
await section('login maps a network failure to 502 BDU_UNREACHABLE', async () => {
  const service = new EnrollmentService({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(() => service.login('24050126', 'secret'),
    (error) => error.status === 502 && error.code === 'BDU_UNREACHABLE');
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-service.js`
(PowerShell: `$env:NODE_ENV='test'; $env:BDU_TEST_RUNNER='safe'; node tests/test-enrollment-service.js`)
Expected: FAIL — `service.login is not a function`.

- [ ] **Step 3: Implement `login`**

Thêm method (giữ `verifyOtp`/`OtpUnavailableError` đến Task 5 để test OTP hiện tại còn chạy):

```js
async login(username, password) {
  // POST /auth/login form-urlencoded grant_type=password.
  // - fetch throw            -> 502 BDU_UNREACHABLE
  // - JSON parse fail        -> 502 BDU_BAD_RESPONSE
  // - !data.access_token     -> 401 INVALID_CREDENTIALS (message từ data.message/error_description)
  // - thành công             -> { token: data.access_token, refreshToken: data.refresh_token || '' }
}
```

- [ ] **Step 4: Chạy test để pass**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-service.js`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment.service.js tests/test-enrollment-service.js
git commit -m "feat(enrollment): add BDU password login to the service"
```

---

### Task 2: Nhận `password` từ API và giữ trong run (RAM)

**Files:**
- Modify: `src/modules/enrollment/enrollment.controller.js:114-190` (`startRun`)
- Modify: `src/modules/enrollment/enrollment-run.service.js:174-237` (`start`)
- Test: `tests/test-enrollment-controller.js`, `tests/test-enrollment-run.js`

**Interfaces:**
- Consumes: `EnrollmentService.login` (Task 1).
- Produces: `start({ mssv, token, refreshToken?, password, items, triggerAt, autoFixScheduleConflict?, svNganh? })`; run có thêm `password`, `loginAtMs`, `loginAttempts`, `loginDone`, `passwordInvalid`.
- Produces: `POST /api/enrollment/runs` yêu cầu `password` (string 1–200 sau trim).

- [ ] **Step 1: Viết test fail (run manager)**

```js
await section('a1) start rejects a missing password', async () => {
  const { manager } = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  await assert.rejects(
    () => manager.start({ mssv: 'SV001', token: 'tok', items: [chinhA], triggerAt: new Date(clock).toISOString() }),
    (error) => error.status === 400 && /mật khẩu/i.test(error.message)
  );
});
await section('a2) serialize never exposes the password', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', password: 'super-secret', items: [chinhA], triggerAt: new Date(clock + 60_000).toISOString() });
  assert.ok(!JSON.stringify(manager.getForStudent(run.runId, 'SV001')).includes('super-secret'));
  manager.stop(run.runId, 'SV001');
});
```

Thêm `password: 'pw'` vào **mọi** lời gọi `manager.start(...)` hiện có (trừ a1).

Test `n)` (chờ dài): login ở T−5 sẽ thay token lần cuối — thêm `login: async () => ({ token: 'tok-refreshed', refreshToken: 'refresh-1' })` vào `makeManager` của test đó.

- [ ] **Step 2: Viết test fail (controller)**

```js
await section('startRun 400 when password is missing', async () => {
  BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
  priorityStore.listPriorities = async () => [{ maMon: 'AAA', idToHoc: 'A-MAIN', loai: 'chinh', thuTu: 1 }];
  const res = response();
  await EnrollmentController.startRun(reqWith({ body: { triggerAt: new Date(Date.now() + 3600_000).toISOString() } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /mật khẩu/i);
});
```

Thêm `password: 'pw'` vào body của các test `startRun` hiện có.

- [ ] **Step 3: Chạy để thấy fail**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-run.js` và `... node tests/test-enrollment-controller.js`
Expected: FAIL ở test mới.

- [ ] **Step 4: Implement**

`enrollment.controller.js` — sau khi xác định `triggerDate` (trước khi đọc priority):

```js
const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
if (!password) return res.status(400).json({ result: false, message: 'Thiếu mật khẩu BDU để đăng nhập lại trước giờ mở.' });
if (password.length > 200) return res.status(400).json({ result: false, message: 'Mật khẩu BDU quá dài.' });
```

Truyền `password` vào `EnrollmentRunService.start({ ..., password })`.

`enrollment-run.service.js` — thêm hằng:

```js
const LOGIN_LEAD_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 3;
```

Trong `start(...)`: nhận `password`; `const secret = String(password || '').trim();` → rỗng thì `throw httpError(400, 'Thiếu mật khẩu BDU để đăng nhập lại trước giờ mở.')`. Thêm vào run:

```js
password: secret,
loginAtMs: triggerAtMs - LOGIN_LEAD_MS,
loginAttempts: 0,
loginDone: false,
passwordInvalid: false,
```

Không đổi `insertRun`/`serialize`.

- [ ] **Step 5: Chạy lại test**

Expected: PASS cả 2 file.

- [ ] **Step 6: Commit**

```bash
git add src/modules/enrollment/enrollment.controller.js src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-controller.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): accept the BDU password for a run and keep it in RAM"
```

---

### Task 3: Login trước giờ mở 5 phút + wipe khi kết thúc

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js` (`execute` ~566-604, `finishRun` ~640-670)
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Produces: `async loginWithPassword(run): Promise<'ok' | 'transient' | 'fatal'>`.
- Consumes: `EnrollmentService.login`, `run.password`, `run.loginAtMs`, `run.loginAttempts`.

- [ ] **Step 1: Mở rộng fake service**

Trong `makeManager`: thêm tham số `login = null`, `login: []` vào `calls`, và:

```js
login: async (mssv, password) => {
  calls.login.push({ mssv, password });
  if (login) return login(mssv, password, calls.login.length);
  return { token: 'tok-login', refreshToken: 'ref-login' };
}
```

- [ ] **Step 2: Viết test fail (dùng helper chung)**

Thêm helper cạnh các helper test:

```js
const startWithPassword = async (overrides = {}) => {
  const made = makeManager({ gateSequence: [true], ...overrides });
  clock = 1_000_000;
  const offsetMs = overrides.offsetMs ?? 10 * 60_000;
  const { run } = await made.manager.start({ mssv: 'SV001', token: 'tok-old', password: 'pw', items: [chinhA], triggerAt: new Date(clock + offsetMs).toISOString() });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed', 'stopped']);
  return { ...made, run, final };
};
```

Các test:

```js
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
  let attempts = 0;
  const login = async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('offline'), { status: 502 });
    return { token: 'tok-late', refreshToken: '' };
  };
  const { final, calls } = await startWithPassword({ login });
  assert.equal(final.status, 'done');
  assert.equal(calls.login.length, 2);
  assert.equal(calls.register[0].token, 'tok-late');
});
await section('a6) starting late logs in immediately before polling the gate', async () => {
  const { calls } = await startWithPassword({ offsetMs: -10 * 60_000 });
  assert.equal(calls.login.length, 1);
  assert.equal(calls.register[0].token, 'tok-login');
});
await section('a7) finishRun wipes the password from RAM', async () => {
  const { manager, run } = await startWithPassword({ offsetMs: 1_000 });
  assert.equal(manager.runs.get(run.runId).password, null);
});
```

- [ ] **Step 3: Chạy để thấy fail**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-run.js`
Expected: FAIL — `calls.login` rỗng / chưa có `loginWithPassword`.

- [ ] **Step 4: Implement `loginWithPassword`**

```js
async loginWithPassword(run) {
  // 'fatal' khi 401 hoặc không có mật khẩu.
  // 'transient' khi lỗi mạng/5xx hoặc đã chạm MAX_LOGIN_ATTEMPTS.
  // 'ok' khi token mới đã thay vào run.
}
```

Quy tắc: `!run.password` → `'fatal'`; `loginAttempts >= MAX_LOGIN_ATTEMPTS` → `'transient'`; tăng `loginAttempts`; gọi `this.service.login(run.mssv, run.password)`; thành công → cập nhật `token`, `refreshToken`, `lastRefreshAt`, log `Đã kiểm tra và đăng nhập lại BDU trước giờ mở.`, trả `'ok'`; `error.status === 401` → set `run.passwordInvalid = true`, log `Mật khẩu BDU không đúng.`, trả `'fatal'`; còn lại → log warning `Không đăng nhập lại được BDU (lỗi tạm thời) — sẽ thử lại đúng giờ mở.`, trả `'transient'`.

- [ ] **Step 5: Chèn login vào `execute`**

Đầu mỗi vòng chờ (trước `triggerAt`):

```js
if (!run.loginDone && this.now() >= run.loginAtMs) {
  const outcome = await this.loginWithPassword(run);
  if (outcome === 'fatal') { await this.finishRun(run, 'failed', { error: 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.' }); return; }
  if (outcome === 'ok') run.loginDone = true;
}
```

Sau vòng chờ, trước khối poll cổng, lặp lại đúng khối trên (xử lý bấm muộn + retry tại `triggerAt`).

- [ ] **Step 6: Wipe trong `finishRun`**

`finalError` ưu tiên `run.passwordInvalid`:

```js
const finalError = status === 'failed' && run.passwordInvalid
  ? 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.'
  : status === 'failed' && run.authExpired
    ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại và kích hoạt lại.'
    : (error ?? null);
```

Ngay trước khi ghi DB: `run.password = null;` (giữ nguyên chỗ xoá `token`/`refreshToken` cuối hàm).

- [ ] **Step 7: Chạy test**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-run.js`
Expected: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): log in with the stored password before the gate opens"
```

---

### Task 4: Fallback khi refresh/401 và thay nhánh 412; xoá state OTP khỏi run

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js` (`tryRefresh`, `registerSubject`, `execute`, `finishRun`, constants, `getLatestForStudent`)
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Consumes: `loginWithPassword` (Task 3).
- Produces: không còn `submitOtp`, `otpResult`, `otpAttempts`, `pendingItem`, `OTP_WAIT_MS`, `MAX_OTP_ATTEMPTS`; `ACTIVE_STATUSES = ['scheduled','running']`; `RECOVERABLE_STATUSES` gồm cả `otp_required` cho row DB cũ.

- [ ] **Step 1: Viết/thay test**

Thay test OTP cũ (`e`, `e2`, `k`, `l`) bằng 3 test sau (dùng `okResponse`, `failResponse`, `makeManager` sẵn có):

```js
await section('e) refresh failure falls back to a password login', async () => {
  let attempts = 0;
  const login = async () => { attempts += 1; return { token: 'tok-pw', refreshToken: '' }; };
  const register = async (args, count) => {
    if (count === 1) throw Object.assign(new Error('expired'), { status: 401 });
    return okResponse('RS-' + count);
  };
  const { manager, calls } = makeManager({ gateSequence: [true], login, register, refresh: async () => { throw new Error('refresh dead'); } });
  clock = 1_000_000;
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok-old', refreshToken: 'ref', password: 'pw', items: [chinhA], triggerAt: new Date(clock + 1_000).toISOString() });
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
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', password: 'pw', items: [chinhA], triggerAt: new Date(clock + 1_000).toISOString() });
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
  const { run } = await manager.start({ mssv: 'SV001', token: 'tok', password: 'pw', items: [chinhA, chinhB], triggerAt: new Date(clock + 1_000).toISOString() });
  const final = await waitForStatus(manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.match(final.summary.that_bai[0].ly_do, /OTP/);
  assert.equal(final.summary.thanh_cong.length, 1);
  assert.ok(clock - started < 60_000);
});
```

Thay test `k)` (stop khi chờ OTP) bằng "stop khi đang chờ cổng → `stopped`, không bắn request" (dùng `gateSequence: [false]`, trigger +60s, gọi `manager.stop` ngay).

Cập nhật test `p)` (refresh chết + password chết): thêm `login` throw 401 và assert `/Mật khẩu BDU không đúng/`; vẫn giữ assert notify Discord.

- [ ] **Step 2: Chạy để thấy fail**

Expected: FAIL ở `f2/f3` (còn chờ OTP) và `e` (refresh chết là fail ngay).

- [ ] **Step 3: Implement `tryRefresh` fallback**

```js
async tryRefresh(run) {
  // 1) thử refresh_token nếu refreshCount < 3
  // 2) thất bại/không có refresh token -> loginWithPassword(run) === 'ok'
}
```

- [ ] **Step 4: Thay nhánh 412 trong `registerSubject`**

Thay khối chờ OTP bằng:

```js
if (outcome.cls === 'otp') {
  const login = await this.loginWithPassword(run);
  if (login === 'ok') outcome = await this.attemptRegister(run, item, true);
}
```

Thêm trước nhánh `rejected`:

```js
if (outcome.cls === 'otp') {
  this.recordItem(run, item, 'failed', 'BDU yêu cầu OTP — không thể tự xử lý, vui lòng đăng ký thủ công');
  return null;
}
```

Trong vòng fallback: bỏ early-return riêng cho `fb.cls === 'otp'`; ghi log cảnh báo và thử nhóm dự phòng kế tiếp (không login lại giữa vòng fallback).

- [ ] **Step 5: Xoá state OTP khỏi run manager**

- Xoá `OTP_WAIT_MS`, `MAX_OTP_ATTEMPTS`, field `pendingItem`/`otpAttempts`/`otpResult`, method `submitOtp`.
- `ACTIVE_STATUSES = new Set(['scheduled', 'running'])`.
- Thêm `RECOVERABLE_STATUSES = new Set(['scheduled', 'running', 'otp_required'])` và dùng **chỉ** trong `getLatestForStudent` để row cũ vẫn bị đánh dấu `failed/server_restart`.
- Không còn chỗ nào emit `otp_required`.

- [ ] **Step 6: Chạy test**

Expected: PASS `tests/test-enrollment-run.js`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): handle 412 and auth failures with the RAM password"
```

---

### Task 5: Xoá toàn bộ surface OTP phía server

**Files:**
- Modify: `src/modules/enrollment/enrollment.controller.js`, `src/routes/enrollment.routes.js`, `src/modules/enrollment/enrollment.service.js`
- Test: `tests/test-enrollment-controller.js`

**Interfaces:**
- Removes: `EnrollmentController.submitOtp`, `POST /api/enrollment/runs/:id/otp`, `EnrollmentService.verifyOtp`, `OtpUnavailableError`.

- [ ] **Step 1: Viết test fail**

Trong `tests/test-enrollment-controller.js`, thay 2 test `submitOtp` cũ bằng:

```js
await section('submitOtp and its route are gone', async () => {
  assert.equal(EnrollmentController.submitOtp, undefined);
  const routes = readFileSync(new URL('../src/routes/enrollment.routes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /\/otp/);
});
```

Thêm `readFileSync` từ `node:fs` ở đầu file.

- [ ] **Step 2: Chạy để thấy fail**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-controller.js`
Expected: FAIL — `submitOtp` vẫn còn.

- [ ] **Step 3: Xoá code OTP phía server**

- Controller: xoá method `submitOtp`, xoá `OtpUnavailableError` khỏi import.
- Routes: xoá dòng `router.post('/enrollment/runs/:id/otp', ...)`.
- Service: xoá `verifyOtp`, class `OtpUnavailableError` và comment `ENROLLMENT_OTP_VERIFY_URL`.
- Không có env OTP trong `.env`/`.env.example`.

- [ ] **Step 4: Chạy test + grep**

Run: `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-controller.js`
Run: `grep -rn "submitOtp\|OtpUnavailableError\|ENROLLMENT_OTP_VERIFY_URL" src/` → không còn kết quả.
Run: `grep -rn "otp_required" src/` → chỉ còn legacy recovery (`RECOVERABLE_STATUSES`, `failStaleRuns`).

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment.controller.js src/modules/enrollment/enrollment.service.js src/routes/enrollment.routes.js tests/test-enrollment-controller.js
git commit -m "refactor(enrollment): remove the server-side OTP surface"
```

---

### Task 6: Modal MSSV + mật khẩu, bỏ modal OTP phía client

**Files:**
- Create: `client/src/features/enrollment/CredentialsModal.jsx`
- Modify: `client/src/features/enrollment/EnrollmentPage.jsx`, `client/src/api/enrollment.js`, `client/src/styles/app.css`
- Test: `tests/frontend/enrollment-credentials.test.jsx`

**Interfaces:**
- Produces: `CredentialsModal({ open, mssv, password, error, busy, onPasswordChange, onClose, onSubmit, dialogRef })`.
- Produces: `startRun(token, { roundId, triggerAt, autoFixScheduleConflict, refreshToken, password })`.
- Removes: `submitOtp` khỏi API client; modal/state OTP khỏi `EnrollmentPage`.

- [ ] **Step 1: Viết test fail**

Tạo `tests/frontend/enrollment-credentials.test.jsx`:

```jsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CredentialsModal from '../../client/src/features/enrollment/CredentialsModal.jsx';
import { startRun } from '../../client/src/api/enrollment.js';

afterEach(() => vi.unstubAllGlobals());
const renderModal = (props = {}) => render(<CredentialsModal open mssv="24050126" password="secret" busy={false} error="" onPasswordChange={() => {}} onClose={() => {}} onSubmit={() => {}} dialogRef={{ current: null }} {...props} />);

describe('CredentialsModal', () => {
  it('shows a read-only MSSV and a password field without autocomplete', () => {
    renderModal({ password: '' });
    expect(screen.getByLabelText('MSSV')).toHaveValue('24050126');
    expect(screen.getByLabelText('MSSV')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Mật khẩu BDU')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Mật khẩu BDU')).toHaveAttribute('autocomplete', 'off');
  });
  it('submits and never writes the password to storage', () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it('disables submit when the password is empty', () => {
    renderModal({ password: '' });
    expect(screen.getByRole('button', { name: 'Kích hoạt' })).toBeDisabled();
  });
  it('shows an inline error', () => {
    renderModal({ error: 'Mật khẩu BDU không đúng.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu BDU không đúng.');
  });
  it('startRun sends the password in the body', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, headers: { get: () => 'application/json' }, json: async () => ({ result: true, data: { runId: 'r1' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await startRun('tok', { roundId: 'dot1', password: 'secret' })).runId).toBe('r1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).password).toBe('secret');
  });
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx vitest run tests/frontend/enrollment-credentials.test.jsx --config vitest.config.js`
Expected: FAIL — không tìm thấy `CredentialsModal`.

- [ ] **Step 3: Tạo `CredentialsModal.jsx`**

```jsx
import { ViewportModal } from '../../components/ViewportModal.jsx';

export default function CredentialsModal({ open, mssv, password, error, busy, onPasswordChange, onClose, onSubmit, dialogRef }) {
  if (!open) return null;
  return (
    <ViewportModal id="enroll-credential-modal" title="Xác thực tài khoản BDU" labelledBy="enroll-credential-title" onClose={onClose} dialogRef={dialogRef}>
      <div id="enroll-credential-title" className="enroll-modal-title">Xác thực tài khoản BDU</div>
      <p className="enroll-modal-text">Tool cần mật khẩu để đăng nhập lại trước giờ mở cổng. Mật khẩu chỉ giữ trong RAM của server và tự xoá khi lượt chạy kết thúc.</p>
      <label className="enroll-credential-field">
        <span>MSSV</span>
        <input value={mssv} readOnly autoComplete="username" />
      </label>
      <label className="enroll-credential-field">
        <span>Mật khẩu BDU</span>
        <input type="password" value={password} autoComplete="off" onChange={(event) => onPasswordChange(event.target.value)} />
      </label>
      {error ? <p className="enroll-error" role="alert">{error}</p> : null}
      <div className="enroll-modal-actions">
        <button type="button" className="enroll-ghost" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="button" className="enroll-primary" onClick={onSubmit} disabled={busy || !password}>{busy ? 'Đang kích hoạt…' : 'Kích hoạt'}</button>
      </div>
    </ViewportModal>
  );
}
```

- [ ] **Step 4: API client**

`startRun` thêm `password` vào body; xoá `submitOtp`.

- [ ] **Step 5: Nối vào `EnrollmentPage.jsx`**

Xoá `OtpBoxes`, import `submitOtp`, state `otp*`, `otpAutoRef` + effect OTP, nhánh SSE `otp_required`, `handleSubmitOtp`, `useViewportDialog(otpOpen, ...)`, modal OTP, `otp_required` trong `ACTIVE_STATUSES`/`statusLabel`.

Thêm state `credentialOpen`, `credentialPassword`, `credentialError` + `credentialDialogRef`. `handleStart` chỉ mở modal (reset password/error). `handleConfirmStart` gọi `startRun` với `password: credentialPassword`; thành công → xoá password, đóng modal, giữ nguyên phần set run/notify cũ; lỗi → `setCredentialError(error.message)` và giữ modal. `closeCredentials` xoá password/error + đóng. Gọi `useViewportDialog(credentialOpen, closeCredentials, credentialDialogRef)`. Render `<CredentialsModal ... />` với `mssv`, `busy={starting}`.

- [ ] **Step 6: CSS**

Thêm cạnh style enrollment trong `client/src/styles/app.css`:

```css
#tab-enrollment .enroll-credential-field { display: grid; gap: 4px; margin-top: 10px; font-size: 0.82rem; }
#tab-enrollment .enroll-credential-field input { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--enroll-border); background: transparent; color: inherit; }
#tab-enrollment .enroll-credential-field input[readonly] { opacity: 0.7; }
```

Xoá `.enroll-otp-boxes`/`.enroll-otp-box` nếu còn.

- [ ] **Step 7: Chạy test + lint + build**

Run: `npx vitest run tests/frontend/enrollment-credentials.test.jsx tests/frontend/enrollment-tkb.test.js --config vitest.config.js`
Run: `npx eslint client/src/features/enrollment client/src/api/enrollment.js`
Run: `npm run build:client`
Expected: PASS, 0 lỗi lint, build thành công.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/enrollment/CredentialsModal.jsx client/src/features/enrollment/EnrollmentPage.jsx client/src/api/enrollment.js client/src/styles/app.css tests/frontend/enrollment-credentials.test.jsx
git commit -m "feat(enrollment): collect MSSV and password instead of an OTP code"
```

---

## Verification sau tất cả task

- [ ] `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-service.js`
- [ ] `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-run.js`
- [ ] `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-controller.js`
- [ ] `NODE_ENV=test BDU_TEST_RUNNER=safe node tests/test-enrollment-migration.js`
- [ ] `npx vitest run --config vitest.config.js`
- [ ] `npx eslint client/src/features/enrollment client/src/api/enrollment.js`
- [ ] `npm run build:client`
- [ ] `grep -rn "submitOtp\|OtpUnavailableError\|ENROLLMENT_OTP_VERIFY_URL" src/ client/src/` → không còn kết quả
- [ ] `grep -rn "otp_required" src/ client/src/` → chỉ còn legacy recovery (`RECOVERABLE_STATUSES`, `failStaleRuns`)
- [ ] `grep -rn "password" src/modules/enrollment/ | grep -i log` → không có dòng nào log giá trị mật khẩu

## Ghi chú triển khai

- Không migration; deploy chỉ cần build + restart app.
- Trước khi deploy, kiểm tra không có run đang active (restart sẽ làm run trong RAM thất bại).
- Sau deploy, kiểm chứng thủ công: đặt lịch cách hiện tại ~6 phút, xem log login ở T−5; thử mật khẩu sai; F5 giữa lúc chờ.
