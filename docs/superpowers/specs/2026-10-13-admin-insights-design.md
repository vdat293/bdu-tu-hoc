# Spec — Làm lại toàn bộ `/admin` (light-first) kèm phân tích hành vi người dùng

**Ngày:** 2026-10-13
**Trạng thái:** chờ duyệt (chưa implement)
**Phạm vi:** **toàn bộ trang `/admin`** (site tĩnh trong `public/admin/`) — làm lại giao diện cả 5 màn cho thân thiện, dễ dùng hơn; và thêm các API đọc dữ liệu hành vi cho nó. Không đụng giao diện người dùng cuối (React `client/`).
**Liên quan:** công tắc khoá dịch vụ per-group đã bàn trước đó **tạm gác**; taxonomy ở mục 5 sẽ được nó tái dùng sau (xem Phụ lục B).

---

## 1. Bối cảnh

`/admin` hiện là "Traffic & Logs Dashboard": site tĩnh `public/admin/` (vanilla JS + Chart.js nhúng sẵn, không framework), đọc dữ liệu từ bảng Postgres `traffic_logs` do middleware `TrafficService.middleware()` (`src/services/traffic.service.js:252`) ghi cho **mọi request API và mọi lần tải trang HTML** (bỏ qua file tĩnh). Mỗi dòng log có: `method, path, route, status_code, response_time_ms, mssv, full_name, ip_address, user_agent, device_type, os, browser, referrer, created_at`.

Chủ sở hữu đang định hướng **data science**: cần nhìn rõ người dùng quan tâm tính năng nào, dùng máy gì, khung giờ cao điểm, mức giữ chân, và một người cụ thể đã tương tác thế nào.

**Hai mục tiêu của đợt này (theo thứ tự ưu tiên):**
1. **Làm lại toàn bộ giao diện `/admin`** cho **thân thiện và dễ dùng hơn** — không chỉ đẹp: nhãn rõ, bố cục dễ quét, đủ trạng thái đang tải/rỗng/lỗi, mặc định **theme sáng**.
2. **Thêm các phân tích hành vi** còn thiếu (tính năng hot, khung giờ cao điểm, hành trình một người, chất lượng, cohort/giữ chân).

**Điểm mấu chốt của khảo sát hiện trạng:** phần lớn dữ liệu cần đã có trong `traffic_logs`; thiếu sót chủ yếu là **cách gom/tổng hợp** và **cách trình bày**, cộng thêm giao diện còn emoji, mật độ thấp, và mặc định tối.

---

## 2. Ý định đã xác nhận

| | |
| :--- | :--- |
| **Kết quả** | Toàn bộ `/admin` được làm lại (mặc định **theme sáng**) cho thân thiện, dễ dùng: 5 màn (Tổng quan, Insights, Nhật ký, Sinh viên, Hệ thống) dùng chung một bộ thành phần và trạng thái; icon SVG thay emoji. Thêm tab **Insights** trả lời 5 câu hỏi: (1) tính năng nào được quan tâm nhất, (2) khung giờ cao điểm, (3) một sinh viên đã tương tác ra sao, (4) máy/OS/browser và chất lượng dịch vụ, (5) cohort & giữ chân. |
| **Ai dùng** | Chủ sở hữu/vận hành, qua `/admin`, sau khi đăng nhập (khoá admin hiện có). |
| **Vì sao bây giờ** | Cần hiểu hành vi người dùng trước khi dựng lại server; dữ liệu 14 ngày nên phải gom lại trước khi hết; và `/admin` hiện khó dùng nên cần làm lại một lần. |
| **Thành công** | (a) Mọi màn `/admin` đọc được rõ ràng trên màn 375–1440, có trạng thái tải/rỗng/lỗi, thao tác bàn phím được, tương phản ≥ 4.5:1 ở cả sáng lẫn tối. (b) Tab Insights: đổi mốc thời gian thấy xếp hạng tính năng, heatmap giờ×thứ, cohort/giữ chân, chất lượng cập nhật. (c) Từ danh sách sinh viên mở được **Hành trình** của một MSSV (timeline có thứ tự + phiên). (d) Không thêm dependency runtime mới. |
| **Ràng buộc** | Không sửa `src/routes/api.routes.js`; không thêm migration; không thêm thư viện (dùng Chart.js sẵn có + CSS grid cho heatmap); giữ thứ tự đăng ký route; route mới phải khai vào `scripts/verify-route-order.mjs`; test Node mới phải khai `scripts/test-manifest.mjs`; chạy test Node kèm env managed. |
| **Ngoài phạm vi** | Tracking cấp click phía client; bản đồ địa lý; sửa giao diện người dùng cuối; công tắc khoá per-group (Phụ lục B); sửa schema `traffic_logs`. |

