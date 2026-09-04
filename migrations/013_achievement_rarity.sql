-- Migration 013: Phân cấp độ hiếm để các danh hiệu khó có diện mạo riêng.

ALTER TABLE achievement_definitions
  ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'achievement_definitions_rarity_check'
  ) THEN
    ALTER TABLE achievement_definitions
      ADD CONSTRAINT achievement_definitions_rarity_check
      CHECK (rarity IN ('common', 'rare', 'epic', 'legendary'));
  END IF;
END $$;

UPDATE achievement_definitions
SET rarity = CASE
  WHEN id IN ('academic_king', 'scholar', 'perfect_semester', 'breaking_limits') THEN 'legendary'
  WHEN id IN ('rising_student', 'breakthrough') THEN 'epic'
  WHEN id IN ('steady_climber', 'credit_warrior') THEN 'rare'
  ELSE 'common'
END,
updated_at = NOW();

