# ODP Ingest — kho dữ liệu học vụ của riêng bdu-tu-hoc (Design Spec)

Ngày: 2026-10-15
Trạng thái: đã duyệt hướng (chat), chờ review spec file
Thay thế: `docs/superpowers/specs/2026-10-15-ttcds-student-center-design.md` §5 (proxy Dashboard BE)

## 1. Bối cảnh & vấn đề

Tính năng "Sinh viên của tôi" (Trung tâm CĐS) hiện lấy chi tiết sinh viên bằng cách
proxy sang một **Dashboard BE** (`DASHBOARD_BE_URL`, port 3001). Trên máy thật
**không tồn tại server đó**, nên tính năng không dùng được.

Kiểm tra nguồn thật:

- Nguồn dữ liệu gốc là **API ODP của trường**: `https://cds.bdu.edu.vn/data/<bảng>`
  (HTTP Basic auth). Dashboard chỉ là lớp ETL kéo 9 bảng ODP về warehouse DuckDB
  riêng của nó (`C:\BDU\Dashboard\server\src\etl\extract.ts`, `api/client.ts`).
- bdu-tu-hoc **đã có sẵn tài khoản CDS** (`CDS_USER`/`CDS_PASSWORD`) và đang dùng
  cho `dim_su_kien_odp` (`src/services/training-score.service.js`) và cho ranking
  (`src/services/academic-ranking.service.js`).
- **Đã kiểm chứng** (probe thật, 200 OK + dữ liệu):
  `fact_ho_so_sinh_vien_odp` 16.403 dòng · `fact_bang_diem_tbhk_odp` 45.297 ·
  `dim_bang_diem_odp` 266.061 · `dim_danh_sach_diem_danh_odp` 114.067 ·
  `dim_thoi_khoa_bieu_odp` 51.967 · `dim_diem_ren_luyen_odp` 23.708 ·
  `dim_su_kien_odp` 266 · `dim_mon_hoc_odp` 2.287. Tổng ~520k dòng.

Thêm nữa, `academic-ranking.service.js` **cũng đang kéo 5 bảng ODP**
(gpa, hồ sơ, bảng điểm, môn học, TKB) rồi bỏ dữ liệu thô — tức mỗi ngày kéo trùng.
Gộp lại thành **một lần kéo dùng chung** cho cả ranking và TTCDS.

## 2. Mục tiêu

1. Kéo 8 bảng ODP về Postgres của bdu-tu-hoc, cập nhật **03:00 mỗi ngày**, chung
   lịch + công tắc `/admin` với ranking.
2. "Sinh viên của tôi" đọc dữ liệu **local** → bỏ proxy và 3 biến `DASHBOARD_*`.
3. Ranking đọc từ kho `odp_*` thay vì tự fetch → một lần kéo, hai nơi dùng.
4. Không rò PII không cần (cccd, email, hộ khẩu, danh sách tên SV).

## 3. Kiến trúc

```
cds.bdu.edu.vn/data/<bảng>     (Basic auth CDS_USER/CDS_PASSWORD)
        │  odp-sync.service.js
        ▼
Postgres bdu_hub:  odp_*  (8 bảng)  +  odp_sync_runs (nhật ký)
        ├── ttcds.service.js     → trang "Sinh viên của tôi" (thay dashboard-proxy)
        └── academic-ranking.service.js → academic_rankings (giữ nguyên API/UI)
```

- **Một job duy nhất** chạy: ingest ODP → rồi calc ranking. Thứ tự này bắt buộc:
  ranking đọc kho vừa kéo.
- Lịch + công tắc dùng lại `RankingSchedulerService` (`RANKING_SYNC_HOUR`,
  `system_settings.ranking_sync.enabled`) — không thêm scheduler thứ hai.

## 4. Data model (migration 059)

8 bảng `odp_*` theo đúng cột nguồn (đã lọc PII), khoá chính theo nguồn:

