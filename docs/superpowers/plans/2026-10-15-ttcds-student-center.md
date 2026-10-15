# Trung tâm CĐS — “Sinh viên của tôi” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm Trung tâm Chuyển đổi số gated nametag `#TTCDS` với dịch vụ “Sinh viên của tôi” (group riêng tư theo khóa + detail proxy Dashboard BE).

**Architecture:** Backend Express thêm module `ttcds` (service local groups/permissions + proxy server-to-server sang Dashboard BE bằng service-account cookie session, cache 5 phút); frontend React (client/) thêm page `/ttcds` port gọn 4-tab Dashboard + khối rèn luyện riêng từ field `ren_luyen`.

**Tech Stack:** Node 22 + Express 4, Postgres (`pg`), React 19 + react-router + tanstack-query, Dashboard BE (Fastify, cookie `bdudash_session`, JWT).

**Spec:** `docs/superpowers/specs/2026-10-15-ttcds-student-center-design.md`

## Global Constraints

- Node `>=22.12 <25` (`package.json engines`).
- Không dùng `training-score.service.js` cho xem hộ; điểm rèn luyện duy nhất từ field `ren_luyen` của Dashboard proxy.
- Group riêng tư: list mặc định `WHERE owner_mssv = me`; không xem chéo group đồng nghiệp.
- Có nametag mà chưa có dòng quyền → coi như `view`; thu hồi Trung tâm = thu hồi `title:ttcds`.
- Thứ tự đăng ký route giữ nguyên trong `src/routes/api.routes.js` (thêm sau clubs).
- Migration mới `migrations/019_ttcds_center.sql`, chạy bằng `npm run db:migrate`.

## Review Focus

- MSSV chữ thường / kèm space paste list (`" 22050006,24050126 "`) phải chuẩn hóa UPPER-trim trước mọi query, nếu không group chứa 2 bản ghi cùng 1 SV.
- Dashboard trả 403 ngoài phạm vi phải hiện đúng “ngoài phạm vi phụ trách”, không được nuốt thành 500 hay trang trắng.
- Dashboard BE chết/timeout phải 503 retryable + nút thử lại, không treo spinner vô hạn.
- `view` POST group/member phải 403 kể cả khi gọi API trực tiếp (không chỉ ẩn nút).
- Cookie session Dashboard hết hạn giữa chừng phải login lại 1 lần rồi retry, không lộ password trong log.

---

### Task 1: Migration + `ttcds.service.js` (groups/members/permissions/audit)

**Files:**
- Create: `migrations/019_ttcds_center.sql`
- Create: `src/services/ttcds.service.js`
- Test: `tests/test-ttcds-groups.js`

**Interfaces:**
- Consumes: `query, transaction, isDatabaseConfigured` từ `src/db/database.js`
- Produces:
  - `TtcdsService.listGroups(ownerMssv, { includeAll }) -> Array<{id,name,nien_khoa,description,owner_mssv,member_count,created_at}>`
  - `TtcdsService.createGroup({ name, nienKhoa, description, ownerMssv }) -> group`
  - `TtcdsService.addMember(groupId, mssv, { addedBy, note }) -> member`
  - `TtcdsService.removeMember(groupId, mssv) -> boolean`
  - `TtcdsService.listMembers(groupId) -> Array<{mssv, note, added_by_mssv, created_at}>`
  - `TtcdsService.getLevel(mssv) -> 'view' | 'create'`
  - `TtcdsService.setLevel({ mssv, level, grantedBy, note }) -> row`
  - `normalizeTtcdsMssv(v) -> UPPER-trim`

