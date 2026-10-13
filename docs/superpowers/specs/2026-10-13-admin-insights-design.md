# Spec — Admin Insights: làm lại /admin và thêm phân tích hành vi người dùng

**Ngày:** 2026-10-13
**Trạng thái:** chờ duyệt (chưa implement)
**Phạm vi:** chỉ khu vực `/admin` (site tĩnh trong `public/admin/`) và các API đọc dữ liệu cho nó. Không đụng giao diện người dùng cuối (React `client/`).
**Liên quan:** công tắc khoá dịch vụ per-group đã bàn trước đó **tạm gác**; taxonomy ở mục 5 sẽ được nó tái dùng sau (xem Phụ lục B).

---

## 1. Bối cảnh

`/admin` hiện là "Traffic & Logs Dashboard": site tĩnh `public/admin/` (vanilla JS + Chart.js nhúng sẵn, không framework), đọc dữ liệu từ bảng Postgres `traffic_logs` do middleware `TrafficService.middleware()` (`src/services/traffic.service.js:252`) ghi cho **mọi request API và mọi lần tải trang HTML** (bỏ qua file tĩnh). Mỗi dòng log có: `method, path, route, status_code, response_time_ms, mssv, full_name, ip_address, user_agent, device_type, os, browser, referrer, created_at`.

Chủ sở hữu đang định hướng **data science**: cần nhìn rõ người dùng quan tâm tính năng nào, dùng máy gì, khung giờ cao điểm, mức giữ chân, và một người cụ thể đã tương tác thế nào. Đồng thời muốn giao diện `/admin` trông "xịn xò" hơn.

**Điểm mấu chốt của khảo sát hiện trạng:** phần lớn dữ liệu cần đã có trong `traffic_logs`; thiếu sót chủ yếu là **cách gom/tổng hợp** và **cách trình bày**, cộng thêm giao diện còn emoji và mật độ thấp.

---

## 2. Ý định đã xác nhận

| | |
| :--- | :--- |
| **Kết quả** | `/admin` có thêm một tab **Insights** trả lời 5 câu hỏi: (1) tính năng nào được quan tâm nhất, (2) khung giờ cao điểm, (3) một sinh viên đã tương tác ra sao, (4) máy/OS/browser và chất lượng dịch vụ, (5) cohort & giữ chân. Giao diện được làm lại theo hướng data-dense, bỏ emoji làm icon. |
| **Ai dùng** | Chủ sở hữu/vận hành, qua `/admin`, sau khi đăng nhập (khoá admin hiện có). |
| **Vì sao bây giờ** | Cần hiểu hành vi người dùng trước khi dựng lại server; dữ liệu 14 ngày nên phải gom lại trước khi hết. |
| **Thành công** | Mở `/admin` → tab Insights: đổi mốc thời gian thấy xếp hạng tính năng, heatmap giờ×thứ, cohort/giữ chân, chất lượng cập nhật; từ danh sách sinh viên mở được **Hành trình** của một MSSV (timeline có thứ tự + phiên). Không thêm dependency runtime mới. |
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

## 4. Hướng mỹ thuật `/admin`

Style đích: **Data-Dense Dashboard** (nhiều widget, bảng dữ liệu, KPI card, padding tối thiểu, mật độ cao). Giữ "vỏ" dark glassmorphism hiện có để không phá vỡ nhận diện; nâng cấp:

- **Icon: bỏ emoji → inline SVG** (bộ Lucide-style tự nhúng trong `public/admin/admin.js`, không thêm dependency, không build step). Đây là thay đổi "xịn" rõ nhất.
- **Thang typography chuẩn**: 12 / 14 / 16 / 18 / 24 / 32. Số liệu (KPI, bảng) dùng font mono (`--font-mono` đã có).
- **Token màu**: giữ xanh dương chủ đạo và amber nhấn đang dùng; bổ sung token cho heatmap (dải cool→hot). Cả `[data-theme="light"]` và dark phải đạt tương phản chữ ≥ 4.5:1.
- **Trạng thái tương tác**: hover + focus-visible rõ ràng, chuyển tiếp 150–300ms; con trỏ pointer cho mọi phần tử bấm được.
- **Chuyển động**: tối thiểu, tôn trọng `prefers-reduced-motion` (không stagger trên bảng dữ liệu dày).
- **Responsive**: kiểm ở 375 / 768 / 1024 / 1440; bảng dài cho cuộn ngang trong wrapper `.table-scroll`.

### 4.1. Cấu trúc tab sau khi làm lại

| Tab | Nội dung |
| :--- | :--- |
| **Tổng quan** | 4 KPI (giữ) + timeline + preview xếp hạng tính năng (top 5) |
| **Insights** (mới) | Xếp hạng tính năng (đầy đủ), heatmap giờ×thứ, cohort/giữ chân, thiết bị + chất lượng |
| **Nhật ký** | Bảng log + bộ lọc (giữ nguyên chức năng) |
| **Sinh viên** | Danh sách đã truy cập (giữ) + nút mở **Hành trình** |
| **Hệ thống** | VPS metrics + ranking-sync + service-lock (giữ nguyên) |

Tab "Charts" cũ được gộp: timeline chi tiết + devices/OS/browser chuyển sang Insights; KPI/timeline preview ở Tổng quan.

