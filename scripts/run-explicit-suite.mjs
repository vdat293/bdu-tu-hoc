import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertExplicitTestDatabase,
  createExplicitTestEnv,
  databaseDisplayName
} from './test-environment.mjs';
import { suiteRequiresR2 } from './test-manifest.mjs';
import { runCommand } from './run-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shouldBuild = args.includes('--build');
const files = args.filter((arg) => !arg.startsWith('--'));
const unknownFlags = args.filter((arg) => arg.startsWith('--') && arg !== '--build');

if (unknownFlags.length > 0) {
  console.error(`[isolated-tests] Không hỗ trợ flag: ${unknownFlags.join(', ')}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error('Usage: node scripts/run-explicit-suite.mjs [--build] tests/test-*.js [...]');
  process.exit(2);
}

function resolveTestFile(file) {
  const normalized = file.replaceAll('\\', '/');
  const candidate = path.isAbsolute(file) ? file : path.join(root, normalized);
  const resolved = path.resolve(candidate);
  const testsRoot = path.join(root, 'tests');
  const realTestsRoot = fs.realpathSync(testsRoot);
  const realResolved = fs.realpathSync(resolved);
  if (realResolved !== realTestsRoot && !realResolved.startsWith(`${realTestsRoot}${path.sep}`)) {
    throw new Error(`Test path nằm ngoài tests/: ${file}`);
  }
  if (!fs.statSync(realResolved).isFile()) throw new Error(`Test path không phải file: ${file}`);
  return realResolved;
}

let resolvedFiles;
try {
  resolvedFiles = files.map(resolveTestFile);
} catch (error) {
  console.error(`[isolated-tests] ${error.message}`);
  process.exit(2);
}

const r2Requirements = resolvedFiles.map(suiteRequiresR2);
const needsR2 = r2Requirements.some(Boolean);
if (needsR2 && !r2Requirements.every(Boolean)) {
  console.error('[isolated-tests] Không trộn suite R2 và non-R2 trong cùng invocation.');
  process.exit(2);
}
if (needsR2 && shouldBuild) {
  console.error('[isolated-tests] Suite R2 không được chạy chung với production build.');
  process.exit(2);
}

let env;
try {
  assertExplicitTestDatabase();
  env = createExplicitTestEnv(process.env, { includeR2: needsR2 });
} catch (error) {
  console.error(`[isolated-tests] ${error.message}`);
  console.error('[isolated-tests] Không chạy test khi chưa có explicit test environment an toàn.');
  process.exit(2);
}

const testTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-isolated-tests-'));
env.TMPDIR = testTempRoot;
env.TEMP = testTempRoot;
env.TMP = testTempRoot;
env.ENGLISH_ANSWERS_PATH = path.join(testTempRoot, 'english-answers.json');
process.on('exit', () => {
  fs.rmSync(testTempRoot, { recursive: true, force: true });
});

if (needsR2 && !env.R2_BUCKET) {
  console.error('[isolated-tests] Các test R2 yêu cầu endpoint, access key, secret key và bucket bdu-test-*.');
  process.exit(2);
}

console.log(`[isolated-tests] database=${databaseDisplayName(env.BDU_TEST_DATABASE_URL)} r2=${env.R2_BUCKET || 'disabled'}`);

if (shouldBuild) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = await runCommand('frontend production build', npmCommand, ['run', 'build:client'], {
    cwd: root,
    env,
    timeoutMs: 180_000
  });
  if (build.failed) process.exit(1);
}

const failures = [];
for (const resolved of resolvedFiles) {
  const label = path.relative(root, resolved);
  console.log(`[isolated-tests] → ${label}`);
  const result = await runCommand(label, process.execPath, [resolved], {
    cwd: root,
    env,
    timeoutMs: 180_000
  });
  if (result.failed) failures.push(result);
}

if (failures.length > 0) {
  console.error(`[isolated-tests] FAILED: ${failures.length} suite có lỗi hoặc timeout.`);
  process.exitCode = 1;
} else {
  console.log('[isolated-tests] PASS');
}
