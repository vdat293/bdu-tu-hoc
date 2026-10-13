# Admin Insights & Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm lại toàn bộ trang `/admin` (mặc định theme sáng, thân thiện/dễ dùng hơn) và thêm tab Insights cùng 5 endpoint phân tích hành vi người dùng.

**Architecture:** Server thêm một taxonomy tính năng (`src/config/feature-groups.js`) và một service đọc dữ liệu (`src/services/traffic-insights.service.js`) trên bảng `traffic_logs` sẵn có, phơi ra 5 endpoint admin mới. Client là site tĩnh `public/admin/` (vanilla JS + Chart.js nhúng sẵn): dựng lại token/theme light-first, một bộ thành phần dùng chung, icon SVG thay emoji, thêm tab Insights và modal Hành trình.

**Tech Stack:** Node.js 22 + Express 4 (ESM), PostgreSQL 16, `node:assert/strict` cho test BE; site tĩnh HTML/CSS/JS + Chart.js cho `/admin`.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-insights-design.md`

## Global Constraints

- Không sửa `src/routes/api.routes.js` và không thêm migration; chỉ dùng bảng `traffic_logs` + `students` sẵn có.
- Không thêm dependency runtime (Chart.js đã nhúng trong `public/admin/chart.min.js`; heatmap dựng bằng CSS grid).
- Giữ thứ tự đăng ký route. Route mới phải khai vào `scripts/verify-route-order.mjs` (`ROUTES_ADDED_AFTER_SPLIT`).
- Mọi file test Node mới phải khai vào `scripts/test-manifest.mjs` (`SAFE_NODE_TESTS`); `tests/test-manifest.test.mjs` canh việc này.
- Chạy test Node phải kèm env managed (PowerShell):
  `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/<file>`
- Múi giờ phân tích luôn là `Asia/Ho_Chi_Minh` (hằng `ANALYTICS_TZ`), không phụ thuộc TZ của server.
- `timeRange` chỉ nhận `1h|6h|24h|7d|30d|all` (mặc định `24h`).
- Theme mặc định của `/admin` là **sáng** (light-first); dark là override.
- Giữ nguyên các `id` cũ mà test đang ghim: `service-lock-toggle|title|message|state`, `ranking-sync-toggle|state|last|next`, và các idiom escape trong `admin.js` (`const safeMssv = escapeHtml(s.mssv)`, `const safeFullName = escapeHtml(s.full_name`, `const methodCls = \`method-${cssToken(method)}\``, `data-log="${jsonStr}"`).
- Comment và thông báo: **tiếng Việt**, giải thích "vì sao", không emoji trong mã.

## Review Focus

Năm lớp đầu vào / chế độ lỗi dễ cắn người dùng nhất, mỗi dòng có test ở task tương ứng:

1. **Múi giờ sai** — `created_at` là UTC; heatmap/cohort phải quy đổi `AT TIME ZONE 'Asia/Ho_Chi_Minh'`, nếu không khung giờ cao điểm lệch 7 tiếng. → Task 3.
2. **Request không khớp tính năng** — endpoint lạ (đăng nhập, identity, thông báo, admin) phải rơi vào `other` và **vẫn nằm trong tổng**, không bị đếm thiếu. → Task 1, Task 3.
3. **Chưa cấu hình DB** — chạy local không `DATABASE_URL` thì trang Insights phải hiện rỗng, không 500 trắng. → Task 3, Task 4.
4. **Hành trình biên** — `mssv` không tồn tại (không 404), sự kiện rỗng, chuỗi sự kiện rất dài (chạm `limit`), và tách phiên đúng ngưỡng 30 phút. → Task 3, Task 10.
5. **Gãy test cũ khi làm lại UI** — đổi markup/CSS dễ phá `test-admin-service-lock-ui.js`, `test-admin-rendering-safety.js`, `test-admin-insights-ui.js`; phải giữ id/idiom hoặc cập nhật test có chủ đích. → Task 5–11.

---

## Phase A — Server

### Task 1: Taxonomy tính năng `feature-groups.js`

**Files:**
- Create: `src/config/feature-groups.js`
- Test: `tests/test-feature-groups.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-feature-groups.js'` vào `SAFE_NODE_TESTS`)

