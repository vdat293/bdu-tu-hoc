-- Migration 020: Bổ sung 5 danh hiệu mới và lưu thông tin học thuật cho sinh viên.
-- #Đại ca (năm 4), #Tiền bối (năm 2+), #Phó bí thư đoàn (admin cấp, theme Đoàn), #Dev (khoa TH), #ChatGPT (admin cấp, logo AI).

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS class_code TEXT,
  ADD COLUMN IF NOT EXISTS faculty_code TEXT,
  ADD COLUMN IF NOT EXISTS cohort INTEGER;

CREATE INDEX IF NOT EXISTS students_academic_context_idx
  ON students (faculty_code, cohort);

-- Khởi tạo hoặc cập nhật 5 danh hiệu mới trong catalog database
INSERT INTO identity_items (
  id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata
) VALUES
  (
    'title:chatgpt', 'title', '#ChatGPT', 'không biết thì hỏi AI',
    'vip', 'chatgpt', 'optional', 6,
    '{"manual_grantable": true, "source": "config", "tone": "chatgpt"}'::jsonb
  ),
  (
    'title:pho-bi-thu-doan', 'title', '#Phó bí thư đoàn', 'Phó bí thư đoàn trường',
    'vip', 'pho-bi-thu-doan', 'optional', 7,
    '{"manual_grantable": true, "source": "config", "tone": "youth"}'::jsonb
  ),
  (
    'title:dai-ca', 'title', '#Đại ca', 'Dành cho sinh viên năm 4 BDU',
    'epic', 'dai-ca', 'optional', 8,
    '{"manual_grantable": true, "source": "config", "tone": "gold", "auto_rule": "year_4"}'::jsonb
  ),
  (
    'title:tien-boi', 'title', '#Tiền bối', 'Dành cho sinh viên từ năm 2 trở đi',
    'rare', 'tien-boi', 'optional', 9,
    '{"manual_grantable": true, "source": "config", "tone": "blue", "auto_rule": "year_2_plus"}'::jsonb
  ),
  (
    'title:dev', 'title', '#Dev', 'Dành cho sinh viên Khoa Tin học (TH)',
    'epic', 'dev', 'optional', 10,
    '{"manual_grantable": true, "source": "config", "tone": "emerald", "auto_rule": "faculty_th"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  asset_key = EXCLUDED.asset_key,
  display_policy = EXCLUDED.display_policy,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Đồng bộ dữ liệu khoa, lớp, khóa cho sinh viên đã có trong bảng academic_rankings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'academic_rankings') THEN
    UPDATE students s
    SET
      class_code = COALESCE(s.class_code, r.class_code),
      faculty_code = COALESCE(s.faculty_code, r.faculty_code),
      cohort = COALESCE(s.cohort, r.cohort)
    FROM (
      SELECT DISTINCT ON (mssv) mssv, class_code, faculty_code, cohort
      FROM academic_rankings
      ORDER BY mssv, sync_run_id DESC
    ) r
    WHERE s.mssv = r.mssv;
  END IF;
END $$;