---

## 3. Hiện trạng dữ liệu (đủ/thiếu)

Nguồn: `traffic_logs` (Postgres, giữ 14 ngày, tự purge). Chuẩn hoá mốc thời gian dùng `getTimeRangeInterval()` sẵn có: `1h|6h|24h|7d|30d|all` (mặc định `24h`).

| Câu hỏi | Trạng thái | Việc spec này làm |
| :--- | :--- | :--- |
| Tính năng hot | Có `route`/`path` thô, chưa có nhãn tính năng, chưa gộp điều hướng trang | Taxonomy + gom theo tính năng |
| Khung giờ cao điểm | **Không có** (`getTimeline` chỉ bucket giờ trong ≤24h, ngày cho dài hơn) | Endpoint heatmap giờ×thứ |
| Hành trình một người | `getUserActivity` chỉ **tổng hợp**, không có dòng thời gian | Endpoint journey có thứ tự + phiên |
| Máy/OS/browser | **Có** (`device_type`, `os`, `browser`) | Trình bày lại đẹp hơn |
| Chất lượng dịch vụ | Có latency trung bình + đếm lỗi, **chưa** p95 theo tính năng | Endpoint quality (p95 + tỉ lệ lỗi theo tính năng) |
| Cohort/giữ chân | Có `mssv` + `created_at` + `students.first_login_at/last_login_at`, chưa gom | Endpoint cohort |

---

## 4. Làm lại toàn bộ giao diện `/admin`

Định hướng: **light-first** (mặc định sáng), style **Data-Dense Dashboard**. Mục tiêu chính là **thân thiện và dễ dùng**, không chỉ đẹp. Làm lại cả 5 tab, sidebar, topbar, modal, bảng, form.

### 4.1. Nguyên tắc dễ dùng (áp cho mọi màn)

- **Nhãn rõ nghĩa** bằng tiếng Việt; mỗi khối có tiêu đề + phụ đề nói khối đó trả lời câu hỏi gì (tránh bảng số liệu "trần" không ai hiểu).
- **Phân cấp thị giác** nhất quán: KPI → xu hướng → chi tiết; mỗi trang một mục đích rõ.
- **Đủ trạng thái** cho mọi khối: *đang tải* (skeleton), *rỗng* (lời nhắc), *lỗi* (nút thử lại). Không để khoảng trắng/lỗi câm.
- **Bộ lọc nhất quán**: mốc thời gian + auto-refresh nằm ở topbar, giữ nguyên khi chuyển tab; bộ lọc riêng của bảng nằm ngay trên bảng đó.
- **Bảng dễ dùng**: header dính, sắp xếp được bằng bàn phím (`aria-sort`), phân trang rõ, cuộn ngang trên mobile trong wrapper `.table-scroll`.
- **Tương tác**: hover + focus-visible rõ, chuyển tiếp 150–300ms, `cursor: pointer` cho mọi thứ bấm được; **không dựa vào màu đơn thuần** để truyền nghĩa (luôn kèm số/nhãn/ký hiệu).
- **Định dạng số thống nhất**: phân cách nghìn, phần trăm 1–2 chữ số, thời lượng `ms`, thời gian `dd/mm HH:mm`.
- **Trợ năng**: heading tuần tự (h1→h2→h3), tương phản chữ ≥ 4.5:1 ở cả hai theme, thao tác được bằng bàn phím, tôn trọng `prefers-reduced-motion`.
- **Responsive**: kiểm ở 375 / 768 / 1024 / 1440; sidebar thu gọn thành drawer dưới 900px (đã có, giữ và rà lại).

### 4.2. Token & mỹ thuật

