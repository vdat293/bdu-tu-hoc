# Trung tâm Chuyển đổi số — “Sinh viên của tôi” (Design Spec)

Ngày: 2026-10-15
Trạng thái: đã duyệt design 5 phần, chờ review spec file
Nguồn dữ liệu chi tiết SV: Dashboard BE (proxy per-request, phương án A)

## 1. Bối cảnh & mục tiêu

- bdu-tu-hoc đã có: Cổng SV (proxy BDU qua `src/services/bdu.service.js`), Bộ công cụ,
  Góc Tự Học Số (`src/config/feature-groups.js`: `community`/`clubs`).
- Gate `#TTCDS` đã có qua `PermissionService` (`TITLE_CAPABILITIES_MAP`:
  `title:ttcds → clan:create`) + `identity-presentation.service.js: can_create_clan`.
- Muốn thêm: mục **Trung tâm Chuyển đổi số (TTCDS)** chỉ mở cho ai còn nametag
  `title:ttcds`. Trong đó có dịch vụ **“Sinh viên của tôi”**: mỗi thầy cô/nhân viên
  TTCDS được giao ≥10 SV năm nhất/khóa, cần list + click vào xem GPA, chuyên cần
  (điểm danh), điểm rèn luyện, số sự kiện trong kỳ ở mức chi tiết như Dashboard.
- Muốn thêm: khái niệm **nhóm quan tâm lớn theo khóa**, ví dụ group
  “các bé tân sinh viên K29” rồi add SV của mình vào. Mỗi năm có khóa mới.

Tham khảo UI/API Dashboard (đã đọc trực tiếp):
- Detail 4-tab: `web/src/components/chi-tiet-sinh-vien.tsx`
  (Tổng quan: GPA theo kỳ + điểm danh theo kỳ / TKB lưới tuần / Bảng điểm chi tiết / Sự kiện).
- Search: `web/src/components/tim-sinh-vien.tsx` (`/api/tim-sinh-vien?q=&limit=40`).
- Trang: `web/src/app/(trang)/sinh-vien/page.tsx`.
- BE `GET /api/sinh-vien/:mssv` (`server/src/api/routes2.ts:224,304-326`) trả
  `ho_so, gpa_hoc_ky, diem_danh, diem_danh_mon, bang_diem, thoi_khoa_bieu, su_kien`
  **và `ren_luyen`** (`SELECT nkhk, diem_ren_luyen, xep_loai FROM fact_ren_luyen`,
  ETL từ `dim_diem_ren_luyen_odp` — `server/src/etl/extract.ts:51`, `schema.ts:71,206`).
- Quyết định đã chốt: điểm rèn luyện lấy riêng từ field `ren_luyen` của Dashboard
  proxy, **không** dùng `src/services/training-score.service.js` (cần Bearer chính chủ,
  không xem hộ được).

## 2. Quyết định đã chốt với user

1. Nguồn dữ liệu: **A — proxy per-request sang Dashboard BE** (không copy/ETL, không iframe).
2. Group **riêng tư theo người tạo**: tự tạo group, tự add MSSV (được giao hoặc tự
   follow thêm MSSV khác), **chỉ thấy group do chính mình tạo**.
3. Quyền trong Trung tâm chỉ còn 2 nấc (+ gate nametag):
   - Gate vào: còn `title:ttcds`. Thu hồi = thu hồi entitlement/role ttcds (không cần nấc “cấm” riêng).
   - `view`: xem danh sách được giao/admin tạo hộ, không tự tạo group/add MSSV
     (muốn tạo phải xin admin tạo hộ).
   - `create`: tự tạo group + tự add bất kỳ MSSV nào.
   - Chưa có dòng quyền mà có nametag → mặc định `view` (an toàn).

## 3. Kiến trúc + gating (Phần 1/5 — đã duyệt)

- Thêm nhóm `ttcds` vào `src/config/feature-groups.js`:
  `label 'Trung tâm Chuyển đổi số'`, `pagePrefixes ['/ttcds']`,
  `apiPrefixes ['/ttcds']`, `lockable: true`.
- Capability mới `ttcds:access`: thêm map `title:ttcds → ttcds:access` cạnh
  `clan:create` trong `src/services/permission.service.js`
  (`TITLE_CAPABILITIES_MAP`). Mất nametag = mất cả Trung tâm.
- Nấc `view`/`create` đọc từ bảng mới `ttcds_permissions` (xem §4).
- Backend: module mới `src/routes/ttcds.routes.js`, đăng ký trong
  `src/routes/api.routes.js` sau clubs (giữ thứ tự khớp route).
  Service mới: `ttcds.service.js` (CRUD group local) +
  `dashboard-proxy.service.js` (server-to-server gọi `DASHBOARD_BE_URL`,
  auth service account, không passthrough token SV).
- Frontend: page `/ttcds` mới, ẩn hẳn nếu `getEffectiveCapabilities` không có
  `ttcds:access`. Nút tạo/add chỉ hiện khi `level === 'create'`.

## 4. Data model (Phần 2/5 — đã duyệt)

Migration mới: `migrations/019_ttcds_center.sql`. Không đụng bảng `clans`.

