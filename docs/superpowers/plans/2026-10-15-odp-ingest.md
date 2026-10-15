# ODP Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kéo 8 bảng ODP của trường về Postgres của bdu-tu-hoc (03:00 hằng ngày, chung lịch ranking), để "Sinh viên của tôi" và Bảng xếp hạng cùng đọc local — bỏ hẳn proxy Dashboard.

**Architecture:** Một service `odp-sync` kéo dữ liệu ODP vào 8 bảng `odp_*` (fetch xong mới truncate+insert trong 1 transaction, nên bảng lỗi giữ nguyên dữ liệu cũ). Scheduler 03:00 chạy ingest rồi mới tới ranking; ranking đổi nguồn đọc từ kho. TTCDS đọc kho bằng service nội bộ giữ nguyên shape `traCuuSinhVien` để frontend không phải sửa.

**Tech Stack:** Node 22 + Express 4, Postgres (`pg`), Node `https`/`fetch` tới `https://cds.bdu.edu.vn/data`, react-query frontend (không đổi).

**Spec:** `docs/superpowers/specs/2026-10-15-odp-ingest-design.md`

## Global Constraints

- Node `>=22.12 <25`; migration mới nhất là `058_ttcds_center.sql` → migration mới là **`059_odp_ingest.sql`**.
- Nguồn: `https://cds.bdu.edu.vn/data/<bảng>`, Basic auth từ `CDS_USER`/`CDS_PASSWORD` (đã có trong `.env`). Base ghi đè bằng `CDS_BASE_URL`.
- Trang phân trang: `?limit=15000&offset=N`, dừng khi trả < limit.
- Danh sách trạng thái điểm danh hợp lệ (**chỉ 5 mã**): `Có`, `Sớm`, `Trễ`, `Phép`, `Vắng`. Rác (`26TH01`, `7`, `9.5`, chuỗi rỗng) → `NULL`. "Có mặt" = `Có/Sớm/Trễ/Phép` (KHÔNG gồm `Vắng`).
- Tên học kỳ suy từ `nkhk`: `hk = ký tự thứ 5`, `niên khóa = 2000 + 2 ký tự đầu` → `'Học kỳ {hk}, năm học {nk0}-{nk0+1}'`.
- **KHÔNG** kéo vào kho: `dim_gio_thu_vien_odp`, và các cột PII `cccd`, `email`, `ho_khau`, `danh_sach_ten_sv`.
- Giữ nguyên: bảng `academic_rankings`, API `/rankings`, UI Bảng xếp hạng, shape `traCuuSinhVien`, toàn bộ frontend `client/src/features/ttcds/**`.
- Thứ tự job bắt buộc: ingest xong mới ranking.
- Không dùng `DASHBOARD_*` sau khi xong.

## Review Focus

- MSSV ghi thiếu/thừa số (mất số 0 đầu) hoặc chuỗi rỗng lọt vào kho → tra cứu ra sinh viên sai; phải coerce số và bỏ dòng thiếu mssv.
- Bảng kéo lỗi giữa chừng KHÔNG được làm rỗng bảng đó (fetch trước, truncate sau, trong 1 transaction).
- `Vắng` bị tính nhầm vào "có mặt" → % chuyên cần sai.
- Ôi nhiễm dữ liệu cũ: sau khi đổi nguồn, ranking phải cho ra cùng kết quả như trước (số sv, thứ hạng).
- 2 instance chạy cùng lúc (deploy/restart) không được ghi chồng vào kho.

---

### Task 1: Migration 059 + `odp-sync.service.js`

**Files:**
- Create: `migrations/059_odp_ingest.sql`
- Create: `src/services/odp-sync.service.js`
- Test: `tests/test-odp-sync.js`

**Interfaces:**
- Consumes: `query, transaction, withAdvisoryLock, isDatabaseConfigured` từ `src/db/database.js`; `CDS_USER`, `CDS_PASSWORD`, `CDS_BASE_URL`, `ODP_SYNC_TIMEOUT_MS`, `CDS_INSECURE_TLS` từ env.
- Produces:
  - `ODP_TABLES` (hằng số): map `{ key, endpoint, table, columns, pk }` cho 8 bảng.
  - `normalizeOdpRows(key, rows) -> Array<object>` (thuần, export để test).
  - `validDiemDanh(value) -> string|null`
  - `hocKyLabel(nkhk) -> { hoc_ky, nien_khoa, ten_hoc_ky }` (thuần)
  - `OdpSyncService.sync({ triggerSource }) -> { skipped, runId, counts, errors }`
  - `OdpSyncService.isReady() -> boolean`
  - `OdpSyncService.markStaleRuns() -> number`
  - `ODP_SYNC_LOCK_ID = 2_030_036_030`

