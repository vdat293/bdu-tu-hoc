import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MIGRATION_LOCK_ID = 782341;
export const MIGRATION_LEDGER_TABLE = 'public.schema_migrations';

function migrationError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export async function loadMigrationFiles(migrationsDir) {
  const names = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

  const versions = new Map();
  const migrations = [];
  for (const filename of names) {
    const match = filename.match(/^(\d{3})_[a-z0-9][a-z0-9_-]*\.sql$/i);
    if (!match) {
      throw migrationError(`Migration filename không hợp lệ: ${filename}`, 'INVALID_MIGRATION_FILENAME');
    }
    const version = Number.parseInt(match[1], 10);
    if (versions.has(version)) {
      throw migrationError(
        `Trùng migration version ${version}: ${versions.get(version)} và ${filename}.`,
        'DUPLICATE_MIGRATION_VERSION'
      );
    }
    versions.set(version, filename);
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    migrations.push({
      version,
      filename,
      sql,
      checksum: crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
    });
  }
  return migrations;
}

export function schemaFingerprintFromRows(columns = [], indexes = []) {
  const normalized = {
    columns: [...columns].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    indexes: [...indexes].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export async function getSchemaFingerprint(client) {
  const [columns, indexes] = await Promise.all([
    client.query(`
      SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `),
    client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `)
  ]);
  return schemaFingerprintFromRows(columns.rows || [], indexes.rows || []);
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
      applied_by TEXT NOT NULL DEFAULT CURRENT_USER
    )
  `);
}

async function readApplied(client) {
  const result = await client.query(`
    SELECT version, filename, checksum_sha256
    FROM ${MIGRATION_LEDGER_TABLE}
    ORDER BY version
  `);
  return new Map((result.rows || []).map((row) => [Number(row.version), row]));
}

async function hasExistingSchema(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.students') AS students,
      to_regclass('public.academic_rankings') AS academic_rankings
  `);
  return Boolean(result.rows?.[0]?.students || result.rows?.[0]?.academic_rankings);
}

function validateAppliedSet(migrations, applied) {
  const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const version of applied.keys()) {
    if (!filesByVersion.has(version)) {
      throw migrationError(
        `Ledger có migration version ${version} nhưng file tương ứng không tồn tại.`,
        'MIGRATION_FILE_MISSING',
        { version }
      );
    }
  }
  const appliedVersions = [...applied.keys()].sort((left, right) => left - right);
  for (const migration of migrations) {
    if (appliedVersions.some((version) => version > migration.version) && !applied.has(migration.version)) {
      throw migrationError(
        `Ledger thiếu migration version ${migration.version} trước các version đã áp dụng.`,
        'MIGRATION_VERSION_GAP',
        { version: migration.version }
      );
    }
  }
}

async function insertLedger(client, migration, executionMs) {
  await client.query(
    `INSERT INTO ${MIGRATION_LEDGER_TABLE}
      (version, filename, checksum_sha256, execution_ms)
     VALUES ($1, $2, $3, $4)`,
    [migration.version, migration.filename, migration.checksum, executionMs]
  );
}

async function runOneMigration(client, migration, { baselineExisting = false } = {}) {
  const startedAt = Date.now();
  await client.query('BEGIN');
  try {
    if (!baselineExisting) await client.query(migration.sql);
    await insertLedger(client, migration, Math.max(0, Date.now() - startedAt));
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    const wrapped = migrationError(
      `Migration ${migration.filename} thất bại: ${error.message || 'database error'}`,
      error.code || 'MIGRATION_FAILED',
      { filename: migration.filename, version: migration.version, cause: error }
    );
    throw wrapped;
  }
}

async function unlockAndRelease(client, lockId) {
  let destroyConnection = false;
  try {
    const result = await client.query('SELECT pg_advisory_unlock($1) AS unlocked', [lockId]);
    if (result.rows?.[0]?.unlocked !== true) {
      destroyConnection = true;
      throw migrationError('Không thể xác nhận đã release migration advisory lock.', 'MIGRATION_LOCK_RELEASE_FAILED');
    }
  } catch (error) {
    destroyConnection = true;
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release(destroyConnection);
  }
}

export async function runMigrations({
  client,
  migrationsDir,
  lockId = MIGRATION_LOCK_ID,
  baselineExisting = false,
  baselineThroughVersion = null,
  expectedSchemaFingerprint = null,
  logger = (...args) => console.log(...args)
}) {
  if (!client || typeof client.query !== 'function') {
    throw migrationError('Migration runner cần PostgreSQL client.', 'MIGRATION_CLIENT_REQUIRED');
  }
  let lockAcquired = false;
  try {
    const migrations = await loadMigrationFiles(migrationsDir);
    if (baselineExisting) {
      if (!Number.isInteger(baselineThroughVersion) || baselineThroughVersion < 1) {
        throw migrationError(
          'Baseline phải chỉ rõ baselineThroughVersion đã được kiểm chứng.',
          'MIGRATION_BASELINE_VERSION_REQUIRED'
        );
      }
      if (!migrations.some((migration) => migration.version === baselineThroughVersion)) {
        throw migrationError(
          `Baseline version ${baselineThroughVersion} không có file migration tương ứng.`,
          'MIGRATION_BASELINE_VERSION_UNKNOWN'
        );
      }
    }
    await client.query("SET lock_timeout = '30s'");
    await client.query("SET statement_timeout = '5min'");
    await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    lockAcquired = true;
    await ensureLedger(client);
    const applied = await readApplied(client);
    const existingSchema = await hasExistingSchema(client);
    if (baselineExisting && !existingSchema) {
      throw migrationError(
        'Baseline bị từ chối vì database không có schema hiện hữu.',
        'MIGRATION_BASELINE_EMPTY_DATABASE'
      );
    }
    if (baselineExisting) {
      if (!/^[a-f0-9]{64}$/i.test(String(expectedSchemaFingerprint || ''))) {
        throw migrationError(
          'Baseline cần fingerprint schema đã được kiểm chứng.',
          'MIGRATION_BASELINE_FINGERPRINT_REQUIRED'
        );
      }
      const actualFingerprint = await getSchemaFingerprint(client);
      if (actualFingerprint !== String(expectedSchemaFingerprint).toLowerCase()) {
        throw migrationError(
          'Fingerprint schema không khớp baseline đã xác nhận.',
          'MIGRATION_BASELINE_FINGERPRINT_MISMATCH'
        );
      }
    }
    validateAppliedSet(migrations, applied);
    if (!baselineExisting && applied.size === 0 && existingSchema) {
      throw migrationError(
        'Database đã có schema nhưng chưa có migration ledger. Từ chối replay tự động; cần baseline explicit trong maintenance window.',
        'MIGRATION_BASELINE_REQUIRED'
      );
    }

    let appliedCount = 0;
    let skippedCount = 0;
    let deferredCount = 0;
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.filename !== migration.filename || existing.checksum_sha256 !== migration.checksum) {
          throw migrationError(
            `Checksum hoặc filename migration đã áp dụng không khớp: ${migration.filename}.`,
            'MIGRATION_CHECKSUM_MISMATCH',
            { filename: migration.filename, version: migration.version }
          );
        }
        skippedCount++;
        continue;
      }
      if (baselineExisting && migration.version > baselineThroughVersion) {
        deferredCount++;
        continue;
      }
      await runOneMigration(client, migration, { baselineExisting });
      appliedCount++;
      logger(`✓ Applied ${migration.filename}`);
    }
    return {
      appliedCount,
      skippedCount,
      deferredCount,
      total: migrations.length,
      baseline: Boolean(baselineExisting)
    };
  } finally {
    if (lockAcquired) await unlockAndRelease(client, lockId);
    else if (typeof client.release === 'function') client.release(false);
  }
}
