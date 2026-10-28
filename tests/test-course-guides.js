import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { GuideService } from '../src/modules/learning/guide.service.js';
import { GuideController } from '../src/modules/learning/guide.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { ApiController } from '../src/controllers/api.controller.js';

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
      `SELECT is_done, workdir, completed_at, progress_version FROM guide_step_progress
        WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND step_id = $4`,
      [VIEWER, COURSE_CODE, 'bai-1', 'buoc-1']
    )
  ).rows[0];
  assert.equal(stored.is_done, true);
  assert.equal(stored.workdir, 'C:\\lab1');
  assert.equal(stored.progress_version, 'cmd-be-first-v4', 'saveProgress phải stamp version hiện hành');
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

  // 2f. Đổi progress_version nhưng giữ nguyên rows (không xóa cứng) → tiến độ
  // cũ bị bỏ qua: getGuide trả version mới + doneCount 0, getProgress trống.
  await query(
    `UPDATE course_guide_configs SET progress_version = $1, updated_at = NOW()
      WHERE course_code = $2 AND lesson_id = 'bai-1'`,
    ['cmd-be-first-v5', COURSE_CODE]
  );
  assert.equal(
    (await query(
      'SELECT COUNT(*)::int AS total FROM guide_step_progress WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3',
      [VIEWER, COURSE_CODE, 'bai-1']
    )).rows[0].total,
    2,
    'Tiến độ cũ không được xóa cứng khi bump version'
  );
  const guideAfterVersion = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guideAfterVersion.lessons[0].progressVersion, 'cmd-be-first-v5');
  assert.equal(guideAfterVersion.lessons[0].doneCount, 0);
  const progressAfterVersion = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.deepEqual(progressAfterVersion.steps, {});
  assert.equal(progressAfterVersion.workdir, null);

  // Ghi tiến độ dưới version mới → chỉ hàng mới được đếm/đọc.
  await GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', {
    stepId: 'buoc-1',
    done: true,
    workdir: 'C:\\lab2'
  });
  const guideNewVersion = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guideNewVersion.lessons[0].doneCount, 1);
  const progressNewVersion = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.deepEqual(Object.keys(progressNewVersion.steps), ['buoc-1']);
  assert.deepEqual(progressNewVersion.steps['buoc-1'], { done: true, workdir: 'C:\\lab2' });

  // Khôi phục version để seed/registry của test không ảnh hưởng test khác,
  // rồi ghi lại tiến độ dưới version đã khôi phục.
  await query(
    `UPDATE course_guide_configs SET progress_version = $1, updated_at = NOW()
      WHERE course_code = $2 AND lesson_id = 'bai-1'`,
    ['cmd-be-first-v4', COURSE_CODE]
  );
  await GuideService.saveProgress(VIEWER, COURSE_CODE, 'bai-1', {
    stepId: 'buoc-1',
    done: true,
    workdir: 'C:\\lab1'
  });

  // 2g. Hàng step_id lạ chèn trực tiếp (bypass validate) bị bỏ qua ở cả hai chiều đọc.
  await query(
    `INSERT INTO guide_step_progress
       (mssv, course_code, lesson_id, step_id, is_done, workdir, progress_version, completed_at, updated_at)
     VALUES ($1, $2, 'bai-1', 'buoc-99', TRUE, '', 'cmd-be-first-v4', NOW(), NOW())
     ON CONFLICT (mssv, course_code, lesson_id, step_id) DO NOTHING;`,
    [VIEWER, COURSE_CODE]
  );
  const guideStray = await GuideService.getGuide(VIEWER, COURSE_CODE);
  assert.equal(guideStray.lessons[0].doneCount, 1, 'step lạ không được tính vào doneCount');
  const progressStray = await GuideService.getProgress(VIEWER, COURSE_CODE, 'bai-1');
  assert.equal('buoc-99' in progressStray.steps, false, 'step lạ không được trả trong getProgress');
  assert.deepEqual(progressStray.steps['buoc-1'], { done: true, workdir: 'C:\\lab1' });
  await query(
    `DELETE FROM guide_step_progress
      WHERE mssv = $1 AND course_code = $2 AND lesson_id = 'bai-1' AND step_id = 'buoc-99'`,
    [VIEWER, COURSE_CODE]
  );

  console.log('✓ GuideService: gating findAccessibleCourse, validate step/workdir, upsert tiến độ stamp version và bỏ qua version cũ đều hoạt động.');

  // Đoạn 3: GuideController ủy quyền đúng service + map status lỗi;
  // route guide đã đăng ký trong learning.routes.js (stub, không chạm DB).
  function fakeGuideResponse() {
    const state = { statusCode: 200, body: null, headers: {} };
    const res = {
      setHeader(name, value) {
        state.headers[name] = value;
      },
      status(code) {
        state.statusCode = code;
        return res;
      },
      json(body) {
        state.body = body;
        return res;
      }
    };
    return { res, state };
  }

  const originalResolveVerifiedMssv = BduIdentityService.resolveVerifiedMssv;
  const originalGuideGetGuide = GuideService.getGuide;
  const originalGuideGetProgress = GuideService.getProgress;
  const originalGuideSaveProgress = GuideService.saveProgress;
  try {
    // 3a. getCourseGuide 200: resolve mssv rồi gọi service đúng tham số.
    BduIdentityService.resolveVerifiedMssv = async () => VIEWER;
    GuideService.getGuide = async (mssv, courseCode) => {
      assert.equal(mssv, VIEWER);
      assert.equal(courseCode, COURSE_CODE);
      return { enabled: true, lessons: [] };
    };
    {
      const { res, state } = fakeGuideResponse();
      await GuideController.getCourseGuide(
        { headers: { authorization: 'Bearer viewer-token' }, params: { courseCode: COURSE_CODE } },
        res
      );
      assert.equal(state.statusCode, 200);
      assert.equal(state.body.result, true);
      assert.equal(state.body.data.enabled, true);
    }

    // 3b. getCourseGuide outsider → 403 (kế thừa gating Task 2).
    const outsiderError = new Error('Sinh viên không thuộc môn học này.');
    outsiderError.status = 403;
    GuideService.getGuide = async () => {
      throw outsiderError;
    };
    {
      const { res, state } = fakeGuideResponse();
      await GuideController.getCourseGuide(
        { headers: { authorization: 'Bearer outsider-token' }, params: { courseCode: COURSE_CODE } },
        res
      );
      assert.equal(state.statusCode, 403);
      assert.equal(state.body.result, false);
    }

    // 3c. getGuideProgress 200.
    GuideService.getProgress = async (mssv, courseCode, lessonId) => {
      assert.equal(mssv, VIEWER);
      assert.equal(courseCode, COURSE_CODE);
      assert.equal(lessonId, 'bai-1');
      return { steps: {}, workdir: null };
    };
    {
      const { res, state } = fakeGuideResponse();
      await GuideController.getGuideProgress(
        {
          headers: { authorization: 'Bearer viewer-token' },
          params: { courseCode: COURSE_CODE, lessonId: 'bai-1' }
        },
        res
      );
      assert.equal(state.statusCode, 200);
      assert.equal(state.body.result, true);
      assert.deepEqual(state.body.data, { steps: {}, workdir: null });
    }

    // 3d. saveGuideProgress stepId lạ → 400 GUIDE_STEP_INVALID.
    const stepError = new Error('Bước hướng dẫn không hợp lệ.');
    stepError.status = 400;
    stepError.code = 'GUIDE_STEP_INVALID';
    GuideService.saveProgress = async () => {
      throw stepError;
    };
    {
      const { res, state } = fakeGuideResponse();
      await GuideController.saveGuideProgress(
        {
          headers: { authorization: 'Bearer viewer-token' },
          params: { courseCode: COURSE_CODE, lessonId: 'bai-1' },
          body: { stepId: 'buoc-99', done: true }
        },
        res
      );
      assert.equal(state.statusCode, 400);
      assert.equal(state.body.result, false);
      assert.equal(state.body.code, 'GUIDE_STEP_INVALID');
    }

    // 3e. saveGuideProgress 200: body stepId/done/workdir truyền nguyên sang service.
    GuideService.saveProgress = async (mssv, courseCode, lessonId, input) => {
      assert.equal(mssv, VIEWER);
      assert.equal(courseCode, COURSE_CODE);
      assert.equal(lessonId, 'bai-1');
      assert.deepEqual(input, { stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' });
      return { stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' };
    };
    {
      const { res, state } = fakeGuideResponse();
      await GuideController.saveGuideProgress(
        {
          headers: { authorization: 'Bearer viewer-token' },
          params: { courseCode: COURSE_CODE, lessonId: 'bai-1' },
          body: { stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' }
        },
        res
      );
      assert.equal(state.statusCode, 200);
      assert.equal(state.body.result, true);
      assert.deepEqual(state.body.data, { stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' });
    }

    // 3f. Barrel + route registration (static assertion).
    assert.equal(typeof ApiController.getCourseGuide, 'function');
    assert.equal(typeof ApiController.getGuideProgress, 'function');
    assert.equal(typeof ApiController.saveGuideProgress, 'function');
    const learningRoutes = fs.readFileSync('src/routes/learning.routes.js', 'utf8');
    assert.match(learningRoutes, /\/learning\/courses\/:courseCode\/guide/);
    assert.match(learningRoutes, /\/learning\/courses\/:courseCode\/guides\/:lessonId\/progress/);
    assert.match(learningRoutes, /ApiController\.getCourseGuide/);
    assert.match(learningRoutes, /ApiController\.getGuideProgress/);
    assert.match(learningRoutes, /ApiController\.saveGuideProgress/);
  } finally {
    BduIdentityService.resolveVerifiedMssv = originalResolveVerifiedMssv;
    GuideService.getGuide = originalGuideGetGuide;
    GuideService.getProgress = originalGuideGetProgress;
    GuideService.saveProgress = originalGuideSaveProgress;
  }

  console.log('✓ GuideController: 200/403/400 map đúng status service; 3 route guide đã đăng ký.');
} finally {
  await query('DELETE FROM guide_step_progress WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM course_guide_configs WHERE course_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]).catch(() => {});
  await query('DELETE FROM students WHERE mssv IN ($1, $2)', [VIEWER, OUTSIDER]).catch(() => {});
  await query('DELETE FROM courses WHERE normalized_code IN ($1, $2)', [COURSE_CODE, EMPTY_COURSE_CODE]).catch(() => {});
  await closeDatabase();
}
