# Khoá bảo trì theo nhóm service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay công tắc khoá toàn site bằng công tắc **khoá theo 10 nhóm tính năng**, dùng chung taxonomy `feature-groups.js`; màn hình bảo trì chỉ ảnh hưởng trang của nhóm bị khoá (giữ sidebar); WebSocket chỉ đóng khi nhóm Community bị khoá.

**Architecture:** Trạng thái nằm trong `system_settings` key `service_lock` dạng `{ groups: { <id>: {locked,title,message} } }`. Guard tra nhóm theo `featureForPath()` rồi chặn nếu nhóm đó `lockable` và đang khoá. Client map route→group bằng `serviceGroups.js`, `MaintenanceGate` chuyển vào `AppLayout` bọc `<Outlet/>`.

**Tech Stack:** Node.js 22 + Express 4 (ESM), PostgreSQL 16, React 19 + Vite, site tĩnh `public/admin/`; test Node `node:assert/strict`, frontend Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-13-khoa-dich-vu-theo-nhom-design.md`

## Global Constraints

- Không thêm migration; dùng `system_settings` (`migrations/053`). Không sửa `src/routes/api.routes.js`.
- Không thêm route mới ⇒ `scripts/verify-route-order.mjs` **không** sửa; giữ thứ tự đăng ký route.
- Không thêm dependency runtime.
- Value `service_lock` chỉ `{ groups: { <id>: { locked, title, message } } }`; `locked` boolean; `title` ≤ **120**; `message` ≤ **500**; mọi chuỗi `trim()`.
- Phản hồi chặn: HTTP **503** + `{ result:false, code:'MAINTENANCE', group, title, message }`.
- Nhóm `lockable`: `wordfmt, survey, training, english, learning, community, clubs, vocab, grammar, games`. `portal` KHÔNG lockable.
- `/api/status` trả `{ result:true, data:{ groups } }`; **không** trả `updated_by`/`updated_at`.
- Fail-open: lỗi DB ⇒ coi như không khoá.
- Bản ghi cũ `{locked,title,message}` ⇒ coi như **cả 10 nhóm `lockable` khoá**.
- Mọi file test Node mới phải khai `scripts/test-manifest.mjs`. Test Node chạy kèm env managed:
  `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'`
- Comment/thông báo tiếng Việt, giải thích "vì sao", không emoji.
- Giữ id cũ `service-lock-*` nếu hợp lý; giữ idiom escape mà `tests/test-admin-rendering-safety.js` ghim.

## Review Focus

Năm lớp dễ cắn người dùng, mỗi dòng có test ở task tương ứng:

1. **Portal/đăng nhập không bao giờ bị chặn** (khoá nhầm ⇒ không đăng nhập lại được, `deploy.sh` rollback). → Task 3.
2. **`/community/clans` (CLB) không bị chặn oan khi khoá `community`** — tiền tố dài nhất thắng. → Task 3.
3. **Bản ghi legacy khoá toàn site** phải giữ tình trạng bảo trì, không tự mở oan. → Task 2.
4. **WebSocket chỉ đóng khi Community khoá** (nhóm khác khoá vẫn cho kết nối realtime). → Task 5.
5. **Lệch bản đồ route client↔server** (thêm nhóm mới mà quên một bên). → Task 8.

---

## Phase A — Server

### Task 1: Cờ `lockable` trong taxonomy

**Files:**
- Modify: `src/config/feature-groups.js`
- Test: `tests/test-feature-groups.js` (bổ sung ca)

**Interfaces:**
- Produces: mỗi mục `FEATURE_GROUPS` có `lockable: boolean`; export `LOCKABLE_FEATURE_IDS` (mảng id khoá được, thứ tự giữ nguyên).

- [ ] **Step 1: Bổ sung test (đỏ trước)**

Thêm vào `tests/test-feature-groups.js`:

| Test | Khẳng định |
| :--- | :--- |
| mọi mục có `lockable` boolean | `FEATURE_GROUPS.every(g => typeof g.lockable === 'boolean')` |
| đúng 10 nhóm lockable | `deepEqual(FEATURE_GROUPS.filter(g=>g.lockable).map(g=>g.id), ['wordfmt','survey','training','english','learning','community','clubs','vocab','grammar','games'])` |
| portal KHÔNG lockable | `FEATURE_GROUPS.find(g=>g.id==='portal').lockable === false` |