- [ ] **Step 1: Write the failing test** `tests/test-odp-sync.js`:
  - `normalizeOdpRows('diem_danh', [...])`: dòng `diem_danh:'26TH01'` → `null`; `'7'` → `null`; `'Vắng'` giữ nguyên; mssv `''`/`null` → dòng bị loại; `nkhk:'24251'` → số `24251`.
  - `validDiemDanh` cho đúng 5 mã + `null` cho rác.
  - `hocKyLabel(24251)` → `{ hoc_ky: 1, nien_khoa: 2024, ten_hoc_ky: 'Học kỳ 1, năm học 2024-2025' }`; `hocKyLabel(26271)` → `{ hoc_ky: 2, nien_khoa: 2026, ... '2026-2027' }`.
  - `OdpSyncService.sync()` với `fetch` mock (không gọi mạng): trả 2 dòng cho `odp_mon_hoc` → `counts.mon_hoc = 2`, bảng được `TRUNCATE` rồi `INSERT`; 1 bảng lỗi HTTP 500 → bảng đó **giữ dữ liệu cũ** (assert không có `TRUNCATE odp_x`) và `errors` có entry; `odp_sync_runs.status = 'failed'` khi bảng bắt buộc `sinh_vien` lỗi.
  - SKIP sạch khi thiếu `DATABASE_URL` (mẫu `tests/test-ttcds-groups.js:6-9`).

