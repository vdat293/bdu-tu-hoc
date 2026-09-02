import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query } from '../src/db/database.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, '..', 'migrations');

try {
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await query(sql);
    console.log(`✓ Applied ${file}`);
  }
} catch (error) {
  const details = error.message || (error.errors || [])
    .map((item) => item.message || item.code)
    .filter(Boolean)
    .join('; ') || 'Unknown database error';
  console.error(`Migration failed: ${details}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