- **Mặc định `[data-theme="light"]`**; giữ dark làm tùy chọn qua toggle sẵn có.
- **Bảng màu light** (theo Data-Dense Dashboard): nền `#F8FAFC`, card `#FFFFFF`, chữ `#1E3A8A`, chữ phụ `#475569`, viền `#DBEAFE`, chủ đạo `#1E40AF`, phụ `#3B82F6`, nhấn `#D97706`, lỗi `#DC2626`, muted `#E9EEF6`. Dark giữ tông hiện tại nhưng đối chiếu lại cùng thang tương phản.
- **Typography**: giữ cặp font hiện có (Plus Jakarta Sans + JetBrains Mono cho số) để không thêm phụ thuộc mạng; chuẩn hoá thang **12 / 14 / 16 / 18 / 24 / 32**.
- **Icon**: bỏ emoji → **inline SVG** (Lucide-style) ở sidebar, KPI card, nút, tiêu đề khối.
- Bo góc / bóng / viền nhất quán theo token; mật độ dày hợp dashboard.

### 4.3. Cấu trúc tab sau khi làm lại

| Tab | Nội dung |
| :--- | :--- |
| **Tổng quan** | 4 KPI + timeline + preview xếp hạng tính năng (top 5) |
| **Insights** (mới) | Xếp hạng tính năng (đầy đủ), heatmap giờ×thứ, cohort/giữ chân, thiết bị + chất lượng |
| **Nhật ký** | Bảng log + bộ lọc (giữ chức năng, làm lại trình bày) |
| **Sinh viên** | Danh sách đã truy cập + nút mở **Hành trình** |
| **Hệ thống** | VPS metrics + ranking-sync + service-lock |

Tab "Charts" cũ được gộp: timeline chi tiết + devices/OS/browser chuyển sang Insights; KPI/timeline preview ở Tổng quan.

### 4.4. Bộ thành phần dùng lại

Định nghĩa một lần trong CSS rồi dùng cho mọi tab (tránh mỗi tab một kiểu): sidebar nav, topbar, KPI card, panel card (tiêu đề + phụ đề + thân), bảng dữ liệu, chip lọc, modal, toast, switch, ô nhập, skeleton, empty state, error state. `admin.js` có bộ helper chung tương ứng (xem mục 7.1).

---

## 5. Taxonomy tính năng (dùng chung)

**File mới:** `src/config/feature-groups.js` — nguồn sự thật duy nhất cho việc gom theo tính năng.

```js
// Mỗi tính năng: id (ổn định), label (hiển thị), apiPrefixes (so trên route/path API),
// pagePrefixes (so trên đường dẫn trang SPA đã tải).
export const FEATURE_GROUPS = [
  { id: 'portal',    label: 'Cổng sinh viên',       apiPrefixes: ['/profile', '/grades', '/schedule', '/rankings'], pagePrefixes: ['/gpa', '/info', '/schedule', '/leaderboard', '/enrollment'] },
  { id: 'wordfmt',   label: 'Word Formatting',       apiPrefixes: ['/wordfmt'],                 pagePrefixes: ['/wordfmt'] },
  { id: 'survey',    label: 'Survey Automation',      apiPrefixes: ['/survey', '/tool-runs'],    pagePrefixes: ['/survey'] },
  { id: 'training',  label: 'Điểm rèn luyện',         apiPrefixes: ['/training-score'],          pagePrefixes: ['/training-score'] },
  { id: 'english',   label: 'English (Moodle)',       apiPrefixes: ['/english'],                 pagePrefixes: ['/english'] },
  { id: 'learning',  label: 'Learning Hub',           apiPrefixes: ['/learning'],                pagePrefixes: ['/learning'] },
  { id: 'community', label: 'Góc Tự Học Số',          apiPrefixes: ['/community/posts', '/community/media'], pagePrefixes: ['/confession'] },
  { id: 'clubs',     label: 'CLB & Nhóm học tập',     apiPrefixes: ['/community/clans', '/community/polls'], pagePrefixes: ['/clans'] },
  { id: 'vocab',     label: 'Luyện từ vựng',          apiPrefixes: ['/vocab'],                   pagePrefixes: ['/vocab'] },
  { id: 'grammar',   label: 'Luyện ngữ pháp',         apiPrefixes: ['/grammar'],                 pagePrefixes: ['/grammar'] },
  { id: 'games',     label: 'Giải trí (game)',        apiPrefixes: ['/entertainment'],           pagePrefixes: [] }
];
export const OTHER_FEATURE = { id: 'other', label: 'Khác' };

// Trả về group khớp tiền tố DÀI NHẤT (đã chuẩn hoá path, xét cả apiPrefixes lẫn
// pagePrefixes); không khớp gì thì trả OTHER_FEATURE. Là hàm thuần, có test riêng
// (mục 8).
export function featureForPath(rawPath)
```

