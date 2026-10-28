import { isDatabaseConfigured, query, transaction } from '../../db/database.js';
import { findAccessibleCourse, normalizeCourseCode } from '../../services/learning.service.js';

const KNOWN_STEPS = {
  'bai-1': ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7']
};
const STEP_ID_PATTERN = /^buoc-[a-z0-9-]+$/;
const LESSON_ID_PATTERN = /^[a-z0-9-]+$/;
const WORKDIR_PATTERN = /^[A-Za-z]:\\/;
const MAX_WORKDIR_LENGTH = 260;

function httpError(message, status = 400, code = null, errors = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (errors) error.errors = errors;
  return error;
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function requireDatabase() {
  if (!isDatabaseConfigured()) {
    throw httpError('Hướng dẫn học tập cần PostgreSQL nhưng DATABASE_URL chưa được cấu hình.', 503);
  }
}

function normalizeLessonId(value) {
  const clean = String(value ?? '').trim().toLowerCase();
  if (!LESSON_ID_PATTERN.test(clean)) {
    throw httpError('Bài học không hợp lệ.', 400, 'GUIDE_LESSON_INVALID');
  }
  return clean;
}

function normalizeStepId(lessonId, value) {
  const clean = String(value ?? '').trim().toLowerCase();
  const allowed = KNOWN_STEPS[lessonId] || [];
  if (!STEP_ID_PATTERN.test(clean) || !allowed.includes(clean)) {
    throw httpError('Bước hướng dẫn không hợp lệ.', 400, 'GUIDE_STEP_INVALID');
  }
  return clean;
}

function normalizeWorkdir(value) {
  if (value === undefined || value === null) return '';
  const clean = String(value).trim();
  if (!clean) return '';
  if (clean.length > MAX_WORKDIR_LENGTH || !WORKDIR_PATTERN.test(clean)) {
    throw httpError(
      'Thư mục làm bài phải dạng ổ Windows (ví dụ C:\\lab1) và tối đa 260 ký tự.',
      400,
      'GUIDE_WORKDIR_INVALID'
    );
  }
  return clean;
}

async function loadRegistry(courseCode, db = { query }) {
  const result = await db.query(
    `SELECT course_code, lesson_id, title, enabled, progress_version
     FROM course_guide_configs
     WHERE course_code = $1
     ORDER BY lesson_id;`,
    [courseCode]
  );
  return result.rows;
}

export const GuideService = {
  async getGuide(mssv, courseCode) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const cleanCourseCode = normalizeCourseCode(course.normalized_code || courseCode);

    const rows = await loadRegistry(cleanCourseCode);
    const lessons = rows.filter((row) => row.enabled);
    if (lessons.length === 0) return { enabled: false, lessons: [] };

    const progressResult = await query(
      `SELECT lesson_id, step_id, is_done
       FROM guide_step_progress
       WHERE mssv = $1 AND course_code = $2 AND is_done = TRUE;`,
      [cleanMssv, cleanCourseCode]
    );
    const doneByLesson = new Map();
    for (const row of progressResult.rows) {
      const allowed = new Set(KNOWN_STEPS[row.lesson_id] || []);
      if (!allowed.has(row.step_id)) continue;
      doneByLesson.set(row.lesson_id, (doneByLesson.get(row.lesson_id) || 0) + 1);
    }

    return {
      enabled: true,
      lessons: lessons.map((row) => ({
        id: row.lesson_id,
        title: row.title,
        progressVersion: row.progress_version,
        stepIds: [...(KNOWN_STEPS[row.lesson_id] || [])],
        doneCount: doneByLesson.get(row.lesson_id) || 0
      }))
    };
  },

  async getProgress(mssv, courseCode, lessonId) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const cleanCourseCode = normalizeCourseCode(course.normalized_code || courseCode);
    const cleanLessonId = normalizeLessonId(lessonId);

    const registry = await loadRegistry(cleanCourseCode);
    if (!registry.some((row) => row.lesson_id === cleanLessonId)) {
      throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
    }

    const result = await query(
      `SELECT step_id, is_done, workdir
       FROM guide_step_progress
       WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3
       ORDER BY updated_at DESC;`,
      [cleanMssv, cleanCourseCode, cleanLessonId]
    );
    const steps = {};
    let workdir = null;
    for (const row of result.rows) {
      steps[row.step_id] = { done: row.is_done === true, workdir: row.workdir ?? '' };
      if (workdir === null && row.workdir) workdir = row.workdir;
    }
    return { steps, workdir };
  },

  async saveProgress(mssv, courseCode, lessonId, input = {}) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw httpError('Dữ liệu tiến độ không hợp lệ.', 400, 'GUIDE_STEP_INVALID');
    }
    if (typeof input.done !== 'boolean') {
      throw httpError('Trạng thái hoàn thành phải là boolean.', 400, 'GUIDE_DONE_INVALID');
    }
    const cleanLessonId = normalizeLessonId(lessonId);
    const cleanStepId = normalizeStepId(cleanLessonId, input.stepId);
    const cleanWorkdir = normalizeWorkdir(input.workdir);

    return transaction(async (client) => {
      const course = await findAccessibleCourse(cleanMssv, courseCode, client);
      const cleanCourseCode = normalizeCourseCode(course.normalized_code || courseCode);
      const registry = await loadRegistry(cleanCourseCode, client);
      if (!registry.some((row) => row.lesson_id === cleanLessonId)) {
        throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
      }

      await client.query(
        `INSERT INTO guide_step_progress
           (mssv, course_code, lesson_id, step_id, is_done, workdir, completed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW())
         ON CONFLICT (mssv, course_code, lesson_id, step_id)
         DO UPDATE SET is_done = EXCLUDED.is_done,
                       workdir = EXCLUDED.workdir,
                       completed_at = CASE WHEN EXCLUDED.is_done THEN NOW() ELSE NULL END,
                       updated_at = NOW();`,
        [cleanMssv, cleanCourseCode, cleanLessonId, cleanStepId, input.done, cleanWorkdir]
      );
      return { stepId: cleanStepId, done: input.done, workdir: cleanWorkdir };
    });
  }
};