**Interfaces:**
- Produces:
  - `FEATURE_GROUPS: Array<{ id: string, label: string, apiPrefixes: string[], pagePrefixes: string[] }>` (đúng danh sách ở spec mục 5).
  - `OTHER_FEATURE = { id: 'other', label: 'Khác' }`.
  - `featureForPath(rawPath: string): { id, label }` — hàm thuần; bỏ tiền tố `/api` và phần `?...`; so tiền tố **dài nhất** theo ranh giới đoạn; không khớp ⇒ `OTHER_FEATURE`.

- [ ] **Step 1: Write the failing test**

`tests/test-feature-groups.js` (khuôn `console.log('✓/✗')`, đặt `process.exitCode = failed ? 1 : 0`):

| Test | Khẳng định |
| :--- | :--- |
| khớp API route | `featureForPath('/api/wordfmt/format').id === 'wordfmt'` |
| khớp trang SPA | `featureForPath('/confession').id === 'community'`, `featureForPath('/clans').id === 'clubs'` |
| bỏ tiền tố `/api` | `featureForPath('/api/vocab/themes').id === featureForPath('/vocab/themes').id === 'vocab'` |
| bỏ query | `featureForPath('/grammar/progress?x=1').id === 'grammar'` |
| ranh giới đoạn | `featureForPath('/vocabulary').id === 'other'` |
| tiền tố dài nhất thắng | `featureForPath('/community/clans/5').id === 'clubs'` (không phải `community`) |
| không khớp ⇒ other | `featureForPath('/api/login').id === 'other'`, `featureForPath('/notifications').id === 'other'` |
| portal có mặt | `featureForPath('/gpa').id === 'portal'` |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-feature-groups.js`
Expected: FAIL — `Cannot find module '../src/config/feature-groups.js'`.

- [ ] **Step 3: Implement `src/config/feature-groups.js`**

Khai `FEATURE_GROUPS`/`OTHER_FEATURE` đúng spec mục 5. Viết `featureForPath` quét mọi prefix trong `[...apiPrefixes, ...pagePrefixes]`, so `path === prefix || path.startsWith(prefix + '/')`, giữ prefix dài nhất. Comment đầu file nêu: đây là nguồn sự thật duy nhất cho gom tính năng, và sẽ được công tắc khoá per-group tái dùng sau (thêm cờ `lockable`).

- [ ] **Step 4: Run test to verify it passes**

Run như Step 2. Expected: PASS toàn bộ.

- [ ] **Step 5: Khai manifest + kiểm tra guard**

Thêm `'test-feature-groups.js'` vào `SAFE_NODE_TESTS` trong `scripts/test-manifest.mjs`.
Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-manifest.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/feature-groups.js tests/test-feature-groups.js scripts/test-manifest.mjs
git commit -m "feat(admin-insights): them taxonomy tinh nang feature-groups"
```

---

### Task 2: `TrafficInsightsService` — hàm thuần

**Files:**
- Create: `src/services/traffic-insights.service.js`
- Modify: `src/services/traffic.service.js` (thêm `export` cho `getTimeRangeInterval`, dòng ~138)
- Test: `tests/test-traffic-insights.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-traffic-insights.js'`)

**Interfaces:**
- Consumes: `featureForPath`, `FEATURE_GROUPS`, `OTHER_FEATURE` (Task 1); `getTimeRangeInterval` (export từ `traffic.service.js`).
- Produces (hàm thuần):
  - `ANALYTICS_TZ = 'Asia/Ho_Chi_Minh'`, `SESSION_GAP_MS = 1_800_000`.
  - `featureForPath` (re-export từ config để tầng khác import một chỗ).
  - `buildSessions(events, gapMs = SESSION_GAP_MS): Array<{ startAt, endAt, durationMs, eventCount, features: string[] }>` — `events` đã sắp ASC, phần tử có `{ at, featureId, path }`; tách phiên khi `at[i] - at[i-1] > gapMs`.
  - `summarizeTransitions(sessions, topN = 10): Array<{ from, to, count }>` — đếm chuyển `path` liên tiếp trong cùng một phiên, sort giảm dần, cắt `topN`.
  - `bucketByFeature(rows): { items, other }` — `rows` là `[{ featureId, requests, users, errors }]`; gộp theo `featureId` (không khớp ⇒ `other`), trả `items` sort theo `requests` desc với `{ id, label, requests, users, errorRate }` và `other: { requests, users, errorRate }`.

