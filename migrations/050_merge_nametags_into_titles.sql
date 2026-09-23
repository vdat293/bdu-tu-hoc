-- The six gem nameplates are title catalog entries, not a separate cosmetic.
WITH gem_titles (old_id, new_id, label, rarity, tone, gem_asset, sort_order) AS (VALUES
  ('nametag:green',  'title:ngoc-luc-bao', 'Ngọc Lục Bảo', 'rare',      'emerald', 'green', 70),
  ('nametag:blue',   'title:lam-tinh',     'Lam Tinh',     'rare',      'blue',    'blue',  71),
  ('nametag:orange', 'title:ho-phach',    'Hổ Phách',     'rare',      'bronze',  'orange',72),
  ('nametag:gold',   'title:kim-quang',   'Kim Quang',    'epic',      'gold',    'gold',  73),
  ('nametag:pink',   'title:hong-ngoc',   'Hồng Ngọc',    'epic',      'charm',   'pink',  74),
  ('nametag:purple', 'title:tu-tinh',     'Tử Tinh',      'legendary', 'violet',  'purple',75)
)
INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata, is_active, updated_at)
SELECT new_id, 'title', '#' || label, 'Danh hiệu mới với nền ngọc ' || label || '.', rarity,
       replace(new_id, 'title:', ''), 'optional', sort_order,
       jsonb_build_object('manual_grantable', TRUE, 'source', 'config', 'tone', tone, 'gem_asset', gem_asset),
       TRUE, NOW()
FROM gem_titles
ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  asset_key = EXCLUDED.asset_key,
  display_policy = EXCLUDED.display_policy,
  sort_order = EXCLUDED.sort_order,
  metadata = identity_items.metadata || EXCLUDED.metadata,
  is_active = TRUE,
  updated_at = NOW();

WITH gem_titles (old_id, new_id) AS (VALUES
  ('nametag:green',  'title:ngoc-luc-bao'),
  ('nametag:blue',   'title:lam-tinh'),
  ('nametag:orange', 'title:ho-phach'),
  ('nametag:gold',   'title:kim-quang'),
  ('nametag:pink',   'title:hong-ngoc'),
  ('nametag:purple', 'title:tu-tinh')
)
UPDATE identity_entitlement_grants old_grant
SET revoked_at = NOW(), revoke_reason = 'Merged into the matching title item', updated_at = NOW()
FROM gem_titles map
WHERE old_grant.item_id = map.old_id
  AND old_grant.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM identity_entitlement_grants title_grant
    WHERE title_grant.mssv = old_grant.mssv
      AND title_grant.item_id = map.new_id
      AND title_grant.source = old_grant.source
      AND title_grant.source_ref = old_grant.source_ref
      AND title_grant.revoked_at IS NULL
  );

WITH gem_titles (old_id, new_id) AS (VALUES
  ('nametag:green',  'title:ngoc-luc-bao'),
  ('nametag:blue',   'title:lam-tinh'),
  ('nametag:orange', 'title:ho-phach'),
  ('nametag:gold',   'title:kim-quang'),
  ('nametag:pink',   'title:hong-ngoc'),
  ('nametag:purple', 'title:tu-tinh')
)
UPDATE identity_entitlement_grants old_grant
SET item_id = map.new_id, updated_at = NOW()
FROM gem_titles map
WHERE old_grant.item_id = map.old_id;

WITH gem_titles (old_id, new_id) AS (VALUES
  ('nametag:green',  'title:ngoc-luc-bao'),
  ('nametag:blue',   'title:lam-tinh'),
  ('nametag:orange', 'title:ho-phach'),
  ('nametag:gold',   'title:kim-quang'),
  ('nametag:pink',   'title:hong-ngoc'),
  ('nametag:purple', 'title:tu-tinh')
)
UPDATE identity_entitlement_audit audit
SET item_id = map.new_id
FROM gem_titles map
WHERE audit.item_id = map.old_id;

WITH gem_titles (old_id, new_id) AS (VALUES
  ('nametag:green',  'title:ngoc-luc-bao'),
  ('nametag:blue',   'title:lam-tinh'),
  ('nametag:orange', 'title:ho-phach'),
  ('nametag:gold',   'title:kim-quang'),
  ('nametag:pink',   'title:hong-ngoc'),
  ('nametag:purple', 'title:tu-tinh')
)
UPDATE students student
SET displayed_title_ids = to_jsonb(
      (array_prepend(map.new_id, array_remove(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(student.displayed_title_ids, '[]'::jsonb))),
        map.new_id
      )))[1:4]
    ),
    equipped_nametag_id = NULL,
    nametag_text = NULL,
    updated_at = NOW()
FROM gem_titles map
WHERE student.equipped_nametag_id = map.old_id;

DELETE FROM identity_items
WHERE item_type = 'nametag'
  AND id IN ('nametag:green', 'nametag:blue', 'nametag:orange', 'nametag:gold', 'nametag:pink', 'nametag:purple');

ALTER TABLE identity_items
  DROP CONSTRAINT IF EXISTS identity_items_item_type_check;
ALTER TABLE identity_items
  ADD CONSTRAINT identity_items_item_type_check
  CHECK (item_type IN ('frame', 'title', 'capability'));

ALTER TABLE students
  DROP COLUMN IF EXISTS equipped_nametag_id,
  DROP COLUMN IF EXISTS nametag_text;
