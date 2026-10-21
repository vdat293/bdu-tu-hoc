import { isDatabaseConfigured, query, transaction } from '../../db/database.js';
import { IdentityPresentationService } from '../../services/identity-presentation.service.js';
import { findAccessibleCourse } from '../../services/learning.service.js';
import { PermissionService } from '../../services/permission.service.js';
import {
  QUIZ_SET_DEFAULT_MAX_PER_PART,
  QUIZ_SET_DEFAULT_MINUTES_PER_PART,
  buildQuizSet,
  gradeQuizResponses,
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

/** Snapshot câu hỏi của đúng một phần; đây là nguồn chấm điểm duy nhất. */
function partQuestionsOf(setRow, partIndex) {
  const questions = Array.isArray(setRow.questions) ? setRow.questions : [];
  return questions.filter((question) => question && Number(question.partIndex) === Number(partIndex));
}

/**
 * Validate responses từ client theo snapshot của phần: object `{id,response}`,
 * tối đa bằng số câu của phần, id thuộc phần và response phải trùng một option
 * (trim + không phân biệt hoa/thường). Trả entry đã canonical hóa + chấm server.
 */
function normalizeProgressResponses(value, questions) {
  if (!Array.isArray(value)) {
    throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
      { path: '$.responses', message: 'responses phải là mảng.' }
    ]);
  }
  if (value.length > questions.length) {
    throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
      { path: '$.responses', message: `responses tối đa ${questions.length} câu.` }
    ]);
  }

  const questionById = new Map(questions.map((question) => [String(question.id), question]));
  const seen = new Set();
  const entries = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
        { path: `$.responses[${index}]`, message: 'Mỗi response phải là object {id,response}.' }
      ]);
    }
    const id = String(raw.id ?? '').trim();
    const question = questionById.get(id);
    if (!question) {
      throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
        { path: `$.responses[${index}].id`, message: 'Câu hỏi không thuộc phần này.' }
      ]);
    }
    if (seen.has(id)) {
      throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
        { path: `$.responses[${index}].id`, message: 'Câu hỏi bị lặp trong responses.' }
      ]);
    }
    const graded = gradeQuizResponses([question], [{ id, response: raw.response }]);
    if (graded.answered !== 1) {
      throw invalidSet('Dữ liệu tiến độ không hợp lệ.', [
        {
          path: `$.responses[${index}].response`,
          message: 'Đáp án phải là một lựa chọn của câu hỏi.'
        }
      ]);
    }
    seen.add(id);
    entries.push(graded.entries[0]);
  });
  return entries;
}

/**
 * Làm sạch responses đã lưu: bỏ entry hỏng/id lạ/option cũ và chấm lại từ
 * snapshot, không tin cờ `correct` (nếu có) trong JSONB.
 */
function normalizeStoredResponses(value, questions) {
  if (!Array.isArray(value)) return [];
  const questionById = new Map(questions.map((question) => [String(question.id), question]));
  const byId = new Map();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id ?? '').trim();
    const question = questionById.get(id);
    if (!question) continue;
    const graded = gradeQuizResponses([question], [{ id, response: raw.response }]);
    if (graded.answered !== 1) continue;
    // Entry trùng id: bản ghi sau thắng; Map giữ nguyên vị trí xuất hiện đầu.
    byId.set(id, graded.entries[0]);
  }
  return [...byId.values()];
}

/**
 * Response của saveProgress: test trước khi nộp tuyệt đối không có
 * `correct`/`correct_count`; review có `correct_count`, không có best/attempts.
 */
function mapSaveProgress(row, mode, { remainingSeconds, expired, alreadyCompleted }) {
  const completed = row.completed_at != null;
  const progress = {
    mode,
    answered: Number(row.answered || 0),
    total_count: Number(row.total_count || 0),
    completed_at: row.completed_at || null,
    responses: sanitizeResponses(row.responses, mode, row.completed_at),
    remaining_seconds: remainingSeconds,
    expired,
    already_completed: alreadyCompleted
  };
  if (mode === 'test') {
    progress.best_correct = row.best_correct == null ? null : Number(row.best_correct);
    progress.best_total = row.best_total == null ? null : Number(row.best_total);
    progress.attempts = Number(row.attempts || 0);
    if (completed) progress.correct_count = Number(row.correct_count || 0);
  } else {
    progress.correct_count = Number(row.correct_count || 0);
  }
  return progress;
}

