# Auto Đăng Ký Môn Học BDU — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay placeholder `/enrollment` bằng công cụ cho sinh viên xếp danh sách môn/nhóm-tổ ưu tiên, canh đúng giờ BDU mở cổng HK2 — 2026-2027 và tự gọi API đăng ký theo thứ tự ưu tiên, có log realtime, rút môn có xác nhận.

**Spec:** `docs/superpowers/specs/2026-11-04-enrollment-auto-design.md` (đọc trước khi làm).

**Architecture:** Express module `src/modules/enrollment/` (BDU adapter + run-manager giữ token trong RAM + Postgres `enrollment_priorities`/`enrollment_runs`), SSE riêng `/api/enrollment/runs/:id/events`, client React rewrite trang `/enrollment`. Server chạy lượt (như SurveyRunService); client chỉ theo dõi.

**Tech Stack:** Node 24, Express, pg (`src/db/database.js`), React + Vite (`client/`), SSE; không thêm dependency mới.

## Global Constraints

- Mọi request tới BDU dùng **token của chính sinh viên**; tool không bypass khung giờ/quy chế, không xoay IP, không giả mạo fingerprint, không tự đọc OTP từ email/SMS.
- **Token BDU không ghi DB, không log, không vào `snapshot`/`summary`/SSE events**; chỉ RAM trong thời gian run; xóa khi run kết thúc.
- Bắn tuần tự theo `thu_tu`, giãn cách **≥ 100ms**, chain `id_rs` từ response trước sang lệnh kế.
- Retry **≤ 3 lần** khi lỗi tạm thời (5xx/network/timeout/429; 429 ưu tiên `Retry-After` nếu có; backoff 200→500→1200ms). **Không** retry khi server từ chối vĩnh viễn (hết chỗ / tiên quyết / ngoài thời gian / 200-không-thành-công).
- Fallback dự phòng **chỉ** khi server báo **hết chỗ**; **thiếu tiên quyết → dừng hẳn môn đó**; **trùng TKB → không fallback**; "Ngoài thời gian cho phép đăng ký" → dừng run (`failed`).
- OTP (**HTTP 412**): server phát SSE `otp_required` → client popup 6 ô → `POST /api/enrollment/runs/:id/otp`; sai ≤ 5 lần; chờ tối đa 5 phút; quá → `failed`. Không đoán endpoint OTP: cổng xác thực chưa mở để khảo sát → mặc định trả **501** với thông báo rõ; bật được qua env `ENROLLMENT_OTP_VERIFY_URL` (xem Task 5).
- "Tự động dọn trùng TKB": **mặc định TẮT**; chỉ rút môn trong `snapshot` của chính run đó; môn bị rút là môn có `thu_tu` cao hơn (ưu tiên thấp hơn).
- Mọi endpoint `/api/enrollment/*` (trừ SSE `runs/:id/events`) đi qua `requireVerifiedMssv` + `bearerToken(req)`; **không tin mssv từ client**; run/summary chỉ đúng mssv chủ đọc/dừng được.
- Migration **idempotent**, đặt `migrations/069_enrollment.sql`, không FK ngoài `students(mssv)`; không sửa migration đã apply.
- UI/messages tiếng Việt; comment tiếng Anh hoặc Việt theo file lân cận.
- Không thêm dependency mới.

## Review Focus (test pin vào task sở hữu code)

1. **Cổng chưa mở tại giờ đặt** (mock catalog luôn trả `trong_thoi_gian_dang_ky:false`) → tool **không được bắn** register; quá `triggerAt + 5′` → run `failed("Cổng chưa mở")`. → Task 4.
2. **412 giữa chuỗi đăng ký** → run sang `otp_required`, **item đang dở được giữ nguyên**, OTP đúng → resume đúng item (chain `id_rs`); OTP sai 5 lần → `failed`; token không lọt ra SSE/log. → Task 4, Task 5, Task 7.
3. **Fallback chọn nhầm môn khác** → dự phòng khác `ma_mon` bị từ chối ở **cả client lẫn server** (validate 2 tầng). → Task 2, Task 5.
4. **Client gửi `thu_tu` tuỳ ý** → server **tự gán** `thu_tu` theo thứ tự array; không bao giờ tin `thu_tu` từ client. → Task 5.
5. **Hai SV chạm nhau**: A đọc/dừng run của B → 404/403; gửi quá 1 run song song cùng mssv → 409; rút môn/đọc registered của B không thể xảy ra qua API (mssv chỉ từ token). → Task 5.
6. **TKB trùng nhưng không đọc được** (chuỗi rỗng/format lạ) → auto-dọn TKB **bỏ qua** pair đó + log, tuyệt đối không rút nhầm. → Task 4.