Quy tắc:
- So tiền tố theo ranh giới đoạn (`/vocab` khớp `/vocab/sets` nhưng **không** khớp `/vocabulary`).
- Chuẩn hoá path: nếu bắt đầu `/api` thì bỏ 4 ký tự (khớp cách guard bảo trì tự chuẩn hoá).
- `featureForPath` là **hàm thuần** để test không cần DB.
- Portal nằm trong taxonomy phân tích **dù không khoá được** ở công tắc per-group (Phụ lục B).

---

## 6. Server — `TrafficInsightsService`

**File mới:** `src/services/traffic-insights.service.js`, dùng `query` từ `src/db/database.js` và `isDatabaseConfigured()` như `traffic.service.js`. Fail-soft: DB lỗi/chưa cấu hình ⇒ trả cấu trúc rỗng hợp lệ (không ném lỗi ra request), giống tinh thần fail-open của service-lock.

Xuất hai loại:
1. **Hàm thuần** (test không cần DB): `featureForPath` (re-export từ config), `buildSessions(events, gapMs)`, `summarizeTransitions(sessions)`, `bucketByFeature(rows)`.
2. **Hàm truy vấn** (async, cần DB).

### 6.1. Ranh giới dữ liệu & múi giờ

- Mọi mốc thời gian tính theo **giờ Việt Nam**: dùng `(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')` trong `EXTRACT`/`date_trunc` (server có thể chạy UTC). Hằng số `ANALYTICS_TZ = 'Asia/Ho_Chi_Minh'`.
- `timeRange` tái dùng đúng tập `1h|6h|24h|7d|30d|all`; giá trị sai rơi về `24h`.
- Bảng đã có index `created_at DESC`; truy vấn luôn lọc theo mốc thời gian (trừ `all`).

### 6.2. Hợp đồng endpoint

Tất cả nằm dưới `/api/admin/dashboard/insights/*`, qua `requireAdmin`, trả `{ result: true, data: {...} }`.

**a) `GET /admin/dashboard/insights/features?timeRange=7d`**
```
data: {
  timeRange,
  totalRequests,
  items: [ { id, label, requests, users, share, errorRate, deltaPct } ],  // sort requests desc
  other: { requests, users, share }
}
```
- `users` = `COUNT(DISTINCT COALESCE(mssv, ip_address))` theo tính năng.
- `share` = requests / totalRequests (4 chữ số thập phân).
- `errorRate` = (số bản ghi status ≥ 400) / requests.
- `deltaPct` = so với khoảng thời gian dài bằng ngay trước đó (như `requestGrowth` ở `getOverviewStats`); `null` khi `timeRange=all`.
- Gom theo tính năng: dựng `CASE WHEN` từ hằng số `FEATURE_GROUPS` (literal tĩnh, không phải input người dùng) trên `COALESCE(route, split_part(path,'?',1))`, fallback `other`.

**b) `GET /admin/dashboard/insights/hours?timeRange=7d`**
```
data: {
  timeRange,
  tz: 'Asia/Ho_Chi_Minh',
  weekdays: ['Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7','Chủ nhật'],
  matrix: [ [24 số], ... 7 hàng ],   // index 0 = Thứ 2, index giờ 0..23
  max,
  peak: { weekday, hour, count }
}
```
- `EXTRACT(ISODOW …) - 1` cho hàng (0 = Thứ 2), `EXTRACT(HOUR …)` cho cột.

