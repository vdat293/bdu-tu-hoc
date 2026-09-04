-- Migration 021: Bổ sung các danh hiệu #Không đối thủ, #Nam vương, #Học tài thi phận
-- và cột has_failed_course cho sinh viên.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS has_failed_course BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO identity_items (
  id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata
) VALUES
  (
    'title:khong-doi-thu', 'title', '#Không đối thủ', 'Top 1 toàn trường BDU',
    'legendary', 'khong-doi-thu', 'optional', 3,
    '{"manual_grantable": true, "source": "config", "tone": "gold", "auto_rule": "rank_1_truong"}'::jsonb
  ),
  (
    'title:nam-vuong', 'title', '#Nam vương', 'đẹp trai có gì sai',
    'vip', 'nam-vuong', 'optional', 4,
    '{"manual_grantable": true, "source": "config", "tone": "violet"}'::jsonb
  ),
  (
    'title:hoc-tai-thi-phan', 'title', '#Học tài thi phận', 'Dành cho sinh viên có môn học bị rớt',
    'rare', 'hoc-tai-thi-phan', 'optional', 11,
    '{"manual_grantable": true, "source": "config", "tone": "bronze", "auto_rule": "has_failed_course"}'::jsonb
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
