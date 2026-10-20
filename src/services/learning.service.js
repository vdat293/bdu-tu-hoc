import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { detectSupportedResourceSource, parseDriveOrMediaUrl } from './community.service.js';
import { IdentityPresentationService } from './identity-presentation.service.js';
import { PermissionService } from './permission.service.js';
import {
  QUIZ_MAX_BYTES,
  gradeQuizResponse,
  gradeQuizResponses,
  normalizeQuiz,
  publicQuizQuestions
} from '../utils/quiz-data.js';

const POST_KINDS = new Set(['request', 'document', 'video', 'link', 'quiz']);
const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 2000;
// Giới hạn số câu trả lời mỗi lần lưu và số entry lưu được (§6.7).
const QUIZ_MAX_RESPONSES = 100;

function httpError(message, status = 400, code = null, errors = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (errors) error.errors = errors;
  return error;
}

export function normalizeCourseCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function normalizeRecordId(value) {
  const clean = String(value ?? '').trim();
  if (!/^\d+$/.test(clean) || clean === '0') return null;
  try {
    return BigInt(clean) <= 9223372036854775807n ? clean : null;
  } catch {
    return null;
  }
}

function getGradeSemesters(payload) {
  const root = payload?.data ?? payload;
  if (Array.isArray(root?.ds_diem_hocky)) {
    return { detected: true, semesters: root.ds_diem_hocky };
  }
  if (Array.isArray(root)) {
    return { detected: true, semesters: root };
  }
  return { detected: false, semesters: [] };
}

export function isCourseFailed(subject) {
  const result = String(subject?.dat_hp ?? subject?.ket_qua ?? '').trim().toLowerCase();
  if (result) {
    if (new Set(['0', 'false', 'không đạt', 'khong dat', 'rot', 'rớt', 'fail', 'failed']).has(result)) {
      return true;
    }
    if (new Set(['1', 'true', 'đạt', 'dat', 'pass', 'passed']).has(result)) {
      return false;
    }
  }
  const letter = String(subject?.diem_tk_chu ?? subject?.diem_chu_hp_4 ?? subject?.diem_chu ?? '').trim().toUpperCase();
  if (['F', 'F+', 'I', 'X'].includes(letter)) {
    return true;
  }
  const grade4 = Number(String(subject?.diem_tk_so ?? subject?.diem_hp_4 ?? '').replace(',', '.'));
  if (Number.isFinite(grade4) && grade4 >= 0 && grade4 < 1.0) {
    return true;
  }
  const grade10 = Number(String(subject?.diem_tk ?? subject?.diem_hp ?? '').replace(',', '.'));
  if (Number.isFinite(grade10) && grade10 >= 0 && grade10 < 4.0) {
    return true;
  }
  return false;
}

/**
 * Chỉ trích xuất mã/tên môn và trạng thái có điểm từ payload thật của BDU.
 * Không thêm danh mục mặc định và không đoán mã môn từ tên.
 */
export function extractCoursesFromBduGrades(payload) {
  const { detected, semesters } = getGradeSemesters(payload);
  if (!detected) {
    throw httpError('Không nhận diện được danh sách học phần trong phản hồi BDU.', 502);
  }

  const courseCatalog = new Map();
  const enrollments = [];
  let hasFailedCourse = false;

  semesters.forEach((semester) => {
    const semesterCode = cleanText(
      semester?.hoc_ky ?? semester?.ma_hoc_ky ?? semester?.semester_code,
      32
    );
    const semesterName = cleanText(
      semester?.ten_hoc_ky ?? semester?.semester_name ?? semesterCode,
      180
    );
    const subjects = Array.isArray(semester?.ds_diem_mon_hoc)
      ? semester.ds_diem_mon_hoc
      : [];

    // Một enrollment không có mã học kỳ thật không được ghi DB, vì tự tạo mã
    // thay thế sẽ làm sai mapping giữa các lần học/lần học lại.
    if (!semesterCode) return;

    subjects.forEach((subject) => {
      if (isCourseFailed(subject)) {
        hasFailedCourse = true;
      }
      const displayCode = cleanText(
        subject?.ma_mon ?? subject?.ma_mon_hoc ?? subject?.ma_hp,
        64
      );
      const normalizedCode = normalizeCourseCode(displayCode);
      const name = cleanText(
        subject?.ten_mon ?? subject?.ten_mon_hoc ?? subject?.ten_hp,
        500
      );
      if (!normalizedCode || !name) return;

      // BDU trả học kỳ mới nhất trước; giữ tên đầu tiên làm tên mới nhất.
      if (!courseCatalog.has(normalizedCode)) {
        courseCatalog.set(normalizedCode, { normalizedCode, displayCode, name });
      }

      const hasFinalGrade = [
        subject?.diem_tk,
        subject?.diem_tk_so,
        subject?.diem_tk_chu
      ].some(hasValue);

      enrollments.push({
        normalizedCode,
        semesterCode,
        semesterName,
        hasFinalGrade
      });
    });
  });

  return {
    courses: [...courseCatalog.values()],
    enrollments,
    hasFailedCourse
  };
}

function requireDatabase() {
  if (!isDatabaseConfigured()) {
    throw httpError('Kho học tập cần PostgreSQL nhưng DATABASE_URL chưa được cấu hình.', 503);
  }
}

