import { isDatabaseConfigured, query, transaction } from '../../db/database.js';
import { findAccessibleCourse, normalizeCourseCode } from '../../services/learning.service.js';

const VALID_ANSWERS = new Set(['A', 'B', 'C', 'D']);
const VALID_FILTERS = new Set(['all', 'unanswered', 'wrong', 'bookmarked']);

function httpError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function requireDatabase() {
  if (!isDatabaseConfigured()) {
    throw httpError('Phòng ôn tập trắc nghiệm cần PostgreSQL nhưng DATABASE_URL chưa được cấu hình.', 503);
  }
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
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

function normalizeAnswer(value, { allowNull = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (allowNull) return null;
    throw httpError('Đáp án phải là A, B, C hoặc D.', 400, 'PRACTICE_ANSWER_INVALID');
  }
  const clean = String(value).trim().toUpperCase();
  if (!VALID_ANSWERS.has(clean)) {
    throw httpError('Đáp án phải là A, B, C hoặc D.', 400, 'PRACTICE_ANSWER_INVALID');
  }
  return clean;
}

function normalizeChapterFilter(rawChapter) {
  if (rawChapter === undefined || rawChapter === null || String(rawChapter).trim() === '' || String(rawChapter).trim().toLowerCase() === 'all') {
    return null;
  }
  const parsed = Number(rawChapter);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
    throw httpError('Chương học không hợp lệ.', 400, 'PRACTICE_CHAPTER_INVALID');
  }
  return parsed;
}

function normalizeQuestionFilter(rawFilter) {
  const clean = String(rawFilter || 'all').trim().toLowerCase();
  if (!VALID_FILTERS.has(clean)) {
    throw httpError('Bộ lọc câu hỏi không hợp lệ.', 400, 'PRACTICE_FILTER_INVALID');
  }
  return clean;
}

