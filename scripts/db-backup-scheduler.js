/**
 * Scheduler backup DB định kỳ (không thêm dependency, tự tính giờ + setTimeout).
 *
 * Cách dùng:
 *   node scripts/db-backup-scheduler.js           # chạy vòng lặp (cần BACKUP_ENABLED=1)
 *   node scripts/db-backup-scheduler.js --once    # chạy ngay 1 chu kỳ rồi thoát (dùng cho cron)
 *
 * Env:
 *   BACKUP_ENABLED=1            BẮT BUỘC = 1 mới chạy. Mặc định TẮT (an toàn ở local).
 *   BACKUP_CRON=03:17           Giờ chạy HH:MM (giờ máy). Cố tình lệch phút so với 03:00
 *                               để không dồn với job khác của máy chủ.
 *   BACKUP_ALLOW_PRODUCTION=1   Truyền --allow-production cho db-backup.js.
 *                               Vẫn cần BDU_MAINTENANCE_ALLOW_PRODUCTION=1 trong env.
 *   BACKUP_ALERT_AFTER=3        Số lần fail liên tiếp trước khi ghi cảnh báo.
 *   BACKUP_REASON=scheduled     Nhãn lý do gắn vào mỗi lần backup.
 *   BACKUP_ALERT_FILE           File ghi cảnh báo (mặc định data/backup-alerts.log).
 *
 * Xử lý SIGTERM/SIGINT để `docker stop` (stopgraceful) dừng sạch, không để lại
 * dump dở dang; tín hiệu được chuyển tiếp xuống pg_dump.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config/load-env.js';
import {
  envFlag,
  envValue,
  logError,
  logInfo,
  logWarn,
  parseIntEnv,
  redactForLog,
  runProcess
} from './db-backup-shared.js';

const SCOPE = 'db-backup-scheduler';
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backupScript = path.join(currentDir, 'db-backup.js');
const rotateScript = path.join(currentDir, 'db-backup-rotate.js');
const MAX_TIMEOUT_MS = 2_147_483_647;

const state = {
  stopping: false,
  running: false,
  timer: null,
  activeChild: null,
  consecutiveFailures: 0,
  alertedAt: 0
};

/** Chỉ chạy CLI khi file này là entrypoint (cho phép import để test logic). */
export const isBackupSchedulerEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(path.resolve(entry)) === normalize(fileURLToPath(import.meta.url));
})();

function printUsage() {
  console.log('======================================================');
  console.log('⏰ BDU Tự Học - Scheduler backup định kỳ');
  console.log('======================================================');
  console.log('Cách dùng: node scripts/db-backup-scheduler.js [--once]');
  console.log('  --once   Chạy ngay một chu kỳ (backup + rotate) rồi thoát.');
  console.log('');
  console.log('Cần BACKUP_ENABLED=1. Giờ chạy lấy từ BACKUP_CRON (mặc định 03:17).');
  console.log('======================================================');
}

function parseCli(argv) {
  const options = { once: false, help: false };
  for (const arg of argv) {
    if (arg === '--once') options.once = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Không hỗ trợ tham số: ${arg}`);
  }
  return options;
}

/** Đọc `HH:MM` (hoặc `HH:MM:SS`) và trả về thời điểm chạy kế tiếp sau `from`. */
export function parseBackupTime(raw) {
  const match = String(raw || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw new Error(`BACKUP_CRON không hợp lệ: "${raw}". Định dạng bắt buộc HH:MM (ví dụ 03:17).`);
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || 0)
  };
}

export function nextRunAt(time, from = new Date()) {
  const next = new Date(from.getTime());
  next.setHours(time.hour, time.minute, time.second, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function formatCountdown(target, from = Date.now()) {
  const seconds = Math.max(0, Math.round((target.getTime() - from) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds % 60).padStart(2, '0')}s`;
}

function writeAlert(message) {
  const file = path.resolve(process.cwd(), envValue('BACKUP_ALERT_FILE') || path.join(envValue('BACKUP_LOCAL_DIR') || 'data', 'backup-alerts.log'));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, { mode: 0o600 });
    return file;
  } catch (error) {
    logWarn(SCOPE, `Không ghi được file cảnh báo ${file}: ${error.message}`);
    return null;
  }
}

