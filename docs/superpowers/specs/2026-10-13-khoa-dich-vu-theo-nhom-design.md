# Spec — Khoá bảo trì theo từng nhóm service (service lock per-group)

**Ngày:** 2026-10-13
**Trạng thái:** chờ duyệt (chưa implement)
**Phạm vi:** thay công tắc **khoá toàn site** hiện có bằng công tắc **khoá theo từng nhóm service**; đụng server (`service-lock`, guard, meta, realtime) + client React (`http.js`, `MaintenanceGate`) + site tĩnh `/admin`.
**Liên quan:** tái dùng `src/config/feature-groups.js` (đã có từ đợt Admin Insights) làm nguồn sự thật chung — xem Phụ lục B của `docs/superpowers/specs/2026-10-13-admin-insights-design.md`.

---

## 1. Bối cảnh

Hiện tại đã có công tắc **khoá toàn site** (`service_lock` dạng `{ locked, title, message }`): một middleware chặn mọi `/api/*` (trừ `/health`,`/version`,`/status`,`/admin/dashboard`), client hiện **màn hình bảo trì toàn trang**, WebSocket bị đóng khi khoá, admin bật/tắt bằng 1 switch ở tab Hệ thống của `/admin`.

Chủ sở hữu muốn **khoá linh hoạt theo từng nhóm dịch vụ** để bảo trì một tính năng mà không phải đóng cả website, và để màn hình bảo trì chỉ ảnh hưởng đúng trang của nhóm bị khoá.

Đợt redesign `/admin` đã hoàn tất và đưa vào `main`; taxonomy tính năng (`feature-groups.js`) đã sẵn sàng để tái dùng.

---

## 2. Ý định đã xác nhận

| | |
| :--- | :--- |
| **Kết quả** | `/admin` có danh sách công tắc theo **10 nhóm tính năng**; bật nhóm nào thì API + trang của nhóm đó vào bảo trì (màn hình bảo trì hiện **trong vùng nội dung**, giữ nguyên sidebar/topbar), các nhóm khác bình thường. |
| **Ai dùng** | Chủ sở hữu/vận hành (qua `/admin`). Người dùng cuối chỉ thấy màn hình bảo trì ở đúng tính năng bị khoá. |
| **Vì sao bây giờ** | Cần bảo trì từng tính năng (deploy/migrate từng phần) mà không đóng cả site; taxonomy dùng chung đã có sẵn. |
| **Thành công** | Bật 1 nhóm ở `/admin` → trong ~1 giây: API của nhóm trả `503` + `code:'MAINTENANCE'` + `group`; tab đang mở ở trang thuộc nhóm tự hiện màn hình bảo trì (không F5, tối đa 30 giây); các trang nhóm khác không bị ảnh hưởng; admin vẫn vào được `/admin`; tắt là tự hết. |
| **Ràng buộc** | Không thêm migration; không sửa `src/routes/api.routes.js`; route/method mới phải khai guard; giữ `system_settings` + `requireAdmin`; `deploy.sh` healthcheck không bị ảnh hưởng. |
| **Ngoài phạm vi** | Hẹn giờ tự khoá/mở; khoá **toàn site** (bỏ hẳn); khoá ở mức từng endpoint; whitelist người dùng khi bảo trì; ghi audit lịch sử bật/tắt. |

---

## 3. Nhóm khoá được (nguồn sự thật chung)

`src/config/feature-groups.js` được bổ sung cờ **`lockable: boolean`** cho mỗi mục:

| id | label | lockable | Vì sao |
| :--- | :--- | :---: | :--- |
| `portal` | Cổng sinh viên | **false** | Chứa `/login`,`/profile`,`/grades`,`/schedule`,`/rankings` — khoá sẽ tự khoá đăng nhập/cổng. |
| `wordfmt` | Word Formatting | true | |
| `survey` | Survey Automation | true | |
| `training` | Điểm rèn luyện | true | |
| `english` | English (Moodle) | true | |
| `learning` | Learning Hub | true | |
| `community` | Góc Tự Học Số | true | Kèm đóng WebSocket `/ws/community`. |
| `clubs` | CLB & Nhóm học tập | true | |
| `vocab` | Luyện từ vựng | true | |
| `grammar` | Luyện ngữ pháp | true | |
| `games` | Giải trí (game) | true | Hiện chưa có trang SPA riêng; chặn ở mức API. |