### 4.2. Icon

Một map `ICONS` trong `admin.js` trả về chuỗi SVG (24×24, `stroke="currentColor"`, `aria-hidden="true"` khi chỉ trang trí). Thay các emoji hiện có ở sidebar, KPI card, nút. Icon có nghĩa độc lập (không kèm text) phải có nhãn truy cập.

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

## 7. Client `/admin` (site tĩnh)

### 7.1. `public/admin/admin.js`
- Thay emoji bằng map `ICONS` (SVG inline).
- Thêm `state.insights = { features, hours, cohort, quality, journey }`, thêm vào `fetchAllData` một `Promise.all` cho 4 endpoint insights (features/hours/cohort/quality), mỗi cái `.catch(() => null)` để một endpoint lỗi không làm hỏng cả dashboard.
- Hàm render: `renderFeatureRanking`, `renderHoursHeatmap` (dựng lưới `<div>` 7×24 qua CSS grid, mỗi ô có `title` + dữ liệu số; có bảng số đi kèm cho trợ năng), `renderCohort` (Chart.js line/bar), `renderQuality` (bảng + cột p95).
- Modal **Hành trình**: `openJourney(mssv)` gọi `/api/admin/dashboard/insights/users/:mssv/journey`, render timeline theo phiên, đánh dấu sự kiện lỗi; tôn trọng `truncated`.
- Giữ nguyên các helper an toàn: `escapeHtml`, `cssToken`, `safeNumber`; mọi dữ liệu chèn vào DOM tiếp tục đi qua `escapeHtml`.
- Heatmap và bảng phải có **fallback dạng số** (không chỉ dựa vào màu).

### 7.2. `public/admin/index.html`
- Sidebar: thêm nút tab `Insights` (icon SVG). Gộp tab `Charts` cũ vào Insights/Tổng quan.
- Section `pane-insights` chứa: khối xếp hạng tính năng, khối heatmap, khối cohort, khối thiết bị + chất lượng.
- Thêm modal `#modal-journey` và điểm mở từ bảng sinh viên.

### 7.3. `public/admin/admin.css`
- Tinh chỉnh token; thêm class cho lưới heatmap (`.heatmap-grid`, `.heatmap-cell`, thang màu), cho khối Insights, cho timeline hành trình.
- Đảm bảo focus-visible, hover, cuộn ngang bảng, và `@media (prefers-reduced-motion: reduce)`.

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
| **B — UI** | Redesign `public/admin/` (icon SVG, token, layout), tab Insights, modal Hành trình, test UI | Mở `/admin`, đổi mốc thời gian, xem 4 khối + mở Hành trình một MSSV; responsive 375/1024; light/dark đạt tương phản |

Chặng A phải xong và được nghiệm thu trước khi làm chặng B.

---

## 10. Rủi ro & câu hỏi mở

- **Múi giờ:** nếu quên `AT TIME ZONE 'Asia/Ho_Chi_Minh'`, heatmap/cohort lệch theo giờ UTC. Đã chốt dùng hằng số và ghi vào `architecture.md`.
- **Lệch taxonomy:** khi thêm nhóm route mới mà quên cập nhật `feature-groups.js`, request sẽ rơi vào "Khác". Giảm thiểu bằng test `test-feature-groups.js` liệt kê các tiền tố hiện có.
- **Chi phí p95:** `percentile_cont` trên bảng lớn đắt; nhưng retention 14 ngày + luôn lọc `created_at` nên chấp nhận được. Nếu chậm, hạ mặc định `timeRange` cho `quality`.
- **Hành trình dài:** giới hạn 200 sự kiện và đánh dấu `truncated`; không phân trang thêm trong đợt này.
- **Sinh viên chỉ có IP (chưa đăng nhập):** cohort tính theo `mssv`, nên khách chưa đăng nhập không vào cohort — ngoài phạm vi.

---

## Phụ lục A — Bảng ánh xạ tiền tố (phục vụ test)

Từ danh sách route hiện có (`src/routes/*.routes.js`), các tiền tố API thuộc từng tính năng đúng như mục 5; các tiền tố còn lại (đăng nhập, identity `/students`, `/me`, thông báo `/notifications`, `/reminders`, meta `/health`,`/version`,`/status`,`/queue-status`, admin `/admin`) **không** thuộc tính năng nào ⇒ rơi vào `other` (vẫn đếm trong tổng, không lên bảng xếp hạng tính năng).

## Phụ lục B — Liên hệ với công tắc khoá per-group (đã gác)

Thiết kế khoá dịch vụ theo nhóm (đã bàn, chưa chốt) sẽ tái dùng **cùng** `src/config/feature-groups.js` làm nguồn sự thật: trường `apiPrefixes` phục vụ guard chặn theo nhóm, còn bảng nhãn phục vụ UI admin. Khác biệt duy nhất: nhóm `portal` khoá được hay không — với công tắc thì **không** (tránh tự khoá đăng nhập/cổng), với phân tích thì **có**. Vì vậy `feature-groups.js` dùng cho phân tích; khi làm công tắc sẽ thêm cờ `lockable: true|false` cho từng mục thay vì tách bảng riêng.