---

## File map

**Create:**
- `migrations/069_enrollment.sql` — bảng `enrollment_priorities`, `enrollment_runs`.
- `src/modules/enrollment/enrollment-priority.js` — pure: validate/normalize danh sách, `pickFallbacks`.
- `src/modules/enrollment/enrollment-tkb.js` — pure: `parseTkb`, `groupsConflict`.
- `src/modules/enrollment/enrollment.service.js` — BDU adapter (catalog+cache, gate status, registered, server time best-effort, register/withdraw, `classifyRegisterResult`).
- `src/modules/enrollment/priority-store.js` — DB: list/replace priorities, insert/update/get `enrollment_runs`.
- `src/modules/enrollment/enrollment-run.service.js` — `EnrollmentRunManager` + singleton; vòng lặp canh giờ; OTP resume; auto-dọn TKB.
- `src/modules/enrollment/enrollment.controller.js`, `src/routes/enrollment.routes.js`
- `client/src/api/enrollment.js`, `client/src/features/enrollment/priority.js`
- `tests/test-enrollment-priority.js`, `tests/test-enrollment-tkb.js`, `tests/test-enrollment-service.js`, `tests/test-enrollment-run.js`, `tests/test-enrollment-controller.js`, `tests/test-enrollment-migration.js`
- `tests/frontend/enrollment-priority.test.js`

**Modify:**
- `src/controllers/api.controller.js` (export + spread `EnrollmentController`)
- `src/routes/api.routes.js` (import + `registerEnrollmentRoutes(router); // 3c`)
- `src/config/feature-groups.js` (group `enrollment` lockable; **bỏ `/enrollment` khỏi** `portal.pagePrefixes`)
- `scripts/test-manifest.mjs` (thêm test node)
- `client/src/features/enrollment/EnrollmentPage.jsx` (rewrite thay placeholder)
- `client/src/layouts/AppLayout.jsx` (badge `/enrollment` `Soon` → `Auto`)
- `docs/superpowers/specs/2026-11-04-enrollment-auto-design.md` (SSE riêng thay `/api/tool-runs/...`; 501 OTP default)
- `.env.example` (document `ENROLLMENT_OTP_VERIFY_URL`, mặc định trống)

---

### Task 1: Migration 069

**Files:** Create `migrations/069_enrollment.sql`; Test: `tests/test-enrollment-migration.js`; Modify `scripts/test-manifest.mjs`

**Interfaces:** Produces tables `enrollment_priorities(mssv, ma_mon, ten_mon, so_tc, id_to_hoc, nhom_to, lop, thu_tu, loai)` and `enrollment_runs(id, mssv, status, trigger_at, snapshot, summary, started_at, finished_at, created_at)`.

- [ ] **Step 1: Write the failing test** — `tests/test-enrollment-migration.js` đọc file SQL và assert: chứa `CREATE TABLE IF NOT EXISTS enrollment_priorities`, `CREATE TABLE IF NOT EXISTS enrollment_runs`, `ON DELETE CASCADE` trong tên bảng, **không** chứa `DROP TABLE`, có `PRIMARY KEY (mssv, id_to_hoc)`, có check `loai IN ('chinh','du_phong')`, `status IN ('scheduled','running','done','failed','stopped')`.
- [ ] **Step 2: Run it, verify FAIL** (`node tests/test-enrollment-migration.js`) — file chưa tồn tại.
- [ ] **Step 3: Write `migrations/069_enrollment.sql`** với schema đúng spec §4 (giữ nguyên cột/kiểu/CHECK), kèm `CREATE INDEX IF NOT EXISTS enrollment_priorities_mssv_idx (mssv, thu_tu)` và `enrollment_runs_mssv_idx (mssv, created_at DESC)`.
- [ ] **Step 4: Run test PASS.** **Step 5: Commit** (`git add migrations/069_enrollment.sql tests/test-enrollment-migration.js scripts/test-manifest.mjs && git commit -m "feat(enrollment): migration 069 priorities and runs"`).