- `ttcds_groups`
  (`id uuid PK`, `name`, `nien_khoa` vd K29, `description`,
  `owner_mssv` chuẩn hóa UPPER, `created_at/updated_at`).
  List mặc định `WHERE owner_mssv = me`; admin/owner thêm `?all=1` để quản lý.
- `ttcds_group_members`
  (`group_id`, `mssv`, unique `(group_id, mssv)`, `added_by_mssv`, `note`
  vd “được giao chính thức” vs “tự follow thêm”, `created_at`).
  Khi add: `INSERT INTO students(mssv) ON CONFLICT DO NOTHING` trước
  (đúng cách `StudentService.joinClan` làm), cho phép MSSV chưa từng login.
- `ttcds_permissions`
  (`mssv PK`, `level 'view'|'create'`, `granted_by`, `note`,
  `granted_at/updated_at`). Có nametag mà chưa có dòng → coi như `view`.
- `ttcds_audit_logs`
  (`actor_mssv`, `action`: `group.create/member.add/member.remove/permission.grant...`,
  `target_group_id/target_mssv`, `created_at`) — bằng chứng “vượt phận”.

## 5. API + proxy (Phần 3/5 — đã duyệt)

- `GET /api/ttcds/capabilities` → `{ can_access, level }`.
- Groups (local, check owner + level):
  `GET /api/ttcds/groups`, `POST /api/ttcds/groups {name, nien_khoa, description}`
  (cần `create`), `DELETE /api/ttcds/groups/:id`,
  `GET/POST/DELETE /api/ttcds/groups/:id/members` (`{mssv, note}`).
- Proxy Dashboard (service account, `DASHBOARD_BE_URL` + `DASHBOARD_USER`/`DASHBOARD_PASSWORD`
  cookie-session auth — Dashboard không có token endpoint; login `POST /api/dang-nhap`
  set cookie `bdudash_session`, service account cần scope toàn trường):
  - `GET /api/ttcds/students/search?q=` → forward `/api/tim-sinh-vien`.
  - `GET /api/ttcds/students/:mssv` → forward `/api/sinh-vien/:mssv`, giữ nguyên
    `ho_so, gpa_hoc_ky, diem_danh, bang_diem, thoi_khoa_bieu, diem_danh_mon, su_kien, ren_luyen`.
  - Cache nhớ 5 phút + nút “tải lại” (mở group 10 bạn không nã 10 phát liên tục).
  - Phase 1: list group chỉ hiện MSSV + họ tên/lớp/khoa (từ search), click mới tải
    full detail — tránh N+1.
- `ren_luyen` là nguồn điểm rèn luyện duy nhất (tách hẳn training-score).
  Nếu Dashboard không trả / 403 → `diem_ren_luyen: null + reason`, UI hiện “—”.
- Lỗi map 1-1: Dashboard 403 → “ngoài phạm vi phụ trách”, 404 → “không tìm thấy SV”,
  BE chết/timeout 8s → 503 retryable (pattern `profileUnavailableError` của `bdu.service.js`).

## 6. UI (Phần 4/5 — đã duyệt)

- Page `/ttcds`: trái list group của mình (tên + `nien_khoa` + số SV).
  Nút “Tạo nhóm K…” chỉ khi `level === 'create'`.
  Trong group: ô add MSSV (paste list, verify qua search), mỗi dòng tóm tắt
  tên/lớp, GPA tích lũy mới nhất, % chuyên cần kỳ đang học, điểm rèn luyện kỳ mới
  nhất, số sự kiện kỳ hiện tại (từ proxy detail đã cache).
- Click 1 SV → detail port gọn từ `chi-tiet-sinh-vien.tsx`, giữ 4 tab:
  Tổng quan (GPA theo kỳ + điểm danh theo kỳ) / TKB lưới tuần / Bảng điểm chi tiết /
  Sự kiện, **thêm khối Điểm rèn luyện** (bảng `nkhk, diem_ren_luyen, xep_loai`)
  ngay dưới Tổng quan. Thiếu → “—”, không fake số.
- `view`: không nút tạo/add/xóa; ngoài group của mình thì không thấy
  (search chỉ để resolve MSSV khi được admin giao, không liệt kê SV người khác).

## 7. Admin, lỗi, test (Phần 5/5 — đã duyệt)

- Admin: reuse `AdminDashboardController` + `system_roles owner`:
  cấp `view`/`create` theo MSSV (`ttcds_permissions`), xem `ttcds_audit_logs`
  (ai tạo group nào, add MSSV nào, khi nào). Thu hồi Trung tâm = thu hồi `title:ttcds`.
- Test:
  - unit permission (mất nametag chặn hẳn, `view` không POST được, owner chỉ thấy group mình);
  - integration proxy (mock `BE_URL` trả fixture `sinh-vien` đủ `gpa/diem_danh/ren_luyen/su_kien`);
  - e2e tạo group K29 → add 2 MSSV → mở detail đủ 4 tab + khối rèn luyện.

## 8. Không thuộc phạm vi

- Không copy/ETL DB Dashboard về Postgres local.
- Không dùng `training-score.service.js` cho xem hộ.
- Không cho xem chéo group của đồng nghiệp; không import phân công hàng loạt ở phase 1
  (admin tạo hộ thủ công cho `view`).