async function findAccessibleCourse(mssv, courseCode, db = { query }) {
  const normalizedCode = normalizeCourseCode(courseCode);
  if (!normalizedCode) throw httpError('Mã môn học không hợp lệ.');

  const result = await db.query(`
    SELECT c.id, c.normalized_code, c.display_code, c.name
    FROM courses c
    JOIN student_courses sc ON sc.course_id = c.id
    JOIN students s ON s.mssv = sc.mssv
    WHERE sc.mssv = $1
      AND c.normalized_code = $2
      AND s.course_synced_at IS NOT NULL
      AND sc.last_seen_at = s.course_synced_at
    LIMIT 1;
  `, [mssv, normalizedCode]);

  if (!result.rows.length) {
    throw httpError('Môn học này không có trong dữ liệu học phần BDU của bạn.', 403);
  }
  return result.rows[0];
}

async function findAccessibleCoursePost(mssv, courseCode, postId, db = { query }) {
  const cleanPostId = normalizeRecordId(postId);
  if (!cleanPostId) throw httpError('Bài viết không hợp lệ.');
  const course = await findAccessibleCourse(mssv, courseCode, db);
  const result = await db.query(`
    SELECT id, course_id, author_mssv, kind, like_count, comment_count
    FROM course_posts
    WHERE id = $1 AND course_id = $2
    LIMIT 1;
  `, [cleanPostId, course.id]);
  if (!result.rows.length) throw httpError('Không tìm thấy bài viết trong môn học này.', 404);
  return { course, post: result.rows[0], postId: cleanPostId };
}

function mapPost(row, viewerMssv) {
  const isAnonymous = Boolean(row.is_anonymous);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    attachments: row.attachments || [],
    status: row.status,
    is_anonymous: isAnonymous,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    is_liked: Boolean(row.is_liked_by_viewer),
    quiz: row.kind === 'quiz' && row.quiz_question_count != null
      ? {
          question_count: Number(row.quiz_question_count),
          time_limit_seconds: Number(row.quiz_time_limit_seconds || 0),
          progress: row.quiz_answered == null ? null : {
            answered: Number(row.quiz_answered || 0),
            correct_count: Number(row.quiz_correct_count || 0),
            best_correct: row.quiz_best_correct == null ? null : Number(row.quiz_best_correct),
            best_total: row.quiz_best_total == null ? null : Number(row.quiz_best_total),
            attempts: Number(row.quiz_attempts || 0),
            completed_at: row.quiz_completed_at || null
          }
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_mine: row.author_mssv === viewerMssv,
    author: {
      mssv: isAnonymous ? null : row.author_mssv,
      name: isAnonymous ? 'Sinh viên giấu tên' : (row.author_name || row.author_mssv),
      is_anonymous: isAnonymous
    }
  };
}

function mapCourseComment(row, viewerMssv) {
  return {
    id: row.id,
    post_id: row.post_id,
    parent_id: row.parent_id,
    content: row.content,
    created_at: row.created_at,
    is_mine: row.author_mssv === viewerMssv,
    author: {
      mssv: row.author_mssv,
      name: row.author_name || row.author_mssv
    }
  };
}

async function enrichCourseIdentities(records) {
  const presentations = await IdentityPresentationService.getPresentations(
    records.map((record) => record.author?.mssv)
  );
  return records.map((record) => {
    const presentation = presentations.get(record.author?.mssv);
    if (!presentation || record.author?.is_anonymous) return record;
    return {
      ...record,
      author: {
        ...record.author,
        photo_url: presentation.avatar_url,
        avatar_source: presentation.avatar_source,
        titles: presentation.selected_titles
      }
    };
  });
}

/**
 * Đọc đề quiz + tiến độ của viewer. Chỉ dùng nội bộ service để mọi endpoint
 * quiz lấy chung một snapshot đã xác thực quyền vào môn và loại bài.
 * remaining_seconds tính bằng NOW() của PostgreSQL (§6.8), không dùng giờ Node.
 */
