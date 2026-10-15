/**
 * test-odp-scheduler.js — Task 2 (ODP ingest chung lịch ranking)
 *
 * Kiểm tra THỨ TỰ và SEMANTICS của lần chạy 03:00 (`runScheduledSync`):
 * - ingest ODP chạy TRƯỚC, ranking chạy SAU.
 * - ingest thất bại (errors / ném lỗi) hoặc skipped → ranking VẪN chạy trên kho cũ.
 * - tắt theo cấu hình /admin → không chạy gì, nhưng vẫn dọn run treo của CẢ HAI.
 * - `start()` chỉ cần MỘT trong hai service ready là chạy.
 *
 * Thuần mock: ghi đè method trên chính singleton mà scheduler import (cùng object),
 * nên KHÔNG chạm database, KHÔNG gọi mạng. Chạy trực tiếp:
 *   node tests/test-odp-scheduler.js
 */
import assert from 'node:assert/strict';
import { AcademicRankingService } from '../src/services/academic-ranking.service.js';
import { OdpSyncService } from '../src/services/odp-sync.service.js';
import { SystemSettingsService } from '../src/services/system-settings.service.js';
import {
  millisecondsUntilNextRun,
  RankingSchedulerService,
  runScheduledSync,
  runTimerTick
} from '../src/services/ranking-scheduler.service.js';

// ---------------------------------------------------------------------------
// Module mock: scheduler gọi qua chính các singleton này, nên ghi đè method ở
// đây là mock được cả hai phía (không cần DB, không cần thư viện mock).
// ---------------------------------------------------------------------------
const calls = [];

function installMocks({ ingest, ranking, enabled = true }) {
  calls.length = 0;
  SystemSettingsService.get = async (key) => {
    assert.equal(key, 'ranking_sync', 'scheduler phải đọc đúng khoá cấu hình');
    return { enabled };
  };
  OdpSyncService.isReady = () => true;
  OdpSyncService.markStaleRuns = async () => {
    calls.push('odp:stale');
    return 0;
  };
  OdpSyncService.sync = async (options) => {
    assert.equal(options?.triggerSource, 'scheduler', 'ingest 03:00 phải dùng triggerSource=scheduler');
    calls.push('odp');
    return ingest === 'throw' ? Promise.reject(new Error('ODP sập nguồn')) : ingest();
  };
  AcademicRankingService.isReady = () => true;
  AcademicRankingService.markStaleRuns = async () => {
    calls.push('ranking:stale');
    return 0;
  };
  AcademicRankingService.sync = async (triggerSource) => {
    assert.equal(triggerSource, 'scheduler', 'ranking 03:00 phải dùng triggerSource=scheduler');
    calls.push('ranking');
    return ranking === 'throw' ? Promise.reject(new Error('Ranking lỗi')) : ranking();
  };
}

// Giữ tham chiếu gốc để không làm hỏng test khác chạy chung tiến trình (nếu có).
const originals = {
  get: SystemSettingsService.get,
  odpReady: OdpSyncService.isReady,
  odpStale: OdpSyncService.markStaleRuns,
  odpSync: OdpSyncService.sync,
  rankReady: AcademicRankingService.isReady,
  rankStale: AcademicRankingService.markStaleRuns,
  rankSync: AcademicRankingService.sync
};

