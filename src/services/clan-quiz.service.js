import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { PermissionService } from './permission.service.js';

const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 8;

function error(message, status = 400, code = 'CLAN_QUIZ_INVALID') {
  const result = new Error(message);
  result.status = status;
  result.code = code;
  return result;
}

function readField(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function parseOptions(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
  } catch {}
  return text.split('|').map((item) => item.trim()).filter(Boolean);
}

export function normalizeQuizQuestions(rows) {
  if (!Array.isArray(rows)) throw error('Danh sách câu hỏi quiz phải là một mảng.');
  if (rows.length > MAX_QUESTIONS) throw error(`Quiz chỉ được tối đa ${MAX_QUESTIONS} câu hỏi.`);

  return rows.map((row, index) => {
    const prompt = String(readField(row, 'prompt', 'question', 'text') ?? '').trim();
    const options = parseOptions(readField(row, 'options', 'choices', 'answers'));
    const rawCorrect = readField(row, 'correctIndex', 'correctindex', 'correct_index', 'answer', 'correctAnswer');
    const correctIndex = Number(rawCorrect);
    const explanation = String(readField(row, 'explanation', 'explain') ?? '').trim();
    if (!prompt) throw error(`Câu ${index + 1} chưa có nội dung.`);
    if (options.length < 2 || options.length > MAX_OPTIONS) {
      throw error(`Câu ${index + 1} phải có từ 2 đến ${MAX_OPTIONS} lựa chọn.`);
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw error(`Đáp án đúng của câu ${index + 1} phải là chỉ số 0..${options.length - 1}.`);
    }
    return { prompt, options, correct_index: correctIndex, explanation };
  });
}

export function parseQuizImport(text, format = 'json') {
  const source = String(text ?? '').trim();
  if (!source) throw error('Nội dung import quiz đang trống.');
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(source); } catch { throw error('JSON quiz không hợp lệ.'); }
    const rows = Array.isArray(parsed) ? parsed : parsed?.questions;
    return normalizeQuizQuestions(rows);
  }
  if (format !== 'csv') throw error('Định dạng quiz chỉ hỗ trợ JSON hoặc CSV.');

  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) records.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) records.push(row); }
  if (records.length < 2) throw error('CSV quiz phải có dòng tiêu đề và ít nhất một câu hỏi.');
  const headers = records[0].map((header) => header.trim().toLowerCase());
  return normalizeQuizQuestions(records.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  )));
}

export function validateQuizConfig({ enabled = false, minCorrect = 0, questions = [] } = {}) {
  const normalizedQuestions = normalizeQuizQuestions(questions);
  const threshold = Number(minCorrect);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > normalizedQuestions.length) {
    throw error(`Số câu đúng tối thiểu phải từ 0 đến ${normalizedQuestions.length}.`);
  }
  if (enabled && normalizedQuestions.length === 0) throw error('Muốn bật quiz, CLB phải có ít nhất một câu hỏi.');
  return { enabled: Boolean(enabled), min_correct: threshold, questions: normalizedQuestions };
}

export async function getClanQuiz(clanId) {
  if (!isDatabaseConfigured()) return { enabled: false, min_correct: 0, total: 0, questions: [] };
  const result = await query(`
    SELECT q.id AS quiz_id, q.enabled, q.min_correct,
      qq.id, qq.question_order, qq.prompt, qq.options
    FROM clans c
    LEFT JOIN clan_quizzes q ON q.clan_id = c.id
    LEFT JOIN clan_quiz_questions qq ON qq.quiz_id = q.id
    WHERE c.id = $1
    ORDER BY qq.question_order ASC;
  `, [clanId]);
  if (result.rows.length === 0) throw error('Không tìm thấy CLB.', 404, 'CLAN_NOT_FOUND');
  const first = result.rows[0];
  const questions = result.rows.filter((row) => row.id !== null).map((row) => ({
    id: row.id,
    order: row.question_order,
    prompt: row.prompt,
    options: row.options
  }));
  return { enabled: Boolean(first.enabled), min_correct: Number(first.min_correct || 0), total: questions.length, questions };
}