- [ ] **Step 2: Chạy test thấy fail**

Run: `node tests/test-feature-groups.js` → FAIL (thiếu `lockable`).

- [ ] **Step 3: Implement**

Thêm `lockable` vào từng mục `FEATURE_GROUPS` (portal `false`, còn lại `true`); export `LOCKABLE_FEATURE_IDS` = `FEATURE_GROUPS.filter(g=>g.lockable).map(g=>g.id)`. Cập nhật comment đầu file (bỏ câu "sau này sẽ thêm" — nay đã thêm).

- [ ] **Step 4: Chạy pass + import resolution**

Run: `node tests/test-feature-groups.js` → PASS; `node tests/test-import-resolution.js` → OK.

- [ ] **Step 5: Commit**

```bash
git add src/config/feature-groups.js tests/test-feature-groups.js
git commit -m "feat(service-lock): them co lockable vao taxonomy tinh nang"
```

---

### Task 2: `ServiceLockService` theo nhóm

**Files:**
- Modify: `src/services/service-lock.service.js`
- Test: `tests/test-service-lock.service.js` (viết lại theo shape mới)

**Interfaces:**
- Produces:
  - `LOCKABLE_GROUPS: [{ id, label }]` (từ `FEATURE_GROUPS.filter(g=>g.lockable)`).
  - `getStatus(): Promise<{ groups: Record<id,{locked,title,message}> }>` — đủ 10 khoá, fail-open.
  - `getAdminStatus(): Promise<{ groups, catalog, updated_at, updated_by }>`.
  - `setGroupStatus({ group, locked, title, message }, updatedBy): Promise<{ groups, updated_at, updated_by }>` — validate, merge, ghi.

- [ ] **Step 1: Viết test (đỏ trước)** — monkey-patch `SystemSettingsService.get/getRecord/set`, không cần DB

| Test | Khẳng định |
| :--- | :--- |
| mặc định | `get` trả `null` ⇒ `getStatus().groups` đủ 10 khoá, tất cả `locked:false`, title/message = default |
| chuẩn hoá thiếu trường | `get` trả `{groups:{wordfmt:{locked:true}}}` ⇒ `wordfmt.title/message` = default |
| fail-open | `get` ném lỗi ⇒ resolve 10 nhóm `locked:false`, không ném |
| legacy → all locked | `get` trả `{locked:true,title:'T',message:'M'}` ⇒ **cả 10** nhóm `locked:true`, `title:'T'` |
| setGroupStatus ghi đúng | gọi `{group:'vocab',locked:true,title:' A ',message:'M'},'ADMIN'` ⇒ `set` nhận value `{groups:{vocab:{locked:true,title:'A',message:'M'}}}` |
| setGroupStatus giữ nhóm khác | value hiện tại có `wordfmt.locked:true` ⇒ sau khi set `vocab` vẫn còn `wordfmt` |
| từ chối group lạ | `{group:'portal',...}` và `{group:'xxx'}` ⇒ lỗi `status===400`, `set` không gọi |
| từ chối locked không boolean | `{group:'vocab',locked:'true'}` ⇒ 400 |
| từ chối title >120 / message >500 | ⇒ 400, không ghi |
| điền default khi thiếu nội dung | `{group:'vocab',locked:true}` ⇒ `set` nhận default title/message |

- [ ] **Step 2: Chạy thấy fail** → `getStatus` shape cũ.

- [ ] **Step 3: Implement** theo Interfaces. Giữ `SERVICE_LOCK_SETTING_KEY`, `DEFAULT_TITLE/MESSAGE`, `MAX_*`; bỏ `locked/title/message` phẳng. Hàm `normalizeStatusMap(raw)` xử lý cả shape mới lẫn legacy. Comment nêu lý do back-compat và lý do fail-open.

- [ ] **Step 4: Chạy pass + manifest**

Run: `node tests/test-service-lock.service.js`, `node tests/test-manifest.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-lock.service.js tests/test-service-lock.service.js
git commit -m "feat(service-lock): ServiceLockService doc/ghi trang thai theo nhom"
```

---

### Task 3: Cửa chặn theo nhóm

