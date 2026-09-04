-- Migration 015: Danh hiệu VIP #TTCDS do chủ hệ thống cấp thủ công.

ALTER TABLE achievement_definitions
  DROP CONSTRAINT IF EXISTS achievement_definitions_rarity_check;

ALTER TABLE achievement_definitions
  ADD CONSTRAINT achievement_definitions_rarity_check
  CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'vip'));

CREATE TABLE IF NOT EXISTS manual_achievement_grants (
  achievement_id TEXT NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL,
  granted_by TEXT NOT NULL DEFAULT 'owner',
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (achievement_id, mssv)
);

CREATE INDEX IF NOT EXISTS manual_achievement_grants_mssv_idx
  ON manual_achievement_grants (mssv, is_active);

INSERT INTO achievement_definitions (
  id, label, description, tone, rule_type, rule_config,
  is_active, sort_order, rarity
) VALUES (
  'ttcds', '#TTCDS', 'Trung tâm Chuyển đổi số', 'violet',
  'manual_assignment', '{}'::jsonb, TRUE, 5, 'vip'
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  tone = EXCLUDED.tone,
  rule_type = EXCLUDED.rule_type,
  rule_config = EXCLUDED.rule_config,
  sort_order = EXCLUDED.sort_order,
  rarity = EXCLUDED.rarity,
  updated_at = NOW();

INSERT INTO manual_achievement_grants (
  achievement_id, mssv, granted_by, note, is_active
) VALUES
  ('ttcds', '22050006', 'owner', 'Trung tâm Chuyển đổi số', TRUE),
  ('ttcds', '24050126', 'owner', 'Trung tâm Chuyển đổi số', TRUE)
ON CONFLICT (achievement_id, mssv) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  note = EXCLUDED.note,
  is_active = TRUE,
  updated_at = NOW();

-- Chỉ tạo bản ghi đã mở khóa khi sinh viên đang active trên web.
-- Grant của sinh viên chưa active vẫn được giữ để mở khóa khi họ quay lại.
INSERT INTO student_achievement_unlocks (mssv, achievement_id, evidence)
SELECT
  grants.mssv,
  grants.achievement_id,
  JSONB_BUILD_OBJECT(
    'grant_type', 'manual',
    'granted_by', grants.granted_by,
    'note', grants.note,
    'granted_at', grants.granted_at
  )
FROM manual_achievement_grants grants
JOIN achievement_definitions definitions
  ON definitions.id = grants.achievement_id AND definitions.is_active = TRUE
JOIN students
  ON students.mssv = grants.mssv AND students.is_active = TRUE
WHERE grants.achievement_id = 'ttcds'
  AND grants.is_active = TRUE
ON CONFLICT (mssv, achievement_id) DO NOTHING;

