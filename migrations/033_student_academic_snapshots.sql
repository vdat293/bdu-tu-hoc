-- Migration 033: Snapshot học lực chụp mỗi lần sinh viên đăng nhập.
--
-- Lý do: thẻ thống kê trên trang hồ sơ (/confession/profile/:mssv) cần GPA hệ 10,
-- GPA hệ 4, tín chỉ đạt và xếp loại tích lũy của bất kỳ sinh viên nào mà không
-- phụ thuộc token BDU còn sống. Dữ liệu được trích từ payload điểm BDU
-- (dtb_tich_luy_he_10, dtb_tich_luy_he_4, so_tin_chi_dat_tich_luy, xep_loai_tkb_hk)
-- ngay sau khi login thành công; bảng academic_rankings chỉ là nguồn dự phòng.

CREATE TABLE IF NOT EXISTS student_academic_snapshots (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  gpa_10 NUMERIC(5,2),
  gpa_4 NUMERIC(5,2),
  earned_credits NUMERIC(8,2),
  classification TEXT,
  semester_code TEXT,
  source TEXT NOT NULL DEFAULT 'bdu_login',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_academic_snapshots_updated_idx
  ON student_academic_snapshots (updated_at DESC);