- [ ] **Step 2: Run test to verify it fails** Run: `node tests/test-odp-sync.js` (env test theo `.superpowers/sdd/ttcds-student-center/task-1-report.md`) Expected: FAIL `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement migration `migrations/059_odp_ingest.sql`** 8 bảng theo spec §4 (`odp_sinh_vien`, `odp_tbhk`, `odp_bang_diem`, `odp_diem_danh`, `odp_thoi_khoa_bieu`, `odp_ren_luyen`, `odp_su_kien`, `odp_mon_hoc`) + `odp_sync_runs` (spec §4) + index đã nêu trong spec.

- [ ] **Step 4: Implement `src/services/odp-sync.service.js`**:
  - `fetchTable(key, { base, user, pass })`: phân trang như trên, retry 5 lần backoff x2 + jitter, timeout `ODP_SYNC_TIMEOUT_MS || 180000`, `rejectUnauthorized: !CDS_INSECURE_TLS` (pattern `academic-ranking.service.js:476-510`).
  - `replaceTable(client, { table, columns, pk }, rows)`: `TRUNCATE` rồi `INSERT` **theo batch** (vd 1000 dòng/lệnh), trong transaction của caller.
  - `sync()`: `withAdvisoryLock(ODP_SYNC_LOCK_ID, ...)`; tạo run row `running`; với mỗi bảng: `BEGIN; TRUNCATE; INSERT; COMMIT` (một transaction **cho mỗi bảng** để bảng lỗi không kéo bảng khác); cập nhật run `success`/`failed`.

- [ ] **Step 5: Run migration + test** Run: `npm run db:migrate` rồi `node tests/test-odp-sync.js` Expected: PASS.

- [ ] **Step 6: Commit** `git add migrations/059_odp_ingest.sql src/services/odp-sync.service.js tests/test-odp-sync.js scripts/test-manifest.mjs; git commit -m "feat(odp): migration 059 + dong bo kho ODP"`

### Task 2: Lịch chạy chung + script chạy tay

**Files:**
- Modify: `src/services/ranking-scheduler.service.js`
- Create: `scripts/odp-sync.js`
- Modify: `package.json` (thêm `"odp:sync"`)
- Test: `tests/test-odp-scheduler.js`

**Interfaces:**
- Consumes: `OdpSyncService.sync/isReady/markStaleRuns` (Task 1), `AcademicRankingService.sync` (hiện có).
- Produces: lần chạy 03:00 = `OdpSyncService.sync()` → `AcademicRankingService.sync()`; `RankingSchedulerService` giữ nguyên `start/stop/isStarted/getNextRunAt/isEnabled`.

- [ ] **Step 1: Write the failing test** `tests/test-odp-scheduler.js`: mock `OdpSyncService` + `AcademicRankingService`, gọi hàm chạy (`runOnce` export được) và assert **thứ tự gọi** ingest → ranking; ingest `failed` → ranking **vẫn được gọi**; ingest `skipped` → ranking vẫn gọi; `ranking_sync.enabled=false` → không gọi cả hai.
- [ ] **Step 2: Run test to verify it fails** Run: `node tests/test-odp-scheduler.js` Expected: FAIL.
- [ ] **Step 3: Implement** tách phần thân trong `setTimeout` thành `runScheduledSync()` (export để test) gọi ingest trước, log `[odp-sync]`/`[ranking-sync]` riêng; giữ `markStaleRuns` cho cả hai service lúc start/stop-schedule. Thêm `scripts/odp-sync.js` (pattern `scripts/sync-rankings.js`) hỗ trợ `--ingest-only`.
- [ ] **Step 4: Run test + smoke** Run: `node tests/test-odp-scheduler.js` Expected: PASS.
- [ ] **Step 5: Commit** `git add src/services/ranking-scheduler.service.js scripts/odp-sync.js package.json tests/test-odp-scheduler.js; git commit -m "feat(odp): chay ingest 03:00 chung lich ranking + script odp:sync"`

### Task 3: Ranking đọc từ kho `odp_*`

**Files:**
- Modify: `src/services/academic-ranking.service.js` (hàm `collectRankings`, `DEFAULT_ENDPOINTS`, `fetchRows` nếu không còn dùng)
- Test: `tests/test-ranking-integration.js` (chạy lại, không sửa kỳ vọng), `tests/test-ranking-from-odp.js` (mới)

**Interfaces:**
- Consumes: bảng `odp_tbhk`, `odp_sinh_vien`, `odp_bang_diem`, `odp_mon_hoc`, `odp_thoi_khoa_bieu` (Task 1).
- Produces: `collectRankings()` trả **cùng shape** hiện tại (`gpaRows`, `profileRows`, `detailRows`, `courseRows`, `timetableRows` → hoặc tương đương) để phần tính điểm phía sau không đổi.

- [ ] **Step 1: Write the failing test** `tests/test-ranking-from-odp.js`: seed vài dòng `odp_sinh_vien`/`odp_tbhk`/`odp_bang_diem`/`odp_mon_hoc` cho 2 MSSV thật-nhỏ rồi gọi `collectRankings()` (hoặc `sync()`) và assert số sinh viên + điểm/credit tính ra khớp số seed; assert **không có** lời gọi `https.get` (spy) khi đọc.
- [ ] **Step 2: Run test to verify it fails** Run: `node tests/test-ranking-from-odp.js` Expected: FAIL.
- [ ] **Step 3: Implement** thay 5 lần `fetchRows` bằng `SELECT` từ `odp_*` (cùng tên cột: `mssv, nkhk, dtb_tich_luy_he_4, dat_hp, diem_hp_4, diem_chu_hp_4, tin_chi, ma_mon_hoc, tiet_bat_dau, so_tiet, ngay_hoc, ma_giang_vien`); giữ nguyên `earnedCreditTotals`, `gpaLevel`, `MIN_CLASS_COHORT`, phần ghi `academic_rankings`.
- [ ] **Step 4: Run tests** Run: `node tests/test-ranking-from-odp.js` và `node tests/test-ranking-integration.js` Expected: PASS cả hai.
- [ ] **Step 5: Commit** `git add src/services/academic-ranking.service.js tests/test-ranking-from-odp.js; git commit -m "feat(ranking): doc tu kho odp thay vi goi API rieng"`

### Task 4: TTCDS đọc local, xoá proxy Dashboard

**Files:**
- Create: `src/services/ttcds-student.service.js`
- Modify: `src/modules/ttcds/ttcds.controller.js` (đổi import + 3 chỗ gọi)
- Delete: `src/services/dashboard-proxy.service.js`, `tests/test-ttcds-proxy.js`
- Modify: `.env.example` (bỏ `DASHBOARD_*`, thêm `CDS_BASE_URL`, `ODP_SYNC_TIMEOUT_MS`)
- Test: `tests/test-ttcds-api.js` (sửa mock proxy → mock service mới), `tests/test-ttcds-student-local.js` (mới)

**Interfaces:**
- Consumes: `odp_sinh_vien, odp_tbhk, odp_bang_diem, odp_diem_danh, odp_thoi_khoa_bieu, odp_ren_luyen, odp_su_kien, odp_mon_hoc` (Task 1).
- Produces (giữ **đúng tên method + shape** mà `DashboardProxy` đang trả, để controller đổi mỗi dòng import):
  - `TtcdsStudentService.searchStudents(q, { limit }) -> { ket_qua: [{ mssv, ten_day_du, ma_lop, ma_khoa, ten_khoa, hien_dien }] }`
  - `TtcdsStudentService.getStudent(mssv) -> { tim_thay, ho_so, gpa_hoc_ky, bang_diem, diem_danh, diem_danh_mon, thoi_khoa_bieu, ren_luyen, su_kien }`
  - `TtcdsStudentService.getAttendance(mssv, { ma_mon_hoc, ma_nhom, nkhk }) -> NhatKyDiemDanh` (404 khi không có dữ liệu)
  - Lỗi mang `.status` (404 khi MSSV không có trong `odp_sinh_vien`).

- [ ] **Step 1: Write the failing test** `tests/test-ttcds-student-local.js`: seed `odp_sinh_vien` (1 MSSV), `odp_tbhk` (2 kỳ), `odp_diem_danh` (có `Có` + `Vắng`), `odp_ren_luyen`, `odp_su_kien` → assert `getStudent` trả `ho_so.ten_day_du`, `gpa_hoc_ky` sắp theo `nkhk`, `diem_danh` tính đúng (`Vắng` **không** vào `di_hoc`), `ren_luyen` đúng điểm/xếp loại, `su_kien` đúng số; `searchStudents('24')` ra MSSV; `getStudent('99999999')` ném `.status 404`; `getAttendance` thiếu dữ liệu → 404.
- [ ] **Step 2: Run test to verify it fails** Run: `node tests/test-ttcds-student-local.js` Expected: FAIL.
- [ ] **Step 3: Implement `ttcds-student.service.js`** — dựng shape từ `odp_*`; `diem_danh_mon` gộp theo `ma_mon_hoc` (đếm `di_hoc`/`vang`/`so_buoi` theo đúng 5 mã); tên học kỳ dùng `hocKyLabel`.
- [ ] **Step 4: Đổi controller sang service mới**; xoá `dashboard-proxy.service.js` + `tests/test-ttcds-proxy.js`; sửa `tests/test-ttcds-api.js` mock sang `TtcdsStudentService`; cập nhật `.env.example`.
- [ ] **Step 5: Run tests** Run: `node tests/test-ttcds-student-local.js tests/test-ttcds-api.js tests/test-ttcds-groups.js` Expected: PASS.
- [ ] **Step 6: Commit** `git add -A src/services/ttcds-student.service.js src/modules/ttcds src/services/dashboard-proxy.service.js tests .env.example; git commit -m "feat(ttcds): doc chi tiet sinh vien tu kho local, bo proxy Dashboard"`

### Task 5: Admin ODP panel + docs + verify tổng

**Files:**
- Modify: `src/modules/admin/admin-dashboard.controller.js` (+ route `src/routes/admin.routes.js`): `GET /api/admin/dashboard/odp-sync`, `POST /api/admin/dashboard/odp-sync`
- Modify: `public/admin/index.html` + `public/admin/admin.js`: khối "Kho ODP" (lần chạy gần nhất, số dòng mỗi bảng, lỗi, nút "Chạy ngay")
- Modify: `READFORME.md`, `docs/architecture.md` (env `CDS_BASE_URL`/`ODP_SYNC_TIMEOUT_MS`, mô tả kho + lịch 03:00, bỏ mục Dashboard proxy)
- Test: `tests/test-odp-admin-api.js`

**Interfaces:**
- Consumes: `odp_sync_runs`, `OdpSyncService.sync({ triggerSource: 'manual' })` (Task 1-2).

- [ ] **Step 1: Write the failing test** `tests/test-odp-admin-api.js`: `GET` trả run gần nhất + `counts`; `POST` gọi `OdpSyncService.sync` (mock) với `triggerSource:'manual'`; thiếu quyền admin → 403.
- [ ] **Step 2: Run test to verify it fails** Run: `node tests/test-odp-admin-api.js` Expected: FAIL.
- [ ] **Step 3: Implement** endpoint + panel admin (theo pattern tab sẵn có trong `public/admin/admin.js`).
- [ ] **Step 4: Cập nhật docs** READFORME/architecture.
- [ ] **Step 5: Verify tổng** Run: `node tests/test-odp-sync.js tests/test-odp-scheduler.js tests/test-ranking-from-odp.js tests/test-ttcds-student-local.js tests/test-ttcds-api.js tests/test-ranking-integration.js tests/test-odp-admin-api.js` + `npx vitest run` + `npm run lint:frontend` + `npm run build:client` Expected: PASS hết.
- [ ] **Step 6: Chạy thật end-to-end** Run: `npm run odp:sync` trên DB thật (grep `odp_sync_runs` ra `success` + số dòng ~520k) rồi mở `/mystudent` xác nhận hiện GPA/chuyên cần/rèn luyện/sự kiện **không cần server Dashboard**.
- [ ] **Step 7: Commit** `git add -A src/modules/admin src/routes/admin.routes.js public/admin READFORME.md docs tests/test-odp-admin-api.js; git commit -m "feat(odp): admin panel kho ODP + docs"`