- [ ] **Step 1: Write the failing test**

`tests/test-traffic-insights.js` — phần hàm thuần:

| Test | Khẳng định |
| :--- | :--- |
| tách phiên đúng ngưỡng | 2 sự kiện cách 29 phút ⇒ 1 phiên; cách 31 phút ⇒ 2 phiên |
| sự kiện đơn / rỗng | 1 sự kiện ⇒ 1 phiên; `[]` ⇒ `[]` |
| phiên gom `features` | mỗi phiên liệt kê các `featureId` duy nhất, giữ thứ tự xuất hiện |
| chuyển trang | chuỗi A→B→A trong 1 phiên ⇒ transitions chứa `{from:A,to:B,count:1}` và `{from:B,to:A,count:1}` |
| top N | nhiều cặp ⇒ cắt đúng `topN`, sort count desc |
| bucket gộp | rows có `wordfmt` ×2 ⇒ cộng dồn requests/users, `errorRate = errors/requests` |
| bucket other | row `featureId:'other'` cộng vào `other`, không lên `items` |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-traffic-insights.js`
Expected: FAIL — không tìm thấy module / `buildSessions is not a function`.

- [ ] **Step 3: Implement hàm thuần + export helper**

Trong `traffic.service.js` đổi `function getTimeRangeInterval` thành `export function getTimeRangeInterval` (giữ nguyên thân). Trong `traffic-insights.service.js` khai các hằng + 3 hàm thuần trên, import `featureForPath` từ `../config/feature-groups.js` và re-export.

- [ ] **Step 4: Run test to verify it passes**

Run như Step 2. Expected: PASS.

- [ ] **Step 5: Khai manifest**

Thêm `'test-traffic-insights.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/traffic-insights.service.js src/services/traffic.service.js tests/test-traffic-insights.js scripts/test-manifest.mjs
git commit -m "feat(admin-insights): ham thuan phien/chuyen trang/gom tinh nang"
```

---

### Task 3: `TrafficInsightsService` — 5 hàm truy vấn (có DI runner)

**Files:**
- Modify: `src/services/traffic-insights.service.js`
- Test: `tests/test-traffic-insights.js` (thêm block hàm truy vấn)

**Interfaces:**
- Consumes: `query`, `isDatabaseConfigured` từ `../db/database.js`; `getTimeRangeInterval` (Task 2).
- Produces `TrafficInsightsService` với chữ ký:
  - `getFeatures({ timeRange } = {}, runner?)`
  - `getHourHeatmap({ timeRange } = {}, runner?)`
  - `getCohort({ timeRange } = {}, runner?)`
  - `getQuality({ timeRange } = {}, runner?)`
  - `getUserJourney({ mssv, timeRange, limit } = {}, runner?)`
  - Quy ước `runner`: nếu truyền (test) thì dùng luôn và **bỏ qua** kiểm tra DB; nếu không truyền thì `runner = query` và khi `!isDatabaseConfigured()` trả cấu trúc rỗng. Lỗi từ `runner` để nổi lên (controller trả 500).
  - Shape trả về đúng spec mục 6.2 (a–e).

- [ ] **Step 1: Write the failing test** (dùng fake `runner` bắt `sql`/`params`)

| Test | Khẳng định |
| :--- | :--- |
| có múi giờ VN | `sql` mà `getHourHeatmap` truyền cho runner chứa `AT TIME ZONE 'Asia/Ho_Chi_Minh'` |
| features map theo tính năng | runner trả rows `[{ endpoint:'/wordfmt/format', requests:3, users:2, errors:0 }]` ⇒ `items[0].id==='wordfmt'`, `share` tính trên `totalRequests` |
| features `all` bỏ delta | `timeRange:'all'` ⇒ `deltaPct === null`, `params` không có mốc thời gian |
| heatmap shape | runner trả 7×24 ô ⇒ `matrix` đủ 7 hàng 24 cột, `peak` đúng ô lớn nhất |
| cohort new/returning | runner trả dữ liệu cố định ⇒ `totals` và `dayBuckets` cộng khớp |
| quality p95 | `items[0].p95Ms` lấy từ cột p95 runner trả |
| journey ASC + clamp | runner bắt `sql` chứa `ORDER BY created_at ASC`; `limit:9999` ⇒ params dùng `500` |
| journey rỗng | runner trả `[]` ⇒ `events: []`, `sessions: []`, `transitions: []`, không ném |
| chưa cấu hình DB | gọi **không** truyền runner khi `isDatabaseConfigured()` false ⇒ trả cấu trúc rỗng, không 500 |

(Ghi chú cho test "chưa cấu hình DB": chạy trong env test managed — `.env` không nạp nên `isDatabaseConfigured()` trả false; chỉ cần khẳng định hàm resolve với mảng rỗng.)

- [ ] **Step 2: Run test to verify it fails**

Run như Task 2. Expected: FAIL — `getFeatures is not a function`.

- [ ] **Step 3: Implement 5 hàm truy vấn**

Gom theo tính năng bằng `CASE WHEN` dựng từ hằng số `FEATURE_GROUPS` (literal tĩnh). Dùng `getTimeRangeInterval(timeRange)` cho mệnh đề thời gian; cột thời gian tính toán bọc `(created_at AT TIME ZONE '${ANALYTICS_TZ}')`. Với `hours`/`cohort` khi `timeRange='all'` dùng cửa sổ `30d`. `getUserJourney` uppercase `mssv`, clamp `limit` vào `[1,500]` mặc định `200`, `ORDER BY created_at ASC`, sau đó map sang `events` + `buildSessions` + `summarizeTransitions`.

- [ ] **Step 4: Run test to verify it passes**

Run như Task 2. Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/services/traffic-insights.service.js tests/test-traffic-insights.js
git commit -m "feat(admin-insights): 5 truy van phan tich (features/hours/cohort/quality/journey)"
```

