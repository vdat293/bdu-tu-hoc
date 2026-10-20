import { isDatabaseConfigured, query, transaction } from '../../db/database.js';
import { IdentityPresentationService } from '../../services/identity-presentation.service.js';
import { findAccessibleCourse } from '../../services/learning.service.js';
import { PermissionService } from '../../services/permission.service.js';
import {
  QUIZ_SET_DEFAULT_MAX_PER_PART,
  QUIZ_SET_DEFAULT_MINUTES_PER_PART,
  buildQuizSet,
  publicQuizSetQuestions
} from '../../utils/quiz-data.js';

const MAX_SOURCE_FILES = 10;
const MAX_SOURCE_FILE_QUESTIONS = 100;
const MAX_TITLE_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PAYLOAD_BYTES = 2.5 * 1024 * 1024;
const MODES = new Set(['review', 'test']);
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function httpError(message, status = 400, code = null, errors = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (errors) error.errors = errors;
  return error;
}

function invalidSet(message, errors = []) {
  return httpError(message, 400, 'QUIZ_SET_INVALID', errors);
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
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

function pushError(errors, path, message) {
  errors.push({ path, message });
}

function requireDatabase() {
  if (!isDatabaseConfigured()) {
    throw httpError('Bộ đề trắc nghiệm cần PostgreSQL nhưng DATABASE_URL chưa được cấu hình.', 503);
  }
}

function normalizeMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw invalidSet('Chế độ làm bài phải là review hoặc test.', [
      { path: '$.mode', message: 'mode phải là review hoặc test.' }
    ]);
  }
  return mode;
}

function normalizePartIndex(value, partCount) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw invalidSet('Phần không hợp lệ.', [
      { path: '$.partIndex', message: 'partIndex phải là số nguyên không âm.' }
    ]);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= partCount) {
    throw invalidSet('Phần không tồn tại trong bộ đề.', [
      { path: '$.partIndex', message: `partIndex phải nằm trong khoảng 0–${Math.max(0, partCount - 1)}.` }
    ]);
  }
  return parsed;
}

function sanitizeSourceName(value) {
  if (typeof value !== 'string') return null;
  const base = value.replace(/\\/g, '/').split('/').pop().trim();
  if (!base || base === '.' || base === '..' || base.length > 255) return null;
  if (CONTROL_CHARS.test(base)) return null;
  return base;
}

function normalizeSourceFiles(rawFiles, questions, errors) {
  if (rawFiles === undefined || rawFiles === null) return [];
  if (!Array.isArray(rawFiles)) {
    pushError(errors, '$.sourceFiles', 'sourceFiles phải là mảng.');
    return [];
  }
  if (rawFiles.length > MAX_SOURCE_FILES) {
    pushError(errors, '$.sourceFiles', `Chỉ được gửi tối đa ${MAX_SOURCE_FILES} file.`);
    return [];
  }

  const files = [];
  rawFiles.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      pushError(errors, '$.sourceFiles', `sourceFiles[${index}] phải là object.`);
      return;
    }
    const name = sanitizeSourceName(raw.name);
    if (!name) {
      pushError(errors, '$.sourceFiles', `sourceFiles[${index}].name không hợp lệ.`);
      return;
    }
    const questionCount = raw.questionCount;
    if (
      typeof questionCount !== 'number'
      || !Number.isInteger(questionCount)
      || questionCount < 1
      || questionCount > MAX_SOURCE_FILE_QUESTIONS
    ) {
      pushError(
        errors,
        '$.sourceFiles',
        `sourceFiles[${index}].questionCount phải là số nguyên 1–${MAX_SOURCE_FILE_QUESTIONS}.`
      );
      return;
    }
    files.push({ name, questionCount });
  });

  if (errors.some((error) => error.path === '$.sourceFiles')) return files;

  if (files.length > 0 && Array.isArray(questions)) {
    const total = files.reduce((sum, file) => sum + file.questionCount, 0);
    if (total !== questions.length) {
      pushError(errors, '$.sourceFiles', 'Tổng số câu trong sourceFiles phải bằng số câu hỏi.');
    }
  }
  return files;
}

