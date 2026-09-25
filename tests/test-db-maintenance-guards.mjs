import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeMaintenanceTarget,
  getPostgresConnectionArgs,
  getPostgresEnv,
  getSafeDatabaseTarget
} from '../scripts/postgres-utils.js';
import { assertSafeMigrationConnectionString } from '../src/db/database.js';

const localTestTarget = {
  host: '127.0.0.1',
  port: '55432',
  user: 'bdu_test',
  password: 'not-printed',
  database: 'bdu_test_local'
};

test('maintenance guard allows an explicit local test target', () => {
  const target = assertSafeMaintenanceTarget(localTestTarget, { operation: 'restore' });
  assert.equal(target.database, 'bdu_test_local');
  assert.deepEqual(getPostgresConnectionArgs(target), [
    '--host=127.0.0.1',
    '--port=55432',
    '--username=bdu_test',
    '--dbname=bdu_test_local'
  ]);
});

test('maintenance guard rejects remote targets without explicit production opt-in', () => {
  assert.throws(
    () => assertSafeMaintenanceTarget({ ...localTestTarget, host: 'db.example.com' }, { operation: 'dump' }),
    (error) => error.code === 'NON_LOCAL_MAINTENANCE_TARGET'
  );
});

test('production opt-in is required for a local non-test restore', () => {
  const previous = process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
  delete process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
  try {
    assert.throws(
      () => assertSafeMaintenanceTarget({ ...localTestTarget, database: 'bdu_hub' }, { operation: 'restore', allowProduction: true }),
      (error) => error.code === 'PRODUCTION_OPT_IN_REQUIRED'
    );
  } finally {
    if (previous === undefined) delete process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
    else process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION = previous;
  }
});

test('maintenance preserves safe SSL query parameters and requires encryption remotely', () => {
  const previousUrl = process.env.BDU_TEST_DATABASE_URL;
  const previousOptIn = process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
  const previousReject = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION = '1';
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
  process.env.BDU_TEST_DATABASE_URL = 'postgresql://bdu_test:secret@db.example.com:5432/bdu_test_remote?sslmode=require&connect_timeout=10';
  try {
    const target = getSafeDatabaseTarget({ operation: 'dump', allowProduction: true });
    assert.equal(target.sslmode, 'require');
    assert.equal(getPostgresEnv(target, { allowProduction: true }).PGSSLMODE, 'require');
  } finally {
    if (previousUrl === undefined) delete process.env.BDU_TEST_DATABASE_URL;
    else process.env.BDU_TEST_DATABASE_URL = previousUrl;
    if (previousOptIn === undefined) delete process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
    else process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION = previousOptIn;
    if (previousReject === undefined) delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    else process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = previousReject;
  }
});

test('remote maintenance refuses non-verifying TLS by default', () => {
  const previousUrl = process.env.BDU_TEST_DATABASE_URL;
  const previousOptIn = process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
  const previousReject = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION = '1';
  delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  process.env.BDU_TEST_DATABASE_URL = 'postgresql://bdu_test:secret@db.example.com:5432/bdu_test_remote?sslmode=require';
  try {
    const target = getSafeDatabaseTarget({ operation: 'dump', allowProduction: true });
    assert.throws(
      () => getPostgresEnv(target, { allowProduction: true }),
      (error) => error.code === 'REMOTE_SSL_VERIFY_REQUIRED'
    );
  } finally {
    if (previousUrl === undefined) delete process.env.BDU_TEST_DATABASE_URL;
    else process.env.BDU_TEST_DATABASE_URL = previousUrl;
    if (previousOptIn === undefined) delete process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION;
    else process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION = previousOptIn;
    if (previousReject === undefined) delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    else process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = previousReject;
  }
});

test('restore rejects a non-test local database by default', () => {
  assert.throws(
    () => assertSafeMaintenanceTarget({ ...localTestTarget, database: 'bdu_hub' }, { operation: 'restore' }),
    (error) => error.code === 'NON_TEST_RESTORE_TARGET'
  );
});

test('test-mode URL selection ignores inherited DATABASE_URL', () => {
  const previousTestUrl = process.env.BDU_TEST_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.BDU_TEST_DATABASE_URL = 'postgresql://bdu_test:secret@localhost:55432/bdu_test_guard?host=evil.example';
  process.env.DATABASE_URL = 'postgresql://production:secret@production.example/bdu_hub';
  try {
    assert.throws(
      () => getSafeDatabaseTarget({ operation: 'restore' }),
      (error) => error.code === 'UNSAFE_DATABASE_URL'
    );
  } finally {
    if (previousTestUrl === undefined) delete process.env.BDU_TEST_DATABASE_URL;
    else process.env.BDU_TEST_DATABASE_URL = previousTestUrl;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('normal migration URL rejects connection-target query overrides', () => {
  assert.throws(
    () => assertSafeMigrationConnectionString('postgresql://user:pass@db.example.com/app?host=evil.example'),
    (error) => error.code === 'UNSAFE_MIGRATION_DATABASE_URL'
  );
  assert.equal(
    assertSafeMigrationConnectionString('postgresql://user:pass@localhost:5432/app?connect_timeout=10').host,
    'localhost'
  );
});

console.log('✅ Backup/restore targets are fail-closed and credentials stay out of argv.');