| Bảng | Khoá | Cột chính |
|---|---|---|
| `odp_sinh_vien` | `mssv` | ten_day_du, ho_sv, ten_sv, gioi_tinh, ngay_sinh, ma_lop, ten_lop, ma_khoa, ten_khoa, ma_nganh, ten_nganh, ma_chuyen_nganh, ten_chuyen_nganh, ma_cvht, ten_cvht, ten_bac_hoc, hien_dien, nk |
| `odp_tbhk` | `(mssv, nkhk)` | ma_lop, ten_sinh_vien, so_tin_chi_dat_hk, so_tin_chi_dat_tich_luy, dtb_hk_he_4, dtb_hk_he_10, dtb_tich_luy_he_4, dtb_tich_luy_he_10, xep_loai_hoc_ki |
| `odp_bang_diem` | `(mssv, nkhk, ma_nhom)` | ten_mon_hoc, diem_hp, diem_hp_4, diem_chu_hp, diem_chu_hp_4, dat_hp, tin_chi, lop, ma_khoa |
| `odp_diem_danh` | `(mssv, ma_nhom, ngay, buoi)` | ma_mon_hoc, ten_mon_hoc, nkhk, diem_danh, gio_co_mat |
| `odp_thoi_khoa_bieu` | `(id)` | nkhk, ma_nhom, ma_mon_hoc, ten_mon_hoc, nhom_hoc, ma_giang_vien, ten_giang_vien, ma_phong, buoi_thu, thu_kieu_so, tiet_bat_dau, so_tiet, ngay_hoc, tuan_bat_dau, tuan_ket_thuc |
| `odp_ren_luyen` | `(mssv, nkhk)` | hoc_ki, lop, diem_ren_luyen, xep_loai |
| `odp_su_kien` | `id` | ten_su_kien, loai, the_loai, ngay_dien_ra, nkhk, danh_sach_sv (chuỗi JSON) |
| `odp_mon_hoc` | `ma_mon_hoc` | ten_mon_hoc, tin_chi, ma_khoa, loai_mon |

- **KHÔNG** đưa vào kho: `thu_vien` (không dùng), `cccd`, `email`, `ho_khau`,
  `danh_sach_ten_sv` (PII).
- `odp_su_kien.danh_sach_sv` giữ nguyên **chuỗi** như nguồn; việc tách thành mảng
  thuộc tầng đọc (đã có `parseEventParticipants` trong `training-score.service.js`).
- Bảng `odp_sync_runs`: `id`, `started_at`, `finished_at`, `status`
  (`running|success|failed`), `trigger_source` (`scheduler|manual`), `counts jsonb`
  (số dòng mỗi bảng), `error text`. Dùng để `/admin` hiển thị + dọn run treo
  (cùng pattern `academic_ranking_sync_runs`).
- Index: `odp_bang_diem (mssv)`, `odp_diem_danh (mssv)`, `odp_thoi_khoa_bieu (mssv?)`
  → thực tế TKB không có mssv (có `danh_sach_sv`), nên index theo `(nkhk, ma_nhom)`;
  `odp_su_kien (nkhk, ngay_dien_ra)`.

## 5. Đồng bộ (odp-sync.service.js)

- Kéo từng bảng: `GET {CDS_BASE}/{bảng}?limit=15000&offset=N` cho tới khi trả < limit
  (chỉ `dim_bang_diem_odp` cần phân trang sâu; các bảng khác 1 phát).
- Timeout/retry/backoff theo đúng pattern đang dùng: `RANKING_SYNC_TIMEOUT_MS`,
  `CDS_INSECURE_TLS`, retry 5 lần backoff x2 + jitter.
- **Ghi theo từng bảng**: `BEGIN; TRUNCATE odp_x; INSERT ...; COMMIT;` trong **một
  transaction**. Fetch xong mới truncate → **bảng nào kéo lỗi thì giữ nguyên dữ liệu
  cũ của bảng đó** (không bao giờ để kho rỗng vì mạng hỏng).
- Khoá advisory (`withAdvisoryLock`, lock id mới) chống 2 instance chạy chồng.
- Đếm số dòng mỗi bảng vào `odp_sync_runs.counts`; lỗi từng bảng ghi vào `error`
  nhưng không chặn các bảng khác; nếu **bảng bắt buộc** (sinh_vien, tbhk) lỗi →
  đánh dấu run `failed`.
- Chuẩn hoá: MSSV/nkhk là số; ngày về `date`; `diem_danh` chỉ nhận giá trị đã chấm
  (`DD_DA_CHAM`), rác → NULL (cùng quy tắc ETL Dashboard).
