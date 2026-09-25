import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { isTestEnvironment } from '../src/config/load-env.js';

const LOCAL_POSTGRES_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'postgres', 'test-postgres']);
const SAFE_DATABASE_QUERY_KEYS = new Set(['sslmode', 'connect_timeout', 'application_name']);

function maintenanceError(message, code = 'UNSAFE_MAINTENANCE_TARGET') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getDatabaseUrl({ preferMigration = false, preferBackup = false } = {}) {
  const dbUrl = isTestEnvironment()
    ? process.env.BDU_TEST_DATABASE_URL
    : preferBackup
      ? (process.env.BACKUP_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)
      : preferMigration
        ? (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)
        : process.env.DATABASE_URL;
  if (!dbUrl) {
    throw maintenanceError(
      isTestEnvironment()
        ? 'Chưa cấu hình BDU_TEST_DATABASE_URL cho test/maintenance.'
        : 'Chưa cấu hình DATABASE_URL cho maintenance.',
      'DATABASE_URL_MISSING'
    );
  }
  return dbUrl;
}

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function assertSafeMaintenanceTarget(target, {
  operation = 'dump',
  allowProduction = false
} = {}) {
  const host = normalizeHost(target?.host);
  const database = String(target?.database || '').trim();
  const isLocal = LOCAL_POSTGRES_HOSTS.has(host);
  const isTestDatabase = /^bdu_test_[a-z0-9_]+$/i.test(database);

  if (!host || !database || !target?.user) {
    throw maintenanceError('Database target phải có host, database và user.', 'INVALID_DATABASE_TARGET');
  }
  if (!isLocal) {
    if (!allowProduction || process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION !== '1') {
      throw maintenanceError(
        `Chỉ cho phép maintenance local/test; host "${host}" cần --allow-production và BDU_MAINTENANCE_ALLOW_PRODUCTION=1.`,
        'NON_LOCAL_MAINTENANCE_TARGET'
      );
    }
  }
  if (operation === 'restore' && !isTestDatabase && !allowProduction) {
    throw maintenanceError(
      `Restore chỉ mặc định cho database bdu_test_*; database "${database}" cần --allow-production.`,
      'NON_TEST_RESTORE_TARGET'
    );
  }
  if (allowProduction && !isTestDatabase && process.env.BDU_MAINTENANCE_ALLOW_PRODUCTION !== '1') {
    throw maintenanceError(
      'Mọi target không phải bdu_test_* cần BDU_MAINTENANCE_ALLOW_PRODUCTION=1 khi dùng --allow-production.',
      'PRODUCTION_OPT_IN_REQUIRED'
    );
  }
  return {
    ...target,
    host,
    port: String(target.port || '5432'),
    database,
    user: String(target.user)
  };
}

export function getSafeDatabaseTarget(options = {}) {
  const dbUrl = getDatabaseUrl(options);
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw maintenanceError('Database URL không hợp lệ.', 'INVALID_DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw maintenanceError('Database URL phải dùng postgres/postgresql.', 'INVALID_DATABASE_URL');
  }
  const query = Object.fromEntries(parsed.searchParams.entries());
  const unsafeQueryKeys = Object.keys(query).filter((key) => !SAFE_DATABASE_QUERY_KEYS.has(key));
  if (parsed.hash || unsafeQueryKeys.length > 0) {
    throw maintenanceError(
      `Database URL chỉ được chứa sslmode/connect_timeout/application_name; phát hiện: ${unsafeQueryKeys.join(', ') || 'fragment'}.`,
      'UNSAFE_DATABASE_URL'
    );
  }
  const target = {
    url: dbUrl,
    host: parsed.hostname || 'localhost',
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    sslmode: query.sslmode || null,
    connectTimeout: query.connect_timeout || null,
    applicationName: query.application_name || null
  };
  if (target.sslmode && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(target.sslmode)) {
    throw maintenanceError(`sslmode không hợp lệ: ${target.sslmode}`, 'UNSAFE_DATABASE_URL');
  }
  if (target.connectTimeout && (!/^\d+$/.test(target.connectTimeout) || Number(target.connectTimeout) < 1 || Number(target.connectTimeout) > 300)) {
    throw maintenanceError('connect_timeout phải là số giây 1..300.', 'UNSAFE_DATABASE_URL');
  }
  return assertSafeMaintenanceTarget(target, options);
}

export function getPostgresConnectionArgs(target, options = {}) {
  const safeTarget = assertSafeMaintenanceTarget(target, { operation: 'dump', ...options });
  return [
    `--host=${safeTarget.host}`,
    `--port=${safeTarget.port}`,
    `--username=${safeTarget.user}`,
    `--dbname=${safeTarget.database}`
  ];
}

export function getPostgresEnv(target, options = {}) {
  const safeTarget = assertSafeMaintenanceTarget(target, { operation: 'dump', ...options });
  const env = {};
  const sslMode = safeTarget.sslmode || (
    !LOCAL_POSTGRES_HOSTS.has(normalizeHost(safeTarget.host)) && process.env.DATABASE_SSL === 'true'
      ? 'require'
      : null
  );
  const isRemote = !LOCAL_POSTGRES_HOSTS.has(normalizeHost(safeTarget.host));
  if (isRemote && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw maintenanceError('Remote PostgreSQL target phải bật SSL mode require/verify.', 'REMOTE_SSL_REQUIRED');
  }
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
  if (isRemote && rejectUnauthorized && sslMode !== 'verify-full') {
    throw maintenanceError(
      'Khi DATABASE_SSL_REJECT_UNAUTHORIZED bật, remote maintenance chỉ chấp nhận sslmode=verify-full.',
      'REMOTE_SSL_VERIFY_REQUIRED'
    );
  }
  if (sslMode) env.PGSSLMODE = sslMode;
  if (safeTarget.connectTimeout) env.PGCONNECT_TIMEOUT = String(safeTarget.connectTimeout);
  if (safeTarget.applicationName) env.PGAPPNAME = String(safeTarget.applicationName).slice(0, 64);
  return env;
}

export function findPostgresBinary(binaryBaseName) {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? `${binaryBaseName}.exe` : binaryBaseName;

  // 1. Kiểm tra trong PATH hệ thống
  try {
    const cmd = isWin ? `where.exe ${binaryName}` : `which ${binaryName}`;
    const output = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    const firstMatch = output.split(/\r?\n/)[0];
    if (firstMatch && fs.existsSync(firstMatch)) {
      return firstMatch;
    }
  } catch {}

  // 2. Tìm trong các thư mục cài đặt phổ biến
  const candidateDirs = [];
  if (isWin) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';

    for (const base of [programFiles, programFilesX86, localAppData]) {
      if (!base) continue;
      const pgDir = path.join(base, 'PostgreSQL');
      if (fs.existsSync(pgDir)) {
        try {
          const versions = fs.readdirSync(pgDir);
          for (const ver of versions) {
            candidateDirs.push(path.join(pgDir, ver, 'bin'));
          }
        } catch {}
      }
    }
  } else {
    candidateDirs.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/Applications/Postgres.app/Contents/Versions/latest/bin'
    );
  }

  for (const dir of candidateDirs) {
    const fullPath = path.join(dir, binaryName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}
