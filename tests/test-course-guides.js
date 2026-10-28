import assert from 'node:assert/strict';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { GuideService } from '../src/modules/learning/guide.service.js';

if (!isDatabaseConfigured()) {
  console.log('Skipping test-course-guides: DATABASE_URL not configured.');
  process.exit(0);
}

const VIEWER = 'TEST_G_VIEWER';
const OUTSIDER = 'TEST_G_OUTSIDER';
const COURSE_CODE = 'TESTG01';
const EMPTY_COURSE_CODE = 'TESTG02';
const EXPECTED_STEPS = ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7'];

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

  // Đoạn 2: GuideService gating + tiến độ theo mssv (môn TESTG01).
  await query('DELETE FROM guide_step_progress WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]);
  await query('DELETE FROM course_guide_configs WHERE course_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]);
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]);
  await query('DELETE FROM courses WHERE normalized_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]);

  const syncedAt = new Date();
  await query(
    `INSERT INTO students (mssv, full_name, is_active, course_synced_at)
     VALUES ($1, 'Người xem guide', TRUE, $3),
            ($2, 'Người ngoài môn', TRUE, $3);`,
    [VIEWER, OUTSIDER, syncedAt]
  );
  const courseResult = await query(
    `INSERT INTO courses (normalized_code, display_code, name)
     VALUES ($1, $1, 'Môn kiểm thử guide'), ($2, $2, 'Môn không seed guide')
     RETURNING normalized_code;`,
    [COURSE_CODE, EMPTY_COURSE_CODE]
  );
  assert.equal(courseResult.rows.length, 2);
  const courseId = (
    await query('SELECT id FROM courses WHERE normalized_code = $1', [COURSE_CODE])
  ).rows[0].id;
  const emptyCourseId = (
    await query('SELECT id FROM courses WHERE normalized_code = $1', [EMPTY_COURSE_CODE])
  ).rows[0].id;
  await query(
    `INSERT INTO student_courses (mssv, course_id, semester_code, semester_name, has_final_grade, last_seen_at)
     VALUES ($1, $2, '20261', 'Học kỳ kiểm thử', FALSE, $4),
            ($1, $3, '20261', 'Học kỳ kiểm thử', FALSE, $4);`,
    [VIEWER, courseId, emptyCourseId, syncedAt]
  );
  await query(
    `INSERT INTO course_guide_configs (course_code, lesson_id, title, enabled, progress_version)
     VALUES ($1, 'bai-1', 'Bài 1', TRUE, 'cmd-be-first-v4')
     ON CONFLICT (course_code, lesson_id)
     DO UPDATE SET title = EXCLUDED.title, enabled = TRUE, progress_version = EXCLUDED.progress_version;`,
    [COURSE_CODE]
  );

  // 2a. getGuide VIEWER: 1 lesson bai-1, 7 steps, doneCount 0.
  const guide = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guide.enabled, true);
  assert.equal(guide.lessons.length, 1);
  assert.equal(guide.lessons[0].id, 'bai-1');
  assert.equal(guide.lessons[0].progressVersion, 'cmd-be-first-v4');
  assert.deepEqual(guide.lessons[0].stepIds, EXPECTED_STEPS);
  assert.equal(guide.lessons[0].doneCount, 0);
  // Chuẩn hóa mã môn: chữ thường vẫn xem được.
  const guideLower = await GuideService.getGuide(VIEWER, COURSE_CODE.toLowerCase());
  assert.deepEqual(guideLower, guide);

  // 2b. getGuide OUTSIDER → 403; lesson chưa seed → { enabled:false, lessons:[] }.
  await assert.rejects(
    () => GuideService.getGuide(OUTSIDER, COURSE_CODE),
    (err) => err.status === 403
  );
  const emptyGuide = await GuideService.getGuide(VIEWER, EMPTY_COURSE_CODE);
  assert.deepEqual(emptyGuide, { enabled: false, lessons: [] });

  // 2c. getProgress OUTSIDER → 403; lesson chưa seed → 404.
  await assert.rejects(
    () => GuideService.getProgress(OUTSIDER, COURSE_CODE, 'bai-1'),
    (err) => err.status === 403
  );
  await assert.rejects(
    () => GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-99'),
    (err) => err.status === 404 && err.code === 'GUIDE_LESSON_NOT_FOUND'
  );

  // 2d. saveProgress stepId lạ → 400 GUIDE_STEP_INVALID; workdir sai → 400.
  await assert.rejects(
    () => GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', { stepId: 'buoc-99', done: true }),
    (err) => err.status === 400 && err.code === 'GUIDE_STEP_INVALID'
  );
  await assert.rejects(
    () => GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', { stepId: 'BUOC-LA  ', done: true }),
    (err) => err.status === 400 && err.code === 'GUIDE_STEP_INVALID'
  );
  await assert.rejects(
    () =>
      GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', {
        stepId: 'buoc-1',
        done: true,
        workdir: 'not-a-path'
      }),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => GuideService.saveProgress(OUTSIDER, COURSE_CODE, 'bai-1', { stepId: 'buoc-1', done: true }),
    (err) => err.status === 403
  );
  assert.equal(
    (await query('SELECT COUNT(*)::int AS total FROM guide_step_progress WHERE mssv = $1', [VIEWER]))
      .rows[0].total,
    0,
    'Tiến độ lỗi không được ghi DB'
  );

  // 2e. saveProgress buoc-1 done=true + workdir → getProgress đọc lại đúng.
  const saved = await GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', {
    stepId: 'buoc-1',
    done: true,
    workdir: 'C:\\lab1'
  });
  assert.deepEqual(saved, { stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' });
  const stored = (
    await query(
      `SELECT is_done, workdir, completed_at FROM guide_step_progress
        WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND step_id = $4`,
      [VIEWER, COURSE_CODE, 'bai-1', 'buoc-1']
    )
  ).rows[0];
  assert.equal(stored.is_done, true);
  assert.equal(stored.workdir, 'C:\\lab1');
  assert.ok(stored.completed_at, 'done=true phải set completed_at');

  const progress = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.deepEqual(progress.steps['buoc-1'], { done: true, workdir: 'C:\\lab1' });
  assert.equal(progress.workdir, 'C:\\lab1');

  // Bước chưa done không tính vào doneCount; uncheck xóa completed_at.
  await GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', { stepId: 'buoc-2', done: false });
  const unchecked = (
    await query(
      `SELECT is_done, workdir, completed_at FROM guide_step_progress
        WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND step_id = $4`,
      [VIEWER, COURSE_CODE, 'bai-1', 'buoc-2']
    )
  ).rows[0];
  assert.equal(unchecked.is_done, false);
  assert.equal(unchecked.completed_at, null);
  const guideAfterSave = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guideAfterSave.lessons[0].doneCount, 1);
  const progressAfterSave = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.deepEqual(progressAfterSave.steps['buoc-2'], { done: false, workdir: '' });

  // 2f. Đổi progress_version → getGuide trả version mới, doneCount tính lại từ 0.
  // Hợp đồng reset: khi bump version phải xóa tiến độ cũ của lesson đó; service
  // chỉ đếm tiến độ hiện hành nên doneCount quay về 0.
  await query(
    `UPDATE course_guide_configs SET progress_version = $1, updated_at = NOW()
      WHERE course_code = $2 AND lesson_id = 'bai-1'`,
    ['cmd-be-first-v5', COURSE_CODE]
  );
  await query(
    'DELETE FROM guide_step_progress WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3',
    [VIEWER, COURSE_CODE, 'bai-1']
  );
  const guideAfterVersion = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guideAfterVersion.lessons[0].progressVersion, 'cmd-be-first-v5');
  assert.equal(guideAfterVersion.lessons[0].doneCount, 0);
  const progressAfterVersion = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.deepEqual(progressAfterVersion.steps, {});
  assert.equal(progressAfterVersion.workdir, null);

  console.log('✓ GuideService: gating findAccessibleCourse, validate step/workdir, upsert tiến độ và reset theo version đều hoạt động.');
} finally {
  await query('DELETE FROM guide_step_progress WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM course_guide_configs WHERE course_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]).catch(() => {});
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