async function loadQuizContext(mssv, courseCode, postId, db = { query }) {
  let accessible;
  try {
    accessible = await findAccessibleCoursePost(mssv, courseCode, postId, db);
  } catch (err) {
    // Bài không tồn tại/không thuộc môn với endpoint quiz đều là QUIZ_NOT_FOUND;
    // lỗi 403 (không có quyền vào môn) và 400 (input sai) giữ nguyên.
    if (err.status === 404) {
      throw httpError('Không tìm thấy bài trắc nghiệm trong môn học này.', 404, 'QUIZ_NOT_FOUND');
    }
    throw err;
  }
  if (accessible.post.kind !== 'quiz') {
    throw httpError('Không tìm thấy bài trắc nghiệm trong môn học này.', 404, 'QUIZ_NOT_FOUND');
  }

  const result = await db.query(`
    SELECT
      cp.*,
      s.full_name AS author_name,
      (viewer_like.post_id IS NOT NULL) AS is_liked_by_viewer,
      cq.questions,
      cq.question_count,
      cq.time_limit_seconds,
      qp.started_at,
      qp.answered,
      qp.correct_count,
      qp.total_count,
      qp.best_correct,
      qp.best_total,
      qp.attempts,
      qp.responses,
      qp.completed_at,
      CASE
        WHEN cq.time_limit_seconds = 0 THEN NULL
        WHEN qp.completed_at IS NOT NULL THEN 0
        WHEN qp.started_at IS NULL THEN cq.time_limit_seconds
        ELSE GREATEST(
          0,
          cq.time_limit_seconds - FLOOR(EXTRACT(EPOCH FROM (NOW() - qp.started_at)))
        )::int
      END AS remaining_seconds
    FROM course_posts cp
    JOIN students s ON s.mssv = cp.author_mssv
    JOIN course_quizzes cq ON cq.post_id = cp.id
    LEFT JOIN course_post_likes viewer_like
      ON viewer_like.post_id = cp.id AND viewer_like.mssv = $2
    LEFT JOIN course_quiz_progress qp
      ON qp.post_id = cp.id AND qp.mssv = $2
    WHERE cp.id = $1 AND cp.course_id = $3
    LIMIT 1;
  `, [accessible.postId, mssv, accessible.course.id]);

  const row = result.rows[0];
  if (!row) {
    throw httpError('Không tìm thấy bài trắc nghiệm trong môn học này.', 404, 'QUIZ_NOT_FOUND');
  }

  const questions = Array.isArray(row.questions) ? row.questions : [];
  const timeLimitSeconds = Number(row.time_limit_seconds || 0);
  const startedAt = row.started_at || null;
  const completedAt = row.completed_at || null;
  const remaining = row.remaining_seconds == null ? null : Number(row.remaining_seconds);
  const answered = Number(row.answered || 0);
  const correctCount = Number(row.correct_count || 0);
  const totalCount = Number(row.total_count || 0);
  const bestCorrect = row.best_correct == null ? null : Number(row.best_correct);
  const bestTotal = row.best_total == null ? null : Number(row.best_total);
  const attempts = Number(row.attempts || 0);

  return {
    course: accessible.course,
    post: mapPost({
      ...row,
      quiz_question_count: row.question_count,
      quiz_time_limit_seconds: timeLimitSeconds,
      quiz_answered: startedAt ? answered : null,
      quiz_correct_count: correctCount,
      quiz_best_correct: bestCorrect,
      quiz_best_total: bestTotal,
      quiz_attempts: attempts,
      quiz_completed_at: completedAt
    }, mssv),
    quiz: {
      questions,
      question_count: Number(row.question_count || 0),
      time_limit_seconds: timeLimitSeconds,
      started_at: startedAt,
      answered,
      correct_count: correctCount,
      total_count: totalCount,
      best_correct: bestCorrect,
      best_total: bestTotal,
      attempts,
      responses: Array.isArray(row.responses) ? row.responses : [],
      completed_at: completedAt,
      remaining_seconds: remaining,
      expired: !completedAt && timeLimitSeconds > 0 && remaining === 0
    }
  };
}

function readQuizByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return null;
  }
}

async function createCourseQuizPost(mssv, course, input) {
  if (!(await PermissionService.can(mssv, 'ttcds:access'))) {
    throw httpError(
      'Chỉ thành viên có danh hiệu #TTCDS mới được tạo bài trắc nghiệm.',
      403,
      'TTCDS_FORBIDDEN'
    );
  }

  const byteLength = readQuizByteLength(input.quiz);
  if (byteLength === null || byteLength > QUIZ_MAX_BYTES) {
    throw httpError('Dữ liệu trắc nghiệm vượt quá 256 KB.', 400, 'QUIZ_INVALID', [
      { path: '$', message: 'JSON vượt quá 256 KB.' }
    ]);
  }

  const normalized = normalizeQuiz(input.quiz);
  if (!normalized.ok) {
    throw httpError('Dữ liệu trắc nghiệm không hợp lệ.', 400, 'QUIZ_INVALID', normalized.errors);
  }

  const quiz = normalized.quiz;
  const title = cleanText(input.title, MAX_TITLE_LENGTH) || quiz.title || '';
  if (!title) {
    throw httpError('Tiêu đề không được để trống.', 400, 'QUIZ_INVALID', [
      { path: '$.title', message: 'Cần tiêu đề bài đăng hoặc title trong JSON.' }
    ]);
  }
  const content = cleanText(input.content, MAX_CONTENT_LENGTH) || quiz.description || '';

  const created = await transaction(async (client) => {
    const inserted = await client.query(`
      INSERT INTO course_posts (
        course_id, author_mssv, kind, title, content, attachments, is_anonymous
      )
      VALUES ($1, $2, 'quiz', $3, $4, '[]'::jsonb, FALSE)
      RETURNING *;
    `, [course.id, mssv, title, content]);

    const postRow = inserted.rows[0];
    await client.query(`
      INSERT INTO course_quizzes (
        post_id, schema_version, questions, question_count, time_limit_seconds
      )
      VALUES ($1, 1, $2::jsonb, $3, $4);
    `, [postRow.id, JSON.stringify(quiz.questions), quiz.questions.length, quiz.timeLimitSeconds]);

    return postRow;
  });

  const student = await query('SELECT full_name FROM students WHERE mssv = $1', [mssv]);
  const post = mapPost({
    ...created,
    author_name: student.rows[0]?.full_name,
    quiz_question_count: quiz.questions.length,
    quiz_time_limit_seconds: quiz.timeLimitSeconds,
    quiz_answered: null
  }, mssv);
  return (await enrichCourseIdentities([post]))[0];
}