/**
 * Review chi tiết sau khi test đã nộp: trả đáp án đúng (nội dung option) +
 * giải thích từ snapshot. `correct` ở đây là text để result view hiển thị,
 * khác với cờ boolean trong responses đã chấm.
 */
function buildCompletedTestReview(questions) {
  return questions.map((question) => ({
    id: question.id,
    correct: String(question.correct ?? ''),
    explanation: String(question.explanation ?? '')
  }));
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

    // Review chi tiết chỉ có sau khi test đã nộp; trong lúc làm và ở chế độ
    // ôn tập (feedback từng câu qua answer) luôn là null.
    const review = modeValue === 'test' && progressRow?.completed_at
      ? buildCompletedTestReview(partQuestionsOf(setRow, partIndexValue))
      : null;

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
      review
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
      // Chỉ lượt đã hoàn thành mới được làm lại. Lượt đang làm dở + restart
      // phải resume để không thể gia hạn thời gian giữa lượt test (§6). Review
      // đang làm dở cũng resume để giữ vị trí; review đã xong thì reset lượt
      // (không timer, không best/attempts).
      if (
        inserted.rowCount === 0
        && restart
        && progress.completed_at != null
      ) {
        // Làm lại chỉ reset lượt hiện tại; best/attempts của test là lịch sử nên giữ nguyên.
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
  },

  /**
   * Chấm một câu ở chế độ ôn tập. Không ghi progress; feedback do client gửi
   * `saveProgress` sau đó. Endpoint không tồn tại cho test mode.
   */
  async answerReview(mssv, courseCode, setId, partIndex, input = {}) {
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

    if (input?.mode !== undefined && input?.mode !== null) {
      const rawMode = String(input.mode).trim().toLowerCase();
      if (rawMode !== 'review') {
        throw httpError(
          'Chỉ chế độ ôn tập mới được chấm và trả đáp án từng câu.',
          400,
          'QUIZ_REVIEW_ONLY'
        );
      }
    }

    const rows = (await query(`
      SELECT *
      FROM course_quiz_progress
      WHERE mssv = $1 AND set_id = $2 AND part_index = $3;
    `, [cleanMssv, cleanSetId, partIndexValue])).rows;
    const reviewRow = rows.find((row) => row.mode === 'review') || null;
    const testRow = rows.find((row) => row.mode === 'test') || null;

    if (!reviewRow || !reviewRow.started_at) {
      if (testRow && testRow.started_at) {
        throw httpError(
          'Chỉ chế độ ôn tập mới được chấm và trả đáp án từng câu.',
          400,
          'QUIZ_REVIEW_ONLY'
        );
      }
      throw httpError(
        'Bạn chưa bắt đầu làm phần ôn tập này.',
        409,
        'QUIZ_NOT_STARTED'
      );
    }
    if (reviewRow.completed_at) {
      throw httpError('Bạn đã hoàn thành phần ôn tập này.', 409, 'QUIZ_COMPLETED');
    }

    const questions = partQuestionsOf(setRow, partIndexValue);
    const questionId = String(input?.questionId ?? '').trim();
    const question = questions.find((item) => String(item.id) === questionId);
    if (!question) {
      throw invalidSet('Câu hỏi không thuộc phần này.', [
        { path: '$.questionId', message: 'questionId không thuộc phần đang ôn tập.' }
      ]);
    }

    const graded = gradeQuizResponses(
      [question],
      [{ id: question.id, response: input?.response }]
    );
    if (graded.answered !== 1) {
      throw invalidSet('Đáp án không hợp lệ.', [
        { path: '$.response', message: 'Đáp án phải là một trong các lựa chọn của câu hỏi.' }
      ]);
    }

    return {
      correct: graded.entries[0].correct,
      correct_answer: String(question.correct ?? ''),
      explanation: String(question.explanation ?? '')
    };
  },

  /**
   * Lưu tiến độ/làm bài. Review merge không ghi đè và hoàn thành khi đủ câu;
   * test lưu đáp án mới nhất không kèm cờ đúng/sai và chỉ chấm khi nộp/hết giờ.
   */
  async saveProgress(mssv, courseCode, setId, partIndex, input = {}) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanSetId = normalizeRecordId(setId);
    if (!cleanSetId) {
      throw invalidSet('Bộ đề không hợp lệ.', [
        { path: '$.setId', message: 'setId phải là số nguyên dương.' }
      ]);
    }
    const wantsCompleted = input?.completed === true;

    return transaction(async (client) => {
      const course = await findAccessibleCourse(cleanMssv, courseCode, client);
      const modeValue = normalizeMode(input?.mode);
      const setRow = await loadSet(course, cleanSetId, client);
      const partIndexValue = normalizePartIndex(partIndex, Number(setRow.part_count));
      const questions = partQuestionsOf(setRow, partIndexValue);
      const totalCount = Number(readPartSizes(setRow)[partIndexValue] || 0);
      const timeLimitSeconds = modeValue === 'test'
        ? Number(setRow.minutes_per_part || 0) * 60
        : null;

      // Khóa dòng progress; remaining_seconds dùng đồng hồ PostgreSQL (§8).
      const progress = (await client.query(`
        SELECT
          qp.*,
          CASE
            WHEN $5::int IS NULL THEN NULL
            WHEN qp.completed_at IS NOT NULL THEN 0
            WHEN qp.started_at IS NULL THEN $5::int
            ELSE GREATEST(
              0,
              $5::int - FLOOR(EXTRACT(EPOCH FROM (NOW() - qp.started_at)))
            )::int
          END AS remaining_seconds
        FROM course_quiz_progress qp
        WHERE qp.mssv = $1 AND qp.set_id = $2 AND qp.part_index = $3 AND qp.mode = $4
        FOR UPDATE;
      `, [cleanMssv, cleanSetId, partIndexValue, modeValue, timeLimitSeconds])).rows[0];

      if (!progress || !progress.started_at) {
        throw httpError(
          'Bạn chưa bắt đầu làm phần này.',
          409,
          'QUIZ_NOT_STARTED'
        );
      }

      const remaining = progress.remaining_seconds == null
        ? null
        : Number(progress.remaining_seconds);

      // Đã hoàn thành: trả nguyên trạng, không cộng attempts/ghi responses lần nữa.
      if (progress.completed_at) {
        return mapSaveProgress(progress, modeValue, {
          remainingSeconds: remaining,
          expired: false,
          alreadyCompleted: true
        });
      }

      const incoming = normalizeProgressResponses(input?.responses, questions);
      const stored = normalizeStoredResponses(progress.responses, questions);

      if (modeValue === 'review') {
        // Merge no-overwrite: đáp án đã lưu thắng, chỉ thêm câu chưa trả lời.
        const storedIds = new Set(stored.map((entry) => entry.id));
        const merged = [...stored];
        for (const entry of incoming) {
          if (storedIds.has(entry.id)) continue;
          storedIds.add(entry.id);
          merged.push(entry);
        }

        const answered = merged.length;
        const correctCount = merged.filter((entry) => entry.correct).length;

        if (wantsCompleted && answered < totalCount) {
          throw httpError(
            `Hãy trả lời đủ ${totalCount} câu trước khi kết thúc phần ôn tập.`,
            400,
            'QUIZ_REVIEW_INCOMPLETE'
          );
        }

        const updated = (await client.query(`
          UPDATE course_quiz_progress
          SET answered = $5,
              correct_count = $6,
              total_count = $7,
              responses = $8::jsonb,
              completed_at = CASE WHEN $9::boolean THEN NOW() ELSE completed_at END,
              updated_at = NOW()
          WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
          RETURNING *;
        `, [
          cleanMssv,
          cleanSetId,
          partIndexValue,
          modeValue,
          answered,
          correctCount,
          totalCount,
          JSON.stringify(merged),
          wantsCompleted
        ])).rows[0];

        // Review không có timer nên remaining luôn null, kể cả khi vừa xong.
        return mapSaveProgress(updated, 'review', {
          remainingSeconds: null,
          expired: false,
          alreadyCompleted: false
        });
      }

      const expired = timeLimitSeconds > 0 && remaining === 0;
      // Quá hạn: chỉ nhận finalize từ đúng dữ liệu đã lưu (responses rỗng).
      if (expired && (!wantsCompleted || incoming.length > 0)) {
        throw httpError(
          'Đã hết thời gian làm bài kiểm tra này.',
          409,
          'QUIZ_TIME_UP'
        );
      }

      // Test: đáp án mới nhất thắng trước khi nộp; không lưu/không trả cờ đúng.
      const mergedById = new Map(stored.map((entry) => [entry.id, entry]));
      if (!expired) {
        for (const entry of incoming) mergedById.set(entry.id, entry);
      }
      const merged = [...mergedById.values()];

      if (!wantsCompleted) {
        const storedResponses = merged.map((entry) => ({
          id: entry.id,
          response: entry.response
        }));
        const updated = (await client.query(`
          UPDATE course_quiz_progress
          SET answered = $5,
              correct_count = 0,
              total_count = $6,
              responses = $7::jsonb,
              updated_at = NOW()
          WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
          RETURNING *;
        `, [
          cleanMssv,
          cleanSetId,
          partIndexValue,
          modeValue,
          merged.length,
          totalCount,
          JSON.stringify(storedResponses)
        ])).rows[0];

        return mapSaveProgress(updated, 'test', {
          remainingSeconds: remaining,
          expired: false,
          alreadyCompleted: false
        });
      }

      // Nộp sớm khi chưa trả lời câu nào bị chặn; hết giờ được phép finalize 0 câu.
      if (!expired && merged.length === 0) {
        throw httpError(
          'Hãy trả lời ít nhất một câu trước khi nộp bài.',
          400,
          'QUIZ_EMPTY_SUBMIT'
        );
      }

      const correctCount = merged.filter((entry) => entry.correct).length;
      const previousBestCorrect = progress.best_correct == null
        ? null
        : Number(progress.best_correct);
      const previousBestTotal = progress.best_total == null
        ? null
        : Number(progress.best_total);
      const hasBest = previousBestCorrect != null
        && previousBestTotal != null
        && previousBestTotal > 0;
      // So tỉ lệ bằng nhân chéo để tránh sai số float; chỉ đổi khi tốt hơn.
      const isBetterBest = !hasBest
        || correctCount * previousBestTotal > previousBestCorrect * totalCount;
      const bestCorrect = isBetterBest ? correctCount : previousBestCorrect;
      const bestTotal = isBetterBest ? totalCount : previousBestTotal;
      // completed_at đã được chặn ở trên nên đây là lần chuyển completed duy nhất.
      const attempts = Number(progress.attempts || 0) + 1;
      // Lưu kèm correct do server chấm từ snapshot để detail/review sau nộp dùng.
      const gradedResponses = merged.map((entry) => ({
        id: entry.id,
        response: entry.response,
        correct: entry.correct
      }));

      const completedRow = (await client.query(`
        UPDATE course_quiz_progress
        SET answered = $5,
            correct_count = $6,
            total_count = $7,
            best_correct = $8,
            best_total = $9,
            attempts = $10,
            responses = $11::jsonb,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE mssv = $1 AND set_id = $2 AND part_index = $3 AND mode = $4
        RETURNING *;
      `, [
        cleanMssv,
        cleanSetId,
        partIndexValue,
        modeValue,
        merged.length,
        correctCount,
        totalCount,
        bestCorrect,
        bestTotal,
        attempts,
        JSON.stringify(gradedResponses)
      ])).rows[0];

      return mapSaveProgress(completedRow, 'test', {
        remainingSeconds: timeLimitSeconds > 0 ? 0 : null,
        expired,
        alreadyCompleted: false
      });
    });
  }
};
