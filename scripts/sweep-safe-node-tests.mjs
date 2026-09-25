/**
 * Chạy SAFE_NODE_TESTS theo đúng env của scripts/run-safe-tests.mjs nhưng
 * bypass run-command.mjs (fail-closed trên Windows). Dùng để lấy baseline
 * và gate refactor trên máy Windows; CI chạy ubuntu nên dùng `npm test:node`.
 *
 * Dùng: node scripts/sweep-safe-node-tests.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeTestEnv } from './test-environment.mjs';
import { SAFE_NODE_TESTS } from './test-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-sweep-'));
const env = createSafeTestEnv(process.env);
env.ENGLISH_ANSWERS_PATH = path.join(testTempRoot, 'english-answers.json');

const passed = [];
const failed = [];

for (const testFile of SAFE_NODE_TESTS) {
  const abs = path.join(root, 'tests', testFile);
  if (!fs.existsSync(abs)) {
    failed.push({ testFile, reason: 'FILE_MISSING' });
    continue;
  }
  const result = spawnSync(process.execPath, [abs], {
    cwd: root,
    env,
    timeout: 120_000,
    encoding: 'utf8'
  });
  if (result.status === 0) {
    passed.push(testFile);
    console.log(`  PASS  ${testFile}`);
  } else {
    const firstError = `${result.stdout || ''}${result.stderr || ''}`
      .split(/\r?\n/)
      .filter((line) => /Error|error:|ENOENT|assert/i.test(line))
      .slice(0, 2)
      .join(' | ');
    failed.push({ testFile, status: result.status, firstError });
    console.log(`  FAIL  ${testFile}  ${firstError}`);
  }
}

fs.rmSync(testTempRoot, { recursive: true, force: true });

console.log(`\n=== SWEEP: ${passed.length}/${SAFE_NODE_TESTS.length} PASS ===`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const item of failed) console.log(`  - ${item.testFile}: ${item.reason || item.firstError}`);
  process.exitCode = 1;
}
