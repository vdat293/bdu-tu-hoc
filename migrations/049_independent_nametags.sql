-- Historical intermediate schema. Migration 050 folds these six entries into title items.
ALTER TABLE identity_items
  DROP CONSTRAINT IF EXISTS identity_items_item_type_check;
ALTER TABLE identity_items
  ADD CONSTRAINT identity_items_item_type_check
  CHECK (item_type IN ('frame', 'title', 'nametag', 'capability'));

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS equipped_nametag_id TEXT,
  ADD COLUMN IF NOT EXISTS nametag_text VARCHAR(32);
