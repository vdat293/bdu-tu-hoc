-- Register the Sukuna / Malevolent Shrine signature frame for existing databases.
INSERT INTO identity_items (
  id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata
)
VALUES (
  'frame:anime-sukuna',
  'frame',
  'Ngự Trù Tử',
  'Khung Anime Signature Sukuna lấy cảm hứng từ Malevolent Shrine: lãnh địa mở và đại điện nguyền rủa hiện thân trong không gian thật.',
  'legendary',
  'anime-sukuna',
  'optional',
  12,
  '{"manual_grantable": true, "source": "config", "motion": "sukuna-malevolent-shrine"}'::jsonb
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