---

### Task 4: Endpoint admin + controller + guard + tài liệu

**Files:**
- Modify: `src/modules/admin/admin-dashboard.controller.js` (thêm 5 method)
- Modify: `src/routes/admin.routes.js` (thêm 5 route sau `PUT /admin/dashboard/service-lock`)
- Modify: `scripts/verify-route-order.mjs` (`ROUTES_ADDED_AFTER_SPLIT`)
- Modify: `docs/architecture.md` (mục insights + taxonomy + múi giờ)
- Test: `tests/test-admin-insights-endpoint.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-admin-insights-endpoint.js'`)

**Interfaces:**
- Consumes: `TrafficInsightsService.*` (Task 3).
- Produces: `AdminDashboardController.getInsightsFeatures|getInsightsHours|getInsightsCohort|getInsightsQuality|getInsightsJourney(req, res)` → `res.json({ result:true, data })`; lỗi ⇒ `res.status(err.status || 500).json({ result:false, message })`.

- [ ] **Step 1: Write the failing test**

`tests/test-admin-insights-endpoint.js` (monkey-patch `TrafficInsightsService`, fake `res` như `tests/test-admin-service-lock.js`):

| Test | Khẳng định |
| :--- | :--- |
| GET features trả data | `200`, `result:true`, `data` là object có `items`, `totalRequests`, `other` |
| GET journey clamp + mssv hoa | gọi với `params.mssv='sv1'` ⇒ service nhận `mssv:'SV1'` |
| journey student null vẫn 200 | service trả `student:null, events:[]` ⇒ `200` |
| lỗi ngoài dự kiến ⇒ 500 | service ném lỗi không `status` ⇒ `500`, `result:false` |
| route đã đăng ký | đọc `src/routes/admin.routes.js`: có đủ 5 dòng route (kể cả `:mssv`) |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-insights-endpoint.js`
Expected: FAIL — `getInsightsFeatures is not a function`.

- [ ] **Step 3: Implement controller + route**

5 method bọc `try/catch`, đọc `req.query.timeRange`/`req.params.mssv`/`req.query.limit`. 5 route thêm **sau** dòng `router.put('/admin/dashboard/service-lock', ...)`:
`GET /admin/dashboard/insights/features`, `.../hours`, `.../cohort`, `.../quality`, `.../users/:mssv/journey`.

- [ ] **Step 4: Run test + guard route**

Run test như Step 2 → PASS.
Run: `node scripts/verify-route-order.mjs`
Expected: FAIL báo thiếu khai — đúng cơ chế.
Thêm 5 route vào `ROUTES_ADDED_AFTER_SPLIT` (`GET /admin/dashboard/insights/features`, `.../hours`, `.../cohort`, `.../quality`, `GET /admin/dashboard/insights/users/:mssv/journey`).
Run lại: `node scripts/verify-route-order.mjs` → `OK`.

- [ ] **Step 5: Khai manifest + ghi `docs/architecture.md`**

Thêm `'test-admin-insights-endpoint.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.
`docs/architecture.md`: thêm mục nêu nhóm endpoint `/admin/dashboard/insights/*`, vai trò `feature-groups.js`, và quy ước múi giờ `Asia/Ho_Chi_Minh` cho phân tích.

