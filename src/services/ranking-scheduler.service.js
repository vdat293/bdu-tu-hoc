import { AcademicRankingService } from './academic-ranking.service.js';
import { OdpSyncService } from './odp-sync.service.js';
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

/**
 * Lần chạy 03:00: ingest kho ODP TRƯỚC, ranking SAU.
 *
 * Ingest thất bại (ném lỗi, có `errors`, hoặc `skipped` vì instance khác giữ lock)
 * KHÔNG được chặn ranking: ranking đọc kho của ngày hôm trước nên vẫn có kết quả.
 * Vì vậy hàm này KHÔNG bao giờ ném ra ngoài — mọi lỗi chỉ được ghi log.
 *
 * Export để test gọi trực tiếp mà không phải chờ tới 03:00. KHÔNG được gọi
 * song song với nhịp timer (`runTimerTick`) — dùng chung cờ `running`.
 */
export async function runScheduledSync() {
  if (!(await isEnabled())) {
    console.log('[ranking-sync] Đang tắt theo cấu hình /admin — bỏ qua lần chạy này.');
    // Vẫn dọn run bỏ dở để bảng trạng thái không treo vĩnh viễn trong
    // giai đoạn tắt theo mùa (sync không chạy nên không tự dọn được).
    await OdpSyncService.markStaleRuns().catch((error) => {
      console.warn('[odp-sync] Không dọn được run bỏ dở:', error.message);
    });
    await AcademicRankingService.markStaleRuns().catch((error) => {
      console.warn('[ranking-sync] Không dọn được run bỏ dở:', error.message);
    });
    return { enabled: false, odp: null, ranking: null };
  }

  let odpResult = null;
  let rankingResult = null;

  // 1) Ingest ODP: kéo kho mới về trước khi ranking đọc.
  try {
    odpResult = await OdpSyncService.sync({ triggerSource: 'scheduler' });
    if (odpResult.skipped) {
      console.log('[odp-sync] Bỏ qua vì một instance khác đang đồng bộ.');
    } else if (odpResult.errors?.length) {
      console.warn(
        `[odp-sync] Run ${odpResult.runId} có ${odpResult.errors.length} bảng lỗi — giữ dữ liệu cũ.`
      );
    } else {
      console.log(`[odp-sync] Hoàn tất run ${odpResult.runId}: ${Object.keys(odpResult.counts || {}).length} bảng.`);
    }
  } catch (error) {
    console.error('[odp-sync] Đồng bộ kho thất bại (ranking vẫn chạy trên kho cũ):', error.message);
  }

  // 2) Ranking: LUÔN chạy, kể cả khi ingest thất bại/skipped.
  try {
    rankingResult = await AcademicRankingService.sync('scheduler');
    if (rankingResult.skipped) {
      console.log('[ranking-sync] Bỏ qua vì một instance khác đang đồng bộ.');
    } else {
      const pruned = rankingResult.prunedRuns ? `, dọn ${rankingResult.prunedRuns} snapshot cũ` : '';
      console.log(`[ranking-sync] Hoàn tất run ${rankingResult.runId}: ${rankingResult.studentCount} sinh viên${pruned}.`);
    }
  } catch (error) {
    console.error('[ranking-sync] Đồng bộ thất bại:', error.message);
  }

  return { enabled: true, odp: odpResult, ranking: rankingResult };
}

/**
 * Một nhịp của lịch 03:00. Bọc `runScheduledSync()` để chuỗi lịch KHÔNG BAO GIỜ
 * đứt: kể cả khi `runScheduledSync()` ném lỗi bất ngờ thì vẫn phải `scheduleNext()`.
 * Export để test gọi trực tiếp (tham số `runSync` chỉ là seam cho test).
 * @param {() => Promise<unknown>} [runSync]
 */
export async function runTimerTick(runSync = runScheduledSync) {
  if (!running) {
    running = true;
    try {
      await runSync();
    } catch (error) {
      console.error('[ranking-sync] Lỗi không mong đợi khi chạy lịch:', error.message);
    } finally {
      running = false;
    }
  }
  scheduleNext();
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
  timer = setTimeout(runTimerTick, delay);
  timer.unref?.();
}

export const RankingSchedulerService = {
  start() {
    if (timer || process.env.RANKING_SYNC_ENABLED === 'false') return false;
    // Chỉ cần MỘT trong hai service ready: lần boot đầu ingest có thể sẵn sàng
    // trong khi ranking chưa (hoặc ngược lại) — vẫn phải bật lịch 03:00.
    if (!OdpSyncService.isReady() && !AcademicRankingService.isReady()) {
      console.warn('[ranking-sync] Chưa cấu hình database; scheduler đang tắt.');
      return false;
    }
    // Dọn run "running" bỏ dở từ lần deploy trước (nếu có) ngay khi khởi động.
    OdpSyncService.markStaleRuns().catch((error) => {
      console.warn('[odp-sync] Không dọn được run bỏ dở:', error.message);
    });
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
