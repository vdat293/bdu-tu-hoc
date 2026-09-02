import { closeDatabase } from '../src/db/database.js';
import { AcademicRankingService } from '../src/services/academic-ranking.service.js';

try {
  const result = await AcademicRankingService.sync('manual');
  if (result.skipped) {
    console.log('Ranking sync skipped: another instance is already running.');
  } else {
    console.log(`Ranking sync completed: run ${result.runId}, ${result.studentCount} students.`);
  }
} catch (error) {
  console.error(`Ranking sync failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
