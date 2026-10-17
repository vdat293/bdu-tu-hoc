# Công tắc khóa dịch vụ bảo trì — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép chủ sở hữu khóa/mở toàn bộ website từ `/admin` bằng một công tắc lưu trong DB, người dùng thấy màn hình "dịch vụ đang tạm khóa để bảo trì", admin vẫn vào được — không sửa code, không restart, không thêm migration.

**Architecture:** Trạng thái nằm trong bảng `system_settings` (đã có), đọc qua `SystemSettingsService` (cache 30 giây, ghi là xoá cache ⇒ hiệu lực tức thời). Một middleware duy nhất gắn ở `src/app.js` ngay trước `app.use('/api', apiRoutes)` chặn mọi request `/api/*` trừ danh sách miễn trừ; React bắt mã `MAINTENANCE` và hiện màn hình toàn trang; WebSocket bị từ chối/đóng; admin bật/tắt bằng card mới trong site tĩnh `public/admin/`.

**Tech Stack:** Node.js 22 + Express 4 (ESM), PostgreSQL 16, React 19 + Vite, `node:assert/strict` cho test BE, Vitest + jsdom + @testing-library/react cho test FE, site tĩnh thuần JS cho `/admin`.

**Spec:** `docs/superpowers/specs/2026-10-12-khoa-dich-vu-bao-tri-design.md`

## Global Constraints

- **Không thêm migration.** Dùng bảng `system_settings` (từ `migrations/053_system_settings.sql`). `migrations/` không được sửa.
- **Không sửa `src/routes/api.routes.js`.** Thứ tự gọi `register*Routes` là hành vi routing (quy tắc 3.2 trong `docs/architecture.md`).
- Value của setting **chỉ 3 trường**: `{ locked, title, message }`. **Không có `eta`**, không gửi header `Retry-After`.
- `locked` phải là boolean; `title` ≤ **120** ký tự; `message` ≤ **500** ký tự; mọi chuỗi phải `trim()`.
- Phản hồi khi bị chặn: HTTP **503** + `{ result:false, code:'MAINTENANCE', title, message }`.
- Danh sách miễn trừ (so trên path **đã cắt** tiền tố `/api`): `/health`, `/version`, `/status`, tiền tố `/admin/dashboard`.
- Endpoint admin dùng **`PUT`** (không `POST`) và path `/api/admin/dashboard/service-lock`, theo đúng convention của `ranking-sync`.
- `GET /api/status` **không** trả `updated_by`, `updated_at`.
- **Fail-open**: lỗi DB hoặc chưa cấu hình `DATABASE_URL` ⇒ coi như không khóa, không được ném lỗi ra request.
- Mọi file test Node mới **phải** được khai vào `scripts/test-manifest.mjs` (có `tests/test-manifest.test.mjs` canh).
- Route/method mới **phải** được khai vào `scripts/verify-route-order.mjs` (`ROUTES_ADDED_AFTER_SPLIT`) hoặc `scripts/verify-controller-split.mjs` (`ADDED_AFTER_SPLIT`).
- Comment và thông báo: **tiếng Việt**, giải thích "vì sao" như style hiện có trong repo; không dùng emoji.
- Test Node chạy trực tiếp (`node tests/<file>`) — runner `npm run test:node` fail-closed trên Windows theo thiết kế.
- **Chạy test Node phải kèm env managed**, nếu không `src/config/load-env.js` ném `UNMANAGED_TEST_EXECUTION` cho mọi test import gián tiếp `src/db/database.js`. Dạng đúng trong PowerShell:
  `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/<file>`
  Lưu ý: ở chế độ test, `.env` **không** được nạp ⇒ các test này phải tự đủ, không được phụ thuộc `DATABASE_URL`.

## Review Focus

Năm lớp đầu vào / chế độ lỗi dễ cắn người dùng nhất, mỗi dòng đã có test ở task tương ứng:

1. **`/api/health` (và `/api/admin/dashboard/login`) lúc đang khóa phải vẫn 200.** Nếu không: bước healthcheck khi deploy tưởng app chết và rollback, còn admin thì không đăng nhập lại được. → Task 2, Task 3.
2. **Body rác khi `PUT`** (`locked: "true"` dạng chuỗi, `title` null, `message` dài 10.000 ký tự). Kỳ vọng: `400`, không ghi DB, và endpoint công khai không bị bơm nội dung dài. → Task 1, Task 5.
3. **DB lỗi hoặc chưa cấu hình `DATABASE_URL`.** Kỳ vọng: site vẫn phục vụ bình thường (fail-open), không 500 hàng loạt. → Task 1, Task 2.
4. **So đường dẫn miễn trừ sai dạng** (`/api/health` lẫn `/health`). Kỳ vọng: cả hai dạng đều được nhận là miễn trừ, site không tự khóa chính mình. → Task 2.
5. **WebSocket**: kết nối đang mở khi bật khóa, và kết nối mới khi đang khóa. Kỳ vọng: đóng mã `1001` kèm lý do / từ chối `503`; client tự reconnect theo backoff, không kẹt. → Task 4 (đóng), Task 9 (đường upgrade, kiểm bằng tay vì cần HTTP server thật).

