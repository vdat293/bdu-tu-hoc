ALTER TABLE inf1003_deploy_keys
  DROP CONSTRAINT inf1003_deploy_keys_pkey,
  DROP CONSTRAINT inf1003_deploy_keys_key_hash_key,
  ADD PRIMARY KEY (key_hash),
  ADD UNIQUE (mssv, script_id);
