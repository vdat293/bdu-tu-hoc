import { AcademicRankingService } from './academic-ranking.service.js';
import { SystemSettingsService } from './system-settings.service.js';

const HCM_UTC_OFFSET_MINUTES = 7 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANKING_SETTING_KEY = 'ranking_sync';
let timer = null;
let running = false;
let nextRunAtMs = null;

function configuredHour() {
  const hour = Number.parseInt(process.env.RANKING_SYNC_HOUR || '3', 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3;
}

export function millisecondsUntilNextRun(
  nowMs = Date.now(),
  hour = configuredHour(),
  utcOffsetMinutes = HCM_UTC_OFFSET_MINUTES
) {
  const localNow = new Date(nowMs + utcOffsetMinutes * 60_000);
  let targetMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    hour, 0, 0, 0
  ) - utcOffsetMinutes * 60_000;
  if (targetMs <= nowMs) targetMs += DAY_MS;
  return targetMs - nowMs;
}

/**
 * Công tắc hiệu lực = công tắc cứng cấp deploy (env) AND cấu hình trong /admin.
 * Chưa có cấu hình trong DB thì mặc định bật (giữ hành vi cũ).
 * Lưu ý: bật/tắt KHÔNG kích hoạt chạy ngay — chỉ ảnh hưởng lần chạy 03:00 kế tiếp.
 */
async function isEnabled() {
  if (process.env.RANKING_SYNC_ENABLED === 'false') return false;
  try {
    const setting = await SystemSettingsService.get(RANKING_SETTING_KEY, null);
    if (setting && typeof setting.enabled === 'boolean') return setting.enabled;
  } catch (error) {
    console.warn('[ranking-sync] Không đọc được cấu hình /admin:', error.message);
  }
  return true;
}

function scheduleNext() {
  const hour = configuredHour();
  const delay = millisecondsUntilNextRun(Date.now(), hour);
  nextRunAtMs = Date.now() + delay;
  const nextAt = new Date(nextRunAtMs);
  console.log(
    `[ranking-sync] Lần chạy tiếp theo: ${nextAt.toISOString()} `
    + `(${String(hour).padStart(2, '0')}:00 Asia/Ho_Chi_Minh)`
  );
  timer = setTimeout(async () => {
    if (!running) {
      running = true;
      try {
        if (!(await isEnabled())) {
          console.log('[ranking-sync] Đang tắt theo cấu hình /admin — bỏ qua lần chạy này.');
          // Vẫn dọn run bỏ dở để bảng trạng thái không treo vĩnh viễn trong
          // giai đoạn tắt theo mùa (sync không chạy nên không tự dọn được).
          await AcademicRankingService.markStaleRuns().catch((error) => {
            console.warn('[ranking-sync] Không dọn được run bỏ dở:', error.message);
          });
        } else {
          const result = await AcademicRankingService.sync('scheduler');
          if (result.skipped) {
            console.log('[ranking-sync] Bỏ qua vì một instance khác đang đồng bộ.');
          } else {
            const pruned = result.prunedRuns ? `, dọn ${result.prunedRuns} snapshot cũ` : '';
            console.log(`[ranking-sync] Hoàn tất run ${result.runId}: ${result.studentCount} sinh viên${pruned}.`);
          }
        }
      } catch (error) {
        console.error('[ranking-sync] Đồng bộ thất bại:', error.message);
      } finally {
        running = false;
      }
    }
    scheduleNext();
  }, delay);
  timer.unref?.();
}

export const RankingSchedulerService = {
  start() {
    if (timer || process.env.RANKING_SYNC_ENABLED === 'false') return false;
    if (!AcademicRankingService.isReady()) {
      console.warn('[ranking-sync] Chưa cấu hình database/CDS; scheduler đang tắt.');
      return false;
    }
    // Dọn run "running" bỏ dở từ lần deploy trước (nếu có) ngay khi khởi động.
    AcademicRankingService.markStaleRuns().catch((error) => {
      console.warn('[ranking-sync] Không dọn được run bỏ dở:', error.message);
    });
    scheduleNext();
    return true;
  },

  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    nextRunAtMs = null;
  },

  isStarted() {
    return Boolean(timer);
  },

  getNextRunAt() {
    return nextRunAtMs ? new Date(nextRunAtMs).toISOString() : null;
  },

  isEnabled
};
