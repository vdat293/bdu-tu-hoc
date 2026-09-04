-- Migration 011: Tách danh hiệu tải học tập thường và vượt giới hạn tín chỉ.

UPDATE achievement_definitions
SET
  description = 'Trong một học kỳ hoàn thành từ 18 tín chỉ và vẫn đạt GPA học kỳ từ 3.20.',
  rule_config = '{"minCredits": 18, "minGpa": 3.2}'::jsonb,
  updated_at = NOW()
WHERE id = 'credit_warrior';

INSERT INTO achievement_definitions (
  id, label, description, tone, rule_type, rule_config, is_active, sort_order
) VALUES (
  'breaking_limits', '#Phá vỡ giới hạn',
  'Trong một học kỳ hoàn thành trên 20 tín chỉ và vẫn đạt GPA học kỳ từ 3.20.',
  'violet', 'semester_credits_with_gpa',
  '{"minCredits": 20, "minGpa": 3.2, "strictCredits": true}', TRUE, 45
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  tone = EXCLUDED.tone,
  rule_type = EXCLUDED.rule_type,
  rule_config = EXCLUDED.rule_config,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