### Task 2: Priority domain logic (pure) + TKB utils (pure)

**Files:** Create `src/modules/enrollment/enrollment-priority.js`, `src/modules/enrollment/enrollment-tkb.js`; Test `tests/test-enrollment-priority.js`, `tests/test-enrollment-tkb.js`

**Interfaces:**
- Produces `validatePriorityItems(items) → { ok:true, items:Normalized[] } | { ok:false, errors:string[] }`; `assignOrder(items) → Normalized[]` (set `thuTu=i+1`); `pickFallbacks(items, maMon) → Normalized[]` (loai='du_phong' cùng `maMon`, sort theo `thuTu`); `parseTkb(tkb) → Array<{thu:number, startPeriod:number, endPeriod:number, from:Date|null, to:Date|null}>`; `groupsConflict(a,b) → boolean`.

- [ ] **Step 1: Failing tests** — priority: rejects non-array/>100 items; item thiếu `ma_mon`/`id_to_hoc`; loai sai; trùng `id_to_hoc`; 1 môn có 2 `chinh`; `du_phong` của môn không có `chinh` trong cùng danh sách; **dự phòng khác `ma_mon` bị reject**; normalize trim + truncate `ten_mon` 200 ký tự, trả `{maMon, tenMon, soTc, idToHoc, nhomTo, lop, loai}` (không tin `thu_tu` từ input). tkb: parse `"Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27"` → thu=3, start=1, end=3, from=2026-12-29, to=2027-01-26; `"Thứ 4,tiết 6->8,...,23/02/27"` (1 ngày) → from=to=2027-02-23; chuỗi rác → `[]`; `groupsConflict`: cùng thứ + trùng tiết + trùng khoảng ngày → `true`; khác thứ / khác tiết / disjoint ngày → `false`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** hai file thuần (không import DB/fetch; chỉ `const` helpers).
- [ ] **Step 4: Run PASS.** **Step 5: Commit** (`git add src/modules/enrollment/enrollment-priority.js src/modules/enrollment/enrollment-tkb.js tests/test-enrollment-priority.js tests/test-enrollment-tkb.js && git commit -m "feat(enrollment): pure priority validation and TKB utils"`).

### Task 3: BDU adapter `enrollment.service.js`

**Files:** Create `src/modules/enrollment/enrollment.service.js`; Test `tests/test-enrollment-service.js`