- [ ] **Step 6: Xác minh bằng server thật**

Run: `npm run dev:server` (cửa sổ khác), rồi (PowerShell, có `ADMIN_DASHBOARD_KEY`):
`curl -s -H "x-admin-key: $env:ADMIN_DASHBOARD_KEY" "http://127.0.0.1:3000/api/admin/dashboard/insights/features?timeRange=7d"`
Lặp cho `hours`, `cohort`, `quality`, và `users/<MSSV>/journey`.
Expected: mỗi cái `{"result":true,"data":{...}}`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/admin-dashboard.controller.js src/routes/admin.routes.js scripts/verify-route-order.mjs docs/architecture.md tests/test-admin-insights-endpoint.js scripts/test-manifest.mjs
git commit -m "feat(admin-insights): api admin /insights/* va cap nhat guard/tai lieu"
```

---

## Phase B — Giao diện /admin

### Task 5: Nền tảng thiết kế — token light-first, thành phần chung, icon SVG

**Files:**
- Modify: `public/admin/admin.css` (token + thành phần chung)
- Modify: `public/admin/index.html` (shell: sidebar + topbar, icon SVG)
- Modify: `public/admin/admin.js` (map `ICONS`, helper định dạng/trạng thái, đổi theme mặc định sang sáng)
- Test: `tests/test-admin-redesign-ui.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-admin-redesign-ui.js'`)

**Interfaces:**
- Produces: `ICONS: Record<string,string>` (chuỗi SVG 24×24, `stroke="currentColor"`); helper `formatNumber`, `formatPercent`, `formatDurationMs`, `formatDateTime`, `renderSkeleton`, `renderEmpty`, `renderError`; class CSS dùng chung (`.panel-card`, `.table-scroll`, `.kpi-card`, `.chip`, `.stack-skeleton`...).

- [ ] **Step 1: Write the failing test**

`tests/test-admin-redesign-ui.js` (đọc file bằng `fs.readFileSync` + `assert.match`):

| Test | Khẳng định |
| :--- | :--- |
| theme mặc định sáng | `admin.js` khởi tạo theme với fallback `'light'` |
| token light-first | `admin.css` chứa `[data-theme="light"]` và biến `--color-primary` |
| icon SVG | `index.html`: mỗi nút nav sidebar có `<svg`; `admin.js` chứa `const ICONS` |
| helper chung | `admin.js` chứa `renderSkeleton`, `renderEmpty`, `renderError`, `formatNumber` |
| giữ id cũ | `index.html` còn `service-lock-toggle`, `ranking-sync-toggle` |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-redesign-ui.js`
Expected: FAIL ở assert đầu (chưa có `[data-theme="light"]` / helper).

- [ ] **Step 3: Implement nền tảng**

`admin.css`: token light-first theo spec mục 4.2 (`#F8FAFC`, `#FFFFFF`, `#1E3A8A`, `#475569`, `#DBEAFE`, `#1E40AF`, `#3B82F6`, `#D97706`, `#DC2626`, `#E9EEF6`), dark là `[data-theme="dark"]` override; thêm class thành phần chung.
`admin.js`: thêm `ICONS`; thêm helper; đổi fallback theme mặc định sang `'light'` (giữ nút toggle). Thay emoji trong sidebar/topbar/các nút tĩnh bằng `ICONS.<name>`.
`index.html`: chèn `<svg>` vào nút nav; đảm bảo class thành phần chung áp vào panel/KPI hiện có.