**c) `GET /admin/dashboard/insights/cohort?timeRange=30d`**
```
data: {
  timeRange,
  dayBuckets: [ { date, active, new, returning } ],  // active = DISTINCT mssv mỗi ngày
  totals: { active, new, returning },
  stickiness: { dau, wau, ratio },     // dau = active 1 ngày gần nhất, wau = active 7 ngày
  returnRate7d                            // trong số active 7 ngày qua, tỉ lệ cũng active 7 ngày trước
}
```
- `new` = `mssv` có `MIN(created_at)` toàn thời gian ≥ đầu cửa sổ; ngược lại là `returning`.
- `dayBuckets` có tối đa 30 điểm (hoặc theo số ngày của `timeRange`).

**d) `GET /admin/dashboard/insights/quality?timeRange=7d`**
```
data: {
  timeRange,
  overall: { requests, errorRate, avgMs, p95Ms },
  items: [ { id, label, requests, errorRate, avgMs, p95Ms } ]   // sort requests desc
}
```
- `p95Ms` = `percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)`.

**e) `GET /admin/dashboard/insights/users/:mssv/journey?limit=200&timeRange=7d`**
```
data: {
  mssv,
  student: { mssv, full_name, class_code, faculty_code } | null,
  events: [ { at, method, path, route, featureId, featureLabel, statusCode, responseTimeMs, deviceType, isError } ], // ASC
  sessions: [ { startAt, endAt, durationMs, eventCount, features: [id...] } ],
  transitions: [ { from, to, count } ],   // top 10, từ sessions
  truncated: boolean                        // true khi chạm limit
}
```
- `events` lấy `ORDER BY created_at ASC LIMIT limit` (mặc định 200, tối đa 500), lọc theo `mssv` (đã uppercase) và `timeRange`.
- **Phiên** (`buildSessions`): tách khi khoảng cách hai sự kiện liên tiếp > **30 phút** (`SESSION_GAP_MS = 1_800_000`).
- Nếu `student` không tìm thấy nhưng có sự kiện ⇒ vẫn trả `student: null` + `events` (không 404). Không có sự kiện ⇒ `events: []`.

### 6.3. Đăng ký route & controller

- Thêm 5 method vào `src/modules/admin/admin-dashboard.controller.js`: `getInsightsFeatures`, `getInsightsHours`, `getInsightsCohort`, `getInsightsQuality`, `getInsightsJourney`. Mỗi method bọc `try/catch`, trả `err.status || 500` như các method hiện có; không lộ chi tiết SQL ở 500.
- Thêm 5 route vào `src/routes/admin.routes.js` **sau** `router.use('/admin/dashboard', requireAdmin)` (giữ nhóm).
- Khai 5 route mới vào `ROUTES_ADDED_AFTER_SPLIT` (`scripts/verify-route-order.mjs`), đúng định dạng hiện có, gồm cả tham số `:mssv`:
  - `GET /admin/dashboard/insights/features`
  - `GET /admin/dashboard/insights/hours`
  - `GET /admin/dashboard/insights/cohort`
  - `GET /admin/dashboard/insights/quality`
  - `GET /admin/dashboard/insights/users/:mssv/journey`
- Không sửa `src/routes/api.routes.js`. `admin-dashboard.controller.js` được `verify-controller-split.mjs` bỏ qua nên không cần khai method mới ở đó.
- Cập nhật `docs/architecture.md`: ghi nhóm endpoint insights, vai trò `feature-groups.js`, và quy ước múi giờ `Asia/Ho_Chi_Minh`.

---

## 7. Client `/admin` (site tĩnh) — làm lại toàn bộ

Làm lại cả 5 tab theo mục 4, dùng chung một bộ thành phần; tab Insights là phần mới thêm vào.

### 7.1. `public/admin/admin.js`
- **Icon**: thay toàn bộ emoji bằng map `ICONS` (SVG inline, `stroke="currentColor"`), dùng ở sidebar, KPI card, nút, tiêu đề khối.
- **Helper chung** (chuẩn hoá cách hiển thị, dùng cho mọi tab):
  - `formatNumber`, `formatPercent`, `formatDurationMs`, `formatDateTime` (thống nhất định dạng ở mục 4.1).
  - `renderSkeleton`, `renderEmpty`, `renderError` cho trạng thái khối.
  - helper dựng bảng sắp xếp được (đặt `aria-sort`, đổi thứ tự khi bấm tiêu đề, giữ header dính).