**Interfaces (consumes TKB/priority types):**
- `class EnrollmentService` — `constructor({ fetchImpl = fetch, catalogTtlMs = 60_000, now = () => Date.now() } = {})`
- `getCatalog(token, { loaiLoc = 2, forceRefresh = false } = {}) → Promise<{ hocKyDangKy, trongThoiGianDangKy, dienGiaiEnableChung, dsMonHoc:[{ma,ten}], dsNhomTo:[{idToHoc, maMon, tenMon, nhomTo, to, lop, soTc, slCp, slCl, tkb, enable, gcEnable, isCtdt, isChctdt}] }>` (cache theo (token,loaiLoc) TTL `catalogTtlMs`; `forceRefresh` bỏ qua cache).
- `getGateStatus(token) → Promise<boolean>` = `(await getCatalog(token, {forceRefresh:true})).trongThoiGianDangKy`.
- `getRegistered(token) → Promise<{ soTinChiMin, dsKqdkmh }>`.
- `fetchServerTime() → Promise<Date|null>` — `GET /hsba/w-gettimeserver`; parse tolerant (ISO string | epoch ms/s | `{data:{...}}` | `{...time...}` lồng ≤ 4 tầng); rác → `null` (không throw).
- `registerGroup(token, { idToHoc, isChecked, svNganh = 1, idRs = '' }) → Promise<{ httpStatus, code, isThanhCong, isChoose, idRs, idToHocXoa, thongBaoLoi, thongBaoTienQuyet, rawMessage }>` — POST `dkmh/w-xulydkmhsinhvien`, body `{"filter":{...}}`; headers `Authorization: Bearer`, `idpc: 0`, `Content-Type: application/json`; `isChecked:true`=đăng ký / `false`=rút (withdraw dùng chung hàm này).
- `classifyRegisterResult(res) → 'thanh_cong'|'seat_full'|'prereq'|'schedule_conflict'|'gate_closed'|'auth'|'rate_limit'|'transient'|'otp'|'rejected'` — thứ tự kiểm tra: `httpStatus===412→'otp'`; `401|426→'auth'`; `429→'rate_limit'`; `5xx→'transient'`; `code!==200→'rejected'`; message match `/hết\s*(chỗ|chỉ tiêu)|đã\s*đầy|không\s*còn\s*chỗ/i`→`seat_full`; `/tiên\s*quyết/i`→`prereq`; `/trùng\s*(thời khóa biểu|thời khoá biểu|tkb|lịch học)/i`→`schedule_conflict`; `/ngoài\s*thời\s*gian|chưa\s*đến\s*giờ|hết\s*thời\s*gian/i`→`gate_closed`; `data.is_thanh_cong===true`→`thanh_cong`; còn lại→`rejected`.
- Mọi method throw `EnrollmentBduError` (`status`, `code`) khi BDU lỗi mạng/không parse được; controller map sang HTTP.

Tests (mock `fetch` toàn cục, assert `Authorization: Bearer test-token`, `idpc:'0'`, URL đúng; body đúng envelope): catalog normalize đúng 2 array + cờ; cache hit lần 2 (1 fetch); `forceRefresh` gọi lại; `getGateStatus` đúng true/false; `registerGroup` đúng body/`is_checked`; classify: 412→otp, 401/426→auth, 429→rate_limit, 503→transient, `"Ngoài thời gian cho phép đăng ký"`→gate_closed, `"hết chỉ tiêu"`→seat_full, `"tiên quyết"`→prereq, `"trùng thời khóa biểu"`→schedule_conflict, unknown→rejected; `fetchServerTime`: ISO→Date, epoch→Date, garbage→null; lỗi mạng → EnrollmentBduError.

- [ ] **Step 1: Failing tests** (as above, `node tests/test-enrollment-service.js`) **Step 2: Verify FAIL** **Step 3: Implement** **Step 4: PASS** **Step 5: Commit** (`git add src/modules/enrollment/enrollment.service.js tests/test-enrollment-service.js && git commit -m "feat(enrollment): BDU adapter with catalog cache and result classification"`)

### Task 4: Run manager (`EnrollmentRunManager`)

**Files:** Create `src/modules/enrollment/priority-store.js`, `src/modules/enrollment/enrollment-run.service.js`; Test `tests/test-enrollment-run.js`

