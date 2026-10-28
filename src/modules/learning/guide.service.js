import { isDatabaseConfigured, query, transaction } from '../../db/database.js';
import { findAccessibleCourse, normalizeCourseCode } from '../../services/learning.service.js';
import { parseLabResult } from './lab-result.js';

const KNOWN_STEPS = {
  'bai-1': ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7']
};

// Yêu cầu "sạch" trước khi được đánh dấu hoàn thành (done=true):
// - folderInput/resultInput: bước thu thập dữ liệu (không chặn done).
// - requiresResult: cần dòng BDU-LAB-V1: đã lưu (cùng progress_version).
// - requiresDirectory: cần thư mục làm bài đã nhập (cùng progress_version).
export const STEP_REQUIREMENTS = {
  'bai-1': {
    'buoc-1': { folderInput: true },
    'buoc-2': { resultInput: true },
    'buoc-3': { requiresResult: true },
    'buoc-4': { requiresResult: true, requiresDirectory: true },
    'buoc-5': { requiresResult: true },
    'buoc-6': { requiresResult: true },
    'buoc-7': {}
  }
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
      `SELECT lesson_id, step_id, is_done, progress_version
       FROM guide_step_progress
       WHERE mssv = $1 AND course_code = $2 AND is_done = TRUE;`,
      [cleanMssv, cleanCourseCode]
    );
    const versionByLesson = new Map(lessons.map((row) => [row.lesson_id, row.progress_version]));
    const doneByLesson = new Map();
    for (const row of progressResult.rows) {
      if (versionByLesson.get(row.lesson_id) !== row.progress_version) continue;
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
    const lesson = registry.find((row) => row.lesson_id === cleanLessonId);
    if (!lesson) {
      throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
    }
    const allowedSteps = new Set(KNOWN_STEPS[cleanLessonId] || []);

    const result = await query(
      `SELECT step_id, is_done, workdir
       FROM guide_step_progress
       WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND progress_version = $4
       ORDER BY updated_at DESC;`,
      [cleanMssv, cleanCourseCode, cleanLessonId, lesson.progress_version]
    );
    const steps = {};
    let workdir = null;
    for (const row of result.rows) {
      if (!allowedSteps.has(row.step_id)) continue;
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
      const lesson = registry.find((row) => row.lesson_id === cleanLessonId);
      if (!lesson) {
        throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
      }

      if (input.done === true) {
        const requirements = (STEP_REQUIREMENTS[cleanLessonId] || {})[cleanStepId] || {};
        if (requirements.requiresResult) {
          const labResult = await client.query(
            `SELECT 1 FROM guide_lab_results
              WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND progress_version = $4;`,
            [cleanMssv, cleanCourseCode, cleanLessonId, lesson.progress_version]
          );
          if (labResult.rows.length === 0) {
            throw httpError(
              'Bước này cần key lab (dòng BDU-LAB-V1:) đã lưu. Hãy dán dòng kết quả ở bước 2 rồi thử lại.',
              400,
              'GUIDE_STEP_NOT_CLEAN'
            );
          }
        }
        if (requirements.requiresDirectory) {
          const workdirResult = await client.query(
            `SELECT 1 FROM guide_step_progress
              WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3
                AND progress_version = $4 AND workdir <> ''
              LIMIT 1;`,
            [cleanMssv, cleanCourseCode, cleanLessonId, lesson.progress_version]
          );
          if (cleanWorkdir === '' && workdirResult.rows.length === 0) {
            throw httpError(
              'Bước này cần thư mục làm bài đã nhập. Hãy nhập thư mục ở bước 1 rồi thử lại.',
              400,
              'GUIDE_STEP_NOT_CLEAN'
            );
          }
        }
      }

      await client.query(
        `INSERT INTO guide_step_progress
           (mssv, course_code, lesson_id, step_id, is_done, workdir, progress_version, completed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW())
         ON CONFLICT (mssv, course_code, lesson_id, step_id)
         DO UPDATE SET is_done = EXCLUDED.is_done,
                       workdir = EXCLUDED.workdir,
                       progress_version = EXCLUDED.progress_version,
                       completed_at = CASE WHEN EXCLUDED.is_done THEN NOW() ELSE NULL END,
                       updated_at = NOW();`,
        [cleanMssv, cleanCourseCode, cleanLessonId, cleanStepId, input.done, cleanWorkdir, lesson.progress_version]
      );
      return { stepId: cleanStepId, done: input.done, workdir: cleanWorkdir };
    });
  },

  async getLabResult(mssv, courseCode, lessonId) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const cleanCourseCode = normalizeCourseCode(course.normalized_code || courseCode);
    const cleanLessonId = normalizeLessonId(lessonId);

    const registry = await loadRegistry(cleanCourseCode);
    const lesson = registry.find((row) => row.lesson_id === cleanLessonId);
    if (!lesson) {
      throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
    }

    const result = await query(
      `SELECT status, region, fe_ip, be_ip, db_endpoint, fe_key_path, be_key_path, token
         FROM guide_lab_results
        WHERE mssv = $1 AND course_code = $2 AND lesson_id = $3 AND progress_version = $4;`,
      [cleanMssv, cleanCourseCode, cleanLessonId, lesson.progress_version]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      STATUS: row.status,
      REGION: row.region,
      FE_IP: row.fe_ip,
      BE_IP: row.be_ip,
      DB_ENDPOINT: row.db_endpoint,
      FE_KEY_PATH: row.fe_key_path,
      BE_KEY_PATH: row.be_key_path,
      token: row.token
    };
  },

  async saveLabResult(mssv, courseCode, lessonId, input = {}) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const cleanCourseCode = normalizeCourseCode(course.normalized_code || courseCode);
    const cleanLessonId = normalizeLessonId(lessonId);

    const registry = await loadRegistry(cleanCourseCode);
    const lesson = registry.find((row) => row.lesson_id === cleanLessonId);
    if (!lesson) {
      throw httpError('Bài hướng dẫn không tồn tại trong môn học này.', 404, 'GUIDE_LESSON_NOT_FOUND');
    }

    const rawToken = input && typeof input === 'object' && !Array.isArray(input) ? input.token : undefined;
    let parsed;
    try {
      parsed = parseLabResult(rawToken);
    } catch (err) {
      throw httpError(err.message, 400, 'GUIDE_LAB_RESULT_INVALID');
    }

    await query(
      `INSERT INTO guide_lab_results
         (mssv, course_code, lesson_id, status, region, fe_ip, be_ip,
          db_endpoint, fe_key_path, be_key_path, token, progress_version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (mssv, course_code, lesson_id)
       DO UPDATE SET status = EXCLUDED.status,
                     region = EXCLUDED.region,
                     fe_ip = EXCLUDED.fe_ip,
                     be_ip = EXCLUDED.be_ip,
                     db_endpoint = EXCLUDED.db_endpoint,
                     fe_key_path = EXCLUDED.fe_key_path,
                     be_key_path = EXCLUDED.be_key_path,
                     token = EXCLUDED.token,
                     progress_version = EXCLUDED.progress_version,
                     updated_at = NOW();`,
      [
        cleanMssv,
        cleanCourseCode,
        cleanLessonId,
        parsed.STATUS,
        parsed.REGION,
        parsed.FE_IP,
        parsed.BE_IP,
        parsed.DB_ENDPOINT,
        parsed.FE_KEY_PATH,
        parsed.BE_KEY_PATH,
        parsed.token,
        lesson.progress_version
      ]
    );
    return parsed;
  }
};
