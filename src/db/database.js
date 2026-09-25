import pg from 'pg';
import { isTestEnvironment } from '../config/load-env.js';

const { Pool } = pg;

let pool;
let poolConnectionKey;
let migrationPool;
let migrationPoolKey;

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function databaseConfigError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertExplicitTestDatabaseFlags() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'test') {
    throw databaseConfigError('Test mode bắt buộc có NODE_ENV=test.', 'DATABASE_TEST_FLAGS_MISSING');
  }
  if (!boolEnv('BDU_TEST_MODE')) {
    throw databaseConfigError('Test mode bắt buộc có BDU_TEST_MODE=1.', 'DATABASE_TEST_FLAGS_MISSING');
  }
  if (!boolEnv('BDU_TEST_CONFIRM_DESTRUCTIVE')) {
    throw databaseConfigError(
      'Test database bắt buộc có BDU_TEST_CONFIRM_DESTRUCTIVE=1.',
      'DATABASE_TEST_CONFIRMATION_MISSING'
    );
  }
}

const SAFE_MIGRATION_QUERY_KEYS = new Set(['sslmode', 'connect_timeout', 'application_name']);

export function assertSafeMigrationConnectionString(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw databaseConfigError('Migration database URL không hợp lệ.', 'INVALID_MIGRATION_DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw databaseConfigError('Migration database URL phải dùng postgres/postgresql.', 'INVALID_MIGRATION_DATABASE_URL');
  }
  const query = Object.fromEntries(parsed.searchParams.entries());
  const unsafeKeys = Object.keys(query).filter((key) => !SAFE_MIGRATION_QUERY_KEYS.has(key));
  if (parsed.hash || unsafeKeys.length > 0) {
    throw databaseConfigError(
      'Migration database URL chỉ được chứa sslmode/connect_timeout/application_name.',
      'UNSAFE_MIGRATION_DATABASE_URL'
    );
  }
  if (query.sslmode && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(query.sslmode)) {
    throw databaseConfigError('Migration sslmode không hợp lệ.', 'UNSAFE_MIGRATION_DATABASE_URL');
  }
  if (query.connect_timeout && (!/^\d+$/.test(query.connect_timeout) || Number(query.connect_timeout) < 1 || Number(query.connect_timeout) > 300)) {
    throw databaseConfigError('Migration connect_timeout phải là số giây 1..300.', 'UNSAFE_MIGRATION_DATABASE_URL');
  }
  return {
    url: value,
    host: normalizeHostname(parsed.hostname),
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    sslmode: query.sslmode || null
  };
}