**Interfaces:**
- `priority-store.js`: `listPriorities(mssv) → Normalized[]`; `replacePriorities(mssv, items) → Normalized[]` (transaction: `DELETE WHERE mssv` + bulk `INSERT` với `thu_tu = index+1`, bỏ qua `thu_tu` client gửi); `insertRun({id, mssv, status, triggerAt, snapshot})`, `updateRun(id, fields)`, `getRun(id, mssv)` (owner-check trong controller). Dùng `query`/`transaction` từ `src/db/database.js`.
- `EnrollmentRunManager` — `constructor({ service, store, sleep, now, retentionMs = 1_800_000 } = {})` với default: service thật, store thật, `sleep = (ms) => new Promise(r => setTimeout(r, ms))`, `now = () => Date.now()`.
- `start({ mssv, token, items, triggerAt, autoFixScheduleConflict = false, svNganh = 1 }) → { run, reused }` — `items` = snapshot **đã validate và đã gán `thuTu`** (controller làm); insert run row (`scheduled`); 2 run cùng mssv → `reused:true`.
- `getForStudent(runId, mssv) → serialized|null`; `subscribe(runId, listener) → unsubscribe`; events: `snapshot | log | item_done {maMon, idToHoc, status:'success'|'failed', reason?, fallbackFrom?} | otp_required {pendingIdToHoc} | done`.
- `submitOtp(runId, mssv, code)` → validate `code` 6 chữ số; run phải ở `otp_required`; gọi `service.verifyOtp(token, code)`: mặc định (chưa mở cổng) throw `OtpUnavailableError` → controller trả **501**; nếu env `ENROLLMENT_OTP_VERIFY_URL` được set → POST `{code}` (bearer) → 2xx = OK và **re-issue item đang dở** (không bắn lại từ đầu), non-2xx/throw = OTP sai (đếm ≤ 5 lần → `failed`).
- `stop(runId, mssv)` → set `stopRequested`; vòng lặp kiểm tra giữa các item và trong poll.
- `execute(runId)` algorithm:
  1. Poll `sleep(1000)` tới `triggerAt − 30s` (hoặc ngay lập tức nếu đã qua); sau đó poll gate mỗi 500ms (`service.getGateStatus`).
  2. Nếu `now > triggerAt + 5min` mà gate chưa mở → `failed` ("Cổng chưa mở"), update run, emit `done`, **không bắn**.
  3. Gate mở → `running`; duyệt các item `loai==='chinh'` theo `thuTu`: mỗi item → `registerGroup(..., isChecked:true, idRs: lastIdRs)`; giãn cách ≥ 100ms (`sleep(100)`).
  4. `classifyRegisterResult`: `thanh_cong` → `item_done{success}`; `seat_full` → duyệt `pickFallbacks(items, maMon)` lần lượt; mỗi dự phòng cũng `registerGroup` (cùng `idRs` chain); success → `item_done{success, fallbackFrom}`; hết dự phòng → `item_done{failed, 'hết chỗ'}`; `prereq` → mark môn này dừng, `item_done{failed,'thiếu tiên quyết'}`; `schedule_conflict` → `failed('trùng lịch')`; `gate_closed` → **dừng toàn bộ run** `failed('Ngoài thời gian cho phép đăng ký')`; `auth` → `failed` (client sẽ logout); `rate_limit`/`transient` → retry ≤3 với backoff 200/500/1200ms rồi `failed('lỗi tạm thời')` cho item đó (sang môn kế); `otp` → `status='otp_required'`, lưu `pendingItem`, emit `otp_required`, chờ `submitOtp` tối đa 5 phút (poll 500ms); hết giờ/sai 5 lần → `failed`; OTP OK → resume item đang dở với `idRs` mới.
  5. Sau cùng: nếu `autoFixScheduleConflict` → ghép cặp các item **thành công** cùng trong snapshot, `groupsConflict` → `withdrawGroup` môn có `thuTu` lớn hơn; ghi vào `summary.rut`; pair không parse được TKB → skip + log.
  6. Terminal: `enrollment_runs` update (`status`, `summary`, `finished_at`); **`run.token = null`**; emit `done`.
- Summary shape: `{ thanh_cong: [{ma_mon, id_to_hoc}], that_bai: [{ma_mon, id_to_hoc, ly_do}], fallback: [{ma_mon, tu_id_to_hoc, sang_id_to_hoc}], rut: [{ma_mon, id_to_hoc, ly_do}] }` — **không** chứa token.

Tests (inject `service`/`store` giả; `sleep` giả là no-op; `now` giả): (a) gate đóng mãi → `failed`, **register không được gọi**; (b) gate mở ở poll thứ 2 → bắn đúng thứ tự `thuTu`, `idRs` chain từ response trước; (c) seat_full → fallback đúng môn cùng `ma_mon`; dự phòng khác môn không bao giờ được bắn; (d) prereq → dừng môn, không bắn item kế của cùng môn nhưng vẫn bắn môn khác; (e) 412 → `otp_required`; submitOtp đúng → resume item dở; OTP sai 5 lần → `failed`; (f) 503×3 → item `failed('lỗi tạm thời')`, run tiếp môn kế; (g) `autoFixScheduleConflict` → withdraw đúng môn ưu tiên thấp; TKB rác → không withdraw; (h) 2 start cùng mssv → `reused:true`; (i) serialize run không có token; (j) `stop()` giữa chừng → dừng, không bắn item kế.