**Files:**
- Modify: `src/utils/service-lock-guard.js`
- Test: `tests/test-service-lock-guard.js` (viết lại)

**Interfaces:**
- Consumes: `featureForPath`, `OTHER_FEATURE` (config); `getStatus()` (Task 2).
- Produces: `createServiceLockGuard({ getStatus })` như cũ; khi chặn: `res.status(503).json({ result:false, code:'MAINTENANCE', group, title, message })`.

- [ ] **Step 1: Viết test (đỏ trước)**

| Test | Khẳng định |
| :--- | :--- |
| cho qua nhóm không khoá | `getStatus` map `wordfmt.locked:false`; `path:'/wordfmt/format'` ⇒ `next()` |
| chặn nhóm khoá | `wordfmt.locked:true`; `path:'/api/wordfmt/format'` ⇒ `503`, body `code:'MAINTENANCE'`, `group:'wordfmt'` |
| portal không bao giờ chặn | `portal`-prefix paths (`/login`,`/profile`,`/grades`,`/schedule`,`/rankings/me`) ⇒ `next()` dù mọi nhóm locked |
| meta/admin không chặn | `/health`,`/version`,`/status`,`/admin/dashboard/login` ⇒ `next()` |
| **CLB không bị `community` chặn oan** | `community.locked:true` ⇒ `path:'/community/clans'` và `/community/clans/5` ⇒ `next()` (thuộc `clubs`) |
| community chặn đúng | `community.locked:true` ⇒ `/community/posts/1` ⇒ 503 `group:'community'` |
| clubs chặn đúng | `clubs.locked:true` ⇒ `/community/clans` ⇒ 503 `group:'clubs'` |
| fail-open | `getStatus` ném ⇒ `next()`, không 503 |
| res tối thiểu | `getStatus` ném + `res` thiếu `json` ⇒ `next()` |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — dùng `featureForPath(req.path)`; nếu `group === OTHER_FEATURE` hoặc `!group.lockable` ⇒ `next()`; else đọc `status.groups[group.id]`, `locked===true` ⇒ 503 (kèm `group: group.id`); fail-open. Bỏ `EXEMPT_PATHS/EXEMPT_PREFIXES`. Comment giải thích vì sao bỏ danh sách cứng (quy tắc nhóm `lockable` thay thế).

