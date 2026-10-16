-- Migration 059: Kho dữ liệu học vụ ODP (ingest 8 bảng ODP của trường về Postgres).
-- Nguồn: https://cds.bdu.edu.vn/data/<bảng> (HTTP Basic auth CDS_USER/CDS_PASSWORD).
-- odp-sync.service.js fetch trọn bảng rồi mới TRUNCATE + INSERT trong 1 transaction,
-- nên bảng nào fetch lỗi sẽ GIỮ NGUYÊN dữ liệu cũ (không bao giờ để kho rỗng).
--
-- KHÔNG lưu PII: cccd, email, ho_khau, danh_sach_ten_sv, sdt.
-- KHÔNG kéo bảng thư viện (dim_gio_thu_vien_odp).

CREATE TABLE IF NOT EXISTS odp_sinh_vien (
  mssv BIGINT PRIMARY KEY,
  ten_day_du TEXT,
  ho_sv TEXT,
  ten_sv TEXT,
  gioi_tinh TEXT,
  ngay_sinh DATE,
  ma_lop TEXT,
  ten_lop TEXT,
  ma_khoa TEXT,
  ten_khoa TEXT,
  ma_nganh TEXT,
  ten_nganh TEXT,
  ma_chuyen_nganh TEXT,
  ten_chuyen_nganh TEXT,
  ma_cvht TEXT,
  ten_cvht TEXT,
  ten_bac_hoc TEXT,
  hien_dien TEXT,
  nk TEXT
);

CREATE TABLE IF NOT EXISTS odp_tbhk (
  mssv BIGINT NOT NULL,
  nkhk INTEGER NOT NULL,
  ma_lop TEXT,
  ten_sinh_vien TEXT,
  so_tin_chi_dat_hk INTEGER,
  so_tin_chi_dat_tich_luy INTEGER,
  dtb_hk_he_4 NUMERIC,
  dtb_hk_he_10 NUMERIC,
  dtb_tich_luy_he_4 NUMERIC,
  dtb_tich_luy_he_10 NUMERIC,
  xep_loai_hoc_ki TEXT,
  PRIMARY KEY (mssv, nkhk)
);

-- tin_chi: nguồn dim_bang_diem_odp không có cột này → luôn NULL. Giữ lại để
-- câu SELECT của ranking (Task 3) không vỡ khi đọc chung bộ cột với odp_mon_hoc.
CREATE TABLE IF NOT EXISTS odp_bang_diem (
  mssv BIGINT NOT NULL,
  nkhk INTEGER NOT NULL,
  ma_nhom TEXT NOT NULL,
  ten_mon_hoc TEXT,
  diem_hp NUMERIC,
  diem_hp_4 NUMERIC,
  diem_chu_hp TEXT,
  diem_chu_hp_4 TEXT,
  dat_hp BOOLEAN,
  tin_chi INTEGER,
  lop TEXT,
  ma_khoa TEXT,
  PRIMARY KEY (mssv, nkhk, ma_nhom)
);

-- Khoá nguồn là (mssv, ma_nhom, ngay, buoi) nhưng thực tế 16.012/114.067 dòng có
-- `ngay` NULL (và 1.438 dòng trùng khoá đó), nên KHÔNG thể đặt PRIMARY KEY (NOT NULL
-- sẽ chặn cả bảng). Dùng UNIQUE INDEX + dedupe ở tầng service để giữ trọn dữ liệu.
CREATE TABLE IF NOT EXISTS odp_diem_danh (
  mssv BIGINT NOT NULL,
  ma_nhom TEXT,
  ngay DATE,
  buoi INTEGER,
  ma_mon_hoc TEXT,
  ten_mon_hoc TEXT,
  nkhk INTEGER,
  diem_danh TEXT,
  gio_co_mat TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS odp_diem_danh_key_idx
  ON odp_diem_danh (mssv, ma_nhom, ngay, buoi);

-- danh_sach_sv: danh sách MSSV của lớp (không phải tên) — academic-ranking dùng
-- để xác định học kỳ hoạt động (recentActivity).
CREATE TABLE IF NOT EXISTS odp_thoi_khoa_bieu (
  id BIGINT PRIMARY KEY,
  nkhk INTEGER,
  ma_nhom TEXT,
  ma_mon_hoc TEXT,
  ten_mon_hoc TEXT,
  nhom_hoc TEXT,
  ma_giang_vien TEXT,
  ten_giang_vien TEXT,
  ma_phong TEXT,
  buoi_thu INTEGER,
  thu_kieu_so INTEGER,
  tiet_bat_dau INTEGER,
  so_tiet INTEGER,
  ngay_hoc DATE,
  tuan_bat_dau INTEGER,
  tuan_ket_thuc INTEGER,
  danh_sach_sv TEXT
);

CREATE TABLE IF NOT EXISTS odp_ren_luyen (
  mssv BIGINT NOT NULL,
  nkhk INTEGER NOT NULL,
  hoc_ki INTEGER,
  lop TEXT,
  diem_ren_luyen NUMERIC,
  xep_loai TEXT,
  PRIMARY KEY (mssv, nkhk)
);

CREATE TABLE IF NOT EXISTS odp_su_kien (
  id BIGINT PRIMARY KEY,
  ten_su_kien TEXT,
  loai TEXT,
  the_loai TEXT,
  ngay_dien_ra DATE,
  nkhk INTEGER,
  danh_sach_sv TEXT
);

CREATE TABLE IF NOT EXISTS odp_mon_hoc (
  ma_mon_hoc TEXT PRIMARY KEY,
  ten_mon_hoc TEXT,
  tin_chi INTEGER,
  ma_khoa TEXT,
  loai_mon TEXT
);

-- Nhật ký mỗi lần đồng bộ kho ODP (dùng cho /admin + dọn run treo).
CREATE TABLE IF NOT EXISTS odp_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  trigger_source TEXT NOT NULL DEFAULT 'scheduler' CHECK (trigger_source IN ('scheduler', 'manual')),
  counts JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS odp_bang_diem_mssv_idx ON odp_bang_diem (mssv);
CREATE INDEX IF NOT EXISTS odp_diem_danh_mssv_idx ON odp_diem_danh (mssv);
CREATE INDEX IF NOT EXISTS odp_thoi_khoa_bieu_nkhk_ma_nhom_idx ON odp_thoi_khoa_bieu (nkhk, ma_nhom);
CREATE INDEX IF NOT EXISTS odp_su_kien_nkhk_ngay_idx ON odp_su_kien (nkhk, ngay_dien_ra);
CREATE INDEX IF NOT EXISTS odp_sync_runs_started_at_idx ON odp_sync_runs (started_at DESC);