- [ ] Steps: 1 failing tests → 2 verify FAIL → 3 implement store → 4 implement manager → 5 PASS → 6 Commit (`git add src/modules/enrollment/priority-store.js src/modules/enrollment/enrollment-run.service.js tests/test-enrollment-run.js && git commit -m "feat(enrollment): server-side run manager with gate polling and OTP seam"`)
- [ ] **Note:** Manager chạy được ở process đơn (như survey). Restart server giữa run → token mất → run `failed` khi health-check (thêm guard: boot log cảnh báo run `running` cũ quá 15 phút → mark `failed` trong `insertRun`/startup hook của controller — tối thiểu: `getRun` trả `failed` cho run `running` quá 15 phút).

### Task 5: Controller + routes + wiring + feature gate

**Files:** Create `src/modules/enrollment/enrollment.controller.js`, `src/routes/enrollment.routes.js`; Modify `src/controllers/api.controller.js`, `src/routes/api.routes.js`, `src/config/feature-groups.js`, `scripts/test-manifest.mjs`, `docs/superpowers/specs/2026-11-04-enrollment-auto-design.md`, `.env.example`; Test `tests/test-enrollment-controller.js`

Controller methods (signature `(req, res)`): `getPriority`, `replacePriority` (PUT; body `{items}`; server **tự gán `thu_tu`** theo array; validate qua `validatePriorityItems`; transaction replace), `getCatalog` (`?loai_loc=2`; `Cache-Control: private, max-age=30`), `getRegistered`, `withdraw` (`{id_to_hoc}` required; 400 thiếu; gọi service → lỗi BDU map 502 + message gốc), `startRun` (`{triggerAt ISO, autoFixScheduleConflict?}`; `triggerAt` parse được, không quá 7 ngày trong tương lai, không quá 5 phút trong quá khứ (nếu quá khứ mà gate đang mở → chạy ngay); snapshot rỗng → 400 "Chưa có danh sách ưu tiên"; 409 khi có run active; 202 + `{runId}`), `getRun` (owner-only: khác mssv → 404), `stopRun`, `submitOtp` (`{code}` 6 chữ số; sai format → 400; không ở `otp_required` → 409; `OtpUnavailableError` → 501 message), `streamRunEvents` (SSE headers y hệt survey controller; **không** `requireVerifiedMssv`; capability = `runId` uuid; heartbeat 15s; cleanup on close).

Routes `registerEnrollmentRoutes(router)`: mọi route `router.<m>('/enrollment/...', requireVerifiedMssv, ...)` trừ `GET /enrollment/runs/:id/events` (SSE, không bearer) và `GET /enrollment/runs/:id` vẫn có bearer. Đăng ký vào `api.routes.js` sau `registerTrainingRoutes(router); // 3c. Auto đăng ký môn học BDU`. Export + spread `EnrollmentController` trong `api.controller.js`. `feature-groups.js`: thêm `{ id: 'enrollment', label: 'Auto đăng ký MH', lockable: true, apiPrefixes: ['/enrollment'], pagePrefixes: ['/enrollment'] }` và **xóa** `/enrollment` khỏi `portal.pagePrefixes` (tránh prefix trùng giữa 2 group). Cập nhật spec: thay dòng SSE tái-dùng → `/api/enrollment/runs/:id/events` riêng; ghi rõ OTP mặc định 501 tới khi khảo sát cổng. Thêm `ENROLLMENT_OTP_VERIFY_URL=` vào `.env.example` kèm comment.

Tests `tests/test-enrollment-controller.js` (mock req/res trực tiếp như `test-english-controller-auth.js`): 401 thiếu bearer (mock `resolveVerifiedMssv` throw → 401); `replacePriority` gán `thu_tu` theo array & trả list đã lưu (mock store); item dự phòng khác môn → 400; `startRun` snapshot rỗng → 400; có run active → 409; `getRun`/`stopRun` của mssv khác → 404; withdraw thiếu `id_to_hoc` → 400; `submitOtp` sai format → 400; run không ở `otp_required` → 409; SSE endpoint trả headers `text/event-stream`.

