import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExplicitTestDatabase,
  createExplicitTestEnv,
  createSafeTestEnv,
  isTestEnvironment
} from '../scripts/test-environment.mjs';

test('safe test environment removes inherited credentials and side-effect configuration', () => {
  const env = createSafeTestEnv({
    PATH: '/usr/bin',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://prod/db',
    BDU_TEST_DATABASE_URL: 'postgresql://test/bdu_test_local',
    R2_SECRET_ACCESS_KEY: 'secret',
    DISCORD_BOT_TOKEN: 'token',
    FB_IMPORT_ENABLED: 'true',
    CDS_PASSWORD: 'password',
    SMTP_PASS: 'mail-secret',
    POSTGRES_PASSWORD: 'postgres-secret',
    SYSTEM_ADMIN_KEY: 'admin-secret',
    NODE_OPTIONS: '--require=unexpected-preload.js',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    GITHUB_TOKEN: 'github-secret',
    CUSTOM_TOKEN: 'unknown-secret',
    PORT: '3000'
  });

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.BDU_TEST_MODE, '1');
  assert.equal(env.BDU_TEST_RUNNER, 'safe');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.BDU_TEST_DATABASE_URL, undefined);
  assert.equal(env.R2_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.DISCORD_BOT_TOKEN, undefined);
  assert.equal(env.FB_IMPORT_ENABLED, undefined);
  assert.equal(env.CDS_PASSWORD, undefined);
  assert.equal(env.SMTP_PASS, undefined);
  assert.equal(env.POSTGRES_PASSWORD, undefined);
  assert.equal(env.SYSTEM_ADMIN_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.CUSTOM_TOKEN, undefined);
  assert.equal(env.PORT, undefined);
  assert.equal(isTestEnvironment(env), true);
});

test('explicit database guard rejects production and test-like non-prefix names', () => {
  const base = {
    NODE_ENV: 'test',
    BDU_TEST_MODE: '1',
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1'
  };

  assert.throws(
    () => assertExplicitTestDatabase({ ...base, BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_hub' }),
    /bdu_test_/
  );
  assert.throws(
    () => assertExplicitTestDatabase({ ...base, BDU_TEST_DATABASE_URL: 'postgresql://prod.example/bdu_test_prod' }),
    /allowlist/
  );
  assert.throws(
    () => assertExplicitTestDatabase({ ...base, BDU_TEST_DATABASE_URL: 'postgresql://localhost/contest' }),
    /bdu_test_/
  );
  assert.throws(
    () => assertExplicitTestDatabase({
      ...base,
      BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local?host=prod.example.com'
    }),
    /query hoặc fragment override/
  );
});

test('explicit database guard requires all opt-in flags and a safe host', () => {
  assert.throws(
    () => assertExplicitTestDatabase({
      BDU_TEST_MODE: '1',
      BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
      BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local'
    }),
    /NODE_ENV=test/
  );
  assert.throws(
    () => assertExplicitTestDatabase({
      NODE_ENV: 'test',
      BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
      BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local'
    }),
    /BDU_TEST_MODE=1/
  );
  assert.throws(
    () => assertExplicitTestDatabase({
      NODE_ENV: 'test',
      BDU_TEST_MODE: '1',
      BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local'
    }),
    /CONFIRM_DESTRUCTIVE/
  );

  const url = 'postgresql://tester:secret@localhost:5432/bdu_test_local';
  assert.equal(assertExplicitTestDatabase({
    NODE_ENV: 'test',
    BDU_TEST_MODE: '1',
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
    BDU_TEST_DATABASE_URL: url
  }), url);

  const ipv6Url = 'postgresql://tester:secret@[::1]:5432/bdu_test_local';
  assert.equal(assertExplicitTestDatabase({
    NODE_ENV: 'test',
    BDU_TEST_MODE: '1',
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
    BDU_TEST_DATABASE_URL: ipv6Url
  }), ipv6Url);
});

test('explicit environment maps only a prefixed R2 test bucket', () => {
  const base = {
    NODE_ENV: 'test',
    BDU_TEST_MODE: '1',
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
    BDU_TEST_DATABASE_URL: 'postgresql://tester:secret@localhost/bdu_test_local',
    BDU_TEST_R2_BUCKET: 'bdu-test-media',
    BDU_TEST_R2_ENDPOINT: 'http://127.0.0.1:9000',
    BDU_TEST_R2_ACCESS_KEY_ID: 'test-key',
    BDU_TEST_R2_SECRET_ACCESS_KEY: 'test-secret'
  };

  const env = createExplicitTestEnv(base);
  assert.equal(env.DATABASE_URL, base.BDU_TEST_DATABASE_URL);
  assert.equal(env.BDU_TEST_DATABASE_URL, base.BDU_TEST_DATABASE_URL);
  assert.equal(env.BDU_TEST_RUNNER, 'explicit');
  assert.equal(env.BDU_TEST_CONFIRM_DESTRUCTIVE, '1');
  assert.equal(env.R2_BUCKET, 'bdu-test-media');
  assert.equal(env.R2_ENDPOINT, 'http://127.0.0.1:9000');
  assert.equal(env.R2_ACCESS_KEY_ID, 'test-key');
  assert.equal(env.R2_SECRET_ACCESS_KEY, 'test-secret');
  assert.equal(env.RANKING_SYNC_ENABLED, 'false');
  assert.equal(env.REMINDER_SCHEDULER_ENABLED, 'false');
  assert.equal(env.CLIENT_ASSET_HISTORY_ENABLED, 'false');
  assert.equal(env.FB_IMPORT_ENABLED, 'false');
  assert.equal(env.SYSTEM_OWNER_MSSV, 'TEST_OWNER_001');

  assert.throws(
    () => createExplicitTestEnv({ ...base, BDU_TEST_R2_BUCKET: 'production-bucket' }),
    /bdu-test-/
  );
  assert.throws(
    () => createExplicitTestEnv({ ...base, BDU_TEST_R2_SECRET_ACCESS_KEY: '' }),
    /BDU_TEST_R2_SECRET_ACCESS_KEY/
  );
  assert.throws(
    () => createExplicitTestEnv({ ...base, BDU_TEST_R2_ENDPOINT: 'https://production-r2.example' }),
    /allowlist/
  );

  const nonR2Env = createExplicitTestEnv(base, { includeR2: false });
  assert.equal(nonR2Env.R2_BUCKET, undefined);
  assert.equal(nonR2Env.R2_SECRET_ACCESS_KEY, undefined);

  const ipv6R2Env = createExplicitTestEnv({
    ...base,
    BDU_TEST_R2_ENDPOINT: 'http://[::1]:9000'
  });
  assert.equal(ipv6R2Env.R2_ENDPOINT, 'http://[::1]:9000');
});
