import { AcademicRankingService } from './academic-ranking.service.js';

const HCM_UTC_OFFSET_MINUTES = 7 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
let timer = null;
let running = false;

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

function scheduleNext() {
  const hour = configuredHour();
  const delay = millisecondsUntilNextRun(Date.now(), hour);
  const nextAt = new Date(Date.now() + delay);
  console.log(
    `[ranking-sync] Lần chạy tiếp theo: ${nextAt.toISOString()} `
    + `(${String(hour).padStart(2, '0')}:00 Asia/Ho_Chi_Minh)`
  );
  timer = setTimeout(async () => {
    if (!running) {
      running = true;
      try {
        const result = await AcademicRankingService.sync('scheduler');
        if (result.skipped) {
          console.log('[ranking-sync] Bỏ qua vì một instance khác đang đồng bộ.');
        } else {
          console.log(`[ranking-sync] Hoàn tất run ${result.runId}: ${result.studentCount} sinh viên.`);
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
    scheduleNext();
    return true;
  },

  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
};
