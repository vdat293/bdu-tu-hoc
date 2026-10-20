/**
 * Module dùng chung parse/validate/grade quiz bdu-quiz/v1.
 * Thuần JavaScript, không import DB/DOM, dùng cho client và server.
 */

export const QUIZ_SCHEMA = 'bdu-quiz/v1';
export const QUIZ_MAX_BYTES = 256 * 1024;
export const QUIZ_MAX_QUESTIONS = 100;
export const QUIZ_MIN_OPTIONS = 2;
export const QUIZ_MAX_OPTIONS = 6;
export const QUIZ_DEFAULT_TIME_LIMIT = 0;

export const QUIZ_SET_MAX_QUESTIONS = 500;
export const QUIZ_SET_MAX_PARTS = 20;
export const QUIZ_SET_MIN_PER_PART = 5;
export const QUIZ_SET_MAX_PER_PART = 25;
export const QUIZ_SET_DEFAULT_MAX_PER_PART = 20;
export const QUIZ_SET_MIN_MINUTES_PER_PART = 5;
export const QUIZ_SET_MAX_MINUTES_PER_PART = 180;
export const QUIZ_SET_DEFAULT_MINUTES_PER_PART = 30;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function hasControlChar(value) {
  return CONTROL_CHARS.test(value);
}

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function cleanText(value) {
  return normalizeNewlines(value).trim();
}

/**
 * Trả về chuỗi option canonical (newline đã chuẩn hóa + trim) khớp value,
 * so sánh không phân biệt hoa/thường; null nếu không khớp.
 */