async function main() {
  RankingSchedulerService.stop();

  console.log('🧪 [ODP sched] 1. Ingest ODP chạy TRƯỚC ranking...');
  installMocks({
    ingest: () => ({ skipped: false, runId: 11, counts: { sinh_vien: 5 }, errors: [] }),
    ranking: () => ({ skipped: false, runId: 22, studentCount: 5 })
  });
  await runScheduledSync();
  assert.deepEqual(calls, ['odp', 'ranking'], 'phải ingest trước rồi mới ranking');
  console.log('✅ PASSED: thứ tự odp → ranking.');

  console.log('🧪 [ODP sched] 2. ingest có `errors` (thất bại) → ranking VẪN chạy...');
  installMocks({
    ingest: () => ({
      skipped: false,
      runId: 11,
      counts: {},
      errors: [{ key: 'sinh_vien', message: 'nguồn sập' }],
      status: 'failed'
    }),
    ranking: () => ({ skipped: false, runId: 22, studentCount: 5 })
  });
  const failedIngest = await runScheduledSync();
  assert.deepEqual(calls, ['odp', 'ranking'], 'ingest lỗi vẫn phải chạy ranking (đọc kho cũ)');
  assert.equal(failedIngest.ranking?.runId, 22);
  console.log('✅ PASSED: errors → ranking vẫn chạy.');

  console.log('🧪 [ODP sched] 3. ingest NÉM lỗi → ranking VẪN chạy, scheduler không chết...');
  installMocks({
    ingest: 'throw',
    ranking: () => ({ skipped: false, runId: 22, studentCount: 5 })
  });
  const thrown = await runScheduledSync();
  assert.deepEqual(calls, ['odp', 'ranking'], 'ingest ném lỗi vẫn phải chạy ranking, không được throw ra ngoài');
  assert.equal(thrown.odp, null, 'ingest ném lỗi → không có kết quả');
  assert.equal(thrown.ranking?.runId, 22);
  console.log('✅ PASSED: ingest throw → ranking vẫn chạy, không throw ra ngoài.');

  console.log('🧪 [ODP sched] 4. ingest skipped (không lấy được lock) → ranking VẪN chạy...');
  installMocks({
    ingest: () => ({ skipped: true, runId: null, counts: {}, errors: [] }),
    ranking: () => ({ skipped: false, runId: 22, studentCount: 5 })
  });
  await runScheduledSync();
  assert.deepEqual(calls, ['odp', 'ranking'], 'ingest skipped vẫn phải chạy ranking');
  console.log('✅ PASSED: skipped → ranking vẫn chạy.');

  console.log('🧪 [ODP sched] 5. Cấu hình tắt → KHÔNG chạy gì, nhưng dọn run treo CẢ HAI...');
  installMocks({
    enabled: false,
    ingest: () => ({ skipped: false, runId: 11, counts: {}, errors: [] }),
    ranking: () => ({ skipped: false, runId: 22, studentCount: 5 })
  });
  await runScheduledSync();
  assert.deepEqual(
    calls,
    ['odp:stale', 'ranking:stale'],
    'khi tắt: không sync gì, chỉ dọn run treo của cả hai service'
  );
  console.log('✅ PASSED: tắt → không sync, dọn treo cả hai.');

  console.log('🧪 [ODP sched] 6. start() chỉ cần MỘT trong hai service ready...');
  delete process.env.RANKING_SYNC_ENABLED;
  installMocks({
    ingest: () => ({ skipped: false, runId: 1, counts: {}, errors: [] }),
    ranking: () => ({ skipped: false, runId: 2, studentCount: 1 })
  });
  OdpSyncService.isReady = () => true;
  AcademicRankingService.isReady = () => false;
  const started = RankingSchedulerService.start();
  assert.equal(started, true, 'chỉ ingest ready cũng phải bật lịch (lần boot đầu ranking chưa sẵn sàng)');
  assert.equal(RankingSchedulerService.isStarted(), true);
  RankingSchedulerService.stop();
  assert.ok(calls.includes('odp:stale'), 'start() phải dọn run treo của ingest');
  assert.ok(calls.includes('ranking:stale'), 'start() phải dọn run treo của ranking');
  console.log('✅ PASSED: chỉ ingest ready → vẫn bật lịch và dọn treo cả hai.');

  console.log('🧪 [ODP sched] 7. start() khi CẢ HAI chưa ready → tắt như cũ...');
  installMocks({
    ingest: () => ({ skipped: false, runId: 1, counts: {}, errors: [] }),
    ranking: () => ({ skipped: false, runId: 2, studentCount: 1 })
  });
  OdpSyncService.isReady = () => false;
  AcademicRankingService.isReady = () => false;
  calls.length = 0;
  const notStarted = RankingSchedulerService.start();
  assert.equal(notStarted, false, 'cả hai chưa ready → trả false');
  assert.equal(RankingSchedulerService.isStarted(), false);
  assert.deepEqual(calls, [], 'không dọn run treo vì scheduler không bật');
  RankingSchedulerService.stop();
  console.log('✅ PASSED: cả hai chưa ready → tắt.');

  console.log('🧪 [ODP sched] 8. runScheduledSync ném lỗi bất ngờ → scheduleNext VẪN chạy (chuỗi lịch không đứt)...');
  RankingSchedulerService.stop();
  await runTimerTick(async () => {
    throw new Error('lỗi bất ngờ ngoài dự kiến');
  });
  assert.equal(
    RankingSchedulerService.isStarted(),
    true,
    'lỗi bất ngờ vẫn phải đặt lại timer cho lần chạy kế tiếp'
  );
  assert.ok(
    RankingSchedulerService.getNextRunAt(),
    'lần chạy kế tiếp vẫn phải được lên lịch sau lỗi bất ngờ'
  );
  RankingSchedulerService.stop();
  console.log('✅ PASSED: lỗi bất ngờ không làm đứt chuỗi lịch 03:00.');

  console.log('🧪 [ODP sched] 9. millisecondsUntilNextRun() giữ nguyên hành vi...');
  const beforeThree = Date.UTC(2026, 8, 1, 19, 30, 0);
  assert.equal(millisecondsUntilNextRun(beforeThree), 30 * 60 * 1000);
  const exactlyThree = Date.UTC(2026, 8, 1, 20, 0, 0);
  assert.equal(millisecondsUntilNextRun(exactlyThree), 24 * 60 * 60 * 1000);
  console.log('✅ PASSED: millisecondsUntilNextRun không đổi.');

  console.log('✅ Tất cả kiểm thử lịch ODP+ranking PASS.');
}

try {
  await main();
} finally {
  RankingSchedulerService.stop();
  SystemSettingsService.get = originals.get;
  OdpSyncService.isReady = originals.odpReady;
  OdpSyncService.markStaleRuns = originals.odpStale;
  OdpSyncService.sync = originals.odpSync;
  AcademicRankingService.isReady = originals.rankReady;
  AcademicRankingService.markStaleRuns = originals.rankStale;
  AcademicRankingService.sync = originals.rankSync;
}
