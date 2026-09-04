-- Migration 006: Hồ sơ hiển thị cộng đồng và danh hiệu tự chọn (tối đa 3).

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS displayed_title_ids JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_displayed_title_ids_array_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_displayed_title_ids_array_check
      CHECK (displayed_title_ids IS NULL OR jsonb_typeof(displayed_title_ids) = 'array');
  END IF;
END $$;
