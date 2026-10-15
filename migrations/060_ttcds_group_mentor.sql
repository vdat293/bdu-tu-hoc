-- Migration 060: them cot mentor (ten tu do, toi da 120 ky tu) cho nhom TTCDS.
-- Form tao nhom chi con Ten nhom · Mentor · danh sach sinh vien.
-- Giu nguyen nien_khoa/description (du lieu cu, frontend chi ngung dung).

ALTER TABLE ttcds_groups ADD COLUMN IF NOT EXISTS mentor TEXT;
