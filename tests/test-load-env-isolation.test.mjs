import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadEnvModule = pathToFileURL(path.join(root, 'src/config/load-env.js')).href;
const databaseModule = pathToFileURL(path.join(root, 'src/db/database.js')).href;

function runModuleImport(cwd, moduleUrl, extraEnv = {}) {
  const env = { ...process.env };
  delete env.BDU_TEST_ENV_CANARY;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = String(value);
  }

  const source = `import ${JSON.stringify(moduleUrl)}; console.log(process.env.BDU_TEST_ENV_CANARY || 'absent');`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd,
    env,
    encoding: 'utf8'
  });
}

function runDatabaseSource(source, extraEnv = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    BDU_TEST_MODE: '1'
  };
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
}

test('test mode never loads a .env file from the current directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-load-env-test-'));
  try {
    fs.writeFileSync(path.join(temp, '.env'), 'BDU_TEST_ENV_CANARY=loaded-from-dotenv\n', 'utf8');
    const result = runModuleImport(temp, loadEnvModule, {
      NODE_ENV: 'TEST',
      BDU_TEST_MODE: '1'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /absent/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('non-test mode preserves normal dotenv loading', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-load-env-runtime-test-'));
  try {
    fs.writeFileSync(path.join(temp, '.env'), 'BDU_TEST_ENV_CANARY=loaded-from-dotenv\n', 'utf8');
    const result = runModuleImport(temp, loadEnvModule, {
      NODE_ENV: 'development',
      BDU_TEST_MODE: undefined
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /loaded-from-dotenv/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('direct execution of a test file is rejected before dotenv or database fallback', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-direct-test-guard-'));
  try {
    fs.writeFileSync(path.join(temp, '.env'), 'DATABASE_URL=postgresql://production.example/bdu_hub\n', 'utf8');
    const result = spawnSync(process.execPath, [path.join(root, 'tests/test-community.js')], {
      cwd: temp,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME
      },
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UNMANAGED_TEST_EXECUTION|Direct test execution bị chặn/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('test mode ignores inherited DATABASE_URL and requires an explicit test URL', () => {
  const source = [
    `import { isDatabaseConfigured } from ${JSON.stringify(databaseModule)};`,
    "try { console.log(isDatabaseConfigured() ? 'configured' : 'absent'); }",
    "catch (error) { console.log(error.code); }"
  ].join('\n');
  const result = runDatabaseSource(source, {
    DATABASE_URL: 'postgresql://production.example/bdu_hub'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /absent/);
});

test('database layer rejects test URLs without explicit destructive confirmation', () => {
  const source = [
    `import { isDatabaseConfigured } from ${JSON.stringify(databaseModule)};`,
    "try { isDatabaseConfigured(); console.log('accepted'); }",
    "catch (error) { console.log(error.code); }"
  ].join('\n');
  const result = runDatabaseSource(source, {
    BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DATABASE_TEST_CONFIRMATION_MISSING/);
});

test('database layer rejects connection query overrides before creating a pool', () => {
  const source = [
    `import { getPool } from ${JSON.stringify(databaseModule)};`,
    "try { getPool(); console.log('accepted'); }",
    "catch (error) { console.log(error.code); }"
  ].join('\n');
  const result = runDatabaseSource(source, {
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
    BDU_TEST_DATABASE_URL: 'postgresql://localhost/bdu_test_local?host=prod.example.com'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UNSAFE_TEST_DATABASE_URL/);
});

test('database layer accepts IPv6 loopback test hosts with an effective pg host', () => {
  const source = [
    `import { closeDatabase, getPool } from ${JSON.stringify(databaseModule)};`,
    "const pool = getPool();",
    "console.log(pool.options.host);",
    'await closeDatabase();'
  ].join('\n');
  const result = runDatabaseSource(source, {
    BDU_TEST_CONFIRM_DESTRUCTIVE: '1',
    BDU_TEST_DATABASE_URL: 'postgresql://tester:secret@[::1]:5432/bdu_test_local'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::1$/m);
});

test('database pool cannot be reused after connection identity changes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-pool-mismatch-'));
  try {
    fs.writeFileSync(path.join(temp, '.env'), 'BDU_TEST_ENV_CANARY=isolated-fixture\n', 'utf8');
    const source = [
      `import { closeDatabase, getPool } from ${JSON.stringify(databaseModule)};`,
      "console.log(`canary=${process.env.BDU_TEST_ENV_CANARY || 'none'}`);",
      "getPool();",
      "process.env.NODE_ENV = 'test';",
      "process.env.BDU_TEST_MODE = '1';",
      "process.env.BDU_TEST_CONFIRM_DESTRUCTIVE = '1';",
      "process.env.BDU_TEST_DATABASE_URL = 'postgresql://tester:secret@localhost/bdu_test_local';",
      "try { getPool(); console.log('accepted'); }",
      "catch (error) { console.log(error.code); }",
      'await closeDatabase();'
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: temp,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://production.example/bdu_hub'
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /canary=isolated-fixture/);
    assert.match(result.stdout, /DATABASE_POOL_CONFIG_MISMATCH/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
