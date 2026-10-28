import assert from 'node:assert/strict';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-course-guides: DATABASE_URL not configured.');
  process.exit(0);
}

try {
  // Đoạn 1: registry seed INF1003/bai-1 (do migration 066 seed).
  const registry = await query(
    `SELECT course_code, lesson_id, title, enabled, progress_version
       FROM course_guide_configs
      WHERE course_code = $1 AND lesson_id = $2`,
    ['INF1003', 'bai-1']
  );
  assert.equal(registry.rows.length, 1, 'Phải có đúng 1 row INF1003/bai-1 trong registry');
  assert.equal(registry.rows[0].enabled, true, 'INF1003/bai-1 phải enabled');
  assert.equal(
    registry.rows[0].progress_version,
    'cmd-be-first-v4',
    "progress_version phải là 'cmd-be-first-v4'"
  );

  // Ràng buộc toàn cục: index guide_step_progress(mssv, updated_at).
  const index = await query(
    `SELECT 1 FROM pg_indexes WHERE tablename = 'guide_step_progress' AND indexdef ILIKE '%(mssv, updated_at%'`
  );
  assert.ok(index.rows.length >= 1, 'Phải có index guide_step_progress(mssv, updated_at)');

  console.log('✓ Hướng dẫn học tập: registry INF1003/bai-1 đã seed đúng (enabled, progress_version).');
} finally {
  await closeDatabase();
}