- Env mới: `CDS_BASE_URL` (mặc định `https://cds.bdu.edu.vn/data`), `ODP_SYNC_TIMEOUT_MS`
  (mặc định 180000). Không cần `DASHBOARD_*` nữa.

## 6. Lịch chạy

- `RankingSchedulerService` đổi tên trách nhiệm: lần chạy 03:00 sẽ
  `odp-sync.sync()` → `ranking.sync()`. Giữ nguyên: giờ cấu hình `RANKING_SYNC_HOUR`,
  công tắc `system_settings.ranking_sync.enabled`, `RANKING_SYNC_ENABLED`,
  dọn run treo lúc khởi động.
- Nếu ingest thất bại (không có kho mới) → ranking **vẫn chạy** trên kho cũ và ghi
  cảnh báo; không chặn lịch.
- Script chạy tay: `npm run odp:sync` (mới, cùng pattern `scripts/sync-rankings.js`)
  → ingest + ranking (`--ingest-only` để chỉ kéo kho).

## 7. Ranking đổi nguồn

- `collectRankings()` bỏ 5 lần `fetchRows`, đọc `odp_*` bằng SQL (cùng trường).
- **Giữ nguyên** `academic_rankings`, `academic_ranking_sync_runs`, API `/rankings`,
  UI Bảng xếp hạng, và các quy tắc nghiệp vụ hiện có (MIN_CLASS_COHORT,
  gpaLevel, earnedCreditTotals…). Đây là đổi nguồn đọc, không đổi kết quả.
- Tiêu chí không vỡ: `tests/test-ranking-integration.js` + `test:ranking-integration`
  phải PASS trước/sau.

## 8. TTCDS đổi nguồn

- `ttcds.service` (hoặc service mới `ttcds-student.service.js`) tự dựng object
  `traCuuSinhVien` (`ho_so, gpa_hoc_ky, diem_danh, bang_diem, thoi_khoa_bieu,
  diem_danh_mon, su_kien, ren_luyen`) từ `odp_*`, suy tên học kỳ từ `nkhk`.
- **Xoá** `src/services/dashboard-proxy.service.js`, `tests/test-ttcds-proxy.js`,
  3 biến `DASHBOARD_*` khỏi `.env.example` và docs.
- Không cần bảng `dim_hoc_ky` mới: tên học kỳ **suy trực tiếp từ `nkhk`**
  (`hk = ký tự thứ 5`, `niên khóa = 2000 + 2 ký tự đầu`) — đúng công thức Dashboard
  dùng để dựng `dim_hoc_ky` (`server/src/etl/transform.ts:41-47`), nên kho không phải
  chứa bảng tra riêng.
- Frontend **không sửa** (giữ đúng shape cũ).
- `/api/ttcds/students/search` tìm trong `odp_sinh_vien` (ILIKE theo MSSV/tên) thay
  vì gọi Dashboard.

## 9. Vận hành & test

- Migration `059_odp_ingest.sql`; chạy `npm run db:migrate`.
- `/admin`: thêm khối "Kho ODP" đọc `odp_sync_runs` (lần chạy gần nhất, số dòng,
  lỗi, nút "Chạy ngay" = `POST /api/admin/dashboard/odp-sync`).
- Test:
  - unit: chuẩn hoá dòng (coerce), phân trang, map cột — thuần hàm.
  - integration ingest: mock HTTP (không gọi mạng) → assert truncate+insert,
    lỗi 1 bảng giữ dữ liệu cũ, run status đúng.
  - regression ranking: `test:ranking-integration` PASS sau khi đổi nguồn.
  - TTCDS: test hiện có chạy trên dữ liệu local.
- Tiêu chí hoàn thành: máy sạch + `DATABASE_URL` + `CDS_USER/CDS_PASSWORD` →
  `npm run odp:sync` xong thì trang "Sinh viên của tôi" hiện đúng GPA/chuyên cần/
  rèn luyện/sự kiện **không cần** bất kỳ server nào khác.

## 10. Không thuộc phạm vi

- Không kéo `dim_gio_thu_vien_odp` (thư viện) — không tính năng nào dùng.
- Không realtime/on-demand theo từng sinh viên (dữ liệu theo ngày là đủ).
- Không đụng API `/rankings`, UI bảng xếp hạng, hay shape dữ liệu TTCDS.
- Không giữ fallback proxy Dashboard (bỏ hẳn).
