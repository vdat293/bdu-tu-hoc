-- Migration 067: Stamp progress_version on guide_step_progress rows.
-- Version bump của lesson phải bỏ qua tiến độ cũ (không xóa cứng): service đếm/lọc
-- theo progress_version hiện hành trong course_guide_configs.
-- Idempotent: runner có thể chạy lại toàn bộ file mà không lỗi.

ALTER TABLE guide_step_progress ADD COLUMN IF NOT EXISTS progress_version TEXT;

UPDATE guide_step_progress p
SET progress_version = c.progress_version
FROM course_guide_configs c
WHERE p.course_code = c.course_code
  AND p.lesson_id = c.lesson_id
  AND p.progress_version IS NULL;
