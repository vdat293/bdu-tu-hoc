import { isDatabaseConfigured, query } from '../db/database.js';
import { isAnswerCorrect } from '../utils/grammar-answers.js';

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanStr(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v, label = 'id') {
  if (!UUID_RE.test(String(v || '').trim())) {
    throw httpError(`${label} không đúng định dạng.`, 400);
  }
  return String(v).trim();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Payload từ client chỉ nhận số nguyên thật (không nhận boolean/chuỗi số).
function toInt(v) {
  return Number.isInteger(v) ? v : null;
}

const MAX_RESPONSES = 500;
const MAX_RESPONSE_ID = 64;

function accuracyOf(correct, total) {
  const c = num(correct);
  const t = num(total);
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

// Không trả đáp án trong payload bài học: client hỏi server khi đã trả lời
// xong từng câu (checkAnswer), tránh lộ đề trước khi làm.
function mapExercise(row) {
  return {
    id: row.id,
    type: row.type,
    question: row.question,
    option_a: row.option_a,
    option_b: row.option_b,
    option_c: row.option_c,
    option_d: row.option_d,
    hint: row.hint || '',
    order: num(row.order_idx)
  };
}

const EXERCISE_COLUMNS = `id, type, question, option_a, option_b, option_c, option_d,
  correct_answer, explanation, hint, order_idx`;

const READING_QUESTION_COLUMNS = `id, type, question, option_a, option_b, option_c, option_d,
  correct_answer, explanation, order_idx`;

function normalizeResponse(value) {
  if (Array.isArray(value)) {
    const words = value.slice(0, 40).map((word) => String(word ?? '').slice(0, 200));
    return words.length ? words : null;
  }
  const text = String(value ?? '').slice(0, 500);
  return text.trim() ? text : null;
}

// Chấm lại câu trả lời ở server, không tin số correct do client khai.
// rows: [{ id, type, correct_answer }]; responses: [{ id, response }].
// Bỏ qua id lạ/trùng/quá dài để tránh thổi phồng điểm và payload rác.
// Chỉ lưu id/response/correct: không lưu đáp án vào tiến độ để tránh biến
// responses thành kênh rút đáp án của cả bài.
export function gradeResponseEntries(rows, responses) {
  const byId = new Map((rows || []).map((row) => [String(row.id), row]));
  const seen = new Set();
  const entries = [];
  for (const entry of Array.isArray(responses) ? responses.slice(0, MAX_RESPONSES) : []) {
    const id = String(entry?.id ?? '').trim();
    if (!id || id.length > MAX_RESPONSE_ID || seen.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    seen.add(id);
    const response = normalizeResponse(entry.response);
    entries.push({
      id,
      response,
      correct: response != null && isAnswerCorrect(row.type, response, row.correct_answer)
    });
  }
  return entries;
}

// Bổ sung cờ đúng/sai cho tiến độ lưu trước đây (chưa có `correct`) để client
// khôi phục đúng số câu đúng khi "Làm tiếp".
function hydrateResponses(entries, rows) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const byId = new Map((rows || []).map((row) => [String(row.id), row]));
  return entries
    .map((entry) => {
      const id = String(entry?.id ?? '');
      const row = byId.get(id);
      if (!row) return null;
      const response = normalizeResponse(entry?.response);
      return {
        id,
        response,
        correct: typeof entry?.correct === 'boolean'
          ? entry.correct
          : (response != null && isAnswerCorrect(row.type, response, row.correct_answer))
      };
    })
    .filter(Boolean);
}

export function gradeGrammarResponses(rows, responses) {
  const entries = gradeResponseEntries(rows, responses);
  return { answered: entries.length, correct: entries.filter((entry) => entry.correct).length };
}

export const GrammarService = {
  hasDatabase() {
    return isDatabaseConfigured();
  },

  async listGroups({ mssv = null } = {}) {
    if (!isDatabaseConfigured()) return [];
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const [pathsResult, progressResult] = await Promise.all([
      query(
        `SELECT g.id AS group_id, g.name AS group_name, g.order_idx AS group_order,
                p.id, p.slug, p.name, p.description, p.cover_image, p.difficulty,
                p.banner_label, p.badge_label, p.order_idx, p.lesson_count, p.question_count
         FROM grammar_groups g
         JOIN grammar_paths p ON p.group_id = g.id
         ORDER BY g.order_idx ASC, g.name ASC, p.order_idx ASC, p.name ASC`
      ),
      safeMssv
        ? query(
            `SELECT l.path_id, COUNT(*)::int AS completed
             FROM grammar_progress pr
             JOIN grammar_lessons l ON l.id = pr.lesson_id
             WHERE pr.mssv = $1 AND pr.completed_at IS NOT NULL
             GROUP BY l.path_id`,
            [safeMssv]
          )
        : Promise.resolve({ rows: [] })
    ]);
    const completedByPath = new Map(progressResult.rows.map((r) => [r.path_id, num(r.completed)]));
    const groups = new Map();
    for (const row of pathsResult.rows) {
      if (!groups.has(row.group_id)) {
        groups.set(row.group_id, { id: row.group_id, name: row.group_name, order: num(row.group_order), paths: [] });
      }
      groups.get(row.group_id).paths.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        cover_image: row.cover_image,
        difficulty: num(row.difficulty, 1),
        banner_label: row.banner_label,
        badge_label: row.badge_label,
        order: num(row.order_idx),
        lesson_count: num(row.lesson_count),
        question_count: num(row.question_count),
        completed_lessons: completedByPath.get(row.id) || 0
      });
    }
    return [...groups.values()];
  },

  async getPath(pathId, { mssv = null } = {}) {
    const cleanId = assertUuid(pathId, 'path id');
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const pathResult = await query(
      `SELECT p.id, p.slug, p.name, p.description, p.cover_image, p.difficulty,
              p.banner_label, p.badge_label, p.lesson_count, p.question_count,
              g.id AS group_id, g.name AS group_name
       FROM grammar_paths p
       LEFT JOIN grammar_groups g ON g.id = p.group_id
       WHERE p.id = $1`,
      [cleanId]
    );
    const row = pathResult.rows[0];
    if (!row) return null;

    const lessonsResult = await query(
      `SELECT l.id, l.name, l.description, l.order_idx, l.question_count,
              pr.answered, pr.correct_count, pr.total_count, pr.best_correct, pr.best_total,
              pr.attempts, pr.completed_at, pr.updated_at AS progress_updated_at
       FROM grammar_lessons l
       LEFT JOIN grammar_progress pr ON pr.lesson_id = l.id AND pr.mssv = NULLIF($2, '')
       WHERE l.path_id = $1
       ORDER BY l.order_idx ASC, l.name ASC`,
      [cleanId, safeMssv]
    );

    let completedLessons = 0;
    const lessons = lessonsResult.rows.map((lesson) => {
      const total = num(lesson.question_count);
      const answered = num(lesson.answered);
      const correct = num(lesson.correct_count);
      const completed = Boolean(lesson.completed_at);
      if (completed) completedLessons += 1;
      return {
        id: lesson.id,
        name: lesson.name,
        description: lesson.description,
        order: num(lesson.order_idx),
        question_count: total,
        completed,
        completed_at: lesson.completed_at || null,
        in_progress: !completed && answered > 0,
        progress_percent: completed ? 100 : accuracyOf(answered, total),
        answered,
        accuracy: completed ? accuracyOf(lesson.best_correct, lesson.best_total) : accuracyOf(correct, answered),
        attempts: num(lesson.attempts)
      };
    });

    const totalQuestions = num(row.question_count);
    return {
      path: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        cover_image: row.cover_image,
        difficulty: num(row.difficulty, 1),
        banner_label: row.banner_label,
        badge_label: row.badge_label,
        group_id: row.group_id,
        group_name: row.group_name,
        lesson_count: num(row.lesson_count),
        question_count: totalQuestions,
        estimated_minutes: Math.max(1, Math.round(totalQuestions / 2.4))
      },
      lessons,
      summary: {
        lesson_count: lessons.length,
        completed_lessons: completedLessons,
        total_questions: totalQuestions
      }
    };
  },

  async getLesson(lessonId, { mssv = null } = {}) {
    const cleanId = assertUuid(lessonId, 'lesson id');
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const lessonResult = await query(
      `SELECT l.id, l.path_id, l.name, l.description, l.order_idx, l.question_count,
              p.name AS path_name, p.difficulty
       FROM grammar_lessons l
       JOIN grammar_paths p ON p.id = l.path_id
       WHERE l.id = $1`,
      [cleanId]
    );
    const lesson = lessonResult.rows[0];
    if (!lesson) return null;

    const [rulesResult, exercisesResult, readingsResult, progressResult, extraExercisesResult, extraProgressResult] = await Promise.all([
      query(
        `SELECT id, title, content, order_idx FROM grammar_rules
         WHERE lesson_id = $1 ORDER BY order_idx ASC, id ASC`,
        [cleanId]
      ),
      query(
        `SELECT ${EXERCISE_COLUMNS} FROM grammar_exercises
         WHERE lesson_id = $1 ORDER BY order_idx ASC, id ASC`,
        [cleanId]
      ),
      query(
        `SELECT id, title, passage, order_idx FROM grammar_reading_exercises
         WHERE lesson_id = $1 ORDER BY order_idx ASC, id ASC`,
        [cleanId]
      ),
      query(
        `SELECT answered, correct_count, total_count, best_correct, best_total, attempts, completed_at, responses
         FROM grammar_progress WHERE mssv = $1 AND lesson_id = $2`,
        [safeMssv, cleanId]
      ),
      query(
        `SELECT ${EXERCISE_COLUMNS} FROM grammar_extra_exercises
         WHERE lesson_id = $1 ORDER BY order_idx ASC, id ASC`,
        [cleanId]
      ),
      query(
        `SELECT answered, correct_count, total_count, best_correct, best_total, attempts, completed_at, responses
         FROM grammar_extra_progress WHERE mssv = $1 AND lesson_id = $2`,
        [safeMssv, cleanId]
      )
    ]);

    const readingIds = readingsResult.rows.map((r) => r.id);
    let readingQuestions = [];
    if (readingIds.length) {
      const qResult = await query(
        `SELECT ${READING_QUESTION_COLUMNS}, reading_id FROM grammar_reading_questions
         WHERE reading_id = ANY($1::uuid[]) ORDER BY order_idx ASC, id ASC`,
        [readingIds]
      );
      readingQuestions = qResult.rows;
    }
    const questionsByReading = new Map();
    for (const question of readingQuestions) {
      if (!questionsByReading.has(question.reading_id)) questionsByReading.set(question.reading_id, []);
      questionsByReading.get(question.reading_id).push(mapExercise(question));
    }

    const progress = progressResult.rows[0];
    return {
      lesson: {
        id: lesson.id,
        path_id: lesson.path_id,
        path_name: lesson.path_name,
        difficulty: num(lesson.difficulty, 1),
        name: lesson.name,
        description: lesson.description,
        order: num(lesson.order_idx),
        question_count: num(lesson.question_count),
        exercise_count: exercisesResult.rows.length,
        reading_count: readingIds.length
      },
      rules: rulesResult.rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        order: num(r.order_idx)
      })),
      exercises: exercisesResult.rows.map(mapExercise),
      extra_exercises: extraExercisesResult.rows.map(mapExercise),
      readings: readingsResult.rows.map((r) => ({
        id: r.id,
        title: r.title,
        passage: r.passage,
        order: num(r.order_idx),
        questions: questionsByReading.get(r.id) || []
      })),
      progress: progress
        ? {
            answered: num(progress.answered),
            correct_count: num(progress.correct_count),
            total_count: num(progress.total_count),
            best_correct: progress.best_correct == null ? null : num(progress.best_correct),
            best_total: progress.best_total == null ? null : num(progress.best_total),
            attempts: num(progress.attempts),
            completed_at: progress.completed_at || null,
            responses: hydrateResponses(progress.responses, [...exercisesResult.rows, ...readingQuestions])
          }
        : null,
      extra_progress: extraProgressResult.rows[0]
        ? {
            answered: num(extraProgressResult.rows[0].answered),
            correct_count: num(extraProgressResult.rows[0].correct_count),
            total_count: num(extraProgressResult.rows[0].total_count),
            best_correct: extraProgressResult.rows[0].best_correct == null ? null : num(extraProgressResult.rows[0].best_correct),
            best_total: extraProgressResult.rows[0].best_total == null ? null : num(extraProgressResult.rows[0].best_total),
            attempts: num(extraProgressResult.rows[0].attempts),
            completed_at: extraProgressResult.rows[0].completed_at || null,
            responses: hydrateResponses(extraProgressResult.rows[0].responses, extraExercisesResult.rows)
          }
        : null
    };
  },

  async saveProgress(mssv, lessonId, payload = {}) {
    const cleanMssv = cleanStr(mssv, 32);
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const cleanLesson = assertUuid(lessonId, 'lesson id');

    if (!Array.isArray(payload.responses)) throw httpError('Thiếu câu trả lời để chấm điểm.', 400);
    const completedClaim = payload.completed === true;

    const lessonResult = await query('SELECT id, question_count FROM grammar_lessons WHERE id = $1', [cleanLesson]);
    const lesson = lessonResult.rows[0];
    if (!lesson) throw httpError('Bài học không tồn tại.', 404);

    const total = num(lesson.question_count);

    // Số câu đã làm trước đây nhưng không nằm trong `responses` (dữ liệu cũ
    // chưa lưu câu trả lời) — kẹp theo giá trị server đã biết để client không
    // thể khai khống tiến độ.
    const existingResult = await query(
      `SELECT answered, correct_count, total_count, best_correct, best_total, attempts
       FROM grammar_progress WHERE mssv = $1 AND lesson_id = $2`,
      [cleanMssv, cleanLesson]
    );
    const existing = existingResult.rows[0] || null;
    const baseAnswered = Math.min(Math.max(0, toInt(payload.answered_before) ?? 0), num(existing?.answered));
    const baseCorrect = Math.min(Math.max(0, toInt(payload.correct_before) ?? 0), num(existing?.correct_count));

    // Server tự chấm toàn bộ câu trả lời, không tin điểm client khai.
    const answerRows = await query(
      `SELECT id, type, correct_answer, explanation FROM grammar_exercises WHERE lesson_id = $1
       UNION ALL
       SELECT q.id, q.type, q.correct_answer, q.explanation
         FROM grammar_reading_questions q
         JOIN grammar_reading_exercises r ON r.id = q.reading_id
        WHERE r.lesson_id = $1`,
      [cleanLesson]
    );
    const savedResponses = gradeResponseEntries(answerRows.rows, payload.responses);
    const answered = Math.min(total, baseAnswered + savedResponses.length);
    const correct = Math.min(answered, baseCorrect + savedResponses.filter((entry) => entry.correct).length);
    // Không có câu trả lời nào trong lần lưu này thì không thể tính là hoàn
    // thành (tránh việc lặp lại request rỗng để tăng attempts/xoá responses).
    const completed = completedClaim && total > 0 && savedResponses.length > 0 && answered >= total;
    const totalCount = completed ? total : answered;

    // So sánh best và cộng attempts ngay trong UPSERT để hai tab lưu đồng thời
    // không ghi lùi điểm cao nhất hoặc mất lượt làm.
    const { rows } = await query(
      `INSERT INTO grammar_progress
         (mssv, lesson_id, answered, correct_count, total_count, best_correct, best_total, attempts, responses, completed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $9 THEN 1 ELSE 0 END, $8::jsonb, CASE WHEN $9 THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (mssv, lesson_id) DO UPDATE SET
         answered = EXCLUDED.answered,
         correct_count = EXCLUDED.correct_count,
         total_count = EXCLUDED.total_count,
         best_correct = CASE
           WHEN EXCLUDED.best_correct IS NULL THEN grammar_progress.best_correct
           WHEN grammar_progress.best_correct IS NULL OR grammar_progress.best_total IS NULL OR grammar_progress.best_total <= 0 THEN EXCLUDED.best_correct
           WHEN (EXCLUDED.best_correct::numeric / NULLIF(EXCLUDED.best_total, 0)) >= (grammar_progress.best_correct::numeric / NULLIF(grammar_progress.best_total, 0)) THEN EXCLUDED.best_correct
           ELSE grammar_progress.best_correct
         END,
         best_total = CASE
           WHEN EXCLUDED.best_correct IS NULL THEN grammar_progress.best_total
           WHEN grammar_progress.best_correct IS NULL OR grammar_progress.best_total IS NULL OR grammar_progress.best_total <= 0 THEN EXCLUDED.best_total
           WHEN (EXCLUDED.best_correct::numeric / NULLIF(EXCLUDED.best_total, 0)) >= (grammar_progress.best_correct::numeric / NULLIF(grammar_progress.best_total, 0)) THEN EXCLUDED.best_total
           ELSE grammar_progress.best_total
         END,
         attempts = grammar_progress.attempts + CASE WHEN $9 THEN 1 ELSE 0 END,
         responses = EXCLUDED.responses,
         completed_at = COALESCE(EXCLUDED.completed_at, grammar_progress.completed_at),
         updated_at = NOW()
       RETURNING answered, correct_count, total_count, best_correct, best_total, attempts, completed_at`,
      [
        cleanMssv,
        cleanLesson,
        answered,
        correct,
        totalCount,
        completed ? correct : null,
        completed && totalCount > 0 ? totalCount : null,
        JSON.stringify(savedResponses),
        completed
      ]
    );
    const row = rows[0];
    return {
      ok: true,
      answered: num(row.answered),
      correct_count: num(row.correct_count),
      total_count: num(row.total_count),
      best_correct: row.best_correct == null ? null : num(row.best_correct),
      best_total: row.best_total == null ? null : num(row.best_total),
      attempts: num(row.attempts),
      completed_at: row.completed_at || null
    };
  },

  async saveExtraProgress(mssv, lessonId, payload = {}) {
    const cleanMssv = cleanStr(mssv, 32);
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const cleanLesson = assertUuid(lessonId, 'lesson id');

    if (!Array.isArray(payload.responses)) throw httpError('Thiếu câu trả lời để chấm điểm.', 400);

    const lessonResult = await query('SELECT id FROM grammar_lessons WHERE id = $1', [cleanLesson]);
    if (!lessonResult.rows[0]) throw httpError('Bài học không tồn tại.', 404);

    const answerRows = await query(
      `SELECT id, type, correct_answer, explanation FROM grammar_extra_exercises WHERE lesson_id = $1`,
      [cleanLesson]
    );
    const total = answerRows.rows.length;
    const existingResult = await query(
      `SELECT answered, correct_count FROM grammar_extra_progress WHERE mssv = $1 AND lesson_id = $2`,
      [cleanMssv, cleanLesson]
    );
    const existing = existingResult.rows[0] || null;
    const baseAnswered = Math.min(Math.max(0, toInt(payload.answered_before) ?? 0), num(existing?.answered));
    const baseCorrect = Math.min(Math.max(0, toInt(payload.correct_before) ?? 0), num(existing?.correct_count));
    const entries = gradeResponseEntries(answerRows.rows, payload.responses);
    const answered = Math.min(total, baseAnswered + entries.length);
    const correct = Math.min(answered, baseCorrect + entries.filter((entry) => entry.correct).length);
    const completed = payload.completed === true && total > 0 && entries.length > 0 && answered >= total;
    const totalCount = completed ? total : answered;

    const { rows } = await query(
      `INSERT INTO grammar_extra_progress
         (mssv, lesson_id, answered, correct_count, total_count, best_correct, best_total, attempts, completed_at, responses, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $9 THEN 1 ELSE 0 END, CASE WHEN $9 THEN NOW() ELSE NULL END, $8::jsonb, NOW())
       ON CONFLICT (mssv, lesson_id) DO UPDATE SET
         answered = EXCLUDED.answered,
         correct_count = EXCLUDED.correct_count,
         total_count = EXCLUDED.total_count,
         best_correct = CASE
           WHEN EXCLUDED.best_correct IS NULL THEN grammar_extra_progress.best_correct
           WHEN grammar_extra_progress.best_correct IS NULL OR grammar_extra_progress.best_total IS NULL OR grammar_extra_progress.best_total <= 0 THEN EXCLUDED.best_correct
           WHEN (EXCLUDED.best_correct::numeric / NULLIF(EXCLUDED.best_total, 0)) >= (grammar_extra_progress.best_correct::numeric / NULLIF(grammar_extra_progress.best_total, 0)) THEN EXCLUDED.best_correct
           ELSE grammar_extra_progress.best_correct
         END,
         best_total = CASE
           WHEN EXCLUDED.best_correct IS NULL THEN grammar_extra_progress.best_total
           WHEN grammar_extra_progress.best_correct IS NULL OR grammar_extra_progress.best_total IS NULL OR grammar_extra_progress.best_total <= 0 THEN EXCLUDED.best_total
           WHEN (EXCLUDED.best_correct::numeric / NULLIF(EXCLUDED.best_total, 0)) >= (grammar_extra_progress.best_correct::numeric / NULLIF(grammar_extra_progress.best_total, 0)) THEN EXCLUDED.best_total
           ELSE grammar_extra_progress.best_total
         END,
         attempts = grammar_extra_progress.attempts + CASE WHEN $9 THEN 1 ELSE 0 END,
         completed_at = COALESCE(EXCLUDED.completed_at, grammar_extra_progress.completed_at),
         responses = EXCLUDED.responses,
         updated_at = NOW()
       RETURNING answered, correct_count, total_count, best_correct, best_total, attempts, completed_at`,
      [
        cleanMssv,
        cleanLesson,
        answered,
        correct,
        totalCount,
        completed ? correct : null,
        completed && totalCount > 0 ? totalCount : null,
        JSON.stringify(entries),
        completed
      ]
    );
    const row = rows[0];
    return {
      ok: true,
      answered: num(row.answered),
      correct_count: num(row.correct_count),
      total_count: num(row.total_count),
      best_correct: row.best_correct == null ? null : num(row.best_correct),
      best_total: row.best_total == null ? null : num(row.best_total),
      attempts: num(row.attempts),
      completed_at: row.completed_at || null
    };
  },

  // Kiểm tra một câu trả lời sau khi người học đã chọn (payload bài học không
  // còn chứa đáp án), trả kèm đáp án đúng + giải thích cho câu đó.
  async checkAnswer(lessonId, questionId, payload = {}) {
    const cleanLesson = assertUuid(lessonId, 'lesson id');
    const cleanQuestion = assertUuid(questionId, 'question id');
    const result = await query(
      `SELECT id, type, correct_answer, explanation FROM grammar_exercises
        WHERE id = $1 AND lesson_id = $2
       UNION ALL
       SELECT q.id, q.type, q.correct_answer, q.explanation
         FROM grammar_reading_questions q
         JOIN grammar_reading_exercises r ON r.id = q.reading_id
        WHERE q.id = $1 AND r.lesson_id = $2
       UNION ALL
       SELECT id, type, correct_answer, explanation FROM grammar_extra_exercises
        WHERE id = $1 AND lesson_id = $2`,
      [cleanQuestion, cleanLesson]
    );
    const row = result.rows[0];
    if (!row) throw httpError('Câu hỏi không tồn tại trong bài học.', 404);
    const response = normalizeResponse(payload?.response);
    // Chỉ tiết lộ đáp án khi người học đã thực sự chọn một câu trả lời —
    // tránh biến endpoint thành API tra đáp án tự do.
    if (response == null) {
      return { correct: false, correct_answer: '', explanation: '' };
    }
    return {
      correct: isAnswerCorrect(row.type, response, row.correct_answer),
      correct_answer: String(row.correct_answer ?? ''),
      explanation: String(row.explanation ?? '')
    };
  }
};