**Luôn hoạt động (không khoá được, map về `OTHER_FEATURE`):** đăng nhập, portal, identity (`/students`,`/me`), thông báo (`/notifications`,`/reminders`), meta (`/health`,`/version`,`/status`,`/queue-status`), toàn bộ `/admin/*`.

Không cần danh sách "miễn trừ" cứng nữa: guard chỉ chặn khi path thuộc một nhóm `lockable` và nhóm đó đang khoá.

---

## 4. Lưu trữ (không migration)

Vẫn key `service_lock` trong bảng `system_settings`. Value đổi shape:

```json
{ "groups": {
    "wordfmt": { "locked": true,  "title": "Word Formatting đang bảo trì", "message": "…" },
    "vocab":   { "locked": false, "title": "", "message": "" }
} }
```

- Lưu **thưa**: chỉ nhóm đã từng đặt mới có mặt; nhóm thiếu ⇒ `locked:false` + nội dung mặc định.
- `updated_at`/`updated_by` dùng cột sẵn có của `system_settings` (một mốc cho lần ghi gần nhất, không per-nhóm).
- **Tương thích ngược:** gặp value cũ dạng `{ locked, title, message }` (khoá toàn site) ⇒ coi như **cả 10 nhóm `lockable` đang khoá** với `title`/`message` đó (không tự mở khoá oan). Lần ghi kế tiếp tự chuyển sang shape mới.

---

## 5. Server

### 5.1. `ServiceLockService` (`src/services/service-lock.service.js`)

Giữ `SERVICE_LOCK_SETTING_KEY = 'service_lock'`, `DEFAULT_TITLE`, `DEFAULT_MESSAGE`, `MAX_TITLE_LENGTH = 120`, `MAX_MESSAGE_LENGTH = 500`. API đổi:

- `LOCKABLE_GROUPS`: danh sách `{ id, label }` lấy từ `FEATURE_GROUPS.filter(g => g.lockable)`.
- `getStatus(): Promise<{ groups: Record<id, {locked,title,message}> }>` — luôn đủ **10 khoá** (nhóm thiếu ⇒ mặc định `locked:false` + default). Không bao giờ ném lỗi (fail-open: trả mọi nhóm `locked:false`).
- `getAdminStatus(): Promise<{ groups, catalog: [{id,label}], updated_at, updated_by }>`.
- `setGroupStatus({ group, locked, title, message }, updatedBy): Promise<{ groups, updated_at, updated_by }>` — validate: `group` phải thuộc `LOCKABLE_GROUPS` (khác ⇒ lỗi `status=400`); `locked` boolean; `title` ≤120 / `message` ≤500, `trim()`, rỗng ⇒ default; đọc value hiện tại, merge đúng nhóm, ghi lại (không đụng nhóm khác).

### 5.2. Cửa chặn `src/utils/service-lock-guard.js`

- Dùng `featureForPath(req.path)` để tìm nhóm. Nếu nhóm là `OTHER_FEATURE` **hoặc** `lockable !== true` ⇒ `next()`.
- Nếu nhóm đang khoá ⇒ `res.status(503).json({ result:false, code:'MAINTENANCE', group: <id>, title, message })`.
- Fail-open: mọi lỗi đọc trạng thái ⇒ `next()` (giữ nguyên hành vi hiện tại).
- Bỏ `EXEMPT_PATHS`/`EXEMPT_PREFIXES` cứng (thay bằng quy tắc nhóm `lockable`); giữ việc tự chuẩn hoá `/api` (đã nằm trong `featureForPath`).

### 5.3. `GET /api/status` (`meta.controller.getServiceStatus`)

Trả `{ result:true, data:{ groups: Record<id,{locked,title,message}> } }`. **Không** trả `updated_by`/`updated_at`. Bỏ 3 khoá phẳng `locked/title/message`.