function normalizeCreateInput(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];

  let title = null;
  if (typeof source.title !== 'string') {
    pushError(errors, '$.title', 'Tiêu đề phải là chuỗi.');
  } else {
    const cleaned = normalizeText(source.title);
    if (cleaned.length < 1 || cleaned.length > MAX_TITLE_LENGTH) {
      pushError(errors, '$.title', `Tiêu đề phải từ 1 đến ${MAX_TITLE_LENGTH} ký tự.`);
    } else if (CONTROL_CHARS.test(cleaned)) {
      pushError(errors, '$.title', 'Tiêu đề chứa ký tự điều khiển.');
    } else {
      title = cleaned;
    }
  }

  let description = '';
  if (source.description !== undefined && source.description !== null) {
    if (typeof source.description !== 'string') {
      pushError(errors, '$.description', 'Mô tả phải là chuỗi.');
    } else {
      const cleaned = normalizeText(source.description);
      if (cleaned.length > MAX_DESCRIPTION_LENGTH) {
        pushError(errors, '$.description', `Mô tả tối đa ${MAX_DESCRIPTION_LENGTH} ký tự.`);
      } else if (CONTROL_CHARS.test(cleaned)) {
        pushError(errors, '$.description', 'Mô tả chứa ký tự điều khiển.');
      } else {
        description = cleaned;
      }
    }
  }

  const questions = source.questions;
  if (!Array.isArray(questions)) {
    pushError(errors, '$.questions', 'questions phải là mảng.');
  } else {
    let byteLength = null;
    try {
      byteLength = Buffer.byteLength(JSON.stringify(questions), 'utf8');
    } catch {
      byteLength = null;
    }
    if (byteLength === null || byteLength > MAX_PAYLOAD_BYTES) {
      pushError(errors, '$.questions', 'Dữ liệu câu hỏi vượt quá 2.5 MB.');
    }
  }

  const sourceFiles = normalizeSourceFiles(source.sourceFiles, questions, errors);

  const maxQuestionsPerPart = source.maxQuestionsPerPart === undefined || source.maxQuestionsPerPart === null
    ? QUIZ_SET_DEFAULT_MAX_PER_PART
    : source.maxQuestionsPerPart;
  const minutesPerPart = source.minutesPerPart === undefined || source.minutesPerPart === null
    ? QUIZ_SET_DEFAULT_MINUTES_PER_PART
    : source.minutesPerPart;

  const built = buildQuizSet({
    questions: Array.isArray(questions) ? questions : [],
    maxQuestionsPerPart,
    minutesPerPart
  });
  if (!built.ok) errors.push(...built.errors);

  if (errors.length > 0) {
    throw invalidSet('Dữ liệu bộ đề không hợp lệ.', errors);
  }

  return {
    title,
    description,
    sourceFiles,
    set: built.set
  };
}

function mapSetSummary(row, viewerMssv, presentation = null) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    question_count: Number(row.question_count || 0),
    part_count: Number(row.part_count || 0),
    part_sizes: Array.isArray(row.part_sizes) ? row.part_sizes.map(Number) : [],
    minutes_per_part: Number(row.minutes_per_part || 0),
    author: {
      mssv: row.author_mssv,
      name: presentation?.name || row.author_name || row.author_mssv,
      titles: Array.isArray(presentation?.selected_titles) ? presentation.selected_titles : [],
      photo_url: presentation?.avatar_url || null
    },
    is_mine: row.author_mssv === viewerMssv,
    created_at: row.created_at
  };
}

function sanitizeResponses(value, mode, completedAt) {
  if (!Array.isArray(value)) return [];
  const includeCorrect = mode === 'review' || Boolean(completedAt);
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const mapped = { id: entry.id, response: entry.response };
      if (includeCorrect && typeof entry.correct === 'boolean') {
        mapped.correct = entry.correct;
      }
      return mapped;
    });
}

/**
 * Shape tiến độ dùng chung cho list/detail/start. Test chưa hoàn thành không
 * bao giờ trả cờ `correct` trong responses.
 */
function mapProgress(row, mode, { includeResponses = false } = {}) {
  if (!row) return null;
  const progress = {
    answered: Number(row.answered || 0),
    total_count: Number(row.total_count || 0),
    completed_at: row.completed_at || null
  };
  if (mode === 'test') {
    progress.best_correct = row.best_correct == null ? null : Number(row.best_correct);
    progress.best_total = row.best_total == null ? null : Number(row.best_total);
    progress.attempts = Number(row.attempts || 0);
  }
  if (includeResponses) {
    progress.responses = sanitizeResponses(row.responses, mode, row.completed_at);
  }
  return progress;
}

function progressKey(setId, partIndex, mode) {
  return `${String(setId)}:${Number(partIndex)}:${mode}`;
}

async function loadSet(course, setId, db = { query }) {
  const result = await db.query(`
    SELECT qs.*, s.full_name AS author_name
    FROM course_quiz_sets qs
    JOIN students s ON s.mssv = qs.author_mssv
    WHERE qs.id = $1 AND qs.course_id = $2
    LIMIT 1;
  `, [setId, course.id]);
  if (!result.rows.length) {
    throw httpError('Không tìm thấy bộ đề trong môn học này.', 404, 'QUIZ_SET_NOT_FOUND');
  }
  return result.rows[0];
}