function reportFailure(reason) {
  state.consecutiveFailures += 1;
  const alertAfter = parseIntEnv('BACKUP_ALERT_AFTER', 3, { min: 1, max: 100 });
  logError(SCOPE, `Lần fail liên tiếp #${state.consecutiveFailures}: ${reason}`);
  if (state.consecutiveFailures >= alertAfter && state.consecutiveFailures % alertAfter === 0) {
    const message = `🚨 BACKUP THẤT BẠI ${state.consecutiveFailures} lần liên tiếp (ngưỡng ${alertAfter}). Lý do cuối: ${reason}. Kiểm tra ngay: R2 còn quota? BACKUP_DATABASE_URL còn hiệu lực? pg_dump có chạy được không?`;
    logError(SCOPE, message);
    const file = writeAlert(message);
    if (file) logError(SCOPE, `Cảnh báo đã ghi tại ${file}`);
    state.alertedAt = state.consecutiveFailures;
  }
}

function reportSuccess() {
  if (state.consecutiveFailures > 0) {
    logInfo(SCOPE, `Backup OK — chuỗi fail trước đó (${state.consecutiveFailures} lần) đã kết thúc.`);
  }
  state.consecutiveFailures = 0;
}

/** Chạy một tiến trình con, tiếp nhận SIGTERM/SIGINT để dừng sạch. */
async function runChild(scriptPath, args) {
  const result = await runProcess(process.execPath, [scriptPath, ...args], {
    env: { ...process.env },
    timeoutMs: 2 * 60 * 60_000,
    onChild: (child) => { state.activeChild = child; }
  });
  state.activeChild = null;
  return result;
}

async function runBackupCycle() {
  const reason = envValue('BACKUP_REASON') || 'scheduled';
  const args = ['--reason', reason];
  if (envFlag('BACKUP_ALLOW_PRODUCTION', false)) args.push('--allow-production');

  logInfo(SCOPE, '▶ Bắt đầu chu kỳ backup...');
  const backup = await runChild(backupScript, args);
  const output = `${backup.stdout}\n${backup.stderr}`.trim();
  if (output) logInfo(SCOPE, output.split(/\r?\n/).map((line) => `  | ${line}`).join('\n'));
  if (!backup.ok) {
    reportFailure(`db-backup.js exit ${backup.code}${backup.timedOut ? ' (timeout)' : ''}`);
    return false;
  }

  // Chỉ rotate khi backup thành công: nếu pipeline hỏng, giữ lại các bản cũ
  // còn hiệu lực thay vì xoá dần tài sản dự phòng.
  logInfo(SCOPE, '▶ Backup OK, chạy retention (daily/weekly/monthly)...');
  const rotate = await runChild(rotateScript, []);
  const rotateOutput = `${rotate.stdout}\n${rotate.stderr}`.trim();
  if (rotateOutput) logInfo(SCOPE, rotateOutput.split(/\r?\n/).map((line) => `  | ${line}`).join('\n'));
  if (!rotate.ok) {
    logWarn(SCOPE, `Rotate thất bại (exit ${rotate.code}). Bản backup vẫn an toàn, sẽ thử lại ở chu kỳ sau.`);
  }
  reportSuccess();
  return true;
}

async function runCycle() {
  if (state.running) {
    logWarn(SCOPE, 'Chu kỳ trước chưa xong — bỏ qua lần chạy này (không chạy chồng).');
    return false;
  }
  state.running = true;
  try {
    return await runBackupCycle();
  } catch (error) {
    reportFailure(redactForLog(error?.message || String(error), [envValue('BACKUP_DATABASE_URL')]));
    return false;
  } finally {
    state.running = false;
  }
}