- **Viết lại render của 5 tab** để dùng helper/thành phần chung (Tổng quan, Insights, Nhật ký, Sinh viên, Hệ thống) — giữ nguyên dữ liệu/nghiệp vụ, đổi cách trình bày.
- **Insights**: thêm `state.insights = { features, hours, cohort, quality, journey }`; trong `fetchAllData` thêm một `Promise.all` cho 4 endpoint insights (features/hours/cohort/quality), mỗi cái `.catch(() => null)` để một endpoint lỗi không làm hỏng cả dashboard. Render: `renderFeatureRanking`, `renderHoursHeatmap` (lưới CSS 7×24, mỗi ô có `title` + số, kèm bảng số dự phòng), `renderCohort` (Chart.js line/bar), `renderQuality` (bảng + cột p95).
- **Modal Hành trình**: `openJourney(mssv)` gọi `/api/admin/dashboard/insights/users/:mssv/journey`, render timeline theo phiên, đánh dấu sự kiện lỗi, tôn trọng `truncated`; dùng chung component modal mới.
- **Giữ nguyên helper an toàn** `escapeHtml`, `cssToken`, `safeNumber`; mọi dữ liệu chèn vào DOM tiếp tục đi qua `escapeHtml` (test `test-admin-rendering-safety.js` ghim các idiom này).

### 7.2. `public/admin/index.html`
- Sidebar: icon SVG + thêm nút tab `Insights`; gộp tab `Charts` cũ vào Tổng quan/Insights.
- Viết lại markup 5 `section.tab-pane` theo bộ thành phần chung (panel card có tiêu đề + phụ đề); thêm `pane-insights` với 4 khối (xếp hạng tính năng, heatmap, cohort, thiết bị + chất lượng).
- Thêm modal `#modal-journey` và điểm mở từ bảng Sinh viên.
- Thêm vùng trạng thái (skeleton/rỗng/lỗi) cho các khối dữ liệu.

### 7.3. `public/admin/admin.css`
- Viết lại token theo **light-first** (mục 4.2); `[data-theme="dark"]` là override. Rà lại tương phản cả hai theme.
- Bổ sung class thành phần chung (panel, bảng, chip lọc, skeleton, empty/error state) và class cho lưới heatmap (`.heatmap-grid`, `.heatmap-cell`, thang màu cool→hot), timeline hành trình.
- Đảm bảo focus-visible, hover, cuộn ngang bảng (`.table-scroll`), responsive và `@media (prefers-reduced-motion: reduce)`.

---

## 8. Kiểm thử

**Test Node mới (khai `scripts/test-manifest.mjs`, chạy kèm env managed):**
- `tests/test-feature-groups.js` — `featureForPath`: khớp tiền tố dài nhất, ranh giới đoạn (`/vocab` không khớp `/vocabulary`), bỏ tiền tố `/api`, không khớp ⇒ `other`. Không cần DB.
- `tests/test-traffic-insights.js` — hàm thuần: `buildSessions` (tách phiên ở đúng ngưỡng 30 phút, sự kiện đơn, rỗng), `summarizeTransitions` (đếm chuyển trang, top N), `bucketByFeature` (cộng dồn + `other`). Không cần DB.
- `tests/test-admin-insights-ui.js` — đọc file: `index.html` có tab/element insights + modal journey; `admin.js` chứa 5 path endpoint và `method` không đổi; route đã đăng ký trong `admin.routes.js`.

**Test cần cập nhật:**
- `tests/test-admin-rendering-safety.js` ghim vài chuỗi escape (vd `const safeMssv = escapeHtml(s.mssv)`): redesign phải giữ các idiom này hoặc cập nhật test tương ứng, **không** nới lỏng escaping.
- `tests/test-admin-service-lock.js` / `test-admin-service-lock-ui.js`: không đụng chức năng, chỉ cần xanh lại sau khi đổi markup tab System.

**Test DB (tầng tổng hợp) — không bắt buộc trong runner an toàn:** nếu viết, để cùng nhóm quarantined như `test-traffic-logging.js` (cần `DATABASE_URL`), khai lý do trong manifest.

