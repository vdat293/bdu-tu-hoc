ALTER TABLE inf1003_deploy_keys
  ADD COLUMN script_id TEXT CHECK (script_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  ALTER COLUMN region DROP NOT NULL,
  ALTER COLUMN bucket DROP NOT NULL;
