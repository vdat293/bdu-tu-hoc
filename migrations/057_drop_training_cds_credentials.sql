-- Bỏ đồng bộ app sinh viên: điểm 6.16 lấy từ dim_su_kien_odp bằng service
-- account (CDS_USER/CDS_PASSWORD), không còn lưu mật khẩu từng sinh viên.
DROP TABLE IF EXISTS training_cds_credentials;