### 5.4. Realtime (`src/services/community-realtime.service.js`)

- Trong `httpServer.on('upgrade')`: chỉ chặn khi **nhóm `community`** khoá — `getStatus()` → `Boolean(status?.groups?.community?.locked)`.
- `disconnectAllForMaintenance()` giữ nguyên; controller chỉ gọi khi **nhóm community chuyển sang khoá**.

---

## 6. Client (React)

### 6.1. `client/src/api/http.js`

`MaintenanceError` và sự kiện `bdu:maintenance` mang thêm `group` (từ `data.group`). Vẫn chỉ nhánh `503 && data.code === 'MAINTENANCE'` mới kích hoạt.

### 6.2. `client/src/app/serviceGroups.js` (mới)

Map đường dẫn trang SPA → id nhóm (đối chiếu `feature-groups.js`; có test chéo để bắt lệch):

| Route prefix | group |
| :--- | :--- |
| `/wordfmt` | `wordfmt` |
| `/survey` | `survey` |
| `/training-score` | `training` |
| `/english` | `english` |
| `/learning` | `learning` |
| `/vocab` | `vocab` |
| `/grammar` | `grammar` |
| `/clans` | `clubs` |
| `/confession` | `community` |

Trang không có trong map (portal, 404…) ⇒ `null` ⇒ **không bao giờ** bị bảo trì. Export `featureForRoute(pathname): string|null`.

### 6.3. `MaintenanceGate` (đổi hành vi)

- Chuyển khỏi `App.jsx` (không còn bọc cả `<AppRoutes/>`) vào **`AppLayout`**, bọc quanh `<Outlet/>` ⇒ màn hình bảo trì thay **vùng nội dung**, giữ sidebar/topbar.
- Dùng `useLocation()` + `featureForRoute()` để biết nhóm của trang hiện tại.
- Đọc `GET /api/status` (một lần khi mount; poll 30 giây **chỉ khi** trang hiện tại đang bị khoá) và nghe `bdu:maintenance` (cập nhật map khi có sự kiện).
- Nếu nhóm của trang hiện tại đang khoá ⇒ render màn hình bảo trì (title/message của nhóm); ngược lại render children.
- Lỗi `/api/status` giữ nguyên trạng thái (không tự mở/đóng oan); nút "Thử lại" gọi lại ngay.

### 6.4. `App.jsx` / `AppLayout.jsx`

`App.jsx`: bỏ `<MaintenanceGate>` bọc ngoài. `AppLayout.jsx`: bọc `<MaintenanceGate><Outlet/></MaintenanceGate>` bên trong `AppErrorBoundary`.

---

## 7. Admin API & UI

### 7.1. API (`admin-dashboard.controller.js`, `admin.routes.js`)

Giữ path `/api/admin/dashboard/service-lock` (GET + PUT).

- `GET` → `{ result:true, data:{ groups, catalog, updated_at, updated_by } }`.
- `PUT` body `{ group, locked, title, message }` → ghi **một** nhóm qua `setGroupStatus`; trả `{ result:true, message, data:{ groups, updated_at, updated_by } }`; `400` khi validate lỗi; khi nhóm `community` chuyển sang khoá ⇒ gọi `CommunityRealtime.disconnectAllForMaintenance()`.
- `updatedBy = req.identityAdminMssv || 'ADMIN_KEY'`.
- Không đổi `requireAdmin`; không thêm route mới ⇒ `verify-route-order.mjs` không phải sửa.

### 7.2. Site tĩnh `public/admin/` (tab Hệ thống)

Card "Khóa dịch vụ" đổi từ 1 switch thành **danh sách dòng theo nhóm**: nhãn nhóm + switch + ô tiêu đề + ô nội dung. Giữ `confirm()` khi bật khoá. Cờ "đang sửa" theo từng dòng để auto-refresh không ghi đè nội dung chưa lưu. Giữ id cũ dùng được nếu còn phù hợp, hoặc thay bằng id mới có tiền tố `service-lock-` (ghi rõ trong kế hoạch).

---

## 8. Kiểm thử

