# Enrollment Watch Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau khi auto đăng ký xong, tự gỡ các môn đã đăng ký khỏi danh sách ưu tiên, tick sẵn chúng ở bảng "Môn học đang mở", và thêm toggle canh slot thử lại lớp hết chỗ mỗi 60 giây tới khi đăng ký được hoặc đợt đóng.

**Architecture:** Watcher là pha `watching` của chính run hiện tại: `status` vẫn `running`, thông tin pha nằm trong cột `state` JSON. Run tái dùng `registerGroup`, limiter BDU, refresh token, SSE, nút Dừng và thông báo sẵn có. Môn thành công bị xoá khỏi `enrollment_priorities` theo cả nhóm `ma_mon`; client hiển thị tick sẵn từ danh sách đã đăng ký.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, React 19 + Vite, Node assert test runner, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-enrollment-watch-slots-design.md`

## Global Constraints

- Không migration, không thêm bảng/cột. `enrollment_runs.status` giữ nguyên; `phase` nằm trong `state` JSON.
- `watchSlots` mặc định `false`, theo từng lượt, khoá khi run active.
- Chỉ canh lý do `seat_full`. Mỗi lớp tối đa 1 request/60 giây; không retry 3 lần trong một tick.
- Xoá ưu tiên theo **cả nhóm `ma_mon`**; chỉ môn thành công của chính run đó.
- Không ghi password/token vào DB/log; run `phase='watching'` không resume sau restart.
- Copy UI giữ nguyên dấu tiếng Việt: **"Canh slot lớp hết chỗ"**, phụ đề **"Cứ 1 phút thử lại lớp báo hết chỗ (gồm dự phòng) tới khi đăng ký được hoặc đợt đóng. Mặc định tắt."**, tag **"Đã ĐK"**, badge **"Đang canh slot"**.
- Chạy test an toàn theo repo: `npm run test:node -- --only tests/<file>` và `npm run test:frontend`; cuối cùng `npm test`, `npm run lint:frontend`, `npm run build:client`.

## Review Focus

- Xoá `enrollment_priorities` lỗi DB nhưng đăng ký thành công → run vẫn `done`, UI vẫn tick sẵn môn đã đăng ký.
- Bấm Dừng trong lúc chờ 60 giây → dừng trong ≤5 giây, không bắn thêm request.
- Canh ngoài 09:00–20:00 hoặc sát giờ đóng đợt → không dồn request, kết thúc đúng `closesAt`.
- Server restart khi đang canh → run `failed`, không hiện trạng thái canh "ma".
- Token hết hạn trong lúc canh dài → refresh/login tiếp tục; lỗi auth không khôi phục thì `failed` rõ lý do.
- Môn đã đăng ký vẫn tick sẵn + disabled kể cả sau khi đã bị gỡ khỏi danh sách ưu tiên.

---

### Task 1: Store — xoá ưu tiên theo nhóm môn

**Files:**
- Modify: `src/modules/enrollment/priority-store.js`
- Test: `tests/test-enrollment-priority.js`

**Interfaces:**
- Produces: `priorityStore.deletePrioritiesBySubjects(mssv: string, maMons: string[]): Promise<number>`

- [ ] **Step 1: Write the failing test**

Thêm `import { priorityStore } from '../src/modules/enrollment/priority-store.js';` ở đầu `tests/test-enrollment-priority.js`, rồi thêm test vào cuối file (trước `console.log('OK')`):

```js
const deleted = await priorityStore.deletePrioritiesBySubjects('SV001', []);
assert.equal(deleted, 0, 'danh sách rỗng phải trả 0 và không gọi DB');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-priority.js`
Expected: FAIL — `priorityStore.deletePrioritiesBySubjects is not a function`.

- [ ] **Step 3: Implement `deletePrioritiesBySubjects` in `src/modules/enrollment/priority-store.js`**

```js
async deletePrioritiesBySubjects(mssv, maMons) {
  const subjects = [...new Set((maMons ?? []).filter(Boolean))];
  if (!subjects.length) return 0;
  const result = await query(
    'DELETE FROM enrollment_priorities WHERE mssv = $1 AND ma_mon = ANY($2::text[])',
    [String(mssv), subjects]
  );
  return result.rowCount ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-priority.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/priority-store.js tests/test-enrollment-priority.js
git commit -m "feat(enrollment): delete priority rows by subject group"
```

---

### Task 2: Run-service — mã lý do máy đọc được

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js`
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Produces: `recordItem(run, item, status, reason, fallbackFrom, reasonCode)` ghi `code` vào `run.results[]` và `run.summaryAcc.that_bai[]`.
- Produces: `seatFullSubjects(run): string[]` — `ma_mon` duy nhất có entry `that_bai.code === 'seat_full'`.

- [ ] **Step 1: Write the failing tests**

Thêm vào cuối `tests/test-enrollment-run.js` (trước `console.log('OK')`):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: FAIL — `seatFullSubjects is not a function` / `code` undefined.

- [ ] **Step 3: Implement reason codes**

Sửa `recordItem` nhận thêm tham số thứ 6 `reasonCode`; thêm `code: reasonCode` vào `entry` và `{ code: reasonCode ?? 'failed' }` vào entry `that_bai`. Cập nhật đủ 10 call site trong `registerSubject`:

| Nhánh | `reasonCode` |
|---|---|
| `seat_full` (kể cả hết dự phòng) | `'seat_full'` |
| `otp` | `'otp'` |
| `prereq` | `'prereq'` |
| `schedule_conflict` | `'schedule_conflict'` |
| `over_credit` | `'over_credit'` |
| `gate_closed` | `'gate_closed'` |
| `auth` | `'auth'` |
| `rejected` | `'rejected'` |
| `transient` cuối cùng | `'transient'` |

Thêm method:

```js
seatFullSubjects(run) {
  const subjects = (run.summaryAcc?.that_bai ?? [])
    .filter((entry) => entry?.code === 'seat_full')
    .map((entry) => entry.ma_mon)
    .filter(Boolean);
  return [...new Set(subjects)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: PASS toàn bộ file.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): tag failed items with a reason code"
```

---

### Task 3: Run-service — dọn môn thành công khỏi ưu tiên

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js`
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Produces: `cleanupSuccessfulPriorities(run): Promise<void>` — xoá cả nhóm `ma_mon` trong `summaryAcc.thanh_cong`, chống lặp bằng `run.cleanedMaMons`, phát SSE `priority_updated`.
- Consumes: `priorityStore.deletePrioritiesBySubjects` (Task 1).

- [ ] **Step 1: Write the failing tests**

Bổ sung `deletePrioritiesBySubjects` vào fake store trong `makeManager`:

```js
deletePrioritiesBySubjects: async (mssv, maMons) => {
  calls.deletePriorities.push({ mssv, maMons });
  return maMons.length;
},
```

khởi tạo `calls.deletePriorities: []` trong object `calls`. Thêm các section:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: FAIL — `deletePrioritiesBySubjects` không được gọi / event không có.

- [ ] **Step 3: Implement cleanup**

Trong `start()` khởi tạo `cleanedMaMons: new Set()`. Thêm method:

```js
async cleanupSuccessfulPriorities(run) {
  const done = [...new Set((run.summaryAcc?.thanh_cong ?? []).map((e) => e.ma_mon).filter(Boolean))];
  run.cleanedMaMons ??= new Set();
  const pending = done.filter((maMon) => !run.cleanedMaMons.has(maMon));
  if (!pending.length || typeof this.store.deletePrioritiesBySubjects !== 'function') return;
  try {
    await this.store.deletePrioritiesBySubjects(run.mssv, pending);
    pending.forEach((maMon) => run.cleanedMaMons.add(maMon));
    this.appendLog(run, 'info', `Đã gỡ ${pending.length} môn đã đăng ký khỏi danh sách ưu tiên.`);
    this.emit(run, { type: 'priority_updated', removedMaMons: pending });
  } catch (error) {
    this.appendLog(run, 'warning', `Không gỡ được môn đã đăng ký khỏi danh sách ưu tiên: ${clip(error?.message || error)}`);
  }
}
```

Gọi `await this.cleanupSuccessfulPriorities(run);` ở đầu `finishRun()` (trước khi dựng `summary`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): drop registered subjects from the priority list"
```

---

### Task 4: Run-service — state/serialize cho canh slot

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js`
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Produces: `start({ ..., watchSlots = false, watchUntil = null })`; run có `watchSlots`, `watchUntilMs`, `phase`, `cleanedMaMons`.
- Produces: `serialize()` / `serializeStoredRun()` trả `phase`, `watchSlots`, `watchUntil`.
- Produces: `summaryAcc.canh_slot: Array<{ ma_mon, id_to_hoc, so_lan_thu }>`.

- [ ] **Step 1: Write the failing tests**

```js
await section('w6) start stores watch settings and serializes them', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  const watchUntil = new Date(clock + 10 * 60_000).toISOString();
  const { run } = await manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil
  });
  const serialized = manager.getForStudent(run.runId, 'SV001');
  assert.equal(serialized.watchSlots, true);
  assert.equal(serialized.phase, 'registering');
  assert.equal(serialized.watchUntil, watchUntil);
  manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(manager, run.runId, 'SV001', ['stopped']);
  assert.equal(final.status, 'stopped');
});