- [ ] **Step 1: Write the failing test** `tests/test-ttcds-groups.js`: tạo group K29 owner `TEST_TTCDS_OWNER`, add `22050006` + `' 24050126 '` (space/thường), assert listMembers chuẩn hóa UPPER, `listGroups` của owner khác không thấy group này, `getLevel` mặc định `'view'`, `setLevel create` rồi `getLevel` ra `'create'`; dọn dữ liệu TEST_* đầu/cuối (theo mẫu `tests/test-permission-rbac.js:33-40`).
- [ ] **Step 2: Run test to verify it fails** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-groups.js` Expected: FAIL (file/table chưa có).
- [ ] **Step 3: Implement migration `migrations/019_ttcds_center.sql`** 4 bảng theo spec §4 (`ttcds_groups`, `ttcds_group_members` unique `(group_id,mssv)`, `ttcds_permissions` check `level IN ('view','create')`, `ttcds_audit_logs`) + index `(owner_mssv)`, `(mssv)`.
- [ ] **Step 4: Implement `TtcdsService` trong `src/services/ttcds.service.js`** đúng signatures trên; `addMember` INSERT `students(mssv) ON CONFLICT DO NOTHING` trước (copy `src/services/student.service.js: joinClan`); mọi MSSV qua `normalizeTtcdsMssv`.
- [ ] **Step 5: Run migration + test** Run: `npm run db:migrate` rồi `node scripts/run-explicit-suite.mjs tests/test-ttcds-groups.js` Expected: PASS (hoặc SKIP sạch khi thiếu `DATABASE_URL`).
- [ ] **Step 6: Commit** `git add migrations/019_ttcds_center.sql src/services/ttcds.service.js tests/test-ttcds-groups.js; git commit -m "feat(ttcds): groups/members/permissions service + migration 019"`

### Task 2: Gating `ttcds:access` + level check

**Files:**
- Modify: `src/services/permission.service.js`
- Modify: `src/config/identity-items.json` (nếu metadata thiếu capabilities)
- Test: mở rộng `tests/test-ttcds-groups.js` (thêm block) hoặc `tests/test-permission-rbac.js` kiểu grant

**Interfaces:**
- Consumes: `TtcdsService.getLevel` (Task 1)
- Produces:
  - `PermissionService.can(mssv, 'ttcds:access') -> boolean` (true khi có `title:ttcds`/`achievement:ttcds`/`ttcds`)
  - `TtcdsService.requireAccess(mssv) -> throws 403` khi mất nametag
  - `TtcdsService.requireCreate(mssv) -> throws 403` khi `getLevel !== 'create'`

- [ ] **Step 1: Write the failing test** assert `can(TEST_TTCDS_USER,'ttcds:access')===true` sau khi grant `title:ttcds`, `can(REGULAR,'ttcds:access')===false`; `requireCreate` với user `view` ném 403, với `create` pass.
- [ ] **Step 2: Run test to verify it fails** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-groups.js` Expected: FAIL (`ttcds:access` chưa match).
- [ ] **Step 3: Implement** thêm `'title:ttcds': [..., 'ttcds:access']` (và 2 alias `ttcds`, `achievement:ttcds`) trong `TITLE_CAPABILITIES_MAP` (`src/services/permission.service.js:96-100`); thêm `requireAccess/requireCreate` vào `ttcds.service.js`; đồng bộ `metadata.capabilities` của `title:ttcds` trong `src/config/identity-items.json` nếu đang thiếu.
- [ ] **Step 4: Run test to verify it passes** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-groups.js` Expected: PASS.
- [ ] **Step 5: Commit** `git add src/services/permission.service.js src/services/ttcds.service.js src/config/identity-items.json tests/test-ttcds-groups.js; git commit -m "feat(ttcds): gate ttcds:access + view/create levels"`

### Task 3: `dashboard-proxy.service.js` (service-account cookie session + cache)

**Files:**
- Create: `src/services/dashboard-proxy.service.js`
- Modify: `.env.example` (thêm `DASHBOARD_BE_URL`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`)
- Test: `tests/test-ttcds-proxy.js` (mock fetch, không cần Dashboard thật)

**Interfaces:**
- Consumes: Dashboard `POST /api/dang-nhap {ten_dang_nhap, mat_khau}` → cookie `bdudash_session` (`server/src/server.ts:72-98`, `auth/secret.ts:41`); `GET /api/sinh-vien/:mssv` (400/403/200 `traCuuSinhVien`, `server/src/server.ts:340-349`); `GET /api/tim-sinh-vien?q=&limit=` (400 khi <2 ký tự, `server.ts:351-357`); `GET /api/sinh-vien/:mssv/diem-danh?ma_mon_hoc=&ma_nhom=&nkhk=` (`server.ts:364-383`)
- Produces:
  - `DashboardProxy.searchStudents(q, { limit }) -> { ket_qua }`
  - `DashboardProxy.getStudent(mssv) -> { tim_thay, ho_so, gpa_hoc_ky, bang_diem, diem_danh, ren_luyen, thoi_khoa_bieu, diem_danh_mon, su_kien, ... }`
  - `DashboardProxy.getAttendance(mssv, { ma_mon_hoc, ma_nhom, nkhk }) -> NhatKyDiemDanh`
  - Lỗi mang `status`: 400/403 passthrough message `loi`, BE chết/timeout 8s → 503 `retryable=true` (pattern `profileUnavailableError` trong `src/services/bdu.service.js:457-463`)