- [ ] **Step 4: Run test + test cũ**

Run như Step 2 → PASS.
Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-rendering-safety.js`
Expected: PASS (giữ idiom escape). Nếu đỏ, khôi phục đúng chuỗi bị ghim, **không** nới lỏng test.

- [ ] **Step 5: Khai manifest + commit**

Thêm `'test-admin-redesign-ui.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

```bash
git add public/admin/admin.css public/admin/index.html public/admin/admin.js tests/test-admin-redesign-ui.js scripts/test-manifest.mjs
git commit -m "feat(admin-ui): nen tang light-first + thanh phan chung + icon SVG"
```

---

### Task 6: Tab Insights

**Files:**
- Modify: `public/admin/index.html` (section `pane-insights` + nút tab)
- Modify: `public/admin/admin.js` (fetch + render 4 khối + `state.insights`)
- Modify: `public/admin/admin.css` (heatmap + khối insights)
- Test: `tests/test-admin-insights-ui.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-admin-insights-ui.js'`)

**Interfaces:**
- Consumes: 5 endpoint `/api/admin/dashboard/insights/*` (Task 4).
- Produces: element `#pane-insights`, `#feature-ranking`, `#hours-heatmap`, `#cohort-chart`, `#quality-table`; hàm `renderFeatureRanking`, `renderHoursHeatmap`, `renderCohort`, `renderQuality`.

- [ ] **Step 1: Write the failing test**

`tests/test-admin-insights-ui.js`:

| Test | Khẳng định |
| :--- | :--- |
| markup đủ khối | `index.html` có `pane-insights`, `feature-ranking`, `hours-heatmap`, `cohort-chart`, `quality-table` |
| gọi đúng API | `admin.js` chứa `insights/features`, `insights/hours`, `insights/cohort`, `insights/quality` |
| có fallback số cho heatmap | `admin.js` chứa `hours-heatmap-table` (bảng số đi kèm) |
| CSS heatmap | `admin.css` có `.heatmap-grid` và `.heatmap-cell` |
| một endpoint lỗi không sập tab | `admin.js` có `.catch(` quanh các lời gọi insights |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-insights-ui.js`
Expected: FAIL ở assert `pane-insights`.

- [ ] **Step 3: Implement tab Insights**

`index.html`: thêm nút tab + `<section id="pane-insights">` với 4 panel card (tiêu đề + phụ đề nêu câu hỏi) và bảng số dự phòng cho heatmap.
`admin.js`: `state.insights`; thêm 4 lời gọi vào `Promise.all` trong `fetchAllData` với `.catch(() => null)`; render 4 khối dùng helper trạng thái; heatmap dựng lưới CSS 7×24, mỗi ô `title` + số; cohort vẽ Chart.js; quality là bảng `p95Ms`.
`admin.css`: `.heatmap-grid` (grid 24 cột), thang màu cool→hot, responsive.

- [ ] **Step 4: Run test to verify it passes**

Run như Step 2 → PASS.

- [ ] **Step 5: Khai manifest + commit**

Thêm `'test-admin-insights-ui.js'` vào `SAFE_NODE_TESTS`; run `node tests/test-manifest.test.mjs` → PASS.

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-insights-ui.js scripts/test-manifest.mjs
git commit -m "feat(admin-ui): tab Insights (tinh nang/heatmap/cohort/chat luong)"
```

---

### Task 7: Làm lại tab Tổng quan

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/admin/admin.js` (`renderOverview`, `renderTimelineChart`, `renderEndpoints`)
- Modify: `public/admin/admin.css`
- Test: dùng lại `tests/test-admin-redesign-ui.js` (thêm assert) 

**Interfaces:**
- Consumes: helper + thành phần (Task 5).
- Produces: Tổng quan dùng `.kpi-card`/`.panel-card` chung, có skeleton/rỗng/lỗi; giữ `id` KPI hiện có.

- [ ] **Step 1: Thêm ca test vào `tests/test-admin-redesign-ui.js`**

| Test | Khẳng định |
| :--- | :--- |
| KPI dùng thành phần chung | `index.html` vùng overview có class `kpi-card` |
| preview top tính năng | `index.html` có `endpoints-list-preview` và `admin.js` có `renderFeatureRanking` tái dùng cho preview |

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-redesign-ui.js`
Expected: FAIL ở assert `kpi-card`.

