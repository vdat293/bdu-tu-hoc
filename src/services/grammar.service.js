import { isDatabaseConfigured, query } from '../db/database.js';

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

function accuracyOf(correct, total) {
  const c = num(correct);
  const t = num(total);
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function mapExercise(row) {
  return {
    id: row.id,
    type: row.type,
    question: row.question,
    options: [row.option_a, row.option_b, row.option_c, row.option_d].filter((v) => String(v ?? '').trim() !== ''),
    option_a: row.option_a,
    option_b: row.option_b,
    option_c: row.option_c,
    option_d: row.option_d,
    correct_answer: row.correct_answer,
    correct_option: row.correct_option || '',
    explanation: row.explanation,
    hint: row.hint || '',
    order: num(row.order_idx)
  };
}

const EXERCISE_COLUMNS = `id, type, question, option_a, option_b, option_c, option_d,
  correct_answer, correct_option, explanation, hint, order_idx`;

const READING_QUESTION_COLUMNS = `id, type, question, option_a, option_b, option_c, option_d,
  correct_answer, correct_option, explanation, order_idx`;

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

    const [rulesResult, exercisesResult, readingsResult, progressResult] = await Promise.all([
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
        `SELECT answered, correct_count, total_count, best_correct, best_total, attempts, completed_at
         FROM grammar_progress WHERE mssv = $1 AND lesson_id = $2`,
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
            completed_at: progress.completed_at || null
          }
        : null
    };
  },

  async saveProgress(mssv, lessonId, payload = {}) {
    const cleanMssv = cleanStr(mssv, 32);
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const cleanLesson = assertUuid(lessonId, 'lesson id');

    const lessonResult = await query('SELECT id, question_count FROM grammar_lessons WHERE id = $1', [cleanLesson]);
    const lesson = lessonResult.rows[0];
    if (!lesson) throw httpError('Bài học không tồn tại.', 404);

    const total = num(lesson.question_count);
    const completed = Boolean(payload.completed);
    const totalCount = completed ? total : Math.min(total, Math.max(0, num(payload.total, total)));
    const answered = completed ? total : Math.min(totalCount, Math.max(0, num(payload.answered)));
    const correct = Math.min(answered, Math.max(0, num(payload.correct)));

    const existingResult = await query(
      `SELECT answered, correct_count, total_count, best_correct, best_total, attempts
       FROM grammar_progress WHERE mssv = $1 AND lesson_id = $2`,
      [cleanMssv, cleanLesson]
    );
    const existing = existingResult.rows[0] || null;

    let bestCorrect = existing?.best_correct == null ? null : num(existing.best_correct);
    let bestTotal = existing?.best_total == null ? null : num(existing.best_total);
    let attempts = num(existing?.attempts);
    if (completed && totalCount > 0) {
      attempts += 1;
      const isBetter = bestTotal == null || bestTotal <= 0
        || correct / Math.max(totalCount, 1) >= bestCorrect / Math.max(bestTotal, 1);
      if (isBetter) {
        bestCorrect = correct;
        bestTotal = totalCount;
      }
    }

    const { rows } = await query(
      `INSERT INTO grammar_progress
         (mssv, lesson_id, answered, correct_count, total_count, best_correct, best_total, attempts, completed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (mssv, lesson_id) DO UPDATE SET
         answered = EXCLUDED.answered,
         correct_count = EXCLUDED.correct_count,
         total_count = EXCLUDED.total_count,
         best_correct = EXCLUDED.best_correct,
         best_total = EXCLUDED.best_total,
         attempts = EXCLUDED.attempts,
         completed_at = COALESCE(EXCLUDED.completed_at, grammar_progress.completed_at),
         updated_at = NOW()
       RETURNING answered, correct_count, total_count, best_correct, best_total, attempts, completed_at`,
      [cleanMssv, cleanLesson, answered, correct, totalCount, bestCorrect, bestTotal, attempts, completed]
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
  }
};
