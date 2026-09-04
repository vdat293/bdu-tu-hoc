import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { detectSupportedResourceSource, parseDriveOrMediaUrl } from './community.service.js';
import { IdentityPresentationService } from './identity-presentation.service.js';

const POST_KINDS = new Set(['request', 'document', 'video', 'link']);
const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 2000;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
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
    enrollments
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
    SELECT id, course_id, author_mssv, like_count, comment_count
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
    if (!presentation) return record;
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
        SET course_synced_at = $2, updated_at = NOW()
        WHERE mssv = $1;
      `, [cleanMssv, syncTime]);
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
      SELECT cp.*, s.full_name AS author_name, (viewer_like.post_id IS NOT NULL) AS is_liked_by_viewer
      FROM course_posts cp
      JOIN students s ON s.mssv = cp.author_mssv
      LEFT JOIN course_post_likes viewer_like
        ON viewer_like.post_id = cp.id AND viewer_like.mssv = $2
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

  async createCoursePost(mssv, courseCode, input = {}) {
    requireDatabase();
    const cleanMssv = String(mssv || '').trim().toUpperCase();
    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const kind = String(input.kind || '').trim().toLowerCase();
    const title = cleanText(input.title, MAX_TITLE_LENGTH);
    const content = cleanText(input.content, MAX_CONTENT_LENGTH);
    const url = cleanText(input.url, 2048);
    const isAnonymous = kind === 'request' && normalizeBoolean(input.isAnonymous ?? input.is_anonymous);

    if (!POST_KINDS.has(kind)) throw httpError('Loại bài đăng không hợp lệ.');
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
  }
};

export const LearningServiceInternals = { getGradeSemesters, hasValue, normalizeBoolean, normalizeRecordId };
