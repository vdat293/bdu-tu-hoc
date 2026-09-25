import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getMigrationPool } from '../src/db/database.js';
import { isTestEnvironment } from '../src/config/load-env.js';
import { runMigrations } from './migration-ledger.mjs';
import { getSafeDatabaseTarget } from './postgres-utils.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const unknownArgs = args.filter((arg) => arg !== '--yes');
if (unknownArgs.length > 0) {
  console.error(`❌ Không hỗ trợ flag: ${unknownArgs.join(', ')}`);
  process.exit(2);
}
if (!yes || process.env.BDU_MIGRATION_BASELINE_CONFIRM !== '1') {
  console.error('Baseline yêu cầu --yes và BDU_MIGRATION_BASELINE_CONFIRM=1.');
  process.exit(2);
}

const testMode = isTestEnvironment();
const allowProduction = !testMode;
let target;
try {
  target = getSafeDatabaseTarget({
    operation: 'dump',
    allowProduction,
    preferMigration: true
  });
} catch (error) {
  console.error(`❌ Không xác thực được target baseline: ${error.message}`);
  process.exit(1);
}
if (process.env.BDU_MIGRATION_BASELINE_CONFIRM_DATABASE !== target.database) {
  console.error(`❌ Xác nhận database không khớp. Expected BDU_MIGRATION_BASELINE_CONFIRM_DATABASE=${target.database}.`);
  process.exit(1);
}
const baselineVersion = Number.parseInt(process.env.BDU_MIGRATION_BASELINE_THROUGH_VERSION || '', 10);
if (!Number.isInteger(baselineVersion) || baselineVersion < 1) {
  console.error('❌ Cần BDU_MIGRATION_BASELINE_THROUGH_VERSION là version migration đã kiểm chứng.');
  process.exit(1);
}
const canonicalTarget = `${target.host}:${target.port}/${target.database}`;
if (process.env.BDU_MIGRATION_BASELINE_CONFIRM_TARGET !== canonicalTarget) {
  console.error(`❌ Xác nhận target không khớp. Expected BDU_MIGRATION_BASELINE_CONFIRM_TARGET=${canonicalTarget}.`);
  process.exit(1);
}
const baselineFingerprint = String(process.env.BDU_MIGRATION_BASELINE_CONFIRM_FINGERPRINT || '').toLowerCase();
if (!/^[a-f0-9]{64}$/.test(baselineFingerprint)) {
  console.error('❌ Cần fingerprint SHA-256 schema đã kiểm chứng.');
  process.exit(1);
}
if (!testMode && !process.env.MIGRATION_DATABASE_URL) {
  console.error('❌ Production baseline phải dùng MIGRATION_DATABASE_URL riêng.');
  process.exit(1);
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, '..', 'migrations');
try {
  const client = await getMigrationPool().connect();
  const result = await runMigrations({
    client,
    migrationsDir,
    baselineExisting: true,
    baselineThroughVersion: baselineVersion,
    expectedSchemaFingerprint: baselineFingerprint,
    logger: (message) => console.log(`✓ Baseline recorded ${message.replace('Applied ', '')}`)
  });
  console.log(`Migration baseline summary: recorded=${result.appliedCount}, existing=${result.skippedCount}, deferred=${result.deferredCount}, total=${result.total}.`);
} catch (error) {
  console.error(`Migration baseline failed [${error.code || 'MIGRATION_BASELINE_FAILED'}]: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