- [ ] **Step 1: Write the failing test** mock global `fetch`: login trả `set-cookie: bdudash_session=JWT`, `getStudent(22050006)` trả fixture có đủ `gpa_hoc_ky/diem_danh/ren_luyen/su_kien`; assert cache (lần 2 không fetch thêm); giả lập detail trả 401 một lần → proxy tự login lại rồi retry thành công (password không xuất hiện trong log/error); assert 403 Dashboard → lỗi `status 403` giữ message “quyền xem”, assert fetch throw → lỗi `status 503`.
- [ ] **Step 2: Run test to verify it fails** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-proxy.js` Expected: FAIL.
- [ ] **Step 3: Implement `dashboard-proxy.service.js`** login 1 lần, cache cookie + expiry, tự login lại 1 lần khi 401 rồi retry; cache nhớ `Map` 5 phút cho `getStudent`; timeout 8000ms; không log password; base URL `process.env.DASHBOARD_BE_URL ?? 'http://localhost:3001'`.
- [ ] **Step 4: Run test to verify it passes** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-proxy.js` Expected: PASS.
- [ ] **Step 5: Commit** `git add src/services/dashboard-proxy.service.js tests/test-ttcds-proxy.js .env.example; git commit -m "feat(ttcds): dashboard proxy with service-account session + cache"`

### Task 4: Routes + controller `/api/ttcds/*`

**Files:**
- Create: `src/modules/ttcds/ttcds.controller.js`
- Create: `src/routes/ttcds.routes.js`
- Modify: `src/routes/api.routes.js` (gọi `registerTtcdsRoutes` sau clubs)
- Modify: `src/config/feature-groups.js` (thêm nhóm `ttcds`)
- Test: `tests/test-ttcds-api.js` (supertest/express hoặc gọi controller với req/res giả + stub proxy)

**Interfaces:**
- Consumes: `TtcdsService` (Task 1-2), `DashboardProxy` (Task 3), `BduIdentityService.resolveVerifiedMssv` (mẫu `src/modules/clubs/clubs.controller.js:35-45`)
- Produces endpoints:
  - `GET /api/ttcds/capabilities -> { result, can_access, level }`
  - `GET /api/ttcds/groups (?all=1 admin)` / `POST /api/ttcds/groups` (cần create) / `DELETE /api/ttcds/groups/:id` (owner hoặc admin)
  - `GET/POST/DELETE /api/ttcds/groups/:id/members[/:mssv]` (owner của group + create; `view` 403)
  - `GET /api/ttcds/students/search?q=` / `GET /api/ttcds/students/:mssv` / `GET /api/ttcds/students/:mssv/diem-danh` (cần access; member phải thuộc group của mình trừ admin `?all=1`, nếu không 403 “ngoài phạm vi phụ trách”)
  - `GET/PUT /api/ttcds/permissions` + `GET /api/ttcds/audit` (chỉ owner `system_roles`/identity_admin, reuse `AdminDashboardController.requireAdmin` pattern)