function getConfiguredDatabaseTarget() {
  if (!isTestEnvironment()) {
    const connectionString = process.env.DATABASE_URL || null;
    return connectionString ? { key: connectionString, options: { connectionString } } : null;
  }

  const testUrl = process.env.BDU_TEST_DATABASE_URL || null;
  if (!testUrl) return null;
  assertExplicitTestDatabaseFlags();

  let parsed;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw databaseConfigError('BDU_TEST_DATABASE_URL không hợp lệ.', 'INVALID_TEST_DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw databaseConfigError('BDU_TEST_DATABASE_URL phải dùng postgres/postgresql.', 'INVALID_TEST_DATABASE_URL');
  }
  const safeQueryKeys = new Set(['sslmode', 'connect_timeout', 'application_name']);
  const query = Object.fromEntries(parsed.searchParams.entries());
  const unsafeQueryKeys = Object.keys(query).filter((key) => !safeQueryKeys.has(key));
  if (parsed.hash || unsafeQueryKeys.length > 0) {
    throw databaseConfigError(
      'BDU_TEST_DATABASE_URL chỉ được chứa sslmode/connect_timeout/application_name.',
      'UNSAFE_TEST_DATABASE_URL'
    );
  }
  if (query.sslmode && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(query.sslmode)) {
    throw databaseConfigError('BDU_TEST_DATABASE_URL có sslmode không hợp lệ.', 'UNSAFE_TEST_DATABASE_URL');
  }
  if (query.connect_timeout && (!/^\d+$/.test(query.connect_timeout) || Number(query.connect_timeout) < 1 || Number(query.connect_timeout) > 300)) {
    throw databaseConfigError('connect_timeout phải là số giây 1..300.', 'UNSAFE_TEST_DATABASE_URL');
  }
  if (!parsed.username) {
    throw databaseConfigError(
      'BDU_TEST_DATABASE_URL phải có tên database user.',
      'INVALID_TEST_DATABASE_URL'
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^bdu_test_[a-z0-9_]+$/i.test(database)) {
    throw databaseConfigError(
      `Database test phải có tên bdu_test_*, không phải "${database}".`,
      'UNSAFE_TEST_DATABASE_NAME'
    );
  }

  const host = normalizeHostname(parsed.hostname);
  const allowedHosts = ['127.0.0.1', '::1', 'localhost', 'postgres', 'test-postgres'];
  if (!allowedHosts.includes(host)) {
    throw databaseConfigError(
      `Host database test "${parsed.hostname}" không nằm trong allowlist.`,
      'UNSAFE_TEST_DATABASE_HOST'
    );
  }

  return {
    key: testUrl,
    options: {
      host,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
      ...(query.sslmode ? {
        ssl: query.sslmode === 'disable'
          ? false
          : { rejectUnauthorized: ['verify-ca', 'verify-full'].includes(query.sslmode) }
      } : {}),
      ...(query.connect_timeout ? { connectionTimeoutMillis: Number(query.connect_timeout) * 1000 } : {}),
      ...(query.application_name ? { application_name: String(query.application_name).slice(0, 64) } : {})
    }
  };
}

export function isDatabaseConfigured() {
  return Boolean(getConfiguredDatabaseTarget());
}

export function getPool() {
  const target = getConfiguredDatabaseTarget();

  if (!target) {
    if (isTestEnvironment()) {
      throw databaseConfigError(
        'Test mode chỉ dùng BDU_TEST_DATABASE_URL với database bdu_test_*.',
        'DATABASE_NOT_CONFIGURED'
      );
    }
    throw databaseConfigError('Chưa cấu hình DATABASE_URL cho PostgreSQL.', 'DATABASE_NOT_CONFIGURED');
  }

  if (pool && poolConnectionKey !== target.key) {
    throw databaseConfigError(
      'Database connection đã khởi tạo với cấu hình khác trong cùng process.',
      'DATABASE_POOL_CONFIG_MISMATCH'
    );
  }

  if (!pool) {
    const sslEnabled = isTestEnvironment()
      ? false
      : boolEnv('DATABASE_SSL', process.env.NODE_ENV === 'production');
    pool = new Pool({
      ...target.options,
      max: Number.parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslEnabled
        ? { rejectUnauthorized: boolEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', true) }
        : false
    });
    poolConnectionKey = target.key;
    pool.on('error', (error) => {
      console.error('[database] PostgreSQL pool error:', error.message);
    });
  }
  return pool;
}

export function getMigrationPool() {
  if (isTestEnvironment()) return getPool();
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw databaseConfigError('Migration cần MIGRATION_DATABASE_URL hoặc DATABASE_URL.', 'DATABASE_NOT_CONFIGURED');
  }
  const migrationTarget = assertSafeMigrationConnectionString(connectionString);
  if (process.env.NODE_ENV === 'production' && !process.env.MIGRATION_DATABASE_URL) {
    console.warn('[migration-db] MIGRATION_DATABASE_URL chưa được tách; dùng tạm runtime URL. Cần tách role trước hardening production.');
  }
  const isRemoteMigration = !['127.0.0.1', '::1', 'localhost', 'postgres', 'test-postgres'].includes(migrationTarget.host);
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
  if (isRemoteMigration && rejectUnauthorized && migrationTarget.sslmode !== 'verify-full') {
    throw databaseConfigError(
      'Production migration remote phải dùng sslmode=verify-full khi bật certificate verification.',
      'MIGRATION_SSL_VERIFY_REQUIRED'
    );
  }
  if (isRemoteMigration && !migrationTarget.sslmode && process.env.DATABASE_SSL === 'true') {
    throw databaseConfigError(
      'Migration remote cần sslmode=verify-full rõ ràng.',
      'MIGRATION_SSL_REQUIRED'
    );
  }
  console.log(`[migration-db] target=${migrationTarget.host}:${migrationTarget.port}/${migrationTarget.database}`);
  if (migrationPool && migrationPoolKey !== connectionString) {
    throw databaseConfigError('Migration connection đã khởi tạo với cấu hình khác trong cùng process.', 'DATABASE_POOL_CONFIG_MISMATCH');
  }
  if (!migrationPool) {
    migrationPool = new Pool({
      connectionString,
      max: Number.parseInt(process.env.MIGRATION_POOL_MAX || '2', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: boolEnv('DATABASE_SSL', process.env.NODE_ENV === 'production')
        ? { rejectUnauthorized: boolEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', true) }
        : false
    });
    migrationPoolKey = connectionString;
    migrationPool.on('error', (error) => {
      console.error('[migration-db] PostgreSQL pool error:', error.message);
    });
  }
  return migrationPool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function transaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock(lockId, work) {
  const client = await getPool().connect();
  let locked = false;
  let destroyConnection = false;
  try {
    const result = await client.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockId]
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return { acquired: false, value: null };
    return { acquired: true, value: await work(client) };
  } finally {
    if (locked) {
      try {
        const unlocked = await client.query('SELECT pg_advisory_unlock($1) AS unlocked', [lockId]);
        if (unlocked.rows[0]?.unlocked !== true) destroyConnection = true;
      } catch {
        destroyConnection = true;
      }
    }
    client.release(destroyConnection);
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
    poolConnectionKey = undefined;
  }
  if (migrationPool) {
    await migrationPool.end();
    migrationPool = undefined;
    migrationPoolKey = undefined;
  }
}
