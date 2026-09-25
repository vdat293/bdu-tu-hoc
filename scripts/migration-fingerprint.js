import { closeDatabase, getMigrationPool } from '../src/db/database.js';
import { getSchemaFingerprint } from './migration-ledger.mjs';

const args = process.argv.slice(2);
if (args.length > 0) {
  console.error('Cách dùng: npm run db:migration:fingerprint');
  process.exit(2);
}

try {
  const client = await getMigrationPool().connect();
  try {
    const fingerprint = await getSchemaFingerprint(client);
    console.log(fingerprint);
  } finally {
    if (typeof client.release === 'function') client.release(false);
  }
} catch (error) {
  console.error(`Fingerprint failed [${error.code || 'MIGRATION_FINGERPRINT_FAILED'}]: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
