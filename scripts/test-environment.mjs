import process from 'node:process';

const SAFE_ENV_KEYS = new Set([
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'npm_config_audit',
  'npm_config_cache',
  'npm_config_fund',
  'npm_config_update_notifier',
  'npm_execpath',
  'npm_lifecycle_event',
  'npm_lifecycle_script',
  'npm_node_execpath',
  'npm_package_json',
  'PATHEXT',
  'PATH',
  'SHELL',
  'SystemRoot',
  'TERM',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'WINDIR'
]);

const DEFAULT_TEST_DB_HOSTS = ['127.0.0.1', '::1', 'localhost', 'postgres', 'test-postgres'];
const DEFAULT_TEST_R2_HOSTS = ['127.0.0.1', '::1', 'localhost', 'minio', 'test-minio'];

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function invalidTestEnvironment(message) {
  const error = new Error(message);
  error.code = 'UNSAFE_TEST_ENVIRONMENT';
  return error;
}

export function isTestEnvironment(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'test' || isEnabled(env.BDU_TEST_MODE);
}

export function createSafeTestEnv(sourceEnv = process.env) {
  const env = {};

  // Allowlist thay vì denylist: secret mới hoặc biến lạ chưa được khai báo
  // không thể vô tình kế thừa vào child test process.
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (SAFE_ENV_KEYS.has(key) && value !== undefined) env[key] = String(value);
  }

  env.NODE_ENV = 'test';
  env.BDU_TEST_MODE = '1';
  env.BDU_TEST_RUNNER = 'safe';
  env.CI = '1';
  return env;
}

function assertExplicitTestFlags(env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'test') {
    throw invalidTestEnvironment('Integration test bắt buộc có NODE_ENV=test.');
  }
  if (!isEnabled(env.BDU_TEST_MODE)) {
    throw invalidTestEnvironment('Integration test bắt buộc có BDU_TEST_MODE=1.');
  }
  if (!isEnabled(env.BDU_TEST_CONFIRM_DESTRUCTIVE)) {
    throw invalidTestEnvironment('Integration test bắt buộc có BDU_TEST_CONFIRM_DESTRUCTIVE=1.');
  }
}

function assertPostgresUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw invalidTestEnvironment('BDU_TEST_DATABASE_URL không hợp lệ.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw invalidTestEnvironment('BDU_TEST_DATABASE_URL phải dùng postgres/postgresql.');
  }
  // pg-connection-string cho phép query `host` override hostname. Trong test
  // mode ta kiểm tra effective host, nên mọi query override đều bị từ chối.
  if (parsed.search || parsed.hash) {
    throw invalidTestEnvironment('BDU_TEST_DATABASE_URL không được chứa query hoặc fragment override.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^bdu_test_[a-z0-9_]+$/i.test(database)) {
    throw invalidTestEnvironment(`Database test phải có tên bdu_test_*, không phải "${database}".`);
  }

  const host = normalizeHostname(parsed.hostname);
  if (!DEFAULT_TEST_DB_HOSTS.includes(host)) {
    throw invalidTestEnvironment(`Host database test "${host}" không nằm trong allowlist.`);
  }
  if (!parsed.username) {
    throw invalidTestEnvironment('BDU_TEST_DATABASE_URL phải có tên database user.');
  }

  return parsed;
}

export function assertExplicitTestDatabase(env = process.env) {
  assertExplicitTestFlags(env);

  const rawUrl = env.BDU_TEST_DATABASE_URL;
  if (!rawUrl) {
    throw invalidTestEnvironment('Thiếu BDU_TEST_DATABASE_URL.');
  }
  assertPostgresUrl(rawUrl);
  return rawUrl;
}

function assertTestR2Config(env) {
  const bucket = env.BDU_TEST_R2_BUCKET;
  if (!bucket) return null;
  if (!bucket.startsWith('bdu-test-')) {
    throw invalidTestEnvironment('BDU_TEST_R2_BUCKET phải bắt đầu bằng "bdu-test-".');
  }

  const required = [
    'BDU_TEST_R2_ENDPOINT',
    'BDU_TEST_R2_ACCESS_KEY_ID',
    'BDU_TEST_R2_SECRET_ACCESS_KEY'
  ];
  for (const key of required) {
    if (!env[key]) throw invalidTestEnvironment(`Thiếu ${key} cho R2 integration test.`);
  }

  let endpoint;
  try {
    endpoint = new URL(env.BDU_TEST_R2_ENDPOINT);
  } catch {
    throw invalidTestEnvironment('BDU_TEST_R2_ENDPOINT không hợp lệ.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw invalidTestEnvironment('BDU_TEST_R2_ENDPOINT phải dùng http/https.');
  }
  const endpointHost = normalizeHostname(endpoint.hostname);
  if (!DEFAULT_TEST_R2_HOSTS.includes(endpointHost)) {
    throw invalidTestEnvironment(`R2 test endpoint "${endpoint.hostname}" không nằm trong allowlist.`);
  }

  return {
    bucket,
    endpoint: env.BDU_TEST_R2_ENDPOINT,
    accessKeyId: env.BDU_TEST_R2_ACCESS_KEY_ID,
    secretAccessKey: env.BDU_TEST_R2_SECRET_ACCESS_KEY,
    accountId: env.BDU_TEST_R2_ACCOUNT_ID || ''
  };
}

export function createExplicitTestEnv(sourceEnv = process.env, options = {}) {
  const databaseUrl = assertExplicitTestDatabase(sourceEnv);
  const includeR2 = options.includeR2 ?? Boolean(sourceEnv.BDU_TEST_R2_BUCKET);
  const r2 = includeR2 ? assertTestR2Config(sourceEnv) : null;
  const env = createSafeTestEnv(sourceEnv);

  // Các test legacy vẫn đọc DATABASE_URL; wrapper chỉ gán URL đã kiểm tra
  // prefix/allowlist ở trên, không bao giờ lấy URL từ .env production.
  env.DATABASE_URL = databaseUrl;
  env.BDU_TEST_DATABASE_URL = databaseUrl;
  env.BDU_TEST_RUNNER = 'explicit';
  env.BDU_TEST_CONFIRM_DESTRUCTIVE = '1';
  env.DATABASE_SSL = 'false';

  if (r2) {
    env.R2_BUCKET = r2.bucket;
    env.R2_ENDPOINT = r2.endpoint;
    env.R2_ACCESS_KEY_ID = r2.accessKeyId;
    env.R2_SECRET_ACCESS_KEY = r2.secretAccessKey;
    env.R2_ACCOUNT_ID = r2.accountId;
  }

  // Side effect ngoài DB luôn tắt trong integration wrapper. R2 chỉ bật khi
  // endpoint local/test và đủ credential test.
  env.RANKING_SYNC_ENABLED = 'false';
  env.REMINDER_SCHEDULER_ENABLED = 'false';
  env.CLIENT_ASSET_HISTORY_ENABLED = 'false';
  env.FB_IMPORT_ENABLED = 'false';
  env.SYSTEM_OWNER_MSSV = 'TEST_OWNER_001';
  env.ADMIN_DASHBOARD_KEY = 'test-admin-key';
  env.DISCORD_BOT_TOKEN = '';
  env.CDS_USER = '';
  env.CDS_PASSWORD = '';
  env.SMTP_HOST = '';
  env.SMTP_USER = '';
  env.SMTP_PASS = '';

  return env;
}

export function databaseDisplayName(rawUrl) {
  try {
    return decodeURIComponent(new URL(rawUrl).pathname.replace(/^\//, ''));
  } catch {
    return 'unknown';
  }
}