export const LearningService = {
  hasDatabase() {
    return isDatabaseConfigured();
  },

  async syncStudentCourses(mssv, gradePayload) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    if (!cleanMssv) throw httpError('Không xác định được MSSV để đồng bộ học phần.', 401);

    const extracted = extractCoursesFromBduGrades(gradePayload);
    const syncTime = new Date();

    await transaction(async (client) => {
      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', TRUE)
        ON CONFLICT (mssv) DO UPDATE SET
          is_active = TRUE,
          updated_at = NOW();
      `, [cleanMssv]);

      const courseIds = new Map();
      for (const course of extracted.courses) {
        const result = await client.query(`
          INSERT INTO courses (normalized_code, display_code, name)
          VALUES ($1, $2, $3)
          ON CONFLICT (normalized_code) DO UPDATE SET
            display_code = EXCLUDED.display_code,
            name = EXCLUDED.name,
            updated_at = NOW()
          RETURNING id;
        `, [course.normalizedCode, course.displayCode, course.name]);
        courseIds.set(course.normalizedCode, result.rows[0].id);
      }

      for (const enrollment of extracted.enrollments) {
        const courseId = courseIds.get(enrollment.normalizedCode);
        if (!courseId) continue;
        await client.query(`
          INSERT INTO student_courses (
            mssv, course_id, semester_code, semester_name,
            has_final_grade, last_seen_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (mssv, course_id, semester_code) DO UPDATE SET
            semester_name = EXCLUDED.semester_name,
            has_final_grade = EXCLUDED.has_final_grade,
            last_seen_at = EXCLUDED.last_seen_at,
            updated_at = NOW();
        `, [
          cleanMssv,
          courseId,
          enrollment.semesterCode,
          enrollment.semesterName || null,
          enrollment.hasFinalGrade,
          syncTime
        ]);
      }

      await client.query(`
        UPDATE students
        SET course_synced_at = $2,
            has_failed_course = CASE WHEN $3 = TRUE THEN TRUE ELSE has_failed_course END,
            updated_at = NOW()
        WHERE mssv = $1;
      `, [cleanMssv, syncTime, Boolean(extracted.hasFailedCourse)]);
    });

    return {
      courseCount: extracted.courses.length,
      enrollmentCount: extracted.enrollments.length,
      syncedAt: syncTime.toISOString()
    };
  },

  async getStudentCourses(mssv) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const [result, studentResult] = await Promise.all([
      query(`
      SELECT
        c.normalized_code AS code,
        c.display_code,
        c.name,
        BOOL_OR(NOT sc.has_final_grade) AS is_studying,
        BOOL_OR(sc.has_final_grade) AS has_final_grade,
        ARRAY_AGG(DISTINCT sc.semester_code ORDER BY sc.semester_code DESC) AS semester_codes,
        ARRAY_AGG(DISTINCT COALESCE(sc.semester_name, sc.semester_code)) AS semester_names,
        COUNT(DISTINCT cp.id) FILTER (WHERE cp.kind = 'request' AND cp.status = 'open')::int AS request_count,
        COUNT(DISTINCT cp.id) FILTER (WHERE cp.kind IN ('document', 'video', 'link'))::int AS resource_count,
        COUNT(DISTINCT cp.id)::int AS post_count,
        (
          SELECT COALESCE(
            JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'code', sc_semester.semester_code,
                'name', COALESCE(sc_semester.semester_name, sc_semester.semester_code),
                'has_final_grade', sc_semester.has_final_grade
              )
              ORDER BY sc_semester.semester_code DESC
            ),
            '[]'::jsonb
          )
          FROM student_courses sc_semester
          WHERE sc_semester.mssv = s.mssv
            AND sc_semester.course_id = c.id
            AND sc_semester.last_seen_at = s.course_synced_at
        ) AS semesters,
        MAX(s.course_synced_at) AS synced_at
      FROM students s
      JOIN student_courses sc
        ON sc.mssv = s.mssv AND sc.last_seen_at = s.course_synced_at
      JOIN courses c ON c.id = sc.course_id
      LEFT JOIN course_posts cp ON cp.course_id = c.id
      WHERE s.mssv = $1
      GROUP BY c.id, s.mssv, s.course_synced_at
      ORDER BY BOOL_OR(NOT sc.has_final_grade) DESC, c.name ASC;
      `, [cleanMssv]),
      query('SELECT course_synced_at FROM students WHERE mssv = $1', [cleanMssv])
    ]);

    return {
      courses: result.rows.map((row) => ({
        code: row.code,
        display_code: row.display_code,
        name: row.name,
        is_studying: row.is_studying,
        has_final_grade: row.has_final_grade,
        semester_codes: row.semester_codes || [],
        semester_names: row.semester_names || [],
        semesters: row.semesters || [],
        request_count: Number(row.request_count || 0),
        resource_count: Number(row.resource_count || 0),
        post_count: Number(row.post_count || 0)
      })),
      synced_at: studentResult.rows[0]?.course_synced_at || null
    };
  },

  async getCoursePosts(mssv, courseCode) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const result = await query(`
      SELECT
        cp.*,
        s.full_name AS author_name,
        (viewer_like.post_id IS NOT NULL) AS is_liked_by_viewer,
        cq.question_count AS quiz_question_count,
        cq.time_limit_seconds AS quiz_time_limit_seconds,
        qp.answered AS quiz_answered,
        qp.correct_count AS quiz_correct_count,
        qp.best_correct AS quiz_best_correct,
        qp.best_total AS quiz_best_total,
        qp.attempts AS quiz_attempts,
        qp.completed_at AS quiz_completed_at
      FROM course_posts cp
      JOIN students s ON s.mssv = cp.author_mssv
      LEFT JOIN course_post_likes viewer_like
        ON viewer_like.post_id = cp.id AND viewer_like.mssv = $2
      LEFT JOIN course_quizzes cq ON cq.post_id = cp.id
      LEFT JOIN course_quiz_progress qp
        ON qp.post_id = cp.id AND qp.mssv = $2
      WHERE cp.course_id = $1
      ORDER BY cp.created_at DESC
      LIMIT 100;
    `, [course.id, cleanMssv]);

    const posts = await enrichCourseIdentities(result.rows.map((row) => mapPost(row, cleanMssv)));
    return {
      course: {
        code: course.normalized_code,
        display_code: course.display_code,
        name: course.name
      },
      posts
    };
  },

  async startCourseQuiz(mssv, courseCode, postId, options = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const restart = options?.restart === true;

    return transaction(async (client) => {
      // loadQuizContext xác thực quyền vào môn, loại bài và trả time limit.
      const context = await loadQuizContext(cleanMssv, courseCode, postId, client);
      const progressPostId = context.post.id;
      const timeLimitSeconds = context.quiz.time_limit_seconds;

      // ON CONFLICT để hai tab bấm "Bắt đầu" cùng lúc không tạo hai dòng.
      const inserted = await client.query(`
        INSERT INTO course_quiz_progress (mssv, post_id, started_at, responses)
        VALUES ($1, $2, NOW(), '[]'::jsonb)
        ON CONFLICT (mssv, post_id) DO NOTHING
        RETURNING mssv;
      `, [cleanMssv, progressPostId]);

      let progress = (await client.query(`
        SELECT *
        FROM course_quiz_progress
        WHERE mssv = $1 AND post_id = $2
        FOR UPDATE;
      `, [cleanMssv, progressPostId])).rows[0];

      let restarted = false;
      // Đã có lượt (đang làm dở hoặc đã xong) + restart: reset lượt hiện tại,
      // giữ best/attempts. Lượt vừa được INSERT lần đầu không tính là restart.
      if (restart && inserted.rowCount === 0) {
        progress = (await client.query(`
          UPDATE course_quiz_progress
          SET started_at = NOW(),
              answered = 0,
              correct_count = 0,
              total_count = 0,
              responses = '[]'::jsonb,
              completed_at = NULL,
              updated_at = NOW()
          WHERE mssv = $1 AND post_id = $2
          RETURNING *;
        `, [cleanMssv, progressPostId])).rows[0];
        restarted = true;
      } else if (!progress.started_at) {
        // Dữ liệu bất thường: có dòng nhưng chưa có mốc bắt đầu.
        progress = (await client.query(`
          UPDATE course_quiz_progress
          SET started_at = NOW(), updated_at = NOW()
          WHERE mssv = $1 AND post_id = $2
          RETURNING *;
        `, [cleanMssv, progressPostId])).rows[0];
      }

      // remaining_seconds dùng đồng hồ DB, không dùng giờ Node (§6.8).
      const remainingRow = (await client.query(`
        SELECT
          CASE
            WHEN $3::int = 0 THEN NULL
            WHEN completed_at IS NOT NULL THEN 0
            WHEN started_at IS NULL THEN $3::int
            ELSE GREATEST(
              0,
              $3::int - FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))
            )::int
          END AS remaining_seconds
        FROM course_quiz_progress
        WHERE mssv = $1 AND post_id = $2;
      `, [cleanMssv, progressPostId, timeLimitSeconds])).rows[0];

      const remaining = remainingRow.remaining_seconds == null
        ? null
        : Number(remainingRow.remaining_seconds);

      return {
        started_at: progress.started_at,
        remaining_seconds: remaining,
        expired: !progress.completed_at && timeLimitSeconds > 0 && remaining === 0,
        restarted,
        completed_at: progress.completed_at
      };
    });
  },

  async answerCourseQuiz(mssv, courseCode, postId, input = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const context = await loadQuizContext(cleanMssv, courseCode, postId);
    const quiz = context.quiz;

    // Chỉ chấm khi lượt đang làm: đã start, chưa nộp, chưa hết giờ.
    if (!quiz.started_at) {
      throw httpError('Bạn chưa bắt đầu làm bài trắc nghiệm này.', 409, 'QUIZ_NOT_STARTED');
    }
    if (quiz.completed_at) {
      throw httpError('Bạn đã hoàn thành bài trắc nghiệm này.', 409, 'QUIZ_COMPLETED');
    }
    if (quiz.expired) {
      throw httpError('Đã hết thời gian làm bài trắc nghiệm này.', 409, 'QUIZ_TIME_UP');
    }

    const questionId = String(input?.questionId ?? '').trim();
    const question = quiz.questions.find(
      (item) => String(item?.id ?? '') === questionId
    );
    if (!question) {
      throw httpError('Câu hỏi không thuộc bài trắc nghiệm này.', 400, 'QUIZ_INVALID');
    }

    const response = String(input?.response ?? '').trim().toUpperCase();
    const optionIndex = /^[A-F]$/.test(response) ? response.charCodeAt(0) - 65 : -1;
    const optionCount = Array.isArray(question.options) ? question.options.length : 0;
    if (optionIndex < 0 || optionIndex >= optionCount) {
      const lastOption = optionCount > 0 ? String.fromCharCode(64 + optionCount) : 'A';
      throw httpError(
        `Đáp án phải là một lựa chọn từ A đến ${lastOption}.`,
        400,
        'QUIZ_INVALID'
      );
    }

    return {
      correct: gradeQuizResponse(question, response),
      correct_option: String(question.correct ?? '').trim().toUpperCase(),
      explanation: String(question.explanation ?? ''),
      remaining_seconds: quiz.remaining_seconds
    };
  },

  async saveCourseQuizProgress(mssv, courseCode, postId, input = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const responses = input?.responses;
    if (!Array.isArray(responses) || responses.length > QUIZ_MAX_RESPONSES) {
      throw httpError('Dữ liệu tiến độ trắc nghiệm không hợp lệ.', 400, 'QUIZ_INVALID');
    }
    const wantsCompleted = input?.completed === true;

    return transaction(async (client) => {
      const context = await loadQuizContext(cleanMssv, courseCode, postId, client);
      const progressPostId = context.post.id;
      const timeLimitSeconds = context.quiz.time_limit_seconds;
      const questionCount = context.quiz.question_count;

      // Khóa dòng progress của viewer; remaining_seconds tính bằng đồng hồ DB.
      const progress = (await client.query(`
        SELECT
          qp.*,
          CASE
            WHEN $3::int = 0 THEN NULL
            WHEN qp.completed_at IS NOT NULL THEN 0
            WHEN qp.started_at IS NULL THEN $3::int
            ELSE GREATEST(
              0,
              $3::int - FLOOR(EXTRACT(EPOCH FROM (NOW() - qp.started_at)))
            )::int
          END AS remaining_seconds
        FROM course_quiz_progress qp
        WHERE qp.mssv = $1 AND qp.post_id = $2
        FOR UPDATE;
      `, [cleanMssv, progressPostId, timeLimitSeconds])).rows[0];

      if (!progress || !progress.started_at) {
        throw httpError('Bạn chưa bắt đầu làm bài trắc nghiệm này.', 409, 'QUIZ_NOT_STARTED');
      }

      const remaining = progress.remaining_seconds == null
        ? null
        : Number(progress.remaining_seconds);

      // Lượt đã hoàn thành: trả nguyên trạng, không sửa responses/best/attempts.
      if (progress.completed_at) {
        return {
          answered: Number(progress.answered || 0),
          correct_count: Number(progress.correct_count || 0),
          total_count: Number(progress.total_count || 0),
          best_correct: progress.best_correct == null ? null : Number(progress.best_correct),
          best_total: progress.best_total == null ? null : Number(progress.best_total),
          attempts: Number(progress.attempts || 0),
          completed_at: progress.completed_at,
          remaining_seconds: remaining,
          expired: false,
          already_completed: true
        };
      }

      const expired = timeLimitSeconds > 0 && remaining === 0;

      // Hết giờ: chỉ cho phép nộp chốt từ responses đã lưu. Mọi entry gửi
      // kèm sau deadline đều bị từ chối, kể cả completed:true (§6.7/§7.4).
      if (expired && (!wantsCompleted || responses.length > 0)) {
        throw httpError('Đã hết thời gian làm bài trắc nghiệm này.', 409, 'QUIZ_TIME_UP');
      }

      // Merge: giữ đáp án đã lưu (khóa sau khi trả lời), chỉ thêm id mới còn
      // thuộc quiz và hợp lệ; chấm lại toàn bộ bằng server, bỏ cờ correct client.
      // Sau deadline không merge gì cả, chỉ dùng dữ liệu đã lưu.
      const stored = gradeQuizResponses(context.quiz.questions, progress.responses).entries;
      let merged = stored;
      if (!expired) {
        const seen = new Set(stored.map((entry) => entry.id));
        const additions = responses.filter(
          (entry) => entry && !Array.isArray(entry) && typeof entry === 'object' && !seen.has(entry.id)
        );
        merged = [
          ...stored,
          ...gradeQuizResponses(context.quiz.questions, additions).entries
        ].slice(0, QUIZ_MAX_RESPONSES);
      }

      const answered = merged.length;
      const correctCount = merged.filter((entry) => entry.correct).length;

      if (!wantsCompleted) {
        await client.query(`
          UPDATE course_quiz_progress
          SET answered = $3,
              correct_count = $4,
              total_count = $3,
              responses = $5::jsonb,
              updated_at = NOW()
          WHERE mssv = $1 AND post_id = $2;
        `, [cleanMssv, progressPostId, answered, correctCount, JSON.stringify(merged)]);

        return {
          answered,
          correct_count: correctCount,
          total_count: answered,
          best_correct: progress.best_correct == null ? null : Number(progress.best_correct),
          best_total: progress.best_total == null ? null : Number(progress.best_total),
          attempts: Number(progress.attempts || 0),
          completed_at: null,
          remaining_seconds: remaining,
          expired: false,
          already_completed: false
        };
      }

      // Nộp sớm khi chưa trả lời câu nào bị chặn; hết giờ được phép finalize
      // 0 câu từ dữ liệu đã lưu (§6.7/§7.4).
      if (!expired && answered === 0) {
        throw httpError(
          'Hãy trả lời ít nhất một câu trước khi nộp bài.',
          400,
          'QUIZ_EMPTY_SUBMIT'
        );
      }

      const totalCount = questionCount;
      // Best so theo tỉ lệ bằng phép nhân chéo (tránh sai số float); chỉ đổi
      // khi tốt hơn hẳn hoặc chưa có best trước đó (§6.7 step 7).
      const previousBestCorrect = progress.best_correct == null ? null : Number(progress.best_correct);
      const previousBestTotal = progress.best_total == null ? null : Number(progress.best_total);
      const hasBest = previousBestCorrect != null
        && previousBestTotal != null
        && previousBestTotal > 0;
      const isBetterBest = !hasBest
        || correctCount * previousBestTotal > previousBestCorrect * totalCount;
      const bestCorrect = isBetterBest ? correctCount : previousBestCorrect;
      const bestTotal = isBetterBest ? totalCount : previousBestTotal;
      // attempts chỉ tăng ở lần chuyển sang completed đầu tiên; nhánh
      // completed_at phía trên đã trả sớm nên không bao giờ cộng lặp.
      const attempts = Number(progress.attempts || 0) + 1;

      const completedRow = (await client.query(`
        UPDATE course_quiz_progress
        SET answered = $3,
            correct_count = $4,
            total_count = $5,
            best_correct = $6,
            best_total = $7,
            attempts = $8,
            responses = $9::jsonb,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE mssv = $1 AND post_id = $2
        RETURNING completed_at;
      `, [
        cleanMssv,
        progressPostId,
        answered,
        correctCount,
        totalCount,
        bestCorrect,
        bestTotal,
        attempts,
        JSON.stringify(merged)
      ])).rows[0];

      return {
        answered,
        correct_count: correctCount,
        total_count: totalCount,
        best_correct: bestCorrect,
        best_total: bestTotal,
        attempts,
        completed_at: completedRow.completed_at,
        // §6.8: completed_at khác NULL thì remaining = 0; không giới hạn = null.
        remaining_seconds: timeLimitSeconds > 0 ? 0 : null,
        expired: false,
        already_completed: false
      };
    });
  },

  async getCourseQuiz(mssv, courseCode, postId) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const context = await loadQuizContext(cleanMssv, courseCode, postId);
    const quiz = context.quiz;

    const [post] = await enrichCourseIdentities([context.post]);
    return {
      course: {
        code: context.course.normalized_code,
        display_code: context.course.display_code,
        name: context.course.name
      },
      post,
      quiz: {
        question_count: quiz.question_count,
        time_limit_seconds: quiz.time_limit_seconds,
        // Không bao giờ trả snapshot gốc: chỉ id/câu hỏi/lựa chọn.
        questions: publicQuizQuestions(quiz.questions),
        progress: quiz.started_at
          ? {
              started_at: quiz.started_at,
              answered: quiz.answered,
              correct_count: quiz.correct_count,
              total_count: quiz.total_count,
              best_correct: quiz.best_correct,
              best_total: quiz.best_total,
              attempts: quiz.attempts,
              completed_at: quiz.completed_at,
              responses: quiz.responses
            }
          : null,
        remaining_seconds: quiz.remaining_seconds,
        expired: quiz.expired,
        review: quiz.completed_at
          ? quiz.questions.map((question) => ({
              id: question.id,
              correct: question.correct,
              explanation: question.explanation || ''
            }))
          : null
      }
    };
  },

  async createCoursePost(mssv, courseCode, input = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const kind = String(input.kind || '').trim().toLowerCase();

    if (!POST_KINDS.has(kind)) throw httpError('Loại bài đăng không hợp lệ.');
    if (kind === 'quiz') {
      return createCourseQuizPost(cleanMssv, course, input);
    }

    const title = cleanText(input.title, MAX_TITLE_LENGTH);
    const content = cleanText(input.content, MAX_CONTENT_LENGTH);
    const url = cleanText(input.url, 2048);
    const isAnonymous = kind === 'request' && normalizeBoolean(input.isAnonymous ?? input.is_anonymous);

    if (!title) throw httpError('Tiêu đề không được để trống.');
    if (kind === 'request' && !content) {
      throw httpError('Hãy nhập nội dung bạn muốn luận bàn.');
    }
    if (kind !== 'request' && !url) {
      throw httpError('Hãy cung cấp liên kết tài liệu hoặc video.');
    }

    const attachments = [];
    if (url) {
      if (!detectSupportedResourceSource(url)) {
        throw httpError('Kho tài liệu chỉ hỗ trợ liên kết YouTube, Google Drive hoặc GitHub.');
      }
      const parsed = parseDriveOrMediaUrl(
        url,
        title,
        kind === 'video' ? 'video' : null
      );
      if (!parsed) throw httpError('Liên kết tài liệu hoặc video không hợp lệ.');
      attachments.push(parsed);
    }

    const result = await query(`
      INSERT INTO course_posts (
        course_id, author_mssv, kind, title, content, attachments, is_anonymous
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING *;
    `, [course.id, cleanMssv, kind, title, content, JSON.stringify(attachments), isAnonymous]);

    const student = await query('SELECT full_name FROM students WHERE mssv = $1', [cleanMssv]);
    const post = mapPost({
      ...result.rows[0],
      author_name: student.rows[0]?.full_name
    }, cleanMssv);
    return (await enrichCourseIdentities([post]))[0];
  },

  async deleteCoursePost(mssv, courseCode, postId) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    return transaction(async (client) => {
      const accessible = await findAccessibleCoursePost(cleanMssv, courseCode, postId, client);
      const locked = await client.query(
        'SELECT author_mssv FROM course_posts WHERE id = $1 AND course_id = $2 FOR UPDATE',
        [accessible.postId, accessible.course.id]
      );
      if (locked.rows[0]?.author_mssv !== cleanMssv) {
        throw httpError('Bạn chỉ có thể xóa bài viết của chính mình.', 403);
      }
      await client.query('DELETE FROM course_posts WHERE id = $1', [accessible.postId]);
      return { deleted: true, id: accessible.postId };
    });
  },

  async toggleCoursePostLike(mssv, courseCode, postId) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    return transaction(async (client) => {
      const accessible = await findAccessibleCoursePost(cleanMssv, courseCode, postId, client);
      await client.query('SELECT id FROM course_posts WHERE id = $1 FOR UPDATE', [accessible.postId]);
      const existing = await client.query(
        'SELECT 1 FROM course_post_likes WHERE post_id = $1 AND mssv = $2',
        [accessible.postId, cleanMssv]
      );

      const liked = existing.rowCount === 0;
      if (liked) {
        await client.query(
          'INSERT INTO course_post_likes (post_id, mssv) VALUES ($1, $2)',
          [accessible.postId, cleanMssv]
        );
        await client.query(
          'UPDATE course_posts SET like_count = like_count + 1, updated_at = NOW() WHERE id = $1',
          [accessible.postId]
        );
      } else {
        await client.query(
          'DELETE FROM course_post_likes WHERE post_id = $1 AND mssv = $2',
          [accessible.postId, cleanMssv]
        );
        await client.query(
          'UPDATE course_posts SET like_count = GREATEST(0, like_count - 1), updated_at = NOW() WHERE id = $1',
          [accessible.postId]
        );
      }

      const updated = await client.query('SELECT like_count FROM course_posts WHERE id = $1', [accessible.postId]);
      return { liked, like_count: Number(updated.rows[0]?.like_count || 0) };
    });
  },

  async getCoursePostComments(mssv, courseCode, postId) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const accessible = await findAccessibleCoursePost(cleanMssv, courseCode, postId);
    const result = await query(`
      SELECT comments.*, students.full_name AS author_name
      FROM course_post_comments comments
      JOIN students ON students.mssv = comments.author_mssv
      WHERE comments.post_id = $1
      ORDER BY comments.created_at ASC;
    `, [accessible.postId]);
    return enrichCourseIdentities(result.rows.map((row) => mapCourseComment(row, cleanMssv)));
  },

  async addCoursePostComment(mssv, courseCode, postId, input = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const content = String(input.content || '').trim();
    const parentId = input.parentId ? normalizeRecordId(input.parentId) : null;
    if (!content) throw httpError('Nội dung bình luận không được để trống.');
    if (content.length > MAX_COMMENT_LENGTH) {
      throw httpError(`Bình luận không được vượt quá ${MAX_COMMENT_LENGTH} ký tự.`);
    }
    if (input.parentId && !parentId) throw httpError('Bình luận được trả lời không hợp lệ.');

    return transaction(async (client) => {
      const accessible = await findAccessibleCoursePost(cleanMssv, courseCode, postId, client);
      await client.query('SELECT id FROM course_posts WHERE id = $1 FOR UPDATE', [accessible.postId]);
      if (parentId) {
        const parent = await client.query(
          'SELECT 1 FROM course_post_comments WHERE id = $1 AND post_id = $2',
          [parentId, accessible.postId]
        );
        if (!parent.rows.length) throw httpError('Bình luận được trả lời không tồn tại.');
      }

      const inserted = await client.query(`
        INSERT INTO course_post_comments (post_id, author_mssv, parent_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `, [accessible.postId, cleanMssv, parentId, content]);
      await client.query(
        'UPDATE course_posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = $1',
        [accessible.postId]
      );
      const author = await client.query('SELECT full_name FROM students WHERE mssv = $1', [cleanMssv]);
      const comment = mapCourseComment({
        ...inserted.rows[0],
        author_name: author.rows[0]?.full_name
      }, cleanMssv);
      return (await enrichCourseIdentities([comment]))[0];
    });
  },

  async getCoursePostRealtimeMetadata(mssv, courseCode, postId) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const accessible = await findAccessibleCoursePost(cleanMssv, courseCode, postId);
    return {
      courseCode: accessible.course.normalized_code,
      postId: accessible.postId,
      likeCount: Number(accessible.post.like_count || 0),
      commentCount: Number(accessible.post.comment_count || 0)
    };
  }
};

export const LearningServiceInternals = { getGradeSemesters, hasValue, normalizeBoolean, normalizeRecordId };
