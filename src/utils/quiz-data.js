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
  const normalizedQuestions = [];
  const seenIds = new Set();
  rawQuestions.forEach((q, idx) => {
    const qPath = `questions[${idx}]`;
    if (!isPlainObject(q)) {
      pushError(errors, qPath, `Câu ${idx + 1}: phải là object.`);
      return;
    }

    // id
    let id = undefined;
    if (Object.prototype.hasOwnProperty.call(q, 'id')) {
      if (typeof q.id !== 'string') {
        pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id phải là chuỗi.`);
      } else {
        const nid = cleanText(q.id);
        if (nid.length < 1 || nid.length > 64 || !ID_RE.test(nid) || hasControlChar(nid)) {
          pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id không hợp lệ.`);
        } else {
          id = nid;
        }
      }
    } else if (hasAnyId) {
      pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: thiếu id.`);
    }

    // question
    let questionText = null;
    if (typeof q.question !== 'string') {
      pushError(errors, `${qPath}.question`, `Câu ${idx + 1}: question phải là chuỗi.`);
    } else {
      const nq = cleanText(q.question);
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
    if (!Array.isArray(q.options)) {
      pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options phải là mảng.`);
    } else {
      if (q.options.length < QUIZ_MIN_OPTIONS || q.options.length > QUIZ_MAX_OPTIONS) {
        pushError(errors, `${qPath}.options`, `Câu ${idx + 1}: options phải có ${QUIZ_MIN_OPTIONS}–${QUIZ_MAX_OPTIONS} lựa chọn.`);
      }
      const opts = [];
      let optOk = true;
      q.options.forEach((opt, oi) => {
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

    // correct
    let correct = null;
    if (typeof q.correct !== 'string') {
      pushError(errors, `${qPath}.correct`, `Câu ${idx + 1}: correct phải là chuỗi.`);
    } else {
      const rc = q.correct.trim().toUpperCase();
      if (!/^[A-F]$/.test(rc)) {
        pushError(errors, `${qPath}.correct`, `Câu ${idx + 1}: correct phải là A–F.`);
      } else if (options && (rc.charCodeAt(0) - 65) >= options.length) {
        pushError(errors, `${qPath}.correct`, `Câu ${idx + 1}: correct phải là A–${String.fromCharCode(64 + (options ? options.length : 0))}.`);
      } else if (!options) {
        // options invalid; still accept letter range unknown; push? skip
        correct = rc;
      } else {
        correct = rc;
      }
    }

    // explanation (optional)
    let explanation = '';
    if (q.explanation !== undefined && q.explanation !== null) {
      if (typeof q.explanation !== 'string') {
        pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation phải là chuỗi.`);
      } else {
        const ne = cleanText(q.explanation);
        if (ne.length > 2000) {
          pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation vượt quá 2000 ký tự.`);
        } else if (hasControlChar(ne)) {
          pushError(errors, `${qPath}.explanation`, `Câu ${idx + 1}: explanation chứa ký tự điều khiển.`);
        } else {
          explanation = ne;
        }
      }
    }

    // id uniqueness check later; store id maybe undefined if invalid
    // Only build if no errors for this question? We'll collect and decide at end.
    // Track id for uniqueness
    if (id !== undefined) {
      if (seenIds.has(id)) {
        pushError(errors, `${qPath}.id`, `Câu ${idx + 1}: id trùng.`);
      } else {
        seenIds.add(id);
      }
    }

    // If hasAnyId and id undefined due to error, skip build
    normalizedQuestions.push({
      _idx: idx,
      id,
      question: questionText,
      options,
      correct,
      explanation,
      _hasId: Object.prototype.hasOwnProperty.call(q, 'id')
    });
  });

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

export function gradeQuizResponse(question, response) {
  if (!question || !Array.isArray(question.options)) return false;
  const r = String(response ?? '').trim().toUpperCase();
  if (!/^[A-F]$/.test(r)) return false;
  const idx = r.charCodeAt(0) - 65;
  if (idx >= question.options.length) return false;
  const correct = String(question.correct ?? '').trim().toUpperCase();
  return r === correct;
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
      const rawResp = entry.response;
      const r = String(rawResp ?? '').trim().toUpperCase();
      if (!/^[A-F]$/.test(r)) continue;
      const idx = r.charCodeAt(0) - 65;
      if (idx >= (question.options?.length || 0)) continue;
      seen.add(id);
      const correct = gradeQuizResponse(question, r);
      entries.push({ id, response: r, correct });
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
        correct: 'B',
        explanation: 'Ngăn xếp (stack) hoạt động theo LIFO: vào sau, ra trước.'
      }
    ]
  };
  return JSON.stringify(obj, null, 2);
}