**Guard bắt buộc xanh:** `node scripts/verify-route-order.mjs` (đã khai route mới), `tests/test-import-resolution.js` (file config/service mới import được), `tests/test-manifest.test.mjs` (mọi test được phân loại đúng một lần), `node scripts/verify-controller-split.mjs`.

**Kiểm tra frontend giao diện người dùng cuối:** `routing-contract.test.js` phải không đổi (không thêm route React).

---

## 9. Triển khai theo 2 chặng

| Chặng | Nội dung | Nghiệm thu |
| :--- | :--- | :--- |
| **A — Server** | `feature-groups.js`, `traffic-insights.service.js`, 5 method controller, 5 route, guards, test Node + cập nhật `architecture.md` | `curl` 5 endpoint trả dữ liệu đúng; các guard/test xanh |
| **B — UI** | Làm lại **toàn bộ** `public/admin/`: token light-first, bộ thành phần chung, icon SVG, cả 5 tab, thêm tab Insights, modal Hành trình, trạng thái tải/rỗng/lỗi, test UI | Mở `/admin`: 5 tab đọc rõ ở 375 và 1024, không lỗi câm; tab Insights có 4 khối + đổi mốc thời gian; mở Hành trình một MSSV; cả sáng lẫn tối đạt tương phản 4.5:1 |

Chặng A phải xong và được nghiệm thu trước khi làm chặng B.

---

## 10. Rủi ro & câu hỏi mở

- **Múi giờ:** nếu quên `AT TIME ZONE 'Asia/Ho_Chi_Minh'`, heatmap/cohort lệch theo giờ UTC. Đã chốt dùng hằng số và ghi vào `architecture.md`.
- **Lệch taxonomy:** khi thêm nhóm route mới mà quên cập nhật `feature-groups.js`, request sẽ rơi vào "Khác". Giảm thiểu bằng test `test-feature-groups.js` liệt kê các tiền tố hiện có.
- **Chi phí p95:** `percentile_cont` trên bảng lớn đắt; nhưng retention 14 ngày + luôn lọc `created_at` nên chấp nhận được. Nếu chậm, hạ mặc định `timeRange` cho `quality`.
- **Hành trình dài:** giới hạn 200 sự kiện và đánh dấu `truncated`; không phân trang thêm trong đợt này.
- **Sinh viên chỉ có IP (chưa đăng nhập):** cohort tính theo `mssv`, nên khách chưa đăng nhập không vào cohort — ngoài phạm vi.
- **Đổi theme mặc định sang sáng:** người dùng hiện quen tối; phải rà tương phản và kiểm lại cả hai theme sau khi đổi token, tránh chữ mờ trên nền card trắng. Rủi ro thấp (admin nội bộ, có toggle).
- **Phạm vi lớn (làm lại cả 5 tab):** dễ kéo dài; giảm thiểu bằng cách chia 2 chặng rõ ràng (mục 9) và dùng chung một bộ thành phần để không phải thiết kế lại từng màn.

---

## Phụ lục A — Bảng ánh xạ tiền tố (phục vụ test)

Từ danh sách route hiện có (`src/routes/*.routes.js`), các tiền tố API thuộc từng tính năng đúng như mục 5; các tiền tố còn lại (đăng nhập, identity `/students`, `/me`, thông báo `/notifications`, `/reminders`, meta `/health`,`/version`,`/status`,`/queue-status`, admin `/admin`) **không** thuộc tính năng nào ⇒ rơi vào `other` (vẫn đếm trong tổng, không lên bảng xếp hạng tính năng).

## Phụ lục B — Liên hệ với công tắc khoá per-group (đã gác)

Thiết kế khoá dịch vụ theo nhóm (đã bàn, chưa chốt) sẽ tái dùng **cùng** `src/config/feature-groups.js` làm nguồn sự thật: trường `apiPrefixes` phục vụ guard chặn theo nhóm, còn bảng nhãn phục vụ UI admin. Khác biệt duy nhất: nhóm `portal` khoá được hay không — với công tắc thì **không** (tránh tự khoá đăng nhập/cổng), với phân tích thì **có**. Vì vậy `feature-groups.js` dùng cho phân tích; khi làm công tắc sẽ thêm cờ `lockable: true|false` cho từng mục thay vì tách bảng riêng.
