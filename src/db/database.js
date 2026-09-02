import pg from 'pg';
import '../config/load-env.js';

const { Pool } = pg;

let pool;

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!isDatabaseConfigured()) {
    const error = new Error('Chưa cấu hình DATABASE_URL cho PostgreSQL.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }

  if (!pool) {
    const sslEnabled = boolEnv('DATABASE_SSL', process.env.NODE_ENV === 'production');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number.parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslEnabled
        ? { rejectUnauthorized: boolEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', true) }
        : false
    });
    pool.on('error', (error) => {
      console.error('[database] PostgreSQL pool error:', error.message);
    });
  }
  return pool;
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
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
    }
    client.release();
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
