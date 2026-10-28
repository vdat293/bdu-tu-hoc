-- Migration 068: Lưu kết quả lab (dòng BDU-LAB-V1:) theo từng học viên/môn/bài.
-- Không FK cứng tới courses để tránh phụ thuộc sync bảng điểm (giống guide_step_progress).
-- GET lọc theo progress_version hiện hành trong course_guide_configs: version cũ bị
-- bỏ qua (không xóa cứng), giống tiến độ guide_step_progress.
-- Idempotent: runner có thể chạy lại toàn bộ file mà không lỗi.

CREATE TABLE IF NOT EXISTS guide_lab_results (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  course_code VARCHAR(64) NOT NULL,
  lesson_id VARCHAR(64) NOT NULL,
  status TEXT NOT NULL,
  region TEXT NOT NULL,
  fe_ip TEXT NOT NULL,
  be_ip TEXT NOT NULL,
  db_endpoint TEXT NOT NULL,
  fe_key_path TEXT NOT NULL,
  be_key_path TEXT NOT NULL,
  token TEXT NOT NULL,
  progress_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, course_code, lesson_id)
);

CREATE INDEX IF NOT EXISTS guide_lab_results_mssv_idx
  ON guide_lab_results (mssv, updated_at DESC);