await section('w7) watchSlots without watchUntil is rejected', async () => {
  const { manager } = makeManager({ gateSequence: [false] });
  clock = 1_000_000;
  await assert.rejects(
    () => manager.start({
      password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
      triggerAt: new Date(clock + 1_000).toISOString(), watchSlots: true
    }),
    (error) => error.status === 400
  );
});

await section('w8) serializeStoredRun reads watching state', async () => {
  const stored = serializeStoredRun({
    id: 'run-stored', status: 'running', trigger_at: new Date(clock).toISOString(),
    snapshot: [chinhA], summary: { thanh_cong: [], that_bai: [], fallback: [], rut: [], canh_slot: [] },
    logs: [], results: [], error: null,
    state: { phase: 'watching', watchSlots: true, watchUntilMs: clock + 60_000 }
  });
  assert.equal(stored.phase, 'watching');
  assert.equal(stored.watchSlots, true);
  assert.ok(stored.watchUntil);
});
```

Thêm `serializeStoredRun` vào import ở đầu file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: FAIL — `watchSlots` undefined / không reject.

- [ ] **Step 3: Implement plumbing**

- `start()` nhận `watchSlots = false, watchUntil = null`; tính `watchUntilMs = watchUntil ? new Date(watchUntil).getTime() : null`; nếu `watchSlots && !Number.isFinite(watchUntilMs)` → `throw httpError(400, 'Thiếu thời điểm đóng đợt cho canh slot.')`.
- Khởi tạo: `watchSlots: watchSlots === true`, `watchUntilMs`, `phase: 'registering'`, `cleanedMaMons: new Set()`, `watchDropped: new Set()`, `watchGaveUp: new Set()`, `watchAttempts: new Map()`, `watchCatalogRefreshAtMs: 0`, `lastWatchLogAtMs: 0`; `summaryAcc` thêm `canh_slot: []`.
- `stateOf()` trả thêm `phase`, `watchSlots`, `watchUntilMs`; `summaryOf()` trả thêm `canh_slot`.
- `resumeRun()` đọc `phase`, `watchSlots`, `watchUntilMs`, `summaryAcc.canh_slot` từ `state` (mặc định `'registering'`, `false`, `null`, `[]`).
- `serialize()` trả thêm `phase`, `watchSlots`, `watchUntil` ISO; copy `summary.canh_slot`.
- `serializeStoredRun()` trả `phase`, `watchSlots`, `watchUntil` từ `row.state`; copy `summary.canh_slot`.
- `finishRun()` summary thêm `canh_slot: [...(run.summaryAcc.canh_slot ?? [])]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): persist and expose the watching phase"
```

---

### Task 5: Watcher — tick, vòng lặp, tích hợp execute

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js`
- Modify: `src/modules/enrollment/enrollment-notify.service.js`
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Produces: `watchSubjects(run): string[]` — `seatFullSubjects` trừ `run.watchGaveUp`.
- Produces: `watchTick(run): Promise<{ pauseMs: number, failed?: string }>`.
- Produces: `runWatcher(run): Promise<{ status: 'done'|'stopped'|'failed', error?: string }>`.
- Produces: `EnrollmentNotifyService.notifyWatchSuccess({ mssv, runId, maMon, message }): Promise<boolean>` (kind `watch_ok:<maMon>`).
- Constructor nhận thêm `watchIntervalMs` (mặc định env `ENROLLMENT_WATCH_INTERVAL_MS`, fallback `60_000`, tối thiểu `1_000`).