- [ ] **Step 1: Write the failing test** `view` POST group → 403; `create` POST group K29 → 201; owner khác GET members → 403; `GET students/:mssv` với stub proxy trả fixture → 200 đủ `ren_luyen`; admin `?all=1` thấy hết.
- [ ] **Step 2: Run test to verify it fails** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-api.js` Expected: FAIL.
- [ ] **Step 3: Implement controller + routes** đúng endpoints trên; `requireVerifiedMssv`-style qua `BduIdentityService`; ghi `ttcds_audit_logs` cho create/add/remove/grant; `Cache-Control: private, no-store` + `Vary: Authorization` cho members (copy `clubs.controller.js:163-165`).
- [ ] **Step 4: Run tests** Run: `node scripts/run-explicit-suite.mjs tests/test-ttcds-api.js tests/test-ttcds-groups.js tests/test-ttcds-proxy.js` Expected: PASS.
- [ ] **Step 5: Commit** `git add src/modules/ttcds src/routes/ttcds.routes.js src/routes/api.routes.js src/config/feature-groups.js tests/test-ttcds-api.js; git commit -m "feat(ttcds): /api/ttcds routes + access control + audit"`

### Task 5: Frontend `/ttcds` (list + detail 4-tab + rèn luyện riêng)

**Files:**
- Create: `client/src/api/ttcds.js`
- Create: `client/src/features/ttcds/TtcdsPage.jsx` (list groups)
- Create: `client/src/features/ttcds/TtcdsGroupPage.jsx` (members + summary + add MSSV)
- Create: `client/src/features/ttcds/TtcdsStudentPage.jsx` (detail 4-tab + khối rèn luyện)
- Modify: `client/src/app/routes.jsx`, `client/src/app/navigation.js`
- Test: `tests/frontend/ttcds-pages.test.jsx`

**Interfaces:**
- Consumes: API Task 4; shape Dashboard `traCuuSinhVien` (`ho_so, gpa_hoc_ky, diem_danh, bang_diem, thoi_khoa_bieu, diem_danh_mon, su_kien, ren_luyen`)
- Produces: routes `/ttcds`, `/ttcds/groups/:id`, `/ttcds/students/:mssv`; nav item “Trung tâm CĐS” ẩn khi thiếu `ttcds:access`

- [ ] **Step 1: Write the failing test** render với query mock: không `can_access` → không thấy nav; `level view` → không có nút tạo; detail fixture có `ren_luyen [{nkhk, diem_ren_luyen, xep_loai}]` → thấy khối “Điểm rèn luyện” tách khỏi 4 tab; thiếu field → “—”.
- [ ] **Step 2: Run test to verify it fails** Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx` Expected: FAIL.
- [ ] **Step 3: Implement** `client/src/api/ttcds.js` (fetch + token header, mẫu `client/src/api/community.js:41`); 3 pages port gọn từ `chi-tiet-sinh-vien.tsx` (Tổng quan: GPA theo kỳ + điểm danh theo kỳ / TKB / Bảng điểm / Sự kiện) + khối rèn luyện riêng; summary dòng member (GPA tích lũy mới nhất, % chuyên cần kỳ đang học, rèn luyện kỳ mới nhất, số sự kiện kỳ hiện tại) tính từ detail đã cache; paste list MSSV split `[,\s;]+`.
- [ ] **Step 4: Run tests + lint + build** Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx`, `npm run lint:frontend`, `npm run build:client` Expected: PASS.
- [ ] **Step 5: Commit** `git add client/src/api/ttcds.js client/src/features/ttcds tests/frontend/ttcds-pages.test.jsx client/src/app/routes.jsx client/src/app/navigation.js; git commit -m "feat(ttcds): frontend Trung tam CDS + detail 4-tab"`

### Task 6: Admin cấp quyền + kiểm thử tổng + docs

**Files:**
- Modify: `client/src/features/ttcds/*` (panel admin `?all=1`, cấp view/create, xem audit — chỉ khi là owner/admin)
- Modify: `READFORME.md` hoặc `docs/architecture.md` (ghi service account Dashboard + env mới)
- Test: chạy toàn bộ liên quan

**Interfaces:**
- Consumes: `GET/PUT /api/ttcds/permissions`, `GET /api/ttcds/audit` (Task 4)

- [ ] **Step 1: Implement admin panel tối thiểu** trong TtcdsPage khi `?all=1` và là admin: table permissions (set view/create), table audit mới nhất.
- [ ] **Step 2: Run full verification** Run: `npm run test:node`, `npm run lint:frontend`, `npm run build:client`, `node scripts/run-explicit-suite.mjs tests/test-ttcds-groups.js tests/test-ttcds-proxy.js tests/test-ttcds-api.js` Expected: PASS.
- [ ] **Step 3: Commit** `git add client/src/features/ttcds READFORME.md docs/architecture.md; git commit -m "feat(ttcds): admin permissions panel + docs"`
