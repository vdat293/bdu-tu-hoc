import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import '../src/config/load-env.js';

export function getDatabaseUrl() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Chưa cấu hình DATABASE_URL trong file .env');
  }
  return dbUrl;
}

export function getSafeDatabaseTarget() {
  const dbUrl = getDatabaseUrl();
  try {
    const target = new URL(dbUrl);
    return {
      url: dbUrl,
      host: target.hostname || 'localhost',
      port: target.port || '5432',
      user: decodeURIComponent(target.username || ''),
      password: decodeURIComponent(target.password || ''),
      database: decodeURIComponent(target.pathname.slice(1))
    };
  } catch {
    return { url: dbUrl };
  }
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
