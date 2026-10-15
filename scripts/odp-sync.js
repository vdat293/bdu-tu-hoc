import { closeDatabase } from '../src/db/database.js';
import { AcademicRankingService } from '../src/services/academic-ranking.service.js';
import { OdpSyncService } from '../src/services/odp-sync.service.js';

/**
 * Chạy tay: kéo kho ODP về rồi (mặc định) cập nhật bảng xếp hạng.
 *   npm run odp:sync               → ingest + ranking
 *   npm run odp:sync -- --ingest-only → chỉ kéo kho
 *
 * Cùng semantics với lịch 03:00: ingest lỗi KHÔNG chặn ranking (ranking đọc kho cũ)
 * nhưng vẫn đặt `process.exitCode = 1` để người vận hành thấy lỗi.
 */
const ingestOnly = process.argv.includes('--ingest-only');

try {
  try {
    const ingest = await OdpSyncService.sync({ triggerSource: 'manual' });
    if (ingest.skipped) {
      console.log('ODP sync skipped: another instance is already running.');
    } else {
      if (ingest.errors?.length) {
        console.warn(`ODP sync run ${ingest.runId} có ${ingest.errors.length} bảng lỗi (giữ dữ liệu cũ):`);
        for (const entry of ingest.errors) {
          console.warn(`  - ${entry.key}: ${entry.message}`);
        }
        process.exitCode = 1;
      } else {
        console.log(`ODP sync completed: run ${ingest.runId}.`);
      }
      for (const [key, count] of Object.entries(ingest.counts || {})) {
        console.log(`  ${key}: ${count}`);
      }
    }
  } catch (error) {
    console.error(`ODP sync failed: ${error.message}`);
    process.exitCode = 1;
  }

  if (!ingestOnly) {
    try {
      const ranking = await AcademicRankingService.sync('manual');
      if (ranking.skipped) {
        console.log('Ranking sync skipped: another instance is already running.');
      } else {
        const pruned = ranking.prunedRuns ? `, đã dọn ${ranking.prunedRuns} snapshot cũ` : '';
        console.log(`Ranking sync completed: run ${ranking.runId}, ${ranking.studentCount} students${pruned}.`);
      }
    } catch (error) {
      console.error(`Ranking sync failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await closeDatabase();
}
