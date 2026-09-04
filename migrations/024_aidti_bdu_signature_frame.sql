-- Migration 024: register the AIDTI BDU animated signature frame.

INSERT INTO identity_items (
  id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata
)
VALUES (
  'frame:aidti-bdu',
  'frame',
  'AIDTI',
  'Khung Signature Viện Trí tuệ Nhân tạo và Chuyển đổi số với sinh viên BDU chibi.',
  'legendary',
  'aidti-bdu',
  'optional',
  12,
  '{"manual_grantable": true, "source": "migration", "motion": "aidti-data-awaken"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  asset_key = EXCLUDED.asset_key,
  display_policy = EXCLUDED.display_policy,
  sort_order = EXCLUDED.sort_order,
  metadata = identity_items.metadata || EXCLUDED.metadata,
  is_active = TRUE,
  updated_at = NOW();