function readPartSizes(row) {
  return Array.isArray(row.part_sizes) ? row.part_sizes.map(Number) : [];
}

export const QuizSetService = {
  async listSets(mssv, courseCode) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);

    const result = await query(`
      SELECT
        qs.id,
        qs.author_mssv,
        qs.title,
        qs.description,
        qs.question_count,
        qs.part_count,
        qs.part_sizes,
        qs.minutes_per_part,
        qs.created_at,
        s.full_name AS author_name
      FROM course_quiz_sets qs
      JOIN students s ON s.mssv = qs.author_mssv
      WHERE qs.course_id = $1
      ORDER BY qs.created_at DESC, qs.id DESC
      LIMIT 100;
    `, [course.id]);

    const rows = result.rows;
    if (rows.length === 0) return { sets: [] };

    const progressResult = await query(`
      SELECT
        set_id,
        part_index,
        mode,
        answered,
        total_count,
        best_correct,
        best_total,
        attempts,
        completed_at
      FROM course_quiz_progress
      WHERE mssv = $1 AND set_id = ANY($2::bigint[]);
    `, [cleanMssv, rows.map((row) => String(row.id))]);

    const progressMap = new Map();
    for (const row of progressResult.rows) {
      progressMap.set(progressKey(row.set_id, row.part_index, row.mode), row);
    }

    const presentations = await IdentityPresentationService.getPresentations(
      rows.map((row) => row.author_mssv)
    );

    const sets = rows.map((row) => {
      const partSizes = readPartSizes(row);
      const progress = partSizes.map((_, partIndex) => ({
        part_index: partIndex,
        review: mapProgress(progressMap.get(progressKey(row.id, partIndex, 'review')), 'review'),
        test: mapProgress(progressMap.get(progressKey(row.id, partIndex, 'test')), 'test')
      }));

      return {
        ...mapSetSummary(row, cleanMssv, presentations.get(row.author_mssv)),
        progress
      };
    });

    return { sets };
  },

  async createSet(mssv, courseCode, input) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const course = await findAccessibleCourse(cleanMssv, courseCode);

    if (!(await PermissionService.can(cleanMssv, 'ttcds:access'))) {
      throw httpError(
        'Chỉ thành viên có danh hiệu #TTCDS mới được tạo bộ đề trắc nghiệm.',
        403,
        'TTCDS_FORBIDDEN'
      );
    }

    const validated = normalizeCreateInput(input);
    const built = validated.set;

    const inserted = await transaction(async (client) => {
      const result = await client.query(`
        INSERT INTO course_quiz_sets (
          course_id,
          author_mssv,
          title,
          description,
          source_files,
          questions,
          part_sizes,
          part_count,
          question_count,
          max_questions_per_part,
          minutes_per_part
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
        RETURNING *;
      `, [
        course.id,
        cleanMssv,
        validated.title,
        validated.description,
        JSON.stringify(validated.sourceFiles),
        JSON.stringify(built.questions),
        JSON.stringify(built.partSizes),
        built.partCount,
        built.questionCount,
        built.maxQuestionsPerPart,
        built.minutesPerPart
      ]);
      return result.rows[0];
    });

    const row = (await query(`
      SELECT qs.*, s.full_name AS author_name
      FROM course_quiz_sets qs
      JOIN students s ON s.mssv = qs.author_mssv
      WHERE qs.id = $1
      LIMIT 1;
    `, [inserted.id])).rows[0];

    const presentations = await IdentityPresentationService.getPresentations([cleanMssv]);
    return mapSetSummary(row, cleanMssv, presentations.get(cleanMssv));
  },

  async deleteSet(mssv, courseCode, setId) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanSetId = normalizeRecordId(setId);
    if (!cleanSetId) {
      throw invalidSet('Bộ đề không hợp lệ.', [
        { path: '$.setId', message: 'setId phải là số nguyên dương.' }
      ]);
    }

    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const setRow = await loadSet(course, cleanSetId);
    if (setRow.author_mssv !== cleanMssv) {
      throw httpError('Chỉ tác giả mới được xóa bộ đề này.', 403, 'QUIZ_SET_FORBIDDEN');
    }

    await query(
      'DELETE FROM course_quiz_sets WHERE id = $1 AND course_id = $2;',
      [cleanSetId, course.id]
    );
    return { deleted: true, id: String(setRow.id) };
  },

  async getPart(mssv, courseCode, setId, partIndex, mode) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanSetId = normalizeRecordId(setId);
    if (!cleanSetId) {
      throw invalidSet('Bộ đề không hợp lệ.', [
        { path: '$.setId', message: 'setId phải là số nguyên dương.' }
      ]);
    }

    const course = await findAccessibleCourse(cleanMssv, courseCode);
    const setRow = await loadSet(course, cleanSetId);
    const partIndexValue = normalizePartIndex(partIndex, Number(setRow.part_count));
    const modeValue = normalizeMode(mode);

    const partSizes = readPartSizes(setRow);
    const questionCount = Number(partSizes[partIndexValue] || 0);
    const questions = publicQuizSetQuestions(setRow.questions, partIndexValue);
    const progressRow = (await query(`
      SELECT *
      FROM course_quiz_progress
      WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
      LIMIT 1;
    `, [cleanMssv, cleanSetId, partIndexValue, modeValue])).rows[0] || null;

    const presentations = await IdentityPresentationService.getPresentations([setRow.author_mssv]);

    return {
      set: mapSetSummary(setRow, cleanMssv, presentations.get(setRow.author_mssv)),
      part: {
        index: partIndexValue,
        question_count: questionCount,
        time_limit_seconds: modeValue === 'test'
          ? Number(setRow.minutes_per_part || 0) * 60
          : null
      },
      questions,
      progress: mapProgress(progressRow, modeValue, { includeResponses: true }),
      // Task 3 sẽ dựng review chi tiết khi test đã hoàn thành; Task 2 tuyệt đối
      // không trả correct/explanation trong detail.
      review: null
    };
  },

  async startPart(mssv, courseCode, setId, partIndex, options = {}) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanSetId = normalizeRecordId(setId);
    if (!cleanSetId) {
      throw invalidSet('Bộ đề không hợp lệ.', [
        { path: '$.setId', message: 'setId phải là số nguyên dương.' }
      ]);
    }
    const restart = options?.restart === true;

    return transaction(async (client) => {
      const course = await findAccessibleCourse(cleanMssv, courseCode, client);
      const modeValue = normalizeMode(options?.mode);
      const setRow = await loadSet(course, cleanSetId, client);
      const partIndexValue = normalizePartIndex(partIndex, Number(setRow.part_count));
      const partSizes = readPartSizes(setRow);
      const totalCount = Number(partSizes[partIndexValue] || 0);
      const timeLimitSeconds = modeValue === 'test'
        ? Number(setRow.minutes_per_part || 0) * 60
        : null;

      // ON CONFLICT giữ một dòng duy nhất khi hai tab bấm bắt đầu cùng lúc.
      const inserted = await client.query(`
        INSERT INTO course_quiz_progress (
          mssv, set_id, part_index, mode, started_at, answered, correct_count,
          total_count, responses, updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), 0, 0, $5, '[]'::jsonb, NOW())
        ON CONFLICT (mssv, set_id, part_index, mode) DO NOTHING
        RETURNING mssv;
      `, [cleanMssv, cleanSetId, partIndexValue, modeValue, totalCount]);

      let progress = (await client.query(`
        SELECT *
        FROM course_quiz_progress
        WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
        FOR UPDATE;
      `, [cleanMssv, cleanSetId, partIndexValue, modeValue])).rows[0];

      let restarted = false;
      if (inserted.rowCount === 0 && restart && modeValue === 'test') {
        // Làm lại chỉ reset lượt hiện tại; best/attempts là lịch sử nên giữ nguyên.
        progress = (await client.query(`
          UPDATE course_quiz_progress
          SET started_at = NOW(),
              answered = 0,
              correct_count = 0,
              total_count = $5,
              responses = '[]'::jsonb,
              completed_at = NULL,
              updated_at = NOW()
          WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
          RETURNING *;
        `, [cleanMssv, cleanSetId, partIndexValue, modeValue, totalCount])).rows[0];
        restarted = true;
      } else if (!progress.started_at) {
        progress = (await client.query(`
          UPDATE course_quiz_progress
          SET started_at = NOW(), updated_at = NOW()
          WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
          RETURNING *;
        `, [cleanMssv, cleanSetId, partIndexValue, modeValue])).rows[0];
      }

      // remaining_seconds tính bằng NOW() của PostgreSQL (§6).
      const remainingRow = (await client.query(`
        SELECT
          started_at,
          completed_at,
          CASE
            WHEN $5::int IS NULL THEN NULL
            WHEN completed_at IS NOT NULL THEN 0
            WHEN started_at IS NULL THEN $5::int
            ELSE GREATEST(
              0,
              $5::int - FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))
            )::int
          END AS remaining_seconds
        FROM course_quiz_progress
        WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4;
      `, [cleanMssv, cleanSetId, partIndexValue, modeValue, timeLimitSeconds])).rows[0];

      return {
        started_at: progress.started_at,
        remaining_seconds: remainingRow.remaining_seconds == null
          ? null
          : Number(remainingRow.remaining_seconds),
        completed_at: progress.completed_at,
        restarted
      };
    });
  }
};
