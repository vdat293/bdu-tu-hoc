import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_DEFAULT_TESTS,
  QUARANTINED_TESTS,
  R2_SUITE_TESTS,
  SAFE_ALIAS_TESTS,
  SAFE_NODE_TESTS,
  suiteRequiresR2
} from '../scripts/test-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsRoot = path.join(root, 'tests');

function assertUnique(label, files) {
  assert.equal(new Set(files).size, files.length, `${label} có file trùng`);
}

test('safe and quarantine manifests have unique, existing files', () => {
  assertUnique('SAFE_NODE_TESTS', SAFE_NODE_TESTS);
  assertUnique('SAFE_ALIAS_TESTS', SAFE_ALIAS_TESTS);
  assertUnique('LEGACY_DEFAULT_TESTS', LEGACY_DEFAULT_TESTS);
  assert.deepEqual(
    SAFE_NODE_TESTS.filter((file) => SAFE_ALIAS_TESTS.includes(file)),
    [],
    'default và alias safe manifest không được overlap'
  );

  for (const file of [...SAFE_NODE_TESTS, ...SAFE_ALIAS_TESTS]) {
    assert.equal(fs.existsSync(path.join(testsRoot, file)), true, `Thiếu safe test ${file}`);
  }
  for (const file of QUARANTINED_TESTS.keys()) {
    assert.equal(fs.existsSync(path.join(testsRoot, file)), true, `Thiếu quarantined test ${file}`);
    assert.ok(QUARANTINED_TESTS.get(file), `Thiếu lý do quarantine ${file}`);
  }
});

test('every top-level test file is explicitly classified', () => {
  const topLevel = fs.readdirSync(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^test-.*\.(?:js|mjs)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const classified = new Set([...SAFE_NODE_TESTS, ...SAFE_ALIAS_TESTS, ...QUARANTINED_TESTS.keys()]);
  const missing = topLevel.filter((file) => !classified.has(file));
  assert.deepEqual(missing, [], `Test top-level chưa được phân loại: ${missing.join(', ')}`);
});

test('every legacy default test is either safe or explicitly quarantined', () => {
  const safe = new Set([...SAFE_NODE_TESTS, ...SAFE_ALIAS_TESTS]);
  const missing = LEGACY_DEFAULT_TESTS.filter((file) => !safe.has(file) && !QUARANTINED_TESTS.has(file));
  assert.deepEqual(missing, [], `Legacy default test chưa được phân loại: ${missing.join(', ')}`);
});

test('quarantined tests cannot be selected by the safe runner', () => {
  const safe = new Set([...SAFE_NODE_TESTS, ...SAFE_ALIAS_TESTS]);
  for (const file of QUARANTINED_TESTS.keys()) {
    assert.equal(safe.has(file), false, `${file} vừa quarantine vừa nằm trong safe manifest`);
  }
});

test('R2 policy is case-insensitive and limited to known isolated suites', () => {
  assert.equal(suiteRequiresR2('/tmp/tests/test-community-MEDIA-integration.js'), true);
  assert.equal(suiteRequiresR2('tests/test-media-CLEANUP.js'), true);
  assert.equal(suiteRequiresR2('tests/test-community.js'), false);
  assert.deepEqual([...R2_SUITE_TESTS].sort(), [
    'test-community-media-integration.js',
    'test-media-cleanup.js'
  ]);
});
