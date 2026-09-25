import fs from 'node:fs';
import path from 'node:path';

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isTestEnvironment(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'test' || isEnabled(env.BDU_TEST_MODE);
}

function isDirectTestEntry() {
  const entry = String(process.argv[1] || '').replaceAll('\\', '/');
  return /\/tests\/(?:test-[^/]+\.(?:js|mjs)|e2e-routing-smoke\.js)$/.test(entry);
}

function isManagedTestRunner(env = process.env) {
  return isTestEnvironment(env)
    && ['safe', 'explicit'].includes(String(env.BDU_TEST_RUNNER || '').trim().toLowerCase());
}

if (isDirectTestEntry() && !isManagedTestRunner()) {
  const error = new Error(
    'Direct test execution bị chặn. Hãy chạy npm test hoặc scripts/run-explicit-suite.mjs để test có môi trường fail-closed.'
  );
  error.code = 'UNMANAGED_TEST_EXECUTION';
  throw error;
}

// Test runner phải cấu hình môi trường bằng biến process explicit. Tuyệt đối
// không fallback sang `.env` production khi NODE_ENV=test hoặc BDU_TEST_MODE=1.
if (!isTestEnvironment()) {
  const envPath = path.resolve(process.cwd(), '.env');

  if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const separator = line.indexOf('=');
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        value.length >= 2
        && ((value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
