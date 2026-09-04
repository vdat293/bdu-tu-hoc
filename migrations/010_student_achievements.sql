-- Migration 010: Thành tựu học tập chỉ dành cho sinh viên đang active trên web.

CREATE TABLE IF NOT EXISTS achievement_definitions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'blue'
    CHECK (tone IN ('gold', 'silver', 'bronze', 'blue', 'emerald', 'violet')),
  rule_type TEXT NOT NULL,
  rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_semester_results (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  semester_code VARCHAR(32) NOT NULL,
  semester_name TEXT,
  semester_gpa_4 NUMERIC(5, 2) NOT NULL
    CHECK (semester_gpa_4 > 0 AND semester_gpa_4 <= 4),
  semester_classification TEXT,
  earned_credits NUMERIC(8, 2),
  source TEXT NOT NULL DEFAULT 'bdu_grades',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, semester_code)
);

CREATE TABLE IF NOT EXISTS student_achievement_unlocks (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (mssv, achievement_id)
);

CREATE INDEX IF NOT EXISTS achievement_definitions_active_idx
  ON achievement_definitions (is_active, sort_order);

CREATE INDEX IF NOT EXISTS student_achievement_unlocks_mssv_idx
  ON student_achievement_unlocks (mssv, unlocked_at DESC);

INSERT INTO achievement_definitions (
  id, label, description, tone, rule_type, rule_config, is_active, sort_order
) VALUES
  (
    'academic_king', '#Vua học thuật',
    'Tất cả học kỳ đã có kết quả đều đạt GPA học kỳ từ 3.20, tối thiểu 2 học kỳ.',
    'gold', 'all_semesters_min_gpa', '{"minGpa": 3.2, "minSemesters": 2}', TRUE, 10
  ),
  (
    'scholar', '#Học bá',
    'Đạt loại Xuất sắc trong ít nhất 3 học kỳ.',
    'gold', 'excellent_semester_count', '{"count": 3, "excellentGpa": 3.6}', TRUE, 20
  ),
  (
    'rising_student', '#Sinh viên đang lên',
    'GPA học kỳ tăng liên tiếp trong 3 học kỳ gần nhất; mỗi lần tăng ít nhất 0.01.',
    'emerald', 'latest_consecutive_gpa_increases', '{"increaseCount": 2, "minDelta": 0.01}', TRUE, 30
  ),
  (
    'perfect_semester', '#Kỳ học hoàn hảo',
    'Có ít nhất 1 học kỳ đạt GPA học kỳ 4.00.',
    'violet', 'any_semester_min_gpa', '{"minGpa": 4.0}', TRUE, 40
  ),
  (
    'breakthrough', '#Bứt phá ngoạn mục',
    'GPA học kỳ gần nhất tăng ít nhất 0.50 so với học kỳ liền trước.',
    'emerald', 'latest_gpa_delta', '{"minDelta": 0.5}', TRUE, 50
  ),
  (
    'steady_climber', '#Đường dài vững bước',
    'Có ít nhất 5 học kỳ đạt GPA học kỳ từ 2.50 trở lên.',
    'blue', 'semester_min_gpa_count', '{"count": 5, "minGpa": 2.5}', TRUE, 60
  ),
  (
    'credit_warrior', '#Chiến thần tín chỉ',
    'Trong một học kỳ hoàn thành từ 20 tín chỉ và vẫn đạt GPA học kỳ từ 3.20.',
    'bronze', 'semester_credits_with_gpa', '{"minCredits": 20, "minGpa": 3.2}', TRUE, 70
  )
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  tone = EXCLUDED.tone,
  rule_type = EXCLUDED.rule_type,
  rule_config = EXCLUDED.rule_config,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