---

### Task 1: `ServiceLockService` — nguồn sự thật và validate

**Files:**
- Create: `src/services/service-lock.service.js`
- Test: `tests/test-service-lock.service.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-service-lock.service.js'` vào `SAFE_NODE_TESTS`)

**Interfaces:**
- Consumes: `SystemSettingsService` từ `src/services/system-settings.service.js` (đã có: `get(key, fallback)`, `getRecord(key)`, `set(key, value, updatedBy)`).
- Produces:
  - `SERVICE_LOCK_SETTING_KEY = 'service_lock'`
  - `DEFAULT_TITLE = 'Dịch vụ đang tạm khóa để bảo trì'`
  - `DEFAULT_MESSAGE = 'Hệ thống đang bảo trì, vui lòng quay lại sau.'`
  - `MAX_TITLE_LENGTH = 120`, `MAX_MESSAGE_LENGTH = 500`
  - `ServiceLockService.getStatus(): Promise<{ locked: boolean, title: string, message: string }>` — không bao giờ ném lỗi.
  - `ServiceLockService.setStatus({ locked, title, message }, updatedBy): Promise<{ locked, title, message, updated_at, updated_by }>` — ném `Error` có `status = 400` khi dữ liệu sai.

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-service-lock.service.js` theo khuôn `tests/test-profile-controller.js` (monkey-patch service, không cần DB). Nội dung là các test sau, mỗi test in một dòng `✓`/`✗` như style repo:

| Test | Khẳng định |
| :--- | :--- |
| mặc định khi chưa có bản ghi | `SystemSettingsService.get` trả `null` ⇒ `getStatus()` trả `{ locked: false, title: DEFAULT_TITLE, message: DEFAULT_MESSAGE }` |
| chuẩn hoá bản ghi thiếu trường | `get` trả `{ locked: true }` ⇒ `title`/`message` được thay bằng default, không trả `undefined` |
| fail-open khi DB lỗi | `get` ném lỗi ⇒ `getStatus()` resolve `{ locked: false }` và **không** ném |
| `setStatus` lưu đúng shape + `updatedBy` | `SystemSettingsService.set` được gọi với `('service_lock', { locked: true, title: 'T', message: 'M' }, 'TESTADMIN')`, trả về record |
| `setStatus` điền default khi thiếu nội dung | gọi `setStatus({ locked: true }, 'X')` ⇒ `set` nhận `title`/`message` mặc định |
| `setStatus` từ chối `locked` không phải boolean | `setStatus({ locked: 'true' })` ⇒ ném lỗi `status === 400`, `set` **không** được gọi |
| `setStatus` từ chối `title` quá dài | `title` 121 ký tự ⇒ `400`, không ghi |
| `setStatus` từ chối `message` quá dài | `message` 501 ký tự ⇒ `400`, không ghi |
| `setStatus` trim chuỗi | `title: '  A  '` ⇒ `set` nhận `'A'` |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock.service.js`
Expected: FAIL — `Cannot find module '../src/services/service-lock.service.js'`

- [x] **Step 3: Viết `src/services/service-lock.service.js`**

Chỉ khai báo các hằng ở Interfaces và hai method. `getStatus()` dùng `SystemSettingsService.get(SERVICE_LOCK_SETTING_KEY)` bọc `try/catch` để fail-open; `setStatus()` validate theo Global Constraints rồi gọi `SystemSettingsService.set(...)`. Comment đầu file ghi rõ: vì sao fail-open (không biến sự cố DB thành sự cố toàn site) và vì sao giới hạn độ dài (nội dung này sẽ được trả ở endpoint công khai `/api/status`).

- [x] **Step 4: Chạy lại test**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock.service.js`
Expected: PASS toàn bộ, không warning.

- [x] **Step 5: Khai test vào manifest và kiểm tra guard**

Thêm `'test-service-lock.service.js'` vào `SAFE_NODE_TESTS` trong `scripts/test-manifest.mjs`.
Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-manifest.test.mjs`
Expected: PASS (nếu quên khai, test này fail với "every top-level test file is explicitly classified").

- [x] **Step 6: Commit**

```bash
git add src/services/service-lock.service.js tests/test-service-lock.service.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): them ServiceLockService doc/ghi trang thai khoa bao tri"
```

---

### Task 2: Middleware `serviceLockGuard`

**Files:**
- Create: `src/utils/service-lock-guard.js`
- Test: `tests/test-service-lock-guard.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-service-lock-guard.js'`)

