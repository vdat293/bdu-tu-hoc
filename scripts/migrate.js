import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getMigrationPool } from '../src/db/database.js';
import { runMigrations } from './migration-ledger.mjs';

const args = process.argv.slice(2);
const unknownArgs = args.filter((arg) => arg.startsWith('--'));
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
if (unknownArgs.length > 0 || positionalArgs.length > 0) {
  console.error(`❌ Không hỗ trợ tham số: ${args.join(', ')}`);
  process.exit(2);
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, '..', 'migrations');
let client;

try {
  client = await getMigrationPool().connect();
  const result = await runMigrations({ client, migrationsDir });
  console.log(`Migration summary: applied=${result.appliedCount}, skipped=${result.skippedCount}, total=${result.total}.`);
} catch (error) {
  const details = error.message || (error.errors || [])
    .map((item) => item.message || item.code)
    .filter(Boolean)
    .join('; ') || 'Unknown database error';
  console.error(`Migration failed [${error.code || 'MIGRATION_FAILED'}]: ${details}`);
  process.exitCode = 1;
} finally {
  // runMigrations owns the client lock/release. If connecting itself failed,
  // there is no client to release here.
  await closeDatabase();
}