- [ ] **Step 3: Implement**

Đưa 4 KPI + timeline + preview top tính năng về bộ thành phần chung; thêm skeleton/empty/error; giữ id KPI cũ (nếu đổi id thì cập nhật test tương ứng, có chủ đích).

- [ ] **Step 4: Run test to verify it passes**

Run như Step 2 → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-redesign-ui.js
git commit -m "feat(admin-ui): lam lai tab Tong quan"
```

---

### Task 8: Làm lại tab Nhật ký + Sinh viên

**Files:**
- Modify: `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`
- Test: `tests/test-admin-redesign-ui.js` (thêm assert)

**Interfaces:**
- Produces: bảng Nhật ký + bảng Sinh viên dùng `.table-scroll`, header dính, sắp xếp được (`aria-sort`); giữ các `id` lọc hiện có (`log-filters`, `visited-students-table-body`...). Nút **Hành trình** trong bảng Sinh viên gọi `openJourney` (Task 10) — ở task này chỉ render nút (Task 10 nối hàm).

- [ ] **Step 1: Thêm ca test**

| Test | Khẳng định |
| :--- | :--- |
| bảng cuộn ngang | `index.html` có `table-scroll` ở vùng Nhật ký và Sinh viên |
| nút Hành trình | `admin.js` có `openJourney(` |
| giữ lọc cũ | `index.html` còn `logs-table-body`, `visited-students-table-body` |

- [ ] **Step 2: Run test to verify it fails** → FAIL ở `table-scroll`.

- [ ] **Step 3: Implement** — bọc bảng trong `.table-scroll`; đưa filter về thành phần `.chip`; thêm nút Hành trình; giữ nguyên nghiệp vụ lọc/phân trang và các idiom escape.

- [ ] **Step 4: Run test to verify it passes** + chạy `test-admin-rendering-safety.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-redesign-ui.js
git commit -m "feat(admin-ui): lam lai tab Nhat ky va Sinh vien"
```

---

### Task 9: Làm lại tab Hệ thống (giữ service-lock + ranking)

**Files:**
- Modify: `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`
- Test: `tests/test-admin-service-lock-ui.js` (phải vẫn PASS), `tests/test-admin-redesign-ui.js`

**Interfaces:**
- Produces: panel VPS + ranking + service-lock dùng thành phần chung; **giữ nguyên** `service-lock-toggle/title/message/state`, chuỗi `/api/admin/dashboard/service-lock`, `method: 'PUT'`, `confirm(` trong nhánh bật khoá, và `ranking-sync-*`.

- [ ] **Step 1: Xác nhận test ràng buộc hiện có**

Run: `$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-admin-service-lock-ui.js`
Expected: PASS (mốc trước khi sửa).

- [ ] **Step 2: Implement** — chuyển panel hệ thống sang thành phần chung, thay emoji bằng `ICONS`, **không** đổi id/logic service-lock và ranking.

- [ ] **Step 3: Run test ràng buộc**

Run lại `node tests/test-admin-service-lock-ui.js` → PASS.
Run `node tests/test-admin-redesign-ui.js` → PASS (đã có assert giữ id).

- [ ] **Step 4: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css
git commit -m "feat(admin-ui): lam lai tab He thong, giu nguyen service-lock/ranking"
```

---

### Task 10: Modal Hành trình

**Files:**
- Modify: `public/admin/index.html` (thêm `#modal-journey`)
- Modify: `public/admin/admin.js` (`openJourney`, render timeline phiên, nối từ bảng Sinh viên)
- Modify: `public/admin/admin.css`
- Test: `tests/test-admin-insights-ui.js` (thêm assert)

**Interfaces:**
- Consumes: `GET /admin/dashboard/insights/users/:mssv/journey` (Task 4); helper modal (Task 5).
- Produces: `openJourney(mssv)`; element `#modal-journey`, `#journey-timeline`, `#journey-transitions`.

- [ ] **Step 1: Thêm ca test**

| Test | Khẳng định |
| :--- | :--- |
| markup modal | `index.html` có `modal-journey`, `journey-timeline`, `journey-transitions` |
| gọi đúng endpoint | `admin.js` chứa `insights/users/` và `journey` |
| xử lý truncated | `admin.js` có nhánh đọc `truncated` |

- [ ] **Step 2: Run test → FAIL** (`Error: modal-journey`).

- [ ] **Step 3: Implement** — modal mở từ nút Hành trình; gọi endpoint với `encodeURIComponent(mssv)`; render timeline theo phiên (đánh dấu sự kiện lỗi, nhãn tính năng), top transitions; hiện nhắc khi `truncated`; escape mọi dữ liệu.

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css tests/test-admin-insights-ui.js
git commit -m "feat(admin-ui): modal Hanh trinh nguoi dung"
```

---

### Task 11: Rà trợ năng, responsive, chuyển động + nghiệm thu toàn bộ

**Files:**
- Modify: `public/admin/admin.css`, `public/admin/index.html` (nhãn `aria`, heading tuần tự)
- Không tạo file mới.

- [ ] **Step 1: Rà & sửa** — heading tuần tự; `focus-visible` cho mọi phần tử tương tác; `aria-sort` cho bảng sắp xếp; `@media (prefers-reduced-motion: reduce)` tắt chuyển động; bảng cuộn ngang ở 375; sidebar drawer dưới 900px.

- [ ] **Step 2: Chạy toàn bộ kiểm tra tự động**

```powershell
$env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
node tests/test-feature-groups.js
node tests/test-traffic-insights.js
node tests/test-admin-insights-endpoint.js
node tests/test-admin-insights-ui.js
node tests/test-admin-redesign-ui.js
node tests/test-admin-rendering-safety.js
node tests/test-admin-service-lock-ui.js
node tests/test-manifest.test.mjs
node tests/test-import-resolution.js
```
Expected: tất cả PASS.

```powershell
# 2 script guard chạy TRẦN (cần .env): KHÔNG set env test
node scripts/verify-controller-split.mjs
node scripts/verify-route-order.mjs
```
Expected: cả hai in `OK`.

- [ ] **Step 3: Nghiệm thu trên trình duyệt (server local)**

Mở `http://127.0.0.1:3000/admin`, kiểm:
1. Mặc định **sáng**; bấm toggle sang tối vẫn đọc được.
2. 5 tab hoạt động; tab Insights đổi mốc thời gian cập nhật 4 khối; heatmap có bảng số dự phòng.
3. Mở **Hành trình** một MSSV có dữ liệu → thấy timeline theo phiên; thử MSSV rỗng → rỗng êm, không vỡ.
4. Thu nhỏ còn 375px: không cuộn ngang cả trang (chỉ bảng cuộn trong khung).
5. Tương phản chữ ≥ 4.5:1 ở cả hai theme (kiểm bằng DevTools).

- [ ] **Step 4: Commit**

```bash
git add public/admin/admin.css public/admin/index.html public/admin/admin.js
git commit -m "feat(admin-ui): ra tro nang, responsive, chuyen dong; nghiem thu toan bo"
```

---

## Ghi chú cho người thực thi

- **Phase A trước Phase B**: không bắt đầu Task 5–11 khi Task 1–4 chưa PASS + guard xanh (trang Insights cần endpoint thật).
- **Đọc kèm spec** `docs/superpowers/specs/2026-10-13-admin-insights-design.md`; mọi hình dạng dữ liệu (shape) và bảng danh mục tính năng lấy từ đó.
- **Test DB thật** cho các truy vấn tổng hợp (nếu muốn) để ở nhóm quarantined như `test-traffic-logging.js`; không thêm vào runner an toàn.
- Nếu phát hiện phải sửa `src/routes/api.routes.js` hoặc thêm migration ⇒ **dừng lại và báo**, vì thiết kế đã trôi khỏi spec.
- Công tắc khoá per-group vẫn **gác**; taxonomy ở Task 1 sẽ được nó tái dùng sau (thêm cờ `lockable`).