function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function shuffleArray(items, rng = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Chọn đề thi thử phân bổ đều theo các chương có trong danh sách câu hỏi.
 */
function selectBalancedExamQuestions(rows, requestedCount, rng = Math.random) {
  const totalAvailable = rows.length;
  const targetCount = Math.min(totalAvailable, Math.max(1, requestedCount));
  if (targetCount === 0) return [];

  const bucketsByChapter = new Map();
  for (const row of rows) {
    const ch = Number(row.chapter_index || 1);
    if (!bucketsByChapter.has(ch)) bucketsByChapter.set(ch, []);
    bucketsByChapter.get(ch).push(row);
  }

  const chapterKeys = Array.from(bucketsByChapter.keys()).sort((a, b) => a - b);
  const shuffledBuckets = chapterKeys.map((ch) => shuffleArray(bucketsByChapter.get(ch), rng));

  const picked = [];
  let roundIndex = 0;
  while (picked.length < targetCount) {
    let addedInRound = false;
    for (const bucket of shuffledBuckets) {
      if (picked.length >= targetCount) break;
      if (roundIndex < bucket.length) {
        picked.push(bucket[roundIndex]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    roundIndex += 1;
  }

  return shuffleArray(picked, rng);
}

function computeChapterBreakdown(gradedResults) {
  const byChapter = new Map();
  for (const item of gradedResults) {
    const idx = Number(item.chapter_index);
    if (!byChapter.has(idx)) {
      byChapter.set(idx, {
        chapter_index: idx,
        chapter_title: item.chapter_title,
        total: 0,
        correct: 0,
        wrong: 0,
        skipped: 0
      });
    }
    const entry = byChapter.get(idx);
    entry.total += 1;
    if (!item.selected_answer) entry.skipped += 1;
    else if (item.is_correct) entry.correct += 1;
    else entry.wrong += 1;
  }

  return Array.from(byChapter.values())
    .sort((a, b) => a.chapter_index - b.chapter_index)
    .map((entry) => ({
      ...entry,
      accuracy_percent: entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0
    }));
}

function gradeExamSubmission(submittedAnswers, questionMap) {
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  const results = submittedAnswers.map(({ questionId, selectedAnswer }) => {
    const q = questionMap.get(String(questionId));
    const isAnswered = selectedAnswer !== null;
    const isCorrect = isAnswered && selectedAnswer === q.correct_answer;
    if (!isAnswered) skippedCount += 1;
    else if (isCorrect) correctCount += 1;
    else wrongCount += 1;

    return {
      question_id: String(q.id),
      external_id: Number(q.external_id),
      chapter_index: Number(q.chapter_index),
      chapter_title: q.chapter_title,
      question_text: q.question_text,
      options: q.options || {},
      selected_answer: selectedAnswer,
      correct_answer: q.correct_answer,
      is_correct: isCorrect,
      explanation: q.explanation || ''
    };
  });

  const totalQuestions = results.length;
  const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  return {
    total_questions: totalQuestions,
    correct_count: correctCount,
    wrong_count: wrongCount,
    skipped_count: skippedCount,
    score_percent: scorePercent,
    chapter_breakdown: computeChapterBreakdown(results),
    results
  };
}

async function loadEnabledBank(courseCode, db = { query }) {
  const result = await db.query(
    `SELECT id, course_code, title, description, chapters, question_count, enabled
     FROM course_practice_banks
     WHERE course_code = $1 AND enabled = TRUE
     LIMIT 1;`,
    [courseCode]
  );
  return result.rows[0] || null;
}

async function resolveCourseAndBank(mssv, courseCode, { requireBank = true, db = { query } } = {}) {
  const cleanMssv = normalizeMssv(mssv);
  const course = await findAccessibleCourse(cleanMssv, courseCode, db);
  const normalizedCode = normalizeCourseCode(course.normalized_code || courseCode);
  const bank = await loadEnabledBank(normalizedCode, db);
  if (requireBank && !bank) {
    throw httpError('Môn học này chưa có phòng ôn tập trắc nghiệm riêng.', 404, 'PRACTICE_BANK_NOT_FOUND');
  }
  return { cleanMssv, course, normalizedCode, bank };
}

function mapQuestionRow(row) {
  const isAnswered = row.selected_answer !== null && row.selected_answer !== undefined;
  return {
    id: String(row.id),
    external_id: Number(row.external_id),
    chapter_index: Number(row.chapter_index),
    chapter_title: row.chapter_title,
    question_text: row.question_text,
    options: row.options || {},
    // Anti-spoiler: chỉ trả lời giải & đáp án khi câu hỏi đã được trả lời.
    correct_answer: isAnswered ? row.correct_answer : null,
    explanation: isAnswered ? (row.explanation || '') : null,
    progress: {
      selected_answer: isAnswered ? row.selected_answer : null,
      is_correct: isAnswered ? Boolean(row.is_correct) : null,
      is_bookmarked: Boolean(row.is_bookmarked),
      attempts: Number(row.attempts || 0),
      wrong_count: Number(row.wrong_count || 0),
      last_answered_at: row.last_answered_at || null
    }
  };
}

export const PracticeBankService = {
  async getSummary(mssv, courseCode) {
    requireDatabase();
    const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode, { requireBank: false });
    if (!bank) {
      return { enabled: false };
    }

    const [chaptersRes, examsRes] = await Promise.all([
      query(
        `SELECT
           q.chapter_index,
           MIN(q.chapter_title) AS chapter_title,
           COUNT(q.id)::int AS total,
           COUNT(p.question_id) FILTER (WHERE p.selected_answer IS NOT NULL)::int AS answered,
           COUNT(p.question_id) FILTER (WHERE p.is_correct = TRUE)::int AS correct,
           COUNT(p.question_id) FILTER (WHERE p.selected_answer IS NOT NULL AND p.is_correct = FALSE)::int AS wrong,
           COUNT(p.question_id) FILTER (WHERE p.is_bookmarked = TRUE)::int AS bookmarked
         FROM course_practice_questions q
         LEFT JOIN course_practice_progress p
           ON p.question_id = q.id AND p.mssv = $2
         WHERE q.bank_id = $1
         GROUP BY q.chapter_index
         ORDER BY q.chapter_index ASC;`,
        [bank.id, cleanMssv]
      ),
      query(
        `SELECT id, mode, chapter_index, total_questions, correct_count, duration_seconds, created_at
         FROM course_practice_exam_attempts
         WHERE mssv = $1 AND bank_id = $2
         ORDER BY created_at DESC
         LIMIT 8;`,
        [cleanMssv, bank.id]
      )
    ]);

    const chapters = chaptersRes.rows.map((row) => {
      const total = Number(row.total || 0);
      const answered = Number(row.answered || 0);
      const correct = Number(row.correct || 0);
      const wrong = Number(row.wrong || 0);
      const bookmarked = Number(row.bookmarked || 0);
      return {
        chapter_index: Number(row.chapter_index),
        chapter_title: row.chapter_title,
        total,
        answered,
        correct,
        wrong,
        bookmarked,
        accuracy_percent: answered > 0 ? Math.round((correct / answered) * 100) : 0,
        completion_percent: total > 0 ? Math.round((answered / total) * 100) : 0
      };
    });

    const totals = chapters.reduce(
      (acc, ch) => {
        acc.total_questions += ch.total;
        acc.answered_count += ch.answered;
        acc.correct_count += ch.correct;
        acc.wrong_count += ch.wrong;
        acc.bookmarked_count += ch.bookmarked;
        return acc;
      },
      { total_questions: 0, answered_count: 0, correct_count: 0, wrong_count: 0, bookmarked_count: 0 }
    );

    return {
      enabled: true,
      bank: {
        id: String(bank.id),
        course_code: bank.course_code,
        title: bank.title,
        description: bank.description || '',
        question_count: Number(bank.question_count || totals.total_questions)
      },
      stats: {
        ...totals,
        accuracy_percent: totals.answered_count > 0
          ? Math.round((totals.correct_count / totals.answered_count) * 100)
          : 0,
        completion_percent: totals.total_questions > 0
          ? Math.round((totals.answered_count / totals.total_questions) * 100)
          : 0
      },
      chapters,
      recent_exams: examsRes.rows.map((row) => ({
        id: String(row.id),
        mode: row.mode,
        chapter_index: row.chapter_index !== null ? Number(row.chapter_index) : null,
        total_questions: Number(row.total_questions),
        correct_count: Number(row.correct_count),
        score_percent: row.total_questions > 0 ? Math.round((row.correct_count / row.total_questions) * 100) : 0,
        duration_seconds: Number(row.duration_seconds || 0),
        created_at: row.created_at
      }))
    };
  },

  async getQuestions(mssv, courseCode, { chapter, filter, search } = {}) {
    requireDatabase();
    const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode);
    const cleanChapter = normalizeChapterFilter(chapter);
    const cleanFilter = normalizeQuestionFilter(filter);
    const cleanSearch = String(search || '').trim().slice(0, 120);

    const params = [bank.id, cleanMssv];
    const conditions = ['q.bank_id = $1'];

    if (cleanChapter !== null) {
      params.push(cleanChapter);
      conditions.push(`q.chapter_index = $${params.length}`);
    }

    if (cleanFilter === 'unanswered') {
      conditions.push('p.selected_answer IS NULL');
    } else if (cleanFilter === 'wrong') {
      conditions.push('p.selected_answer IS NOT NULL AND p.is_correct = FALSE');
    } else if (cleanFilter === 'bookmarked') {
      conditions.push('p.is_bookmarked = TRUE');
    }

    if (cleanSearch) {
      params.push(`%${escapeLikePattern(cleanSearch)}%`);
      const idx = params.length;
      conditions.push(
        `(q.question_text ILIKE $${idx} ESCAPE '\\' OR q.chapter_title ILIKE $${idx} ESCAPE '\\' OR q.options::text ILIKE $${idx} ESCAPE '\\')`
      );
    }

    const result = await query(
      `SELECT
         q.id, q.external_id, q.chapter_index, q.chapter_title,
         q.question_text, q.options, q.correct_answer, q.explanation,
         p.selected_answer, p.is_correct, p.is_bookmarked,
         p.attempts, p.wrong_count, p.last_answered_at
       FROM course_practice_questions q
       LEFT JOIN course_practice_progress p
         ON p.question_id = q.id AND p.mssv = $2
       WHERE ${conditions.join(' AND ')}
       ORDER BY q.chapter_index ASC, q.external_id ASC;`,
      params
    );

    return {
      bank: {
        id: String(bank.id),
        course_code: bank.course_code,
        title: bank.title,
        question_count: Number(bank.question_count)
      },
      questions: result.rows.map(mapQuestionRow)
    };
  },

  async answerQuestion(mssv, courseCode, questionId, selectedAnswer) {
    requireDatabase();
    const cleanQuestionId = normalizeRecordId(questionId);
    if (!cleanQuestionId) throw httpError('Mã câu hỏi không hợp lệ.', 400, 'PRACTICE_QUESTION_INVALID');
    const cleanAnswer = normalizeAnswer(selectedAnswer);

    return transaction(async (client) => {
      const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode, { db: client });
      const qRes = await client.query(
        `SELECT id, external_id, correct_answer, explanation
         FROM course_practice_questions
         WHERE id = $1 AND bank_id = $2
         LIMIT 1;`,
        [cleanQuestionId, bank.id]
      );
      if (!qRes.rows.length) {
        throw httpError('Không tìm thấy câu hỏi trong ngân hàng ôn tập.', 404, 'PRACTICE_QUESTION_NOT_FOUND');
      }

      const question = qRes.rows[0];
      const isCorrect = cleanAnswer === question.correct_answer;

      const progressRes = await client.query(
        `INSERT INTO course_practice_progress (
           mssv, bank_id, question_id, selected_answer, is_correct,
           attempts, wrong_count, last_answered_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, 1, $6, NOW(), NOW())
         ON CONFLICT (mssv, question_id) DO UPDATE SET
           selected_answer = EXCLUDED.selected_answer,
           is_correct = EXCLUDED.is_correct,
           attempts = course_practice_progress.attempts + 1,
           wrong_count = course_practice_progress.wrong_count + CASE WHEN EXCLUDED.is_correct THEN 0 ELSE 1 END,
           last_answered_at = NOW(),
           updated_at = NOW()
         RETURNING attempts, wrong_count, is_bookmarked;`,
        [cleanMssv, bank.id, question.id, cleanAnswer, isCorrect, isCorrect ? 0 : 1]
      );

      const prog = progressRes.rows[0];
      return {
        question_id: String(question.id),
        external_id: Number(question.external_id),
        selected_answer: cleanAnswer,
        is_correct: isCorrect,
        correct_answer: question.correct_answer,
        explanation: question.explanation || '',
        attempts: Number(prog.attempts),
        wrong_count: Number(prog.wrong_count),
        is_bookmarked: Boolean(prog.is_bookmarked)
      };
    });
  },

  async toggleBookmark(mssv, courseCode, questionId, bookmarked) {
    requireDatabase();
    const cleanQuestionId = normalizeRecordId(questionId);
    if (!cleanQuestionId) throw httpError('Mã câu hỏi không hợp lệ.', 400, 'PRACTICE_QUESTION_INVALID');

    return transaction(async (client) => {
      const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode, { db: client });
      const qRes = await client.query(
        'SELECT id FROM course_practice_questions WHERE id = $1 AND bank_id = $2 LIMIT 1;',
        [cleanQuestionId, bank.id]
      );
      if (!qRes.rows.length) {
        throw httpError('Không tìm thấy câu hỏi trong ngân hàng ôn tập.', 404, 'PRACTICE_QUESTION_NOT_FOUND');
      }

      let result;
      if (typeof bookmarked === 'boolean') {
        result = await client.query(
          `INSERT INTO course_practice_progress (mssv, bank_id, question_id, is_bookmarked, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (mssv, question_id) DO UPDATE SET
             is_bookmarked = EXCLUDED.is_bookmarked,
             updated_at = NOW()
           RETURNING is_bookmarked;`,
          [cleanMssv, bank.id, cleanQuestionId, bookmarked]
        );
      } else {
        result = await client.query(
          `INSERT INTO course_practice_progress (mssv, bank_id, question_id, is_bookmarked, updated_at)
           VALUES ($1, $2, $3, TRUE, NOW())
           ON CONFLICT (mssv, question_id) DO UPDATE SET
             is_bookmarked = NOT course_practice_progress.is_bookmarked,
             updated_at = NOW()
           RETURNING is_bookmarked;`,
          [cleanMssv, bank.id, cleanQuestionId]
        );
      }

      return {
        question_id: String(cleanQuestionId),
        is_bookmarked: Boolean(result.rows[0]?.is_bookmarked)
      };
    });
  },

  async startMockExam(mssv, courseCode, { count = 40, chapters = [] } = {}) {
    requireDatabase();
    const { bank } = await resolveCourseAndBank(mssv, courseCode);

    const parsedCount = Number(count ?? 40);
    if (!Number.isFinite(parsedCount)) {
      throw httpError('Số câu thi thử không hợp lệ.', 400, 'PRACTICE_EXAM_COUNT_INVALID');
    }
    const clampedCount = Math.min(100, Math.max(10, Math.trunc(parsedCount)));

    let cleanChapters = [];
    if (Array.isArray(chapters) && chapters.length > 0) {
      cleanChapters = [...new Set(chapters.map((ch) => normalizeChapterFilter(ch)).filter((ch) => ch !== null))];
    }

    const params = [bank.id];
    let chapterClause = '';
    if (cleanChapters.length > 0) {
      params.push(cleanChapters);
      chapterClause = 'AND chapter_index = ANY($2::smallint[])';
    }

    const result = await query(
      `SELECT id, external_id, chapter_index, chapter_title, question_text, options
       FROM course_practice_questions
       WHERE bank_id = $1 ${chapterClause}
       ORDER BY chapter_index ASC, external_id ASC;`,
      params
    );

    if (!result.rows.length) {
      throw httpError('Không có câu hỏi phù hợp để tạo đề thi thử.', 400, 'PRACTICE_EXAM_EMPTY');
    }

    const selected = selectBalancedExamQuestions(result.rows, clampedCount);

    return {
      bank_id: String(bank.id),
      course_code: bank.course_code,
      chapter_index: cleanChapters.length === 1 ? cleanChapters[0] : null,
      total_questions: selected.length,
      time_limit_seconds: Math.max(300, Math.round(selected.length * 45)),
      questions: selected.map((row) => ({
        id: String(row.id),
        external_id: Number(row.external_id),
        chapter_index: Number(row.chapter_index),
        chapter_title: row.chapter_title,
        question_text: row.question_text,
        options: row.options || {}
      }))
    };
  },

  async submitMockExam(mssv, courseCode, { answers = [], durationSeconds = 0, chapterIndex = null } = {}) {
    requireDatabase();
    if (!Array.isArray(answers) || answers.length === 0 || answers.length > 150) {
      throw httpError('Danh sách câu trả lời thi thử không hợp lệ.', 400, 'PRACTICE_EXAM_ANSWERS_INVALID');
    }

    const normalizedAnswers = [];
    const seenIds = new Set();
    for (const item of answers) {
      const qId = normalizeRecordId(item?.questionId ?? item?.question_id);
      if (!qId) throw httpError('Câu hỏi trong bài thi thử không hợp lệ.', 400, 'PRACTICE_QUESTION_INVALID');
      if (seenIds.has(qId)) throw httpError('Trùng câu hỏi trong bài thi thử.', 400, 'PRACTICE_EXAM_DUPLICATE_QUESTION');
      seenIds.add(qId);
      const selectedAnswer = normalizeAnswer(item?.selectedAnswer ?? item?.selected_answer, { allowNull: true });
      normalizedAnswers.push({ questionId: qId, selectedAnswer });
    }

    const cleanDuration = Math.max(0, Math.min(14400, Math.trunc(Number(durationSeconds) || 0)));
    const cleanChapter = normalizeChapterFilter(chapterIndex);

    return transaction(async (client) => {
      const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode, { db: client });
      const ids = normalizedAnswers.map((a) => a.questionId);
      const qRes = await client.query(
        `SELECT id, external_id, chapter_index, chapter_title, question_text, options, correct_answer, explanation
         FROM course_practice_questions
         WHERE bank_id = $1 AND id = ANY($2::bigint[]);`,
        [bank.id, ids]
      );

      if (qRes.rows.length !== ids.length) {
        throw httpError('Một số câu hỏi không thuộc ngân hàng ôn tập này.', 400, 'PRACTICE_QUESTION_NOT_FOUND');
      }

      const questionMap = new Map(qRes.rows.map((row) => [String(row.id), row]));
      const graded = gradeExamSubmission(normalizedAnswers, questionMap);

      const attemptRes = await client.query(
        `INSERT INTO course_practice_exam_attempts (
           mssv, bank_id, mode, chapter_index, total_questions, correct_count, duration_seconds
         )
         VALUES ($1, $2, 'mock_exam', $3, $4, $5, $6)
         RETURNING id, created_at;`,
        [
          cleanMssv,
          bank.id,
          cleanChapter,
          graded.total_questions,
          graded.correct_count,
          cleanDuration
        ]
      );

      // Đồng bộ câu đã trả lời trong bài thi thử vào tiến độ ôn tập để sinh viên
      // có thể bấm "Ôn ngay câu làm sai" sau khi nộp bài.
      for (const item of graded.results) {
        if (!item.selected_answer) continue;
        await client.query(
          `INSERT INTO course_practice_progress (
             mssv, bank_id, question_id, selected_answer, is_correct,
             attempts, wrong_count, last_answered_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, 1, $6, NOW(), NOW())
           ON CONFLICT (mssv, question_id) DO UPDATE SET
             selected_answer = EXCLUDED.selected_answer,
             is_correct = EXCLUDED.is_correct,
             attempts = course_practice_progress.attempts + 1,
             wrong_count = course_practice_progress.wrong_count + CASE WHEN EXCLUDED.is_correct THEN 0 ELSE 1 END,
             last_answered_at = NOW(),
             updated_at = NOW();`,
          [cleanMssv, bank.id, item.question_id, item.selected_answer, item.is_correct, item.is_correct ? 0 : 1]
        );
      }

      return {
        attempt_id: String(attemptRes.rows[0].id),
        created_at: attemptRes.rows[0].created_at,
        duration_seconds: cleanDuration,
        ...graded
      };
    });
  },

  async resetProgress(mssv, courseCode, { chapter = null, keepBookmarks = true } = {}) {
    requireDatabase();
    const cleanChapter = normalizeChapterFilter(chapter);
    const preserveBookmarks = keepBookmarks !== false;

    return transaction(async (client) => {
      const { cleanMssv, bank } = await resolveCourseAndBank(mssv, courseCode, { db: client });
      const params = [cleanMssv, bank.id];
      const chapterSubquery = cleanChapter !== null
        ? (() => {
            params.push(cleanChapter);
            return `AND question_id IN (SELECT id FROM course_practice_questions WHERE bank_id = $2 AND chapter_index = $${params.length})`;
          })()
        : '';

      if (preserveBookmarks) {
        await client.query(
          `DELETE FROM course_practice_progress
           WHERE mssv = $1 AND bank_id = $2 AND is_bookmarked = FALSE ${chapterSubquery};`,
          params
        );
        await client.query(
          `UPDATE course_practice_progress
           SET selected_answer = NULL,
               is_correct = NULL,
               attempts = 0,
               wrong_count = 0,
               last_answered_at = NULL,
               updated_at = NOW()
           WHERE mssv = $1 AND bank_id = $2 AND is_bookmarked = TRUE ${chapterSubquery};`,
          params
        );
      } else {
        await client.query(
          `DELETE FROM course_practice_progress
           WHERE mssv = $1 AND bank_id = $2 ${chapterSubquery};`,
          params
        );
      }

      return {
        reset: true,
        chapter: cleanChapter,
        keep_bookmarks: preserveBookmarks
      };
    });
  }
};

export const PracticeBankInternals = {
  selectBalancedExamQuestions,
  computeChapterBreakdown,
  gradeExamSubmission,
  escapeLikePattern
};