**Cập nhật test hiện có (bắt buộc xanh):**
- `tests/test-service-lock.service.js` — `getStatus` trả đủ 10 nhóm; `setGroupStatus` validate `group`/`locked`/độ dài; merge không đụng nhóm khác; fail-open.
- `tests/test-service-lock-guard.js` — chặn path nhóm `lockable` đang khoá (có `group` trong body); cho qua portal/identity/thông báo/meta/admin; nhóm chưa khoá cho qua; fail-open.
- `tests/test-service-lock-endpoint.js` — `/api/status` trả `{ groups }`, không lộ `updated_*`.
- `tests/test-community-realtime-maintenance.js` — chỉ từ chối khi `community` khoá.
- `tests/test-admin-service-lock.js` / `test-admin-service-lock-ui.js` — GET/PUT theo nhóm; UI có đủ dòng/ò nhập.
- `tests/frontend/http.test.js` — `MaintenanceError`/event mang `group`.
- `tests/frontend/maintenance-gate.test.jsx` — chỉ hiện khi trang thuộc nhóm khoá; không phủ trang khác.
- `tests/test-feature-groups.js` — mỗi nhóm có `lockable` boolean; đúng 10 nhóm `lockable`; `portal` là `false`.

**Test mới:** `tests/test-service-groups-map.js` (hoặc node tĩnh) — mọi route SPA có pagePrefix trong `feature-groups.js` (trừ `games`) đều có mặt trong `serviceGroups.js` và map đúng id; bắt lệch server↔client.

**Guard bắt buộc xanh:** `verify-route-order.mjs`, `verify-controller-split.mjs`, `test-manifest.test.mjs`, `test-import-resolution.js`.

---

## 9. Triển khai theo 2 chặng

| Chặng | Nội dung | Nghiệm thu |
| :--- | :--- | :--- |
| **A — Server** | `feature-groups` thêm `lockable`; `ServiceLockService` đổi API; guard theo nhóm; `/api/status` map; realtime theo `community`; test + guard | `curl` bật 1 nhóm: API nhóm đó 503 + `group`, nhóm khác 200; `/api/status` đủ 10 nhóm |
| **B — Client + Admin** | `http.js` thêm `group`; `serviceGroups.js`; `MaintenanceGate` route-aware (trong `AppLayout`); admin UI danh sách công tắc; test + nghiệm thu trình duyệt | Mở `/admin`, bật `wordfmt` → trang `/wordfmt` hiện bảo trì (giữ sidebar), `/gpa` bình thường; tắt là hết |

Chặng A xong + nghiệm thu trước khi làm chặng B.

---

## 10. Rủi ro & câu hỏi mở

- **Lệch bản đồ route client↔server**: thêm test chéo (mục 8). Khi thêm nhóm mới phải cập nhật cả hai chỗ.
- **Bản ghi legacy**: mapping "khoá cả 10 nhóm" có thể gây bất ngờ nếu DB còn cờ khoá toàn site cũ — chấp nhận để không mở oan; admin tắt từng nhóm.
- **Community vs CLB** dùng chung tiền tố `/community/*` — guard dựa `featureForPath` (tiền tố dài nhất) nên `/community/clans` vào `clubs`, `/community/posts` vào `community`; cần test các ca này.
- **`games` chưa có trang**: bật khoá chỉ chặn API, không có màn hình; chấp nhận.
- **Bỏ khoá toàn site**: nếu về sau cần "khoá tất" thì bật cả 10 nhóm (không lưu trạng thái riêng).

---

## Phụ lục A — Điểm chạm chính

`src/config/feature-groups.js` · `src/services/service-lock.service.js` · `src/utils/service-lock-guard.js` · `src/modules/meta/meta.controller.js` · `src/services/community-realtime.service.js` · `src/modules/admin/admin-dashboard.controller.js` · `client/src/api/http.js` · `client/src/app/serviceGroups.js` (mới) · `client/src/app/MaintenanceGate.jsx` · `client/src/app/App.jsx` · `client/src/layouts/AppLayout.jsx` · `public/admin/{index.html,admin.js,admin.css}` · các test liên quan.