- [ ] Steps: 1 failing tests → 2 FAIL → 3 implement controller+routes+wiring+feature-groups+spec/env edits → 4 PASS + `node scripts/run-safe-tests.mjs --node-only` → 5 Commit (`git add ... && git commit -m "feat(enrollment): API /api/enrollment/* with owner checks and SSE"`)

### Task 6: Client API + pure UI helpers

**Files:** Create `client/src/api/enrollment.js`, `client/src/features/enrollment/priority.js`; Test `tests/frontend/enrollment-priority.test.js`

`client/src/api/enrollment.js` — thin wrappers qua `request`/`unwrap`: `getPriority(token)`, `savePriority(token, items)` (PUT; body `{items}`), `getCatalog(token, loaiLoc = 2)`, `getRegistered(token)`, `withdraw(token, idToHoc)`, `startRun(token, { triggerAt, autoFixScheduleConflict })`, `getRunStatus(token, runId)`, `stopRun(token, runId)`, `submitOtp(token, runId, code)`; SSE qua `createEventStream` từ `./tools.js` với path `/api/enrollment/runs/${runId}/events`.

`priority.js` (pure, export): `groupBySubject(items) → [{ maMon, tenMon, soTc, chinh, duPhong[] }]` (giữ nguyên thứ tự `thu_tu`); `moveItem(items, itemId, direction /* -1|+1 */) → items` (swap theo mảng phẳng, giữ `thu_tu` = index+1); `toSavePayload(items)`; `canSetAsChinh(items, item)` (chỉ cho phép 1 chinh/môn).

- [ ] Steps: 1 failing frontend test (`groupBySubject` gộp đúng theo `ma_mon` giữ thứ tự; `moveItem` swap và renumber; `toSavePayload` không gửi `thu_tu`? — payload gửi `thu_tu` cũng được vì server tự gán; assert payload có đủ field và thứ tự đúng theo array) → 2 FAIL → 3 implement → 4 `npm run test:frontend -- tests/frontend/enrollment-priority.test.js` PASS (kiểm tra tên script hỗ trợ filter; nếu không, file được pick lên trong full run) → 5 Commit (`git add client/src/api/enrollment.js client/src/features/enrollment/priority.js tests/frontend/enrollment-priority.test.js && git commit -m "feat(enrollment): client API module and priority helpers"`)

### Task 7: `EnrollmentPage.jsx` rewrite (UI)

**Files:** Rewrite `client/src/features/enrollment/EnrollmentPage.jsx`; Modify `client/src/layouts/AppLayout.jsx` (badge `/enrollment`: `['Soon','badge-pill-amber']` → `['Auto','badge-pill-purple']`)

Layout (tiếng Việt, theo pattern trang tool khác: `section-header-box glass-panel` + các panel):
1. **Header** — tiêu đề "Tự Động Đăng Ký Môn Học"; sub: học kỳ từ `getCatalog` (`hoc_ky_dang_ky`); chip trạng thái cổng: `trong_thoi_gian_dang_ky` → "ĐANG MỞ" / "Chưa mở" + `dien_giai_enable_chung`.
2. **Bảng môn đang mở** — cột: Mã MH / Tên / Nhóm-Tổ / Lớp / TC / Còn lại (`slCl`) / TKB; tìm kiếm khớp `ma_mon|ten_mon`; select lọc điều kiện (default "Môn trong CTĐT kế hoạch" = loai_loc 2; các option lấy từ `w-locdsdieukienloc` hardcode 7 mục theo probe, gửi `loai_loc` lên server; không cần render hết admin-only fields); row có checkbox (disabled khi `enable=false`, tooltip `gcEnable`).
3. **Danh sách ưu tiên đã chọn** — nhóm theo môn (dùng `groupBySubject`): mỗi môn 1 dòng chính (radio "Chính") + các dự phòng; nút ↑↓ đổi thứ tự toàn cục; nút ✕ bỏ khỏi danh sách; **Lưu danh sách** → `savePriority` → toast.
4. **Kích hoạt** — `datetime-local` input "Giờ mở cổng dự kiến" (default: ngày mai/ngày theo thông báo, user sửa được); checkbox "Tự động dọn trùng TKB sau khi chạy (mặc định TẮT)"; nút **Kích hoạt Auto** (disabled khi chưa lưu danh sách) → `startRun` → chuyển sang khung theo dõi: đếm ngược tới `triggerAt` (theo `Date.now()`; nếu `fetchServerTime` có → hiển thị lệch server, không bắt buộc), log SSE append vào `<pre className="enrollment-log">`, nút **Dừng** (`stopRun`), trạng thái cuối (`done` summary: thành công/thất bại từng môn, list `rut`).
5. **OTP popup** — hiện khi SSE `otp_required`: 6 ô nhập (auto-focus, paste fill), submit → `submitOtp`; 501 → thông báo "Cổng xác thực chưa mở để kích hoạt OTP — bạn vui lòng vào sv.bdu.edu.vn xác thực thủ công rồi bấm chạy lại"; sai → toast lỗi, đếm lượt nhập; đóng popup vẫn giữ run chờ.
6. **Mô đã đăng ký** — bảng từ `getRegistered` (`ds_kqdkmh`), mỗi dòng nút **Rút** → `ViewportModal` xác nhận → `withdraw` → reload bảng; empty state "Chưa đăng ký môn nào".
7. Lỗi 401/maintenance dùng cơ chế sẵn có (`SessionExpiredError`/`MaintenanceError` được `http.js` ném) — trang chỉ hiển thị `notify`/inline error, không bắt thêm.