export async function saveClanQuiz(clanId, requesterMssv, config) {
  await PermissionService.requireInClan(requesterMssv, clanId, 'clan:edit', 'Chỉ Bang Chủ mới được cấu hình quiz gia nhập.');
  const hasQuestions = Array.isArray(config?.questions);
  let normalized;
  if (hasQuestions) {
    normalized = validateQuizConfig(config);
  } else {
    const existing = await query(`
      SELECT q.enabled, q.min_correct, COUNT(qq.id)::int AS total
      FROM clan_quizzes q
      LEFT JOIN clan_quiz_questions qq ON qq.quiz_id = q.id
      WHERE q.clan_id = $1
      GROUP BY q.id;
    `, [clanId]);
    const row = existing.rows[0];
    const total = Number(row?.total || 0);
    const threshold = Number(config?.minCorrect ?? row?.min_correct ?? 0);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > total) {
      throw error(`Số câu đúng tối thiểu phải từ 0 đến ${total}.`);
    }
    if (Boolean(config?.enabled) && total === 0) {
      throw error('Muốn bật quiz, CLB phải có ít nhất một câu hỏi.');
    }
    normalized = { enabled: Boolean(config?.enabled), min_correct: threshold, questions: null };
  }
  await transaction(async (client) => {
    const quiz = await client.query(`
      INSERT INTO clan_quizzes (clan_id, enabled, min_correct, updated_by_mssv)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (clan_id) DO UPDATE SET enabled = EXCLUDED.enabled, min_correct = EXCLUDED.min_correct,
        updated_by_mssv = EXCLUDED.updated_by_mssv, updated_at = NOW()
      RETURNING id;
    `, [clanId, normalized.enabled, normalized.min_correct, requesterMssv]);
    const quizId = quiz.rows[0].id;
    if (normalized.questions) {
      await client.query('DELETE FROM clan_quiz_questions WHERE quiz_id = $1', [quizId]);
      for (const [index, question] of normalized.questions.entries()) {
        await client.query(`
          INSERT INTO clan_quiz_questions (quiz_id, question_order, prompt, options, correct_index, explanation)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        `, [quizId, index + 1, question.prompt, JSON.stringify(question.options), question.correct_index, question.explanation || null]);
      }
    }
  });
  return getClanQuiz(clanId);
}

export async function getQuizForSubmission(client, clanId) {
  const result = await client.query(`
    SELECT q.id AS quiz_id, q.enabled, q.min_correct,
      qq.id, qq.question_order, qq.prompt, qq.options, qq.correct_index, qq.explanation
    FROM clan_quizzes q
    JOIN clan_quiz_questions qq ON qq.quiz_id = q.id
    WHERE q.clan_id = $1 AND q.enabled = TRUE
    ORDER BY qq.question_order ASC
    FOR UPDATE OF q, qq;
  `, [clanId]);
  if (!result.rows.length) return null;
  const first = result.rows[0];
  return {
    quiz_id: first.quiz_id,
    enabled: true,
    min_correct: Number(first.min_correct),
    questions: result.rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      options: row.options,
      correct_index: Number(row.correct_index),
      explanation: row.explanation || ''
    }))
  };
}

export function scoreQuizSubmission(quiz, answers) {
  const submitted = new Map();
  for (const answer of Array.isArray(answers) ? answers : []) {
    const id = String(readField(answer, 'questionId', 'question_id', 'id') ?? '');
    const selected = Number(readField(answer, 'selectedIndex', 'selected_index', 'answer'));
    if (id && Number.isInteger(selected)) submitted.set(id, selected);
  }
  const results = quiz.questions.map((question) => {
    const selected = submitted.get(String(question.id));
    if (!Number.isInteger(selected) || selected < 0 || selected >= question.options.length) throw error('Quiz phải trả lời đầy đủ và hợp lệ tất cả câu hỏi.');
    const correct = selected === question.correct_index;
    return { question_id: question.id, selected_index: selected, correct, correct_index: question.correct_index, explanation: question.explanation };
  });
  const score = results.filter((item) => item.correct).length;
  return { score, total: results.length, passed: score >= quiz.min_correct, results };
}

export { MAX_QUESTIONS };