function scheduleNext(time) {
  const target = nextRunAt(time);
  const delay = Math.min(Math.max(1000, target.getTime() - Date.now()), MAX_TIMEOUT_MS);
  logInfo(SCOPE, `Lần chạy kế tiếp: ${target.toLocaleString()} (sau ${formatCountdown(target)}).`);
  state.timer = setTimeout(async () => {
    if (state.stopping) return;
    const ok = await runCycle();
    if (!state.stopping) {
      if (!ok) logWarn(SCOPE, 'Chu kỳ vừa rồi thất bại — sẽ thử lại vào lần chạy kế tiếp.');
      scheduleNext(time);
    }
  }, delay);
}

function shutdown(signal) {
  if (state.stopping) return;
  state.stopping = true;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (state.activeChild) {
    logWarn(SCOPE, `Nhận ${signal}: chuyển tiếp tín hiệu xuống tiến trình backup con...`);
    try { state.activeChild.kill(signal); } catch { /* bỏ qua */ }
    // Đợi tối đa 20s cho tiến trình con kịp dọn file tạm rồi mới thoát.
    const forced = setTimeout(() => process.exit(0), 20_000);
    forced.unref?.();
  } else {
    logInfo(SCOPE, `Nhận ${signal}: không có việc đang chạy, dừng scheduler.`);
    process.exit(0);
  }
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  if (!envFlag('BACKUP_ENABLED', false)) {
    logInfo(SCOPE, 'BACKUP_ENABLED không bằng 1 → scheduler KHÔNG chạy (mặc định tắt ở local).');
    logInfo(SCOPE, 'Bật trên máy chủ production bằng cách đặt BACKUP_ENABLED=1 trong env của container.');
    process.exit(0);
  }
  if (!envValue('BACKUP_DATABASE_URL')) {
    logError(SCOPE, 'Thiếu BACKUP_DATABASE_URL — scheduler sẽ không thể backup. Từ chối chạy.');
    process.exit(1);
  }
  if (envFlag('BACKUP_ALLOW_PRODUCTION', false) && envValue('BDU_MAINTENANCE_ALLOW_PRODUCTION') !== '1') {
    logWarn(SCOPE, 'BACKUP_ALLOW_PRODUCTION=1 nhưng thiếu BDU_MAINTENANCE_ALLOW_PRODUCTION=1 → mọi lần backup sẽ fail (đây là hàng rào an toàn có chủ ý).');
  }

  const time = parseBackupTime(envValue('BACKUP_CRON') || '03:17');
  logInfo(SCOPE, `Scheduler ON. Giờ chạy ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:${String(time.second).padStart(2, '0')} (giờ máy, ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'}).`);
  const alertAfter = parseIntEnv('BACKUP_ALERT_AFTER', 3, { min: 1, max: 100 });
  logInfo(SCOPE, `Retention: daily=${envValue('BACKUP_RETENTION_DAILY') || envValue('BACKUP_RETAIN_DAILY') || 7}, weekly=${envValue('BACKUP_RETENTION_WEEKLY') || envValue('BACKUP_RETAIN_WEEKLY') || 4}, monthly=${envValue('BACKUP_RETENTION_MONTHLY') || envValue('BACKUP_RETAIN_MONTHLY') || 6}. Cảnh báo sau ${alertAfter} lần fail liên tiếp.`);

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  if (options.once) {
    logInfo(SCOPE, 'Chế độ --once: chạy một chu kỳ rồi thoát.');
    const ok = await runCycle();
    process.exit(ok ? 0 : 1);
  }
  scheduleNext(time);
}

if (isBackupSchedulerEntry) {
  main().catch((error) => {
    logError(SCOPE, redactForLog(error?.message || String(error), [envValue('BACKUP_DATABASE_URL')]));
    process.exit(1);
  });
}