- [ ] **Step 1:** implement page (giữ `id="tab-enrollment"` + class `tab-pane active` như placeholder; tái dùng `ViewportModal`, `useAuth`, `useToasts`, `getCatalog`...). **Step 2:** `npm run lint:frontend` → fix. **Step 3:** `npm run build:client` → OK. **Step 4:** mở `npm run dev:server` + `dev:client`, đăng nhập test 24050126 trên localhost, kiểm tra trang render, lưu/khôi phục danh sách, nút Kích hoạt disabled đúng lúc, **không** bấm Kích hoạt thật (cổng đóng; nếu bấm → run phải `failed("Cổng chưa mở")` an toàn, chấp nhận được nhưng hỏi user trước). **Step 5:** Commit (`git add client/src/features/enrollment/EnrollmentPage.jsx client/src/layouts/AppLayout.jsx && git commit -m "feat(enrollment): interactive page with priority list, auto-run watch and withdraw"`).

### Task 8: Manifest + full verification + spec sync

**Files:** Modify `scripts/test-manifest.mjs` (đã có thể thêm dần ở các Task; đảm bảo đủ: `test-enrollment-migration.js`, `test-enrollment-priority.js`, `test-enrollment-tkb.js`, `test-enrollment-service.js`, `test-enrollment-run.js`, `test-enrollment-controller.js`), spec (sync SSE/OTP note nếu Task 5 chưa làm).

- [ ] **Step 1:** `npm test` — toàn bộ suite xanh. **Step 2:** `npm run lint:frontend`, `npm run build:client` — xanh. **Step 3:** `git status` sạch ngoại trừ file của feature; **Step 4:** Commit cuối (nếu còn thay đổi) `git commit -m "chore(enrollment): register enrollment tests in safe suite"`.

## Self-review notes

- Spec §§1–10 đều map vào task: intent/scope → Task 7 + Global Constraints; khảo sát §3 → Task 3; schema §4 → Task 1; API §5 → Task 5; luồng run §6 → Task 4; lỗi/an toàn §7 → Task 4/5; testing §8 → mọi task + Task 8. §9 điểm mở 1 (OTP) giữ `ENROLLMENT_OTP_VERIFY_URL` seam — cố ý làm 501-mặt-định, không giả lập. §10 bước tiếp theo hiển nhiên.
- `withdraw` không lọc "thuộc run/snapshot" — đúng spec (rút thủ công là hành động trước xác nhận); auto-dọn TKB mới bị giới hạn vào snapshot (Task 4 step 5).
- Không đổi route client; `/enrollment` giữ URL, badge chuyển Soon→Auto (Task 7).
- Không thêm dependency; SSE tái dùng pattern survey (không dùng chung `SurveyRunService` để tránh cross-domain).
