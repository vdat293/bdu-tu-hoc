import os from 'node:os';
import pg from 'pg';
import '../src/config/load-env.js';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error('db:setup:dev only accepts a localhost DATABASE_URL.');
}

const role = decodeURIComponent(target.username);
const password = decodeURIComponent(target.password);
const database = decodeURIComponent(target.pathname.slice(1));
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
if (!identifierPattern.test(role) || !identifierPattern.test(database)) {
  throw new Error('Database role/name in DATABASE_URL is not a safe PostgreSQL identifier.');
}

const admin = new Client({
  host: target.hostname,
  port: Number(target.port || 5432),
  database: 'postgres',
  user: os.userInfo().username,
  ssl: false
});

try {
  await admin.connect();
  const roleSql = await admin.query(
    "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS create_sql, "
      + "format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS alter_sql",
    [role, password]
  );
  const existingRole = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  await admin.query(
    existingRole.rowCount ? roleSql.rows[0].alter_sql : roleSql.rows[0].create_sql
  );

  const existingDatabase = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (!existingDatabase.rowCount) {
    const databaseSql = await admin.query(
      "SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $2::text) AS sql",
      [database, role]
    );
    await admin.query(databaseSql.rows[0].sql);
  } else {
    const ownerSql = await admin.query(
      "SELECT format('ALTER DATABASE %I OWNER TO %I', $1::text, $2::text) AS sql",
      [database, role]
    );
    await admin.query(ownerSql.rows[0].sql);
  }
  console.log(`✓ Local development database '${database}' is ready.`);
} finally {
  await admin.end().catch(() => {});
}
