import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSafeTestEnv } from './test-environment.mjs';
import { SAFE_ALIAS_TESTS, SAFE_NODE_TESTS } from './test-manifest.mjs';
import { runCommand } from './run-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const supportedFlags = new Set(['--only', '--node-only', '--frontend-only']);
const unknownFlags = args.filter((arg) => arg.startsWith('--') && !supportedFlags.has(arg));
const positionalArgs = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--only');
const nodeOnly = args.includes('--node-only');
const frontendOnly = args.includes('--frontend-only');
const onlyFiles = [];

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--only') {
    const file = args[index + 1];
    if (!file || file.startsWith('--')) {
      console.error('[safe-tests] --only cần một file test hợp lệ.');
      process.exit(2);
    }
    onlyFiles.push(file);
    index += 1;
  }
}

if (unknownFlags.length > 0) {
  console.error(`[safe-tests] Không hỗ trợ flag: ${unknownFlags.join(', ')}`);
  process.exit(2);
}
if (positionalArgs.length > 0) {
  console.error(`[safe-tests] Không nhận positional test; dùng --only: ${positionalArgs.join(', ')}`);
  process.exit(2);
}
if (nodeOnly && frontendOnly) {
  console.error('[safe-tests] Không thể dùng đồng thời --node-only và --frontend-only.');
  process.exit(2);
}
if (onlyFiles.length > 0 && frontendOnly) {
  console.error('[safe-tests] --frontend-only không dùng được với --only.');
  process.exit(2);
}

const allowedOnlyFiles = new Set([...SAFE_NODE_TESTS, ...SAFE_ALIAS_TESTS]);
for (const file of onlyFiles) {
  const normalized = file.replace(/^tests[\\/]/, '').replaceAll('\\', '/');
  if (!allowedOnlyFiles.has(normalized)) {
    console.error(`[safe-tests] File không nằm trong safe manifest: ${file}`);
    process.exit(2);
  }
}

const runFrontend = onlyFiles.length === 0 && !nodeOnly;
const runNode = !frontendOnly;
if (!runFrontend && !runNode) {
  console.error('[safe-tests] Không có suite nào được chọn.');
  process.exit(2);
}

const nodeTests = onlyFiles.length > 0
  ? onlyFiles.map((file) => file.replace(/^tests[\\/]/, ''))
  : SAFE_NODE_TESTS;
const env = createSafeTestEnv();
const testTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-safe-tests-'));
env.TMPDIR = testTempRoot;
env.TEMP = testTempRoot;
env.TMP = testTempRoot;
env.ENGLISH_ANSWERS_PATH = path.join(testTempRoot, 'english-answers.json');
process.on('exit', () => {
  fs.rmSync(testTempRoot, { recursive: true, force: true });
});
const failures = [];

function relativeLabel(file) {
  return path.relative(root, file) || file;
}

function resolveTestFile(file) {
  const normalized = file.replaceAll('\\', '/');
  const candidate = path.isAbsolute(file)
    ? file
    : normalized.startsWith('tests/')
      ? path.join(root, normalized)
      : path.join(root, 'tests', normalized);
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

if (runNode) {
  console.log(`[safe-tests] chạy ${nodeTests.length} Node test trong môi trường đã sanitize`);
  for (const file of nodeTests) {
    const resolved = resolveTestFile(file);
    console.log(`[safe-tests] → ${relativeLabel(resolved)}`);
    const result = await runCommand(relativeLabel(resolved), process.execPath, [resolved], {
      cwd: root,
      env,
      timeoutMs: 120_000
    });
    if (result.failed) failures.push(result);
  }
}

if (runFrontend) {
  console.log('[safe-tests] → frontend Vitest');
  const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(vitestEntry)) {
    failures.push({ label: 'frontend Vitest', failed: true, code: 1, timedOut: false });
  } else {
    const result = await runCommand(
      'frontend Vitest',
      process.execPath,
      [vitestEntry, 'run', '--config', 'vitest.config.js'],
      { cwd: root, env, timeoutMs: 180_000 }
    );
    if (result.failed) failures.push(result);
  }
}

if (failures.length > 0) {
  console.error(`[safe-tests] FAILED: ${failures.length} suite có lỗi hoặc timeout.`);
  for (const failure of failures) {
    const reason = failure.timedOut ? 'timeout' : failure.signal || `exit ${failure.code}`;
    console.error(`[safe-tests] - ${failure.label}: ${reason}`);
  }
  process.exitCode = 1;
} else {
  console.log('[safe-tests] PASS: không chạy DB, R2, SMTP, Discord, Facebook hoặc network ngoài.');
}