- [ ] **Step 4: Chạy pass.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/service-lock-guard.js tests/test-service-lock-guard.js
git commit -m "feat(service-lock): cua chan theo nhom tinh nang"
```

---

### Task 4: `/api/status` trả map nhóm

**Files:**
- Modify: `src/modules/meta/meta.controller.js`
- Test: `tests/test-service-lock-endpoint.js` (cập nhật)

**Interfaces:**
- Consumes: `ServiceLockService.getStatus()` (Task 2).
- Produces: `MetaController.getServiceStatus(req,res)` → `{ result:true, data:{ groups } }`.

- [ ] **Step 1: Cập nhật test**

| Test | Khẳng định |
| :--- | :--- |
| payload có `groups` | monkey-patch `getStatus` ⇒ `200`, `result:true`, `data.groups` đủ 10 khoá |
| không lộ nội bộ | `JSON.stringify(payload)` không chứa `updated_by`/`updated_at` |
| route tồn tại | `src/routes/meta.routes.js` có `router.get('/status'` |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — trả `{ groups: status.groups }`.

- [ ] **Step 4: Chạy pass.**

- [ ] **Step 5: Commit**

```bash
git add src/modules/meta/meta.controller.js tests/test-service-lock-endpoint.js
git commit -m "feat(service-lock): /api/status tra trang thai theo nhom"
```

---

### Task 5: Realtime chỉ đóng khi Community khoá

**Files:**
- Modify: `src/services/community-realtime.service.js`
- Test: `tests/test-community-realtime-maintenance.js` (cập nhật)

**Interfaces:**
- Consumes: `getStatus().groups.community.locked`.

- [ ] **Step 1: Cập nhật test**

| Test | Khẳng định |
| :--- | :--- |
| từ chối chỉ khi community khoá | mock `getStatus` map có `community.locked:true` ⇒ upgrade nhánh chặn; `wordfmt.locked:true` (community false) ⇒ KHÔNG chặn |
| `disconnectAllForMaintenance` | vẫn gọi `ws.close(1001,'Dich vu dang bao tri')` cho mọi client, chịu client chết |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — trong `upgrade`, `locked = Boolean(status && status.groups && status.groups.community && status.groups.community.locked)`.

- [ ] **Step 4: Chạy pass.**

- [ ] **Step 5: Commit**

```bash
git add src/services/community-realtime.service.js tests/test-community-realtime-maintenance.js
git commit -m "feat(service-lock): realtime chi dong khi nhom Community khoa"
```

---

### Task 6: API admin theo nhóm + tài liệu

**Files:**
- Modify: `src/modules/admin/admin-dashboard.controller.js`
- Modify: `docs/architecture.md`
- Test: `tests/test-admin-service-lock.js` (cập nhật)

**Interfaces:**
- Consumes: `ServiceLockService.getAdminStatus()`, `setGroupStatus(...)` (Task 2); `CommunityRealtime.disconnectAllForMaintenance()`.
- Produces: `getServiceLock(req,res)` → `{ result:true, data:{ groups, catalog, updated_at, updated_by } }`; `setServiceLock(req,res)` → body `{ group, locked, title, message }`, trả `{ result:true, message, data:{ groups, updated_at, updated_by } }`, gọi `disconnectAllForMaintenance()` khi **community** chuyển sang locked; `400`/`500` như cũ.

- [ ] **Step 1: Cập nhật test**

| Test | Khẳng định |
| :--- | :--- |
| GET trả groups+catalog | `200`, `data.groups`, `data.catalog` có 10 mục |
| PUT ghi theo nhóm | `setGroupStatus` nhận `({group:'vocab',locked:true,...}, 'TESTADMIN')` |
| PUT thiếu mssv | `updatedBy==='ADMIN_KEY'` |
| PUT khoá community ⇒ đóng WS | spy `disconnectAllForMaintenance` gọi đúng 1 lần |
| PUT khoá nhóm khác ⇒ KHÔNG đóng WS | spy không gọi |
| PUT body sai ⇒ 400 | `{locked:true}` (thiếu group) ⇒ 400, không gọi set |
| lỗi ngoài ⇒ 500 | `setGroupStatus` ném lỗi không `status` ⇒ 500 |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — controller đọc `{ group, locked, title, message }`; validate sơ bộ `typeof locked === 'boolean'` và `group` là chuỗi; gọi `setGroupStatus`; `if (data.groups?.community?.locked) CommunityRealtime.disconnectAllForMaintenance();` (chỉ khi nhóm vừa ghi là community — dùng `group==='community' && locked===true`).

- [ ] **Step 4: Chạy pass + guard**

Run: `node tests/test-admin-service-lock.js`, `node tests/test-manifest.test.mjs`, `node scripts/verify-route-order.mjs` (TRẦN) → OK.

- [ ] **Step 5: Ghi `docs/architecture.md`** — thay mô tả khoá toàn site bằng khoá theo nhóm; nêu guard dùng `featureForPath` + `lockable`, `/api/status` trả `groups`, realtime chỉ community.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/admin-dashboard.controller.js docs/architecture.md tests/test-admin-service-lock.js
git commit -m "feat(service-lock): api admin bat/tat theo nhom + tai lieu"
```

---

## Phase B — Client + Admin UI

### Task 7: `http.js` mang `group`

**Files:**
- Modify: `client/src/api/http.js`
- Test: `tests/frontend/http.test.js` (cập nhật)

**Interfaces:**
- Produces: `MaintenanceError` có `group`; sự kiện `bdu:maintenance` `detail.group`.

- [ ] **Step 1: Cập nhật test** — 503 + `code:'MAINTENANCE'` kèm `group:'vocab'` ⇒ `MaintenanceError.group==='vocab'`; listener nhận `detail.group`.

- [ ] **Step 2: Chạy thấy fail** (mở nhánh `response.status===503 && data?.code==='MAINTENANCE'` — nhánh này phải đứng TRƯỚC `!response.ok`).

- [ ] **Step 3: Implement** — đọc `data.group` (string hoặc null); truyền vào `MaintenanceError` và `notifyMaintenance`.

- [ ] **Step 4: Chạy pass** — `node node_modules/vitest/vitest.mjs run --config vitest.config.js http.test.js`.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/http.js tests/frontend/http.test.js
git commit -m "feat(service-lock): client nhan ma MAINTENANCE kem group"
```

---

### Task 8: `serviceGroups.js` (route → nhóm)

**Files:**
- Create: `client/src/app/serviceGroups.js`
- Test: `tests/test-service-groups-map.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-service-groups-map.js'`)

**Interfaces:**
- Produces: `featureForRoute(pathname): string | null` — khớp tiền tố dài nhất trong map; không khớp ⇒ `null`.

- [ ] **Step 1: Viết test (đỏ)** — `tests/test-service-groups-map.js` đọc `client/src/app/serviceGroups.js` (hoặc import nếu ESM thuần) + `src/config/feature-groups.js`:

| Test | Khẳng định |
| :--- | :--- |
| map đủ nhóm có pagePrefix (trừ games) | với mọi `g` lockable có `pagePrefixes`, tồn tại ánh xạ pagePrefix → `g.id` |
| khớp dài nhất | `/clans/5` → `clubs`; `/vocab/set/x` → `vocab` |
| route lạ ⇒ null | `/`, `/gpa`, `/unknown` → `null` |

- [ ] **Step 2: Chạy thấy fail** — chưa có module.

- [ ] **Step 3: Implement** `serviceGroups.js`: mảng `[{ prefix, group }]` sắp giảm dần độ dài; `featureForRoute` so ranh giới đoạn. Comment nêu phải đồng bộ `src/config/feature-groups.js`.

- [ ] **Step 4: Chạy pass + khai manifest** — `node tests/test-service-groups-map.js`, `node tests/test-manifest.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/serviceGroups.js tests/test-service-groups-map.js scripts/test-manifest.mjs
git commit -m "feat(service-lock): map route client sang nhom tinh nang"
```

---

### Task 9: `MaintenanceGate` theo nhóm (giữ sidebar)

**Files:**
- Modify: `client/src/app/MaintenanceGate.jsx`, `client/src/app/App.jsx`, `client/src/layouts/AppLayout.jsx`
- Test: `tests/frontend/maintenance-gate.test.jsx` (cập nhật)

**Interfaces:**
- Consumes: `featureForRoute` (Task 8); event `bdu:maintenance` (Task 7); `GET /api/status` (`groups`).
- Produces: `MaintenanceGate` route-aware; render children khi nhóm trang hiện tại không khoá, render màn hình bảo trì khi khoá.

- [ ] **Step 1: Cập nhật test** (mock `useLocation`/router hoặc render trong `MemoryRouter`):

| Ca | Khẳng định |
| :--- | :--- |
| trang nhóm khoá | `location='/vocab'`, `/api/status` `groups.vocab.locked=true` ⇒ hiện title/message, children không render |
| trang nhóm khác | `location='/gpa'` ⇒ children render dù nhóm khác locked |
| nhận event khi chạy | dispatch `bdu:maintenance` `{group:'vocab',...}` khi đang ở `/vocab` ⇒ hiện màn hình |
| tự thoát khi mở lại | đang khoá, `/api/status` trả `locked:false`, `advanceTimersByTime(30_000)` ⇒ children render |
| lỗi status không tự thoát | fetch reject ⇒ giữ nguyên |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — `MaintenanceGate` dùng `useLocation()` + `featureForRoute`; đọc `/api/status` khi mount; poll 30s **chỉ khi** trang hiện tại đang khoá; nghe event (cập nhật map). `App.jsx` bỏ bọc ngoài; `AppLayout.jsx` bọc `<MaintenanceGate><Outlet/></MaintenanceGate>` trong `AppErrorBoundary`.

- [ ] **Step 4: Chạy pass + regression** — `maintenance-gate.test.jsx`, toàn bộ vitest, `routing-contract.test.js` không đổi.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/MaintenanceGate.jsx client/src/app/App.jsx client/src/layouts/AppLayout.jsx tests/frontend/maintenance-gate.test.jsx
git commit -m "feat(service-lock): man hinh bao tri theo nhom, giu sidebar"
```

---

### Task 10: Admin UI danh sách công tắc theo nhóm

**Files:**
- Modify: `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`
- Test: `tests/test-admin-service-lock-ui.js` (cập nhật)

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/dashboard/service-lock` (Task 6).

- [ ] **Step 1: Cập nhật test** (đọc file tĩnh)

| Test | Khẳng định |
| :--- | :--- |
| markup có vùng danh sách | `index.html` có `#service-lock-list` |
| JS gọi đúng API | `admin.js` chứa `/api/admin/dashboard/service-lock` + `method: 'PUT'` + gửi `group` |
| xác nhận khi bật | `confirm(` trong luồng bật khoá |
| route đăng ký | `admin.routes.js` có GET/PUT `service-lock` |

- [ ] **Step 2: Chạy thấy fail.**

- [ ] **Step 3: Implement** — `renderServiceLock(data)` dựng danh sách dòng từ `data.catalog` + `data.groups` (nhãn + switch + ô tiêu đề/nội dung, giữ `dirty` theo dòng); handler PUT `{ group, locked, title, message }`, `confirm()` khi bật; giữ auto-refresh.

- [ ] **Step 4: Chạy pass** — `node tests/test-admin-service-lock-ui.js`, `node tests/test-admin-redesign-ui.js`, `node tests/test-admin-rendering-safety.js`, `node tests/test-manifest.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-service-lock-ui.js
git commit -m "feat(service-lock): /admin cong tac khoa theo tung nhom"
```

---

### Task 11: Rà + nghiệm thu

**Files:** chỉ sửa tại chỗ nếu phát hiện lệch.

- [ ] **Step 1: Chạy toàn bộ test Node + guard**

```powershell
$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
node tests/test-feature-groups.js
node tests/test-service-lock.service.js
node tests/test-service-lock-guard.js
node tests/test-service-lock-endpoint.js
node tests/test-community-realtime-maintenance.js
node tests/test-admin-service-lock.js
node tests/test-admin-service-lock-ui.js
node tests/test-service-groups-map.js
node tests/test-manifest.test.mjs
node tests/test-import-resolution.js
```
Run trần: `node scripts/verify-route-order.mjs`, `node scripts/verify-controller-split.mjs` → `OK`.
Run frontend: `node node_modules/vitest/vitest.mjs run --config vitest.config.js` → tất cả PASS.

- [ ] **Step 2: Nghiệm thu bằng server thật (nếu có `DATABASE_URL` + key admin)**

Bật 1 nhóm:
```bash
curl -s -X PUT http://127.0.0.1:3000/api/admin/dashboard/service-lock \
  -H "x-admin-key: $ADMIN_DASHBOARD_KEY" -H "Content-Type: application/json" \
  -d '{"group":"vocab","locked":true,"title":"Từ vựng bảo trì","message":"Thử"}'
curl -s -o NUL -w "vocab=%{http_code}\n"  http://127.0.0.1:3000/api/vocab/themes
curl -s -o NUL -w "grades=%{http_code}\n" http://127.0.0.1:3000/api/grades
curl -s -o NUL -w "health=%{http_code}\n" http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/status
```
Expected: `vocab=503` (body có `"group":"vocab"`), `grades=` 200/401 (**không** 503), `health=200`; `/api/status` có `groups`.

- [ ] **Step 3: Nghiệm thu trình duyệt**

`/admin` bật `vocab` → mở `/vocab` thấy màn hình bảo trì **trong vùng nội dung, sidebar còn**; `/gpa` bình thường; `/vocab` sau khi tắt tự hết; bật `community` ⇒ WS `/ws/community` bị từ chối, bật nhóm khác ⇒ WS vẫn kết nối.

- [ ] **Step 4: Commit (chỉ khi có sửa)**

```bash
git add -A
git commit -m "test(service-lock): nghiem thu dau-cuoi khoa bao tri theo nhom"
```

---

## Ghi chú cho người thực thi

- Đọc kèm spec `docs/superpowers/specs/2026-10-13-khoa-dich-vu-theo-nhom-design.md`.
- Phải sửa **cả 2 đầu** mọi thay đổi shape dữ liệu (`locked/title/message` → `groups`): `http.js`, `MaintenanceGate`, `/api/status`, admin controller.
- `featureForPath` (server) và `featureForRoute` (client) phải cùng kết luận cho các tiền tố dùng chung — Task 8 có test chéo.
- Nếu phát hiện phải thêm route mới hoặc migration ⇒ **dừng và báo** (đã trôi khỏi spec).
