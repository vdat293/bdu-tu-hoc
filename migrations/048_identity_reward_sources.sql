-- Multiple independent ways to earn the same item, including future quests.
ALTER TABLE identity_entitlement_grants
  ADD COLUMN IF NOT EXISTS source_ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE identity_entitlement_grants
  DROP CONSTRAINT IF EXISTS identity_entitlement_grants_source_check;
ALTER TABLE identity_entitlement_grants
  ADD CONSTRAINT identity_entitlement_grants_source_check
  CHECK (source IN ('manual', 'achievement', 'ranking', 'clan', 'campaign', 'migration', 'quest'));

ALTER TABLE identity_entitlement_grants
  DROP CONSTRAINT IF EXISTS identity_quest_reward_check;
ALTER TABLE identity_entitlement_grants
  ADD CONSTRAINT identity_quest_reward_check
  CHECK (source <> 'quest' OR (source_ref <> '' AND expires_at IS NULL));

DROP INDEX IF EXISTS identity_entitlement_active_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS identity_entitlement_source_unique_idx
  ON identity_entitlement_grants (mssv, item_id, source, source_ref)
  WHERE revoked_at IS NULL;