function matchOption(options, value) {
  if (!Array.isArray(options) || typeof value !== 'string') return null;
  const wanted = cleanText(value).toLocaleLowerCase('vi-VN');
  if (wanted === '') return null;
  for (const opt of options) {
    if (typeof opt !== 'string') continue;
    const canonical = cleanText(opt);
    if (canonical.toLocaleLowerCase('vi-VN') === wanted) return canonical;
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, path, message) {
  errors.push({ path, message });
}

function validateTimeLimit(errors, value) {
  if (value === undefined || value === null) return QUIZ_DEFAULT_TIME_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || typeof value === 'boolean') {
    pushError(errors, '$.timeLimitSeconds', 'timeLimitSeconds phải là số nguyên.');
    return null;
  }
  if (value !== 0 && (value < 30 || value > 14400)) {
    pushError(errors, '$.timeLimitSeconds', 'timeLimitSeconds phải là 0 hoặc 30–14400.');
    return null;
  }
  return value;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Chuẩn hóa + validate một câu hỏi bdu-quiz/v1.
 * `ignoreId` dùng khi gộp nhiều file: bỏ ID gốc và cấp lại ID toàn cục sau đó.
 */
function normalizeQuestion(raw, idx, errors, {
  hasAnyId = false,
  seenIds = new Set(),
  ignoreId = false
} = {}) {
  const qPath = `questions[${idx}]`;
  if (!isPlainObject(raw)) {
    pushError(errors, qPath, `Câu ${idx + 1}: phải là object.`);
    return null;
  }

  // id
  let id = undefined;
  if (!ignoreId) {
    if (Object.prototype.hasOwnProperty.call(raw, 'id')) {
      if (typeof raw.id !== 'string') {
        pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id phải là chuỗi.`);
      } else {
        const nid = cleanText(raw.id);
        if (nid.length < 1 || nid.length > 64 || !ID_RE.test(nid) || hasControlChar(nid)) {
          pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id không hợp lệ.`);
        } else {
          id = nid;
        }
      }
    } else if (hasAnyId) {
      pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: thiếu id.`);
    }
  }

  // question
  let questionText = null;
  if (typeof raw.question !== 'string') {
    pushError(errors, `${qPath}.question`, `Câu ${idx + 1}: question phải là chuỗi.`);
  } else {
    const nq = cleanText(raw.question);
    if (nq.length < 1 || nq.length > 2000) {
      pushError(errors, `${qPath}.question`, `Câu ${idx + 1}: question phải từ 1 đến 2000 ký tự.`);
    } else if (hasControlChar(nq)) {
      pushError(errors, `${qPath}.question`, `Câu ${idx + 1}: question chứa ký tự điều khiển.`);
    } else {
      questionText = nq;
    }
  }

  // options
  let options = null;
  if (!Array.isArray(raw.options)) {
    pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options phải là mảng.`);
  } else {
    if (raw.options.length < QUIZ_MIN_OPTIONS || raw.options.length > QUIZ_MAX_OPTIONS) {
      pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options phải có ${QUIZ_MIN_OPTIONS}–${QUIZ_MAX_OPTIONS} lựa chọn.`);
    }
    const opts = [];
    let optOk = true;
    raw.options.forEach((opt, oi) => {
      if (typeof opt !== 'string') {
        pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options[${oi}] phải là chuỗi.`);
        optOk = false;
        return;
      }
      const no = cleanText(opt);
      if (no.length < 1 || no.length > 500) {
        pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options[${oi}] phải từ 1 đến 500 ký tự.`);
        optOk = false;
        return;
      }
      if (hasControlChar(no)) {
        pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options[${oi}] chứa ký tự điều khiển.`);
        optOk = false;
        return;
      }
      opts.push(no);
    });
    if (optOk && opts.length >= QUIZ_MIN_OPTIONS && opts.length <= QUIZ_MAX_OPTIONS) {
      // duplicate check
      const seen = new Set();
      let dup = false;
      for (const o of opts) {
        const key = o.toLocaleLowerCase('vi-VN');
        if (seen.has(key)) { dup = true; break; }
        seen.add(key);
      }
      if (dup) {
        pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options trùng nhau.`);
      } else {
        options = opts;
      }
    }
  }

  // correct: nội dung option (trim + case-insensitive), lưu chuỗi option gốc (canonical)
  let correct = null;
  if (typeof raw.correct !== 'string') {
    pushError(errors, `${qPath}.correct`, `Câu ${idx + 1}: correct phải là chuỗi.`);
  } else if (options) {
    const matched = matchOption(options, raw.correct);
    if (matched === null) {
      pushError(
        errors,
        `${qPath}.correct`,
        `Câu ${idx + 1}: correct phải trùng một lựa chọn trong options.`
      );
    } else {
      correct = matched;
    }
  }

  // explanation (optional)
  let explanation = '';
  if (raw.explanation !== undefined && raw.explanation !== null) {
    if (typeof raw.explanation !== 'string') {
      pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation phải là chuỗi.`);
    } else {
      const ne = cleanText(raw.explanation);
      if (ne.length > 2000) {
        pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation vượt quá 2000 ký tự.`);
      } else if (hasControlChar(ne)) {
        pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation chứa ký tự điều khiển.`);
      } else {
        explanation = ne;
      }
    }
  }

  if (id !== undefined) {
    if (seenIds.has(id)) {
      pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id trùng.`);
    } else {
      seenIds.add(id);
    }
  }

  return {
    id,
    question: questionText,
    options,
    correct,
    explanation
  };
}

export function normalizeQuiz(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    pushError(errors, '$', 'Dữ liệu phải là object JSON.');
    return { ok: false, quiz: null, errors };
  }

  // schema
  if (input.schema !== QUIZ_SCHEMA) {
    pushError(errors, '$.schema', 'schema phải là "bdu-quiz/v1".');
  }

  // title
  let title = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string') {
      pushError(errors, '$.title', 'title phải là chuỗi.');
    } else {
      const nt = cleanText(input.title);
      if (hasControlChar(nt)) {
        pushError(errors, '$.title', 'title chứa ký tự điều khiển không hợp lệ.');
      } else if (nt.length > 180) {
        pushError(errors, '$.title', 'title vượt quá 180 ký tự.');
      } else {
        title = nt === '' ? null : nt;
      }
    }
  }

  // description
  let description = null;
  if (input.description !== undefined && input.description !== null) {
    const nt = (typeof input.description === 'string') ? cleanText(input.description) : null;
    if (nt === null) {
      pushError(errors, '$.description', 'description phải là chuỗi.');
    } else if (hasControlChar(nt)) {
      pushError(errors, '$.description', 'description chứa ký tự điều khiển không hợp lệ.');
    } else if (nt.length > 5000) {
      pushError(errors, '$.description', 'description vượt quá 5000 ký tự.');
    } else {
      description = nt === '' ? null : nt;
    }
  }

  // timeLimitSeconds
  const tls = validateTimeLimit(errors, input.timeLimitSeconds);

  // questions
  if (!Array.isArray(input.questions)) {
    pushError(errors, '$.questions', 'questions phải là mảng.');
  }
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  if (rawQuestions.length < 1 || rawQuestions.length > QUIZ_MAX_QUESTIONS) {
    if (Array.isArray(input.questions)) {
      pushError(errors, '$.questions', `questions phải có 1–${QUIZ_MAX_QUESTIONS} câu.`);
    }
  }

  // ID rule detection
  const hasAnyId = rawQuestions.some((q) => isPlainObject(q) && Object.prototype.hasOwnProperty.call(q, 'id'));

  // normalize each question
  const seenIds = new Set();
  const normalizedQuestions = rawQuestions.map((q, idx) =>
    normalizeQuestion(q, idx, errors, { hasAnyId, seenIds })
  );

  // If any errors, return failure
  if (errors.length > 0) {
    return { ok: false, quiz: null, errors };
  }

  // Assign ids if none had id
  const anyId = rawQuestions.some((q) => isPlainObject(q) && Object.prototype.hasOwnProperty.call(q, 'id'));
  const finalQuestions = normalizedQuestions.map((nq, idx) => {
    let id = nq.id;
    if (!anyId) id = `q${idx + 1}`;
    return {
      id,
      question: nq.question,
      options: nq.options,
      correct: nq.correct,
      explanation: nq.explanation
    };
  });

  if (errors.length > 0) {
    return { ok: false, quiz: null, errors };
  }

  const quiz = {
    schema: QUIZ_SCHEMA,
    title,
    description,
    timeLimitSeconds: tls === null ? 0 : tls,
    questions: finalQuestions
  };
  // If tls null due to error, errors would have been pushed; but we checked errors. However tls null can happen only with error pushed. Since errors empty, tls valid.
  return { ok: true, quiz, errors: [] };
}

export function parseQuizJson(text) {
  const errors = [];
  if (typeof text !== 'string') {
    pushError(errors, '$', 'Dữ liệu phải là chuỗi JSON.');
    return { ok: false, quiz: null, errors };
  }
  // size check
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(text).length;
  } catch {
    bytes = text.length;
  }
  if (bytes > QUIZ_MAX_BYTES) {
    pushError(errors, '$', 'JSON vượt quá 256 KB.');
    return { ok: false, quiz: null, errors };
  }
  // BOM
  let t = text;
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    pushError(errors, '$', 'JSON không hợp lệ. Kiểm tra dấu phẩy, ngoặc kép và ngoặc nhọn.');
    return { ok: false, quiz: null, errors };
  }
  if (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object') {
    pushError(errors, '$', 'Dữ liệu phải là object JSON.');
    return { ok: false, quiz: null, errors };
  }
  return normalizeQuiz(parsed);
}

export function publicQuizQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    options: Array.isArray(q.options) ? [...q.options] : []
  }));
}

function isIntegerInRange(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Chia total câu thành các phần, mỗi phần ≤ maxPerPart.
 * Các phần đầu bằng ceil(total / partCount), phần cuối nhận phần còn lại
 * (ví dụ 65/20 -> [17,17,17,14], 65/25 -> [22,22,21]).
 * Trả [] nếu input không hợp lệ hoặc vượt quá 20 phần.
 */
export function splitQuestionCounts(total, maxPerPart) {
  if (!isIntegerInRange(total, 1, QUIZ_SET_MAX_QUESTIONS)) return [];
  if (!isIntegerInRange(maxPerPart, QUIZ_SET_MIN_PER_PART, QUIZ_SET_MAX_PER_PART)) return [];

  const partCount = Math.ceil(total / maxPerPart);
  if (partCount < 1 || partCount > QUIZ_SET_MAX_PARTS) return [];

  const chunkSize = Math.ceil(total / partCount);
  return Array.from(
    { length: partCount },
    (_, index) => (index === partCount - 1 ? total - chunkSize * (partCount - 1) : chunkSize)
  );
}

/**
 * Gộp câu hỏi từ nhiều file thành một bộ đề: validate lại toàn bộ, bỏ ID gốc,
 * cấp ID q1..qN, chia phần đều và gán partIndex.
 */
export function buildQuizSet(options = {}) {
  const {
    questions,
    maxQuestionsPerPart = QUIZ_SET_DEFAULT_MAX_PER_PART,
    minutesPerPart = QUIZ_SET_DEFAULT_MINUTES_PER_PART
  } = isPlainObject(options) ? options : {};
  const errors = [];

  const maxValid = isIntegerInRange(maxQuestionsPerPart, QUIZ_SET_MIN_PER_PART, QUIZ_SET_MAX_PER_PART);
  if (!maxValid) {
    pushError(
      errors,
      '$.maxQuestionsPerPart',
      `maxQuestionsPerPart phải là số nguyên ${QUIZ_SET_MIN_PER_PART}–${QUIZ_SET_MAX_PER_PART}.`
    );
  }

  const minutesValid = isIntegerInRange(
    minutesPerPart,
    QUIZ_SET_MIN_MINUTES_PER_PART,
    QUIZ_SET_MAX_MINUTES_PER_PART
  );
  if (!minutesValid) {
    pushError(
      errors,
      '$.minutesPerPart',
      `minutesPerPart phải là số nguyên ${QUIZ_SET_MIN_MINUTES_PER_PART}–${QUIZ_SET_MAX_MINUTES_PER_PART}.`
    );
  }

  const questionsIsArray = Array.isArray(questions);
  if (!questionsIsArray) {
    pushError(errors, '$.questions', 'questions phải là mảng.');
  } else if (questions.length < 1 || questions.length > QUIZ_SET_MAX_QUESTIONS) {
    pushError(errors, '$.questions', `questions phải có 1–${QUIZ_SET_MAX_QUESTIONS} câu.`);
  }

  const normalizedQuestions = questionsIsArray
    ? questions.map((q, idx) => normalizeQuestion(q, idx, errors, { ignoreId: true }))
    : [];

  let partSizes = [];
  const countValid = questionsIsArray
    && questions.length >= 1
    && questions.length <= QUIZ_SET_MAX_QUESTIONS;
  if (maxValid && countValid) {
    partSizes = splitQuestionCounts(questions.length, maxQuestionsPerPart);
    if (partSizes.length === 0) {
      pushError(
        errors,
        '$.questions',
        `Số câu vượt quá ${QUIZ_SET_MAX_PARTS} phần; hãy tăng số câu tối đa mỗi phần.`
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, set: null, errors };
  }

  const partIndexes = [];
  partSizes.forEach((size, partIndex) => {
    for (let index = 0; index < size; index += 1) partIndexes.push(partIndex);
  });

  const builtQuestions = normalizedQuestions.map((question, index) => ({
    id: `q${index + 1}`,
    partIndex: partIndexes[index],
    question: question.question,
    options: question.options,
    correct: question.correct,
    explanation: question.explanation
  }));

  const set = {
    questions: builtQuestions,
    partSizes,
    partCount: partSizes.length,
    questionCount: builtQuestions.length,
    maxQuestionsPerPart,
    minutesPerPart
  };
  return { ok: true, set, errors: [] };
}

/** Chỉ trả câu hỏi công khai (không đáp án/giải thích) của một phần. */
export function publicQuizSetQuestions(questions, partIndex) {
  if (!Array.isArray(questions) || !Number.isInteger(partIndex) || partIndex < 0) return [];
  return questions
    .filter((question) => question && question.partIndex === partIndex)
    .map((question) => ({
      id: question.id,
      question: question.question,
      options: Array.isArray(question.options) ? [...question.options] : []
    }));
}

export function gradeQuizResponse(question, response) {
  if (!question || !Array.isArray(question.options)) return false;
  const matched = matchOption(question.options, response);
  if (matched === null) return false;
  const correctOption = matchOption(question.options, question.correct);
  return correctOption !== null && matched === correctOption;
}

export function gradeQuizResponses(questions, responses) {
  const qMap = new Map();
  if (Array.isArray(questions)) {
    for (const q of questions) {
      if (q && q.id !== undefined && q.id !== null) qMap.set(q.id, q);
    }
  }
  const entries = [];
  const seen = new Set();
  if (Array.isArray(responses)) {
    for (const entry of responses) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const id = entry.id;
      if (id === undefined || id === null) continue;
      if (!qMap.has(id)) continue;
      if (seen.has(id)) continue;
      const question = qMap.get(id);
      const canonical = matchOption(question.options, entry.response);
      if (canonical === null) continue;
      seen.add(id);
      entries.push({ id, response: canonical, correct: gradeQuizResponse(question, canonical) });
    }
  }
  return {
    entries,
    answered: entries.length,
    correct: entries.filter((e) => e.correct).length
  };
}

export function remainingSeconds(startedAt, timeLimitSeconds, nowMs = Date.now()) {
  if (!timeLimitSeconds) return null;
  if (startedAt === null || startedAt === undefined) return timeLimitSeconds;
  let startMs;
  if (startedAt instanceof Date) startMs = startedAt.getTime();
  else if (typeof startedAt === 'number') startMs = startedAt;
  else startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return timeLimitSeconds;
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  return Math.max(0, timeLimitSeconds - elapsed);
}

export function quizTemplateJson() {
  const obj = {
    schema: QUIZ_SCHEMA,
    title: 'Ôn tập Chương 1 — Cấu trúc dữ liệu',
    description: '10 câu trắc nghiệm nhanh, làm trong 10 phút.',
    timeLimitSeconds: 600,
    questions: [
      {
        id: 'q1',
        question: 'Cấu trúc dữ liệu nào hoạt động theo nguyên tắc LIFO?',
        options: ['Hàng đợi', 'Ngăn xếp', 'Danh sách liên kết', 'Cây nhị phân'],
        correct: 'Ngăn xếp',
        explanation: 'Ngăn xếp (stack) hoạt động theo LIFO: vào sau, ra trước.'
      }
    ]
  };
  return JSON.stringify(obj, null, 2);
}