**Interfaces:**
- Consumes: không import gì từ Task 1 (nhận hàm qua tham số để test được).
- Produces: `createServiceLockGuard({ getStatus })` trả về middleware Express `(req, res, next) => void`. Khi chặn: `res.status(503).json({ result:false, code:'MAINTENANCE', title, message })`.

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-service-lock-guard.js` (chỉ dùng `node:assert/strict`, không cần DB). Fake `req` = `{ path, method:'GET' }`, fake `res` theo khuôn `response()` trong `tests/test-profile-controller.js`, `next` = hàm đếm số lần gọi. Các ca:

| Test | Khẳng định |
| :--- | :--- |
| cho qua khi không khóa | `getStatus` trả `{ locked:false }` ⇒ `next()` được gọi, `res.status` **không** được gọi |
| chặn path thường | `path:'/profile'`, locked ⇒ `503`, body `code:'MAINTENANCE'`, `title`/`message` khớp `getStatus` |
| miễn trừ `/health` | `path:'/health'` ⇒ `next()`, không `503` |
| miễn trừ `/version`, `/status` | như trên cho từng path |
| miễn trừ tiền tố admin | `path:'/admin/dashboard/login'` và `/admin/dashboard/overview` ⇒ `next()` |
| **miễn trừ khi path còn nguyên tiền tố** | `path:'/api/health'` ⇒ `next()` (khoá chặt hợp đồng: guard phải tự chuẩn hoá, không phụ thuộc việc được mount ở đâu) |
| chặn path `/api/*` khác | `path:'/api/queue-status'`, locked ⇒ `503` |
| fail-open khi `getStatus` ném | `getStatus` ném lỗi ⇒ `next()`, không `503`, không unhandled rejection |
| `res` không có `json` vẫn không sập | `getStatus` ném và `res` tối thiểu ⇒ `next()` |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock-guard.js`
Expected: FAIL — không tìm thấy module `../src/utils/service-lock-guard.js`

- [x] **Step 3: Viết `src/utils/service-lock-guard.js`**

Cài đặt: chuẩn hoá path trước khi so (`path` bắt đầu bằng `/api` thì cắt 4 ký tự đầu), rồi đối chiếu danh sách miễn trừ ở Global Constraints; mọi nhánh lỗi của `getStatus` phải rơi vào `next()`. Comment đầu file nêu đúng lý do kỹ thuật của bước chuẩn hoá: Express cắt tiền tố mount khỏi `req.path` **chỉ khi** middleware được mount tại `/api`, nên code không được phép phụ thuộc vào chi tiết đó.

- [x] **Step 4: Chạy lại test**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock-guard.js`
Expected: PASS toàn bộ.

- [x] **Step 5: Khai vào manifest + kiểm tra guard**

Thêm `'test-service-lock-guard.js'` vào `SAFE_NODE_TESTS`.
Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-manifest.test.mjs`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/utils/service-lock-guard.js tests/test-service-lock-guard.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): middleware chan request khi dang khoa, co fail-open"
```

---

### Task 3: Gắn cửa chặn vào app + endpoint công khai `/api/status`

**Files:**
- Modify: `src/app.js` (thêm import + 1 dòng `app.use`, ngay trước `app.use('/api', apiRoutes)` ở dòng 185)
- Modify: `src/modules/meta/meta.controller.js` (thêm `getServiceStatus`)
- Modify: `src/routes/meta.routes.js` (thêm `router.get('/status', ApiController.getServiceStatus)`)
- Modify: `scripts/verify-controller-split.mjs` (khai `getServiceStatus` vào `ADDED_AFTER_SPLIT`)
- Modify: `docs/architecture.md` (ghi quy tắc: cửa chặn phải nằm sau mount static và trước router `/api`)
- Test: `tests/test-service-lock-endpoint.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-service-lock-endpoint.js'`)

**Interfaces:**
- Consumes: `ServiceLockService.getStatus()` (Task 1), `createServiceLockGuard({ getStatus })` (Task 2).
- Produces: `MetaController.getServiceStatus(req, res)` trả `{ result:true, data:{ locked, title, message } }`; path công khai `GET /api/status`.

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-service-lock-endpoint.js`:

| Test | Khẳng định |
| :--- | :--- |
| payload của `/api/status` | monkey-patch `ServiceLockService.getStatus`, gọi `ApiController.getServiceStatus({}, mockRes)` ⇒ `200`, `result:true`, `data` có đúng 3 khoá `locked/title/message` |
| không lộ nội bộ | `JSON.stringify(payload)` **không** chứa `updated_by`, `updated_at` |
| route được đăng ký | đọc `src/routes/meta.routes.js` và `assert.match` có `router.get('/status'` |
| **vị trí cửa chặn** | đọc `src/app.js`: index của `createServiceLockGuard` phải **nhỏ hơn** index của `app.use('/api', apiRoutes)` (test cấu trúc, chặn việc ai đó di chuyển cửa chặn xuống sau router) |
| **cửa chặn phải sau mount static** | đọc `src/app.js`: index của `createServiceLockGuard` phải **lớn hơn** index của `app.use(express.static(path.join(ROOT_DIR, 'public')`. Nếu không, SPA và `/app-assets` bị chặn ⇒ màn hình bảo trì không bao giờ tải được. |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock-endpoint.js`
Expected: FAIL — `ApiController.getServiceStatus is not a function` (hoặc assert route chưa tồn tại).

- [x] **Step 3: Cài đặt**

`meta.controller.js`: thêm method `getServiceStatus` gọi `ServiceLockService.getStatus()` và trả đúng 3 khoá (không trả `updated_at/updated_by`). Import `ServiceLockService` từ `../../services/service-lock.service.js`.
`meta.routes.js`: thêm dòng route `/status` cạnh `/health`, `/version`.
`app.js`: import `ServiceLockService` và `createServiceLockGuard`, rồi chèn `app.use('/api', createServiceLockGuard({ getStatus: () => ServiceLockService.getStatus() }));` **ngay trước** dòng `app.use('/api', apiRoutes)` — kèm comment ngắn nêu lý do thứ tự này (sau static để SPA vẫn tải được; trước router để không phải sửa `api.routes.js`).

- [x] **Step 4: Chạy lại test + guard**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-lock-endpoint.js`
Expected: PASS.
Run: `node scripts/verify-controller-split.mjs`
Expected: FAIL với "Method moi phai duoc khai bao trong ADDED_AFTER_SPLIT: getServiceStatus" — đây là hành vi đúng của guard.

- [x] **Step 5: Khai guard cho method mới**

Thêm `['getServiceStatus', 'service lock (dot 1)']` vào `ADDED_AFTER_SPLIT` trong `scripts/verify-controller-split.mjs`.
Run: `node scripts/verify-controller-split.mjs`
Expected: `OK - tap method goc va tach khop hoan toan`.

- [x] **Step 6: Ghi quy tắc vào `docs/architecture.md`**

Thêm một mục ngắn (sau mục 3.2) nêu: `/api/status` là endpoint công khai; cửa chặn bảo trì nằm trong `src/app.js` **sau** các mount static và **trước** `app.use('/api', apiRoutes)`; danh sách miễn trừ gồm `/health`, `/version`, `/status`, `/admin/dashboard`; lý do `/health` không được chặn (deploy tự rollback) và `/admin/dashboard/login` không được chặn (không thì khóa xong không vào lại được).

- [x] **Step 7: Xác minh bằng server thật**

Run: `npm run dev:server` (cửa sổ khác) rồi `curl -s http://127.0.0.1:3000/api/status`
Expected: `{"result":true,"data":{"locked":false,...}}`
Run: `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/health`
Expected: `200`

- [x] **Step 8: Commit**

```bash
git add src/app.js src/modules/meta/meta.controller.js src/routes/meta.routes.js scripts/verify-controller-split.mjs docs/architecture.md tests/test-service-lock-endpoint.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): gan cua chan vao app va them /api/status cong khai"
```

---

### Task 4: WebSocket — từ chối kết nối mới và đóng kết nối đang mở

**Files:**
- Modify: `src/services/community-realtime.service.js` (chặn trong `httpServer.on('upgrade', ...)` khoảng dòng 180–201; thêm `disconnectAllForMaintenance()`)
- Test: `tests/test-community-realtime-maintenance.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-community-realtime-maintenance.js'`)

**Interfaces:**
- Consumes: `ServiceLockService.getStatus()` (Task 1) — chỉ dùng để guard gọi; test của task này monkey-patch.
- Produces: `CommunityRealtime.disconnectAllForMaintenance(): void` — đóng mọi client bằng `ws.close(1001, 'Dich vu dang bao tri')`, chịu được client đã chết (bọc `try/catch` từng client).

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-community-realtime-maintenance.js`:

| Test | Khẳng định |
| :--- | :--- |
| đóng hết client đang mở | gán `gateway.clients = new Set([{ws:{close:spy1}}, {ws:{close:spy2}}])` rồi gọi `disconnectAllForMaintenance()` ⇒ cả hai `close` được gọi với `(1001, 'Dich vu dang bao tri')` |
| client đã chết không làm sập | một client có `ws.close` ném lỗi ⇒ lời gọi vẫn hoàn tất, client còn lại vẫn được đóng |
| set rỗng | gọi khi `clients` rỗng ⇒ không ném |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-community-realtime-maintenance.js`
Expected: FAIL — `disconnectAllForMaintenance is not a function`

- [x] **Step 3: Cài đặt**

Thêm `disconnectAllForMaintenance()` vào gateway (vòng lặp cùng kiểu với `close()` ở dòng ~1012, có `try/catch` từng client).
Trong `httpServer.on('upgrade', ...)`: sau kiểm tra origin và trước `this.wss.handleUpgrade(...)`, kiểm tra trạng thái khóa; nếu đang khóa thì ghi `HTTP/1.1 503 Service Unavailable` + `Connection: close` bằng **`socket.end(response)`** (KHÔNG dùng `socket.write(...)` rồi `socket.destroy()` ngay: `write()` đệm bất đồng bộ, `destroy()` có thể huỷ dữ liệu đang đệm nên client nhận "socket hang up" thay vì 503 sạch) rồi `return`. Handler phải là `async` (hoặc bọc IIFE) và toàn bộ nhánh mới nằm trong `try/catch` để không tạo unhandled rejection (Node **không** tự bắt promise reject của handler `'upgrade'`); comment nêu vì sao dùng 503 thô ở tầng socket (không đi qua Express nên không có `res`).

- [x] **Step 4: Chạy lại test**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-community-realtime-maintenance.js`
Expected: PASS.

- [x] **Step 5: Khai manifest**

Thêm `'test-community-realtime-maintenance.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

- [x] **Step 6: Commit**

```bash
git add src/services/community-realtime.service.js tests/test-community-realtime-maintenance.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): tu choi websocket moi va dong ket noi dang mo khi khoa"
```

---

### Task 5: API admin `GET`/`PUT /api/admin/dashboard/service-lock`

**Files:**
- Modify: `src/modules/admin/admin-dashboard.controller.js` (thêm `getServiceLock`, `setServiceLock`)
- Modify: `src/routes/admin.routes.js` (thêm 2 route, **sau** dòng `router.use('/admin/dashboard', requireAdmin)`)
- Modify: `scripts/verify-route-order.mjs` (khai 3 route mới vào `ROUTES_ADDED_AFTER_SPLIT`)
- Test: `tests/test-admin-service-lock.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-admin-service-lock.js'`)

**Interfaces:**
- Consumes: `ServiceLockService.getStatus()`/`setStatus(payload, updatedBy)` (Task 1), `CommunityRealtime.disconnectAllForMaintenance()` (Task 4).
- Produces:
  - `AdminDashboardController.getServiceLock(req, res)` → `{ result:true, data:{ locked, title, message, updated_at, updated_by } }`
  - `AdminDashboardController.setServiceLock(req, res)` → như trên sau khi ghi; `400` khi validate lỗi; gọi `disconnectAllForMaintenance()` khi `locked === true`
  - `updatedBy = req.identityAdminMssv || 'ADMIN_KEY'`

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-admin-service-lock.js` (monkey-patch, **không** cần DB):

| Test | Khẳng định |
| :--- | :--- |
| `GET` trả trạng thái | `200`, `data.locked === false` theo giá trị mock |
| `PUT` ghi + trả record | `200`; `setStatus` được gọi với `(payload, 'TESTADMIN')` khi `req.identityAdminMssv = 'TESTADMIN'` |
| `PUT` không có `identityAdminMssv` | `updatedBy` truyền vào là `'ADMIN_KEY'` |
| `PUT` khi `locked:true` đóng WS | spy trên `disconnectAllForMaintenance` được gọi **đúng 1 lần** |
| `PUT` khi `locked:false` **không** đóng WS | spy không được gọi |
| `PUT` body sai ⇒ `400` | `{ locked:'true' }` ⇒ `400`, `setStatus` **không** được gọi |
| lỗi ngoài dự kiến ⇒ `500` | `setStatus` ném lỗi không có `status` ⇒ `500`, body `result:false` |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-service-lock.js`
Expected: FAIL — `AdminDashboardController.getServiceLock is not a function`

- [x] **Step 3: Cài đặt controller + route**

Hai method theo đúng khuôn `getRankingSync`/`updateRankingSync` (cùng file, cùng cách bọc `try/catch` và trả `err.status || 500`). Route dùng `PUT` thêm vào `admin.routes.js` ngay sau `PUT /admin/dashboard/ranking-sync` để giữ nhóm.

- [x] **Step 4: Chạy lại test**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-service-lock.js`
Expected: PASS.

- [x] **Step 5: Khai guard thứ tự route**

Run: `node scripts/verify-route-order.mjs`
Expected: FAIL — báo thiếu/lệch, liệt kê các route mới.
Thêm vào `ROUTES_ADDED_AFTER_SPLIT`: `'GET /admin/dashboard/service-lock'`, `'PUT /admin/dashboard/service-lock'`, và `'GET /status'` (route của Task 3 chưa được khai nếu Task 3 chưa làm bước này).
Run lại: `node scripts/verify-route-order.mjs`
Expected: `OK - thu tu route cu giong het ban goc, khong hoan vi, khong mat route.`

- [x] **Step 6: Khai manifest**

Thêm `'test-admin-service-lock.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

- [x] **Step 7: Commit**

```bash
git add src/modules/admin/admin-dashboard.controller.js src/routes/admin.routes.js scripts/verify-route-order.mjs tests/test-admin-service-lock.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): api admin GET/PUT cong tac khoa dich vu"
```

---

### Task 6: Client bắt mã `MAINTENANCE` ở tầng HTTP

**Files:**
- Modify: `client/src/api/http.js`
- Test: `tests/frontend/http.test.js` (thêm ca mới vào `describe` đang có)

**Interfaces:**
- Consumes: `request()` hiện có.
- Produces: `MaintenanceError extends ApiError` (`status: 503`, `code: 'MAINTENANCE'`, có `title`, `message`), hàm `notifyMaintenance(details)` phát `window.dispatchEvent(new CustomEvent('bdu:maintenance', { detail }))`.

- [x] **Step 1: Viết test thất bại**

Thêm vào `tests/frontend/http.test.js` (đã có `vi.stubGlobal('fetch', ...)`) hai ca:

| Ca | Khẳng định |
| :--- | :--- |
| 503 + `code:'MAINTENANCE'` | `await expect(request('/api/profile')).rejects.toMatchObject({ name:'MaintenanceError', status:503, code:'MAINTENANCE' })`, và listener `window.addEventListener('bdu:maintenance')` nhận được `detail.title`/`detail.message` |
| 503 **không** có `code:'MAINTENANCE'` | vẫn là `ApiError` thường (không phải `MaintenanceError`) — chốt rằng chỉ đúng mã đó mới kích hoạt màn hình bảo trì |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `node node_modules/vitest/vitest.mjs run --config vitest.config.js http.test.js`
Expected: FAIL — `MaintenanceError` chưa tồn tại / rejection là `ApiError` thường.

- [x] **Step 3: Cài đặt trong `client/src/api/http.js`**

Thêm class + hàm phát event cạnh `SessionExpiredError`/`notifySessionExpired` (giữ đúng khuôn đang có), và nhánh trong `request()` **trước** nhánh `!response.ok` (dòng 63) theo điều kiện `response.status === 503 && data?.code === 'MAINTENANCE'`. Comment nêu vì sao thứ tự nhánh quan trọng.

- [x] **Step 4: Chạy lại test**

Run: `node node_modules/vitest/vitest.mjs run --config vitest.config.js http.test.js`
Expected: PASS cả ca cũ lẫn ca mới.

- [x] **Step 5: Commit**

```bash
git add client/src/api/http.js tests/frontend/http.test.js
git commit -m "feat(service-lock): client nhan dien ma MAINTENANCE va phat su kien"
```

---

### Task 7: Màn hình bảo trì `MaintenanceGate`

**Files:**
- Create: `client/src/app/MaintenanceGate.jsx`
- Modify: `client/src/app/App.jsx` (bọc `<AppRoutes />`)
- Test: `tests/frontend/maintenance-gate.test.jsx`

**Interfaces:**
- Consumes: event `bdu:maintenance` (Task 6), endpoint công khai `GET /api/status` (Task 3).
- Produces: component `MaintenanceGate` nhận `children`, render children khi bình thường, render màn hình bảo trì khi đang khóa.

- [x] **Step 1: Viết test thất bại**

Tạo `tests/frontend/maintenance-gate.test.jsx` theo khuôn `tests/frontend/clubs-rebuild-smoke.test.jsx` (`vi.hoisted`, `vi.stubGlobal('fetch', ...)`, `@testing-library/react`, dùng `vi.useFakeTimers()` cho ca poll):

| Ca | Khẳng định |
| :--- | :--- |
| khởi động khi đang khóa | `fetch('/api/status')` trả `{ result:true, data:{ locked:true, title:'T', message:'M' } }` ⇒ `screen.getByText('T')` và `'M'` xuất hiện, children **không** render |
| khởi động khi bình thường | `locked:false` ⇒ children render, không có màn hình bảo trì |
| nhận event khi đang chạy | render bình thường rồi `window.dispatchEvent(new CustomEvent('bdu:maintenance', { detail:{...} }))` ⇒ màn hình bảo trì hiện ra |
| tự thoát khi mở lại | đang khóa, cho `/api/status` trả `locked:false`, chạy `vi.advanceTimersByTime(30_000)` ⇒ children render lại |
| lỗi `/api/status` không tự thoát | fetch reject ⇒ màn hình bảo trì **giữ nguyên**, không unmount |
| không poll khi bình thường | sau khi khởi động với `locked:false`, `advanceTimersByTime(60_000)` ⇒ `fetch` vẫn chỉ được gọi **1 lần** |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `node node_modules/vitest/vitest.mjs run --config vitest.config.js maintenance-gate.test.jsx`
Expected: FAIL — không tìm thấy module `MaintenanceGate.jsx`

- [x] **Step 3: Cài đặt component + bọc vào App**

`MaintenanceGate.jsx`: state trạng thái; `useEffect` gọi `/api/status` một lần khi mount và đăng ký listener `bdu:maintenance` (dọn listener khi unmount); khi đang khóa thì `setInterval` 30 giây gọi lại `/api/status`; nút "Thử lại" gọi lại ngay. Màn hình là lớp phủ toàn trang, chỉ dùng class CSS đã có trong `client/src/styles/app.css` (nếu cần class mới thì thêm ở cuối file với comment nêu lý do).
`App.jsx`: `<AppProviders><MaintenanceGate><AppRoutes /></MaintenanceGate></AppProviders>`.

- [x] **Step 4: Chạy lại test**

Run: `node node_modules/vitest/vitest.mjs run --config vitest.config.js maintenance-gate.test.jsx`
Expected: PASS cả 6 ca.

- [x] **Step 5: Chạy toàn bộ test frontend + lint**

Run: `node node_modules/vitest/vitest.mjs run --config vitest.config.js`
Expected: tất cả file PASS (285+ ca, gồm `routing-contract.test.js` — phải không đổi vì không thêm route).
Run: `npm run lint:frontend`
Expected: 0 error (1 warning `exhaustive-deps` ở `EnglishPage.jsx` là có sẵn).

- [x] **Step 6: Commit**

```bash
git add client/src/app/MaintenanceGate.jsx client/src/app/App.jsx tests/frontend/maintenance-gate.test.jsx
git commit -m "feat(service-lock): man hinh bao tri toan trang cho nguoi dung"
```

---

### Task 8: Công tắc trong `/admin`

**Files:**
- Modify: `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`
- Test: `tests/test-admin-service-lock-ui.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-admin-service-lock-ui.js'`)

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/dashboard/service-lock` (Task 5).
- Produces: trong tab System của `/admin` có toggle `#service-lock-toggle`, 2 ô nhập `#service-lock-title`, `#service-lock-message`, và vùng trạng thái `#service-lock-state`.

- [x] **Step 1: Viết test thất bại**

Tạo `tests/test-admin-service-lock-ui.js` theo khuôn `tests/test-admin-ranking-toggle.js` (đọc file bằng `fs.readFileSync` + `assert.match`, **không** cần DB):

| Test | Khẳng định |
| :--- | :--- |
| markup có đủ phần tử | `public/admin/index.html` chứa `service-lock-toggle`, `service-lock-title`, `service-lock-message`, `service-lock-state` |
| JS gọi đúng API | `public/admin/admin.js` chứa `/api/admin/dashboard/service-lock` và `method: 'PUT'` |
| JS có xác nhận trước khi khóa | `admin.js` có `confirm(` trong luồng bật khóa (đọc bằng regex trên đoạn quanh `service-lock-toggle`) |
| route được đăng ký | `src/routes/admin.routes.js` khớp `router.get('/admin/dashboard/service-lock'` và `router.put('/admin/dashboard/service-lock'` |

- [x] **Step 2: Chạy test cho tới khi thấy nó fail**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-service-lock-ui.js`
Expected: FAIL ở assert đầu tiên (markup chưa có).

- [x] **Step 3: Cài đặt UI**

`index.html`: thêm card "Khóa dịch vụ" trong tab System, cùng khu vực với card ranking.
`admin.js`: `state.serviceLock`; `renderServiceLock(data)`; gọi API trong `Promise.all` sẵn có; handler toggle đọc 2 ô nhập, hỏi `confirm()` **chỉ khi bật khóa**, gọi `PUT`, cập nhật `renderServiceLock` và `showToast` (bám sát cách `rankingSyncToggle` đang làm, kể cả việc chặn double-submit).
`admin.css`: style theo card có sẵn.

- [x] **Step 4: Chạy lại test**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-service-lock-ui.js`
Expected: PASS.

- [x] **Step 5: Khai manifest**

Thêm `'test-admin-service-lock-ui.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

- [x] **Step 6: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-service-lock-ui.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): cong tac khoa dich vu trong /admin"
```

---

### Task 9: Nghiệm thu đầu-cuối trên server local

**Files:** không tạo file mới. Chỉ chạy và, nếu phát hiện lệch, sửa tại chỗ rồi commit.

**Interfaces:**
- Consumes: toàn bộ Task 1–8.

- [x] **Step 1: Chạy toàn bộ kiểm tra tự động**

```bash
npm run lint:frontend
node node_modules/vitest/vitest.mjs run --config vitest.config.js

# (1) Hai script guard: chạy TRẦN, KHÔNG set env test. Chúng import bản gốc lịch sử
# (có english-exercise.service.js) nên cần .env được nạp; NODE_ENV=test sẽ làm chúng EXIT=2.
node scripts/verify-controller-split.mjs
node scripts/verify-route-order.mjs

# (2) Test Node: PHẢI có env managed, nếu không load-env.js chặn bằng
# UNMANAGED_TEST_EXECUTION (xem Global Constraints). Trong PowerShell:
#   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
node tests/test-service-lock.service.js
node tests/test-service-lock-guard.js
node tests/test-service-lock-endpoint.js
node tests/test-community-realtime-maintenance.js
node tests/test-admin-service-lock.js
node tests/test-admin-service-lock-ui.js
node tests/test-manifest.test.mjs
node tests/test-import-resolution.js
```

Expected: tất cả PASS; 2 script guard in `OK`.

- [x] **Step 2: Khóa site và kiểm tra 4 nhóm miễn trừ**

Với server đang chạy (`npm run dev:server`) và token admin lấy từ `/admin` (hoặc `ADMIN_DASHBOARD_KEY` trong `.env`):

```bash
curl -s -X PUT http://127.0.0.1:3000/api/admin/dashboard/service-lock \
  -H "x-admin-key: $ADMIN_DASHBOARD_KEY" -H "Content-Type: application/json" \
  -d '{"locked":true,"title":"Bảo trì thử","message":"Thử nghiệm"}'

curl -s -o NUL -w "profile=%{http_code}\n"   http://127.0.0.1:3000/api/profile
curl -s -o NUL -w "health=%{http_code}\n"    http://127.0.0.1:3000/api/health
curl -s -o NUL -w "version=%{http_code}\n"   http://127.0.0.1:3000/api/version
curl -s -o NUL -w "status=%{http_code}\n"    http://127.0.0.1:3000/api/status
curl -s http://127.0.0.1:3000/api/profile
```

Expected: `profile=503`; `health=200`; `version=200`; `status=200`; body của `/api/profile` có `"code":"MAINTENANCE"` kèm `title`/`message` đúng như vừa nhập.

- [x] **Step 3: Kiểm tra trên trình duyệt**

1. Mở `http://127.0.0.1:3000/` → thấy màn hình bảo trì với nội dung vừa nhập (không cần F5).
2. Mở `/admin` → dashboard vẫn dùng được (owner/`x-admin-key` không bị chặn).
3. DevTools → tab Network → WS: kết nối `/ws/community` bị từ chối; và nếu bật khóa khi socket đang mở thì thấy đóng mã `1001`.
4. Bấm "Thử lại" sau khi mở khóa (bước 4) → màn hình biến mất.

- [x] **Step 4: Mở khóa và xác nhận trở lại bình thường**

```bash
curl -s -X PUT http://127.0.0.1:3000/api/admin/dashboard/service-lock \
  -H "x-admin-key: $ADMIN_DASHBOARD_KEY" -H "Content-Type: application/json" \
  -d '{"locked":false}'

curl -s -o NUL -w "profile=%{http_code}\n" http://127.0.0.1:3000/api/profile
```

Expected: `profile=401` (chưa đăng nhập, **không phải** 503) ⇒ cửa chặn đã mở.

- [x] **Step 5: Xác nhận không rò rỉ thông tin nội bộ**

```bash
curl -s http://127.0.0.1:3000/api/status
```

Expected: chỉ có `locked`, `title`, `message` — không có `updated_by`, `updated_at`.

- [x] **Step 6: Commit (chỉ khi có sửa trong bước 1–5)**

```bash
git add -A
git commit -m "test(service-lock): nghiem thu dau-cuoi cong tac bao tri tren local"
```

---

## Ghi chú cho người thực thi

- **Lệch tên file test so với spec (có chủ ý, độ phủ là superset):** spec mục 6 ghi `tests/test-service-lock.js` và `tests/frontend/maintenance-gate.test.jsx`. Plan tách file Node thành 5 file để mỗi task có chu kỳ test riêng: `test-service-lock.service.js`, `test-service-lock-guard.js`, `test-service-lock-endpoint.js`, `test-community-realtime-maintenance.js`, `test-admin-service-lock.js`, `test-admin-service-lock-ui.js`. Riêng test interceptor thì **thêm ca vào `tests/frontend/http.test.js` đang có** (file này đã test `request()` với `vi.stubGlobal('fetch', ...)`) thay vì tạo file mới.
- Đợt dựng lại server 2 tầng **không** nằm trong plan này; quyết định đã chốt nằm ở Phụ lục A của spec. Sau khi plan này xong, đợt đó có plan riêng.
- Nếu phát hiện phải chạm `src/routes/api.routes.js` hoặc thêm migration để làm được, **dừng lại** và báo: cả hai đều là dấu hiệu thiết kế đã trôi khỏi spec.
