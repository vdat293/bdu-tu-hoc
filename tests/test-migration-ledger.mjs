import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runMigrations, schemaFingerprintFromRows } from '../scripts/migration-ledger.mjs';

const emptySchemaFingerprint = schemaFingerprintFromRows([], []);

class FakeClient {
  constructor({ schemaExists = false } = {}) {
    this.schemaExists = schemaExists;
    this.applied = new Map();
    this.queries = [];
    this.released = false;
    this.failMigration = false;
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes('pg_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
    if (sql.includes('CREATE TABLE IF NOT EXISTS public.schema_migrations')) return { rows: [] };
    if (sql.includes('FROM public.schema_migrations')) {
      return { rows: [...this.applied.values()].map((row) => ({ ...row })) };
    }
    if (sql.includes('to_regclass')) {
      return { rows: [{ students: this.schemaExists ? 'students' : null, academic_rankings: null }] };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('INSERT INTO public.schema_migrations')) {
      this.applied.set(Number(params[0]), {
        version: Number(params[0]),
        filename: params[1],
        checksum_sha256: params[2]
      });
      return { rows: [] };
    }
    if (this.failMigration && sql.includes('migration_fail')) {
      this.failMigration = false;
      throw new Error('fixture migration failure');
    }
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

async function fixtureDir(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bdu-migration-ledger-'));
  for (const [name, sql] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), sql, 'utf8');
  }
  return dir;
}

test('migration runner applies each file once and records checksums', async () => {
  const dir = await fixtureDir({
    '001_first.sql': 'CREATE TABLE first_table (id INTEGER);',
    '002_second.sql': 'CREATE TABLE second_table (id INTEGER);'
  });
  const client = new FakeClient();
  try {
    const first = await runMigrations({ client, migrationsDir: dir, logger: () => {} });
    assert.deepEqual(first, { appliedCount: 2, skippedCount: 0, deferredCount: 0, total: 2, baseline: false });
    assert.equal(client.queries.some(({ sql }) => sql.includes('pg_advisory_lock')), true);
    assert.equal(client.queries.filter(({ sql }) => sql === 'BEGIN').length, 2);
    assert.equal(client.queries.filter(({ sql }) => sql === 'COMMIT').length, 2);

    const second = await runMigrations({ client, migrationsDir: dir, logger: () => {} });
    assert.deepEqual(second, { appliedCount: 0, skippedCount: 2, deferredCount: 0, total: 2, baseline: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applied migration checksum drift fails closed', async () => {
  const dir = await fixtureDir({ '001_first.sql': 'CREATE TABLE first_table (id INTEGER);' });
  const client = new FakeClient();
  try {
    await runMigrations({ client, migrationsDir: dir, logger: () => {} });
    await fs.writeFile(path.join(dir, '001_first.sql'), 'CREATE TABLE changed_table (id INTEGER);', 'utf8');
    await assert.rejects(
      () => runMigrations({ client, migrationsDir: dir, logger: () => {} }),
      (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH'
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('ledger cannot reference a deleted migration file', async () => {
  const dir = await fixtureDir({ '001_first.sql': 'CREATE TABLE first_table (id INTEGER);' });
  const client = new FakeClient();
  try {
    await runMigrations({ client, migrationsDir: dir, logger: () => {} });
    await fs.rm(path.join(dir, '001_first.sql'));
    await assert.rejects(
      () => runMigrations({ client, migrationsDir: dir, logger: () => {} }),
      (error) => error.code === 'MIGRATION_FILE_MISSING'
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('baseline refuses an empty database', async () => {
  const dir = await fixtureDir({ '001_first.sql': 'CREATE TABLE first_table (id INTEGER);' });
  const client = new FakeClient();
  try {
    await assert.rejects(
      () => runMigrations({ client, migrationsDir: dir, baselineExisting: true, baselineThroughVersion: 1, logger: () => {} }),
      (error) => error.code === 'MIGRATION_BASELINE_EMPTY_DATABASE'
    );
    assert.equal(client.applied.size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('baseline records only the explicitly verified prefix', async () => {
  const dir = await fixtureDir({
    '001_first.sql': 'CREATE TABLE first_table (id INTEGER);',
    '002_second.sql': 'CREATE TABLE second_table (id INTEGER);'
  });
  const client = new FakeClient({ schemaExists: true });
  try {
    const baseline = await runMigrations({
      client,
      migrationsDir: dir,
      baselineExisting: true,
      baselineThroughVersion: 1,
      expectedSchemaFingerprint: emptySchemaFingerprint,
      logger: () => {}
    });
    assert.deepEqual(baseline, { appliedCount: 1, skippedCount: 0, deferredCount: 1, total: 2, baseline: true });
    const migrated = await runMigrations({ client, migrationsDir: dir, logger: () => {} });
    assert.equal(migrated.appliedCount, 1);
    assert.equal(migrated.skippedCount, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('existing schema without a ledger is not replayed implicitly', async () => {
  const dir = await fixtureDir({ '001_first.sql': 'CREATE TABLE first_table (id INTEGER);' });
  const client = new FakeClient({ schemaExists: true });
  try {
    await assert.rejects(
      () => runMigrations({ client, migrationsDir: dir, logger: () => {} }),
      (error) => error.code === 'MIGRATION_BASELINE_REQUIRED'
    );
    assert.equal(client.applied.size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('failed migration rolls back and does not write ledger', async () => {
  const dir = await fixtureDir({ '001_first.sql': 'SELECT 1;', '002_fail.sql': 'SELECT 2; /* migration_fail */' });
  const client = new FakeClient();
  client.failMigration = true;
  try {
    await assert.rejects(
      () => runMigrations({ client, migrationsDir: dir, logger: () => {} }),
      (error) => error.code === 'MIGRATION_FAILED' && error.filename === '002_fail.sql'
    );
    assert.equal(client.queries.some(({ sql }) => sql === 'ROLLBACK'), true);
    assert.equal(client.applied.size, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

console.log('✅ Migration ledger applies once, locks, checksums, and rolls back safely.');