- [ ] **Step 1: Write the failing tests**

```js
await section('w9) seat_full is retried every interval until a slot opens', async () => {
  let attempts = 0;
  const made = makeManager({
    gateSequence: [true],
    register: async (args) => {
      attempts += 1;
      return attempts <= 2 ? failResponse('Lớp đã hết chỗ') : okResponse('RS-OK');
    }
  });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA, backupA2],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil: new Date(clock + 5 * 60_000).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed', 'stopped']);
  assert.equal(final.status, 'done');
  assert.ok(final.summary.thanh_cong.some((item) => item.ma_mon === 'AAA'));
  assert.equal(final.summary.that_bai.length, 0);
  assert.equal(final.summary.canh_slot.length, 1);
  assert.equal(made.calls.register.filter((call) => call.isChecked).length >= 3, true);
});

await section('w10) stop during watching stops within the chunk window', async () => {
  const made = makeManager({ gateSequence: [true], register: async () => failResponse('hết chỗ') });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil: new Date(clock + 60 * 60_000).toISOString()
  });
  await waitForStatus(made.manager, run.runId, 'SV001', ['running']);
  for (let i = 0; i < 100; i += 1) {
    if (made.manager.getForStudent(run.runId, 'SV001')?.phase === 'watching') break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  assert.equal(made.manager.getForStudent(run.runId, 'SV001')?.phase, 'watching');
  await sleep(6_000);
  const requestsBeforeStop = made.calls.register.length;
  made.manager.stop(run.runId, 'SV001');
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['stopped'], 100);
  assert.equal(final.status, 'stopped');
  assert.equal(made.calls.register.length, requestsBeforeStop);
});

await section('w11) gate_closed pauses instead of failing and watching ends at watchUntil', async () => {
  let calls = 0;
  const made = makeManager({
    gateSequence: [true],
    register: async () => {
      calls += 1;
      return calls === 1 ? failResponse('Lớp đã hết chỗ') : failResponse('Ngoài thời gian cho phép đăng ký');
    }
  });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil: new Date(clock + 2 * 60_000).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.ok(final.logs.some((entry) => /đóng/i.test(entry.message)));
});

await section('w12) auth loss while watching fails the run', async () => {
  let calls = 0;
  const made = makeManager({
    gateSequence: [true],
    register: async () => {
      calls += 1;
      if (calls === 1) return failResponse('hết chỗ');
      throw Object.assign(new Error('expired'), { status: 401, code: 'AUTH_EXPIRED' });
    },
    refresh: async () => { throw new Error('refresh dead'); },
    login: async () => { throw Object.assign(new Error('bad'), { status: 401 }); }
  });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil: new Date(clock + 5 * 60_000).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'failed');
});

await section('w13) watching is skipped when no subject ran out of seats', async () => {
  const made = makeManager({ gateSequence: [true] });
  clock = 1_000_000;
  const { run } = await made.manager.start({
    password: 'pw', mssv: 'SV001', token: 'tok', items: [chinhA],
    triggerAt: new Date(clock + 1_000).toISOString(),
    watchSlots: true, watchUntil: new Date(clock + 5 * 60_000).toISOString()
  });
  const final = await waitForStatus(made.manager, run.runId, 'SV001', ['done', 'failed']);
  assert.equal(final.status, 'done');
  assert.equal(final.phase, 'registering');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: FAIL — watcher chưa tồn tại; các run có `watchSlots` kết thúc ngay.

- [ ] **Step 3: Implement watcher**

1. Hằng số: `WATCH_INTERVAL_MS = 60_000`, `WATCH_GATE_PAUSE_MS = 15 * 60_000`, `WATCH_HEARTBEAT_MS = 5 * 60_000`, `WATCH_CATALOG_REFRESH_MS = 10 * 60_000`.
2. Constructor: `this.watchIntervalMs = Number.isSafeInteger(watchIntervalMs) && watchIntervalMs >= 1000 ? watchIntervalMs : intEnv('ENROLLMENT_WATCH_INTERVAL_MS', WATCH_INTERVAL_MS, 1000);`
3. `watchSubjects(run)`: `this.seatFullSubjects(run).filter((maMon) => !run.watchGaveUp?.has(maMon))`.
4. `watchTick(run)` xử lý từng môn/từng item trong `run.snapshot` (sắp theo `thuTu`) như thuật toán trong spec mục 5.3:
   - Gọi trực tiếp `this.bduCall(() => this.service.registerGroup(...))`, **không** dùng `attemptRegister` (để đúng 1 request/lớp/tick).
   - `thanh_cong`/`already_registered` → `recordWatchSuccess` rồi `break`.
   - `seat_full` → sang item kế.
   - `gate_closed` → `pauseMs = WATCH_GATE_PAUSE_MS` và dừng tick.
   - `transient`/`rate_limit` → bỏ qua item.
   - `auth`/401 → `tryRefresh(run, { allowPassword: true })`; được thì thử lại **đúng item đó một lần** với token mới; không được trả `{ pauseMs: 0, failed: 'Phiên đăng nhập đã hết hạn' }`.
   - `rejected` + `isStaleIdResponse(res)` → `refreshCatalogIds(run)` tối đa 1 lần/10 phút; tiếp tục.
   - Còn lại → `run.watchDropped.add(key)`; nếu mọi item của môn đã dropped → `run.watchGaveUp.add(maMon)` + log.
5. `recordWatchSuccess(run, item)`: xác định `fallbackFrom` khi item là `du_phong`, gọi `recordItem(run, item, 'success', undefined, fallbackFrom)`, thêm `summaryAcc.fallback` nếu có, loại entry `that_bai` cùng `ma_mon`, push `summaryAcc.canh_slot`, gọi `cleanupSuccessfulPriorities(run)`, gọi `notifyWatchSuccess` (best-effort), log "Canh được slot … sau N lần thử.".
6. `runWatcher(run)`: vòng lặp với `nextTickAt = now + watchIntervalMs`; ngủ từng đoạn ≤5s tới `nextTickAt` hoặc `watchUntilMs`; heartbeat mỗi 5 phút; trước tick kiểm tra token sắp hết hạn (`tryRefresh` + chỉ fail nếu `run.passwordInvalid`); gọi `watchTick`; nếu `failed` trả failed; nếu hết môn → done; nếu `now >= watchUntilMs` → log "Đợt đăng ký đã đóng — kết thúc canh slot." rồi done; nếu `stopRequested` → stopped.
7. Tích hợp trong `execute()` sau vòng lặp `chinhItems`:
   - `await this.cleanupSuccessfulPriorities(run);`
   - `const canWatch = run.watchSlots === true && this.watchSubjects(run).length > 0 && this.now() < run.watchUntilMs;`
   - Không canWatch → `autoFixConflicts` (nếu bật) rồi `finishRun('done')` như cũ.
   - Có canWatch → `run.phase = 'watching'`, log bắt đầu, phát `snapshot`, `persistRun`, `const outcome = await this.runWatcher(run)`, nếu `outcome.status === 'done' && autoFix` → `autoFixConflicts`, rồi `finishRun(outcome.status, { error: outcome.error })`.
8. `finishRun()`: thêm câu "Canh slot: N môn" vào message Discord `done` nếu `summary.canh_slot.length > 0`.
9. `enrollment-notify.service.js`: thêm `notifyWatchSuccess` gọi `enqueue({ mssv, runId, kind: \`watch_ok:${maMon}\`, message })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: PASS toàn bộ (kể cả các section cũ).

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js src/modules/enrollment/enrollment-notify.service.js tests/test-enrollment-run.js
git commit -m "feat(enrollment): watch full classes until a seat opens"
```

---

### Task 6: Run-service — restart không resume pha watching

**Files:**
- Modify: `src/modules/enrollment/enrollment-run.service.js`
- Test: `tests/test-enrollment-run.js`

**Interfaces:**
- Consumes: `phase` lưu trong `row.state` (Task 4).
- Produces: hành vi `resumeActiveRuns` / `getLatestForStudent` đánh `failed` cho row `state.phase === 'watching'`.

- [ ] **Step 1: Write the failing tests**

```js
await section('w14) resumeActiveRuns fails a watching row instead of resuming', async () => {
  clock = 1_000_000;
  const row = resumeRow({ status: 'running', state: { phase: 'watching', watchSlots: true, watchUntilMs: clock + 60_000 } });
  const made = makeManager({ gateSequence: [true], activeRows: [row] });
  made.calls.credentials.set(row.id, 'pw');
  await made.manager.resumeActiveRuns();
  const failed = made.calls.updateRun.find((entry) => entry.id === row.id && entry.fields.status === 'failed');
  assert.ok(failed, 'run watching phải bị đánh failed sau restart');
  assert.equal(made.calls.register.length, 0);
});

await section('w15) getLatestForStudent fails a watching row without resuming', async () => {
  clock = 1_000_000;
  const row = resumeRow({ status: 'running', state: { phase: 'watching' } });
  const made = makeManager({ latestRow: row });
  made.calls.credentials.set(row.id, 'pw');
  const latest = await made.manager.getLatestForStudent('SV001');
  assert.equal(latest.status, 'failed');
  assert.equal(made.calls.register.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: FAIL — run watching bị resume hoặc trả `running`.

- [ ] **Step 3: Implement restart handling**

- Trong `resumeActiveRuns()`: trước `resumeRun(row)`, nếu `row.state?.phase === 'watching'` → `await this.markRunFailed(row, new Error('Server khởi động lại khi đang canh slot — lượt này không thể tiếp tục.')); continue;`
- Trong `getLatestForStudent()`: nếu `row.status` recoverable và `row.state?.phase === 'watching'` → đi nhánh cập nhật `status: 'failed'`, `summary.reason = 'server_restart'`, xoá credential, trả `serializeStoredRun` như nhánh lỗi hiện có; **không** gọi `resumeRun`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-run.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js
git commit -m "fix(enrollment): fail watching runs after a server restart"
```

---

### Task 7: Controller — nhận và validate `watchSlots`

**Files:**
- Modify: `src/modules/enrollment/enrollment.controller.js`
- Test: `tests/test-enrollment-controller.js`

**Interfaces:**
- Consumes: `EnrollmentRunService.start({ watchSlots, watchUntil, ... })` (Task 4).
- Produces: `POST /api/enrollment/runs` trả `400` khi bật canh slot mà thiếu `roundId`/`closesAt`; truyền `watchSlots`, `watchUntil` ISO.

- [ ] **Step 1: Write the failing tests**

```js
await section('startRun passes watchSlots and closesAt to the run', async () => {
  const realNow = Date.now;
  Date.now = () => new Date('2026-11-05T10:00:00+07:00').getTime();
  try {
    BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
    priorityStore.listPriorities = async () => [chinhA];
    enrollmentService.login = async () => ({ token: 'tok-verified', refreshToken: '', expiresIn: 18000 });
    let startArgs = null;
    EnrollmentRunService.start = async (args) => {
      startArgs = args;
      return { run: { runId: 'run-watch', status: 'scheduled' }, reused: false };
    };
    const res = response();
    await EnrollmentController.startRun(reqWith({ body: { password: 'pw', roundId: 'dot1', watchSlots: true } }), res);
    assert.equal(res.statusCode, 202);
    assert.equal(startArgs.watchSlots, true);
    assert.equal(startArgs.watchUntil, '2026-11-10T13:00:00.000Z');
  } finally {
    Date.now = realNow;
  }
});

await section('startRun 400 when watchSlots is used without roundId', async () => {
  BduIdentityService.resolveVerifiedMssv = async () => 'SV001';
  const res = response();
  await EnrollmentController.startRun(reqWith({
    body: { password: 'pw', watchSlots: true, triggerAt: new Date(Date.now() + 3600_000).toISOString() }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Canh slot/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --only tests/test-enrollment-controller.js`
Expected: FAIL — `startArgs.watchSlots` undefined / không trả 400.

- [ ] **Step 3: Implement controller changes**

- Destructure `watchSlots` từ `req.body`; `const wantsWatch = watchSlots === true;`
- Trong nhánh `roundId`: giữ `closesAt` đã tính; nếu `wantsWatch` và `Number.isNaN(closesAt.getTime())` → `400`.
- Trong nhánh `triggerAt`: nếu `wantsWatch` → `return res.status(400).json({ result: false, message: 'Canh slot chỉ hỗ trợ khi chọn đợt theo lịch nhà trường.' });`
- Truyền `watchSlots: wantsWatch`, `watchUntil: wantsWatch ? closesAt.toISOString() : null` vào `EnrollmentRunService.start`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --only tests/test-enrollment-controller.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/enrollment/enrollment.controller.js tests/test-enrollment-controller.js
git commit -m "feat(enrollment): accept watchSlots on run activation"
```

---

### Task 8: Client API + helper checkbox

**Files:**
- Create: `client/src/features/enrollment/catalog-selection.js`
- Modify: `client/src/api/enrollment.js`
- Create: `tests/frontend/enrollment-selection.test.js`
- Modify: `tests/frontend/enrollment-credentials.test.jsx`

**Interfaces:**
- Produces: `isRegisteredId(registeredIds: Set<string>, idToHoc: string): boolean`.
- Produces: `checkboxState({ idToHoc, selectedIds, registeredIds }): { checked: boolean, disabled: boolean, registered: boolean }`.
- Produces: `startRun(token, { ..., watchSlots }): Promise<...>` gửi `watchSlots`.

- [ ] **Step 1: Write the failing tests**

`tests/frontend/enrollment-selection.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { checkboxState } from '../../client/src/features/enrollment/catalog-selection.js';

describe('checkboxState', () => {
  it('checks and locks a registered class', () => {
    expect(checkboxState({
      idToHoc: 'A-MAIN', selectedIds: new Set(), registeredIds: new Set(['A-MAIN'])
    })).toEqual({ checked: true, disabled: true, registered: true });
  });

  it('keeps a normal class toggleable by selection', () => {
    expect(checkboxState({
      idToHoc: 'A-MAIN', selectedIds: new Set(['A-MAIN']), registeredIds: new Set()
    })).toEqual({ checked: true, disabled: false, registered: false });
  });

  it('leaves an unselected, unregistered class unchecked and toggleable', () => {
    expect(checkboxState({
      idToHoc: 'B-MAIN', selectedIds: new Set(), registeredIds: new Set()
    })).toEqual({ checked: false, disabled: false, registered: false });
  });
});
```

Trong `tests/frontend/enrollment-credentials.test.jsx`, sửa test `startRun sends the password in the body`:

```js
const result = await startRun('tok', { roundId: 'dot1', password: 'secret', watchSlots: true });
expect(JSON.parse(fetchMock.mock.calls[0][1].body).watchSlots).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:frontend`
Expected: FAIL — module `catalog-selection.js` không tồn tại; `watchSlots` undefined.

- [ ] **Step 3: Implement**

`client/src/features/enrollment/catalog-selection.js`:

```js
export function isRegisteredId(registeredIds, idToHoc) {
  return Boolean(idToHoc) && registeredIds instanceof Set && registeredIds.has(idToHoc);
}

export function checkboxState({ idToHoc, selectedIds, registeredIds }) {
  const registered = isRegisteredId(registeredIds, idToHoc);
  const selected = selectedIds instanceof Set && selectedIds.has(idToHoc);
  return { checked: registered || selected, disabled: registered, registered };
}
```

`client/src/api/enrollment.js`: thêm `watchSlots` vào destructure và body của `startRun` (`watchSlots: !!watchSlots`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/enrollment.js client/src/features/enrollment/catalog-selection.js tests/frontend/enrollment-selection.test.js tests/frontend/enrollment-credentials.test.jsx
git commit -m "feat(enrollment): send watchSlots and compute registered checkbox state"
```

---

### Task 9: UI — toggle, badge, SSE và tick sẵn catalog

**Files:**
- Modify: `client/src/features/enrollment/EnrollmentPage.jsx`
- Modify: `client/src/styles/app.css`

**Interfaces:**
- Consumes: `checkboxState` (Task 8), `startRun` `watchSlots` (Task 8), SSE `priority_updated` + `run.phase`/`run.watchUntil` (Task 4).

- [ ] **Step 1: Wire state and activation**

- Thêm `const [watchSlots, setWatchSlots] = useState(false);` cạnh `autoFixScheduleConflict`.
- Trong `handleConfirmStart`, gửi `watchSlots` vào `startRun`; thêm `watchSlots` vào dependency array. Object `setRun` khởi tạo thêm `phase: 'registering'`, `watchSlots`, `watchUntil: selectedRoundInfo ? `${selectedRoundInfo.closesAt}:00+07:00` : null`.
- Thêm toggle ngay dưới toggle TKB:

```jsx
<label className="enroll-switch">
  <input
    type="checkbox"
    checked={activeRun ? run?.watchSlots === true : watchSlots}
    onChange={(event) => setWatchSlots(event.target.checked)}
    disabled={activeRun}
  />
  <span className="enroll-switch-track" aria-hidden="true" />
  <span>
    Canh slot lớp hết chỗ
    <small>Cứ 1 phút thử lại lớp báo hết chỗ (gồm dự phòng) tới khi đăng ký được hoặc đợt đóng. Mặc định tắt.</small>
  </span>
</label>
```

- [ ] **Step 2: Badge và đếm ngược**

- `const watching = run?.phase === 'watching' && ACTIVE_STATUSES.includes(run?.status);`
- Badge: `className={`enroll-status is-${watching ? 'watching' : run.status}`}`; text `watching ? 'Đang canh slot' : (statusLabel[run.status] ?? run.status)`.
- Thêm memo `watchCountdown` từ `run.watchUntil` và `nowTick`: khi `watching`, trả text `Đang canh slot · thử lại mỗi 60s · tới ${new Date(run.watchUntil).toLocaleString('vi-VN')}`. Render trong khối `enroll-countdown` (ưu tiên hiển thị thay cho countdown triggerAt khi watching).

- [ ] **Step 3: SSE**

Trong `subscribeRun` `onMessage`, thêm trước `done`:

```js
if (payload.type === 'priority_updated') {
  const removed = Array.isArray(payload.removedMaMons) ? payload.removedMaMons : [];
  if (removed.length) {
    setSelected((current) => current.filter((item) => !removed.includes(item.maMon)));
    notify(`Đã gỡ ${removed.length} môn đã đăng ký khỏi danh sách ưu tiên.`, 'info');
  }
  loadRegistered();
  return;
}
```

Trong `done`, thêm `if (!dirtyRef.current) loadPriority();`. Thêm `const dirtyRef = useRef(false);` và `useEffect(() => { dirtyRef.current = dirty; }, [dirty]);`.

- [ ] **Step 4: Catalog tick sẵn**

- Sau `registeredRows`, thêm:

```js
const registeredIds = useMemo(
  () => new Set(registeredRows.map((row) => row.idToHoc).filter(Boolean)),
  [registeredRows]
);
```

- Trong map `visibleCatalog`, thay `const checked = selectedIds.has(row.idToHoc);` bằng:

```js
const box = checkboxState({ idToHoc: row.idToHoc, selectedIds, registeredIds });
```

- `<tr>`: dùng `box.checked` cho class `is-selected`, thêm `box.registered ? 'is-registered' : ''`; `onClick={() => { if (!box.registered) toggleGroup(row); }}`.
- Checkbox: `checked={box.checked}`, `disabled={box.registered}`, `onChange={() => toggleGroup(row)}`.
- Sau tag CTĐT, thêm `{box.registered ? <span className="enroll-tag is-ok">Đã ĐK</span> : null}`.

- [ ] **Step 5: CSS**

Thêm cạnh các rule enrollment trong `client/src/styles/app.css`:

```css
#tab-enrollment .enroll-table tr.is-registered { opacity: 0.72; }
#tab-enrollment .enroll-tag.is-ok { color: var(--color-emerald); background: color-mix(in srgb, var(--color-emerald) 14%, transparent); }
#tab-enrollment .enroll-status.is-watching { color: var(--bdu-light); border-color: color-mix(in srgb, var(--bdu-light) 45%, transparent); }
```

- [ ] **Step 6: Verify**

Run: `npm run lint:frontend`
Expected: PASS, không lỗi unused/import.

Run: `npm run build:client`
Expected: build thành công.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/enrollment/EnrollmentPage.jsx client/src/styles/app.css
git commit -m "feat(enrollment): add watch-slot toggle and registered checks in the catalog"
```

---

### Task 10: Verify toàn bộ

**Files:**
- Không tạo file mới; chỉ sửa nếu test/lint/build phát hiện lỗi.

- [ ] **Step 1: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS, gồm `test-enrollment-*` và toàn bộ frontend.

- [ ] **Step 2: Lint + build**

Run: `npm run lint:frontend`
Expected: PASS.

Run: `npm run build:client`
Expected: build thành công.

- [ ] **Step 3: Kiểm tra thủ công nhanh trên `/enrollment`**

Mở trang, xác nhận:
- Toggle "Canh slot lớp hết chỗ" nằm dưới toggle TKB, mặc định tắt, khoá khi run active.
- Sau một lượt auto có môn thành công: danh sách ưu tiên giảm đúng nhóm môn; bảng "Môn học đang mở" hiện tick sẵn + "Đã ĐK", không tick lại được.
- Run đang canh hiện badge "Đang canh slot" và nút Dừng hoạt động.

- [ ] **Step 4: Commit nếu có chỉnh sửa**

```bash
git add <các file đã sửa>
git commit -m "test(enrollment): verify watch slots and priority cleanup"
```
