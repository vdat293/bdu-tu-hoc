import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { MoodleClient } from './moodle.service.js';

const ANSWERS_FILE = path.resolve('data', 'english-answers.json');
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const sessions = new Map();

export function normalizeEnglishQuestion(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[0-9]+[.):]\s*/, '')
    .toLowerCase();
}

function ensureAnswerStore() {
  fs.mkdirSync(path.dirname(ANSWERS_FILE), { recursive: true });
  if (!fs.existsSync(ANSWERS_FILE)) fs.writeFileSync(ANSWERS_FILE, '[]\n', 'utf8');
}

function readAnswers() {
  ensureAnswerStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAnswers(answers) {
  ensureAnswerStore();
  const tempFile = `${ANSWERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(answers, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, ANSWERS_FILE);
}

function saveAnswer(question, correctAnswer, source = 'manual') {
  const cleanQuestion = normalizeEnglishQuestion(question);
  if (!cleanQuestion || !correctAnswer) return null;
  const answers = readAnswers();
  const index = answers.findIndex(item => normalizeEnglishQuestion(item.question) === cleanQuestion);
  const entry = {
    id: index >= 0 ? answers[index].id : crypto.randomUUID(),
    question: String(question).trim(),
    cleanQuestion,
    correctAnswer: String(correctAnswer).trim(),
    source,
    updatedAt: new Date().toISOString()
  };
  if (index >= 0) answers[index] = entry;
  else answers.push(entry);
  writeAnswers(answers);
  return entry;
}

function findAnswer(question) {
  const normalized = normalizeEnglishQuestion(question);
  const answers = readAnswers();
  return answers.find(item => item.cleanQuestion === normalized)
    || (normalized.length > 15
      ? answers.find(item => item.cleanQuestion
        && (item.cleanQuestion.includes(normalized) || normalized.includes(item.cleanQuestion)))
      : null);
}

export function learnEnglishAnswersFromReview(html) {
  const $ = cheerio.load(html);
  const learned = [];
  $('.que').each((_, element) => {
    const block = $(element);
    const question = block.find('.qtext').text().trim();
    let answer = block.find('.rightanswer').text().trim()
      .replace(/^The correct answer is:\s*/i, '')
      .replace(/^Đáp án đúng là:\s*/i, '')
      .trim();
    if (!answer) {
      answer = block.find('.answer .correct').first().closest('label, div, tr').text().trim();
    }
    const saved = question && answer ? saveAnswer(question, answer, 'moodle-review') : null;
    if (saved) learned.push(saved);
  });
  return learned;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) {
    throw Object.assign(new Error('Phiên Moodle không còn tồn tại. Vui lòng đăng nhập Moodle lại.'), { status: 404 });
  }
  session.lastActiveAt = Date.now();
  return session;
}

function send(response, data) {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function log(session, message, type = 'info') {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString('vi-VN'),
    type,
    message
  };
  session.logs.push(entry);
  if (session.logs.length > 300) session.logs.shift();
  session.subscribers.forEach(response => send(response, { type: 'log', ...entry }));
}

export function matchEnglishOption(options, answer) {
  const wanted = normalizeEnglishQuestion(answer);
  const selectable = options.filter(option => option.inputType !== 'text');
  const exact = selectable.find(option => normalizeEnglishQuestion(option.text) === wanted);
  if (exact) return exact;
  return selectable.find(option => {
    const text = normalizeEnglishQuestion(option.text);
    return wanted.length > 2 && text.length > 2 && (text.includes(wanted) || wanted.includes(text));
  });
}

function assertRunning(job) {
  if (job.cancelled) {
    throw Object.assign(new Error('Tiến trình đã được dừng.'), { code: 'CANCELLED' });
  }
}

async function wait(ms, job) {
  if (!ms) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    job.controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Tiến trình đã được dừng.'), { code: 'CANCELLED' }));
    }, { once: true });
  });
}

async function runQuiz(session, job, config) {
  const details = await session.client.getQuizDetails(config.cmid, job.controller.signal);
  log(session, `Bài tập: ${details.title}`, 'question');
  if (!details.canStart) throw new Error('Bài tập không cho phép bắt đầu hoặc tiếp tục lượt làm.');

  const attempt = await session.client.startOrResumeAttempt(config.cmid, details, job.controller.signal);
  log(session, `${attempt.resumed ? 'Tiếp tục' : 'Đã tạo'} lượt làm #${attempt.attemptId}.`, 'success');

  let html = attempt.html;
  let page = 1;
  let answered = 0;
  let skipped = 0;
  let lastSesskey = details.sesskey;

  while (true) {
    assertRunning(job);
    const parsed = session.client.parseAttemptPage(html);
    if (!parsed.questions.length) throw new Error(`Không tìm thấy câu hỏi ở trang ${page}.`);
    lastSesskey = parsed.sesskey || lastSesskey;
    log(session, `Đang xử lý trang ${page} (${parsed.questions.length} câu).`);
    const formData = { ...parsed.formInputs };
    parsed.questions.forEach(question => Object.assign(formData, question.hiddenInputs));

    for (const question of parsed.questions) {
      assertRunning(job);
      log(session, `[Câu ${question.index}] ${question.text.slice(0, 140)}`, 'question');
      const stored = findAnswer(question.text);
      if (!stored) {
        skipped++;
        log(session, 'Chưa có trong ngân hàng đáp án; bỏ qua để tránh chọn bừa.', 'warning');
        continue;
      }

      const textInput = question.options.find(option => option.inputType === 'text');
      if (textInput) {
        formData[textInput.name] = stored.correctAnswer;
        answered++;
        log(session, `Điền “${stored.correctAnswer}”.`, 'action');
      } else {
        const option = matchEnglishOption(question.options, stored.correctAnswer);
        if (!option) {
          skipped++;
          log(session, `Đáp án “${stored.correctAnswer}” không khớp lựa chọn; bỏ qua.`, 'warning');
          continue;
        }
        formData[option.name] = option.value;
        answered++;
        log(session, `Chọn “${option.text}”.`, 'action');
      }
      await wait(config.delaySeconds * 1000, job);
    }

    html = await session.client.submitPageAnswers(
      attempt.attemptId,
      lastSesskey,
      formData,
      job.controller.signal
    );
    if (parsed.isLastPage) break;
    page++;
  }

  if (!config.autoSubmit) {
    log(session, `Đã điền ${answered} câu, bỏ qua ${skipped} câu. Lượt làm vẫn mở để kiểm tra trước khi nộp.`, 'success');
    return { answered, skipped, submitted: false, attemptId: attempt.attemptId };
  }

  if (answered === 0) {
    throw new Error('Không có câu nào khớp ngân hàng đáp án nên hệ thống từ chối tự nộp bài trắng.');
  }
  log(session, 'Đang nộp bài theo tùy chọn Tự động nộp đã được xác nhận.');
  await session.client.finishAttempt(attempt.attemptId, lastSesskey, job.controller.signal);
  let learned = 0;
  try {
    const review = await session.client.getReviewPage(attempt.attemptId, job.controller.signal);
    learned = learnEnglishAnswersFromReview(review).length;
  } catch (error) {
    log(session, `Đã nộp nhưng chưa đọc được trang review: ${error.message}`, 'warning');
  }
  log(session, `Hoàn thành: điền ${answered}, bỏ qua ${skipped}, học thêm ${learned} đáp án.`, 'success');
  return { answered, skipped, submitted: true, learned, attemptId: attempt.attemptId };
}

export const EnglishExerciseService = {
  async login({ username, password, courseId = '281' }) {
    if (!username || !password) {
      throw Object.assign(new Error('Vui lòng nhập tài khoản và mật khẩu Moodle.'), { status: 400 });
    }
    const client = new MoodleClient();
    await client.login(String(username).trim(), String(password));
    const session = {
      id: crypto.randomUUID(),
      client,
      username: String(username).trim(),
      courseId: String(courseId || '281'),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      logs: [],
      subscribers: new Set(),
      job: null
    };
    sessions.set(session.id, session);
    log(session, `Đăng nhập Moodle thành công: ${session.username}.`, 'success');
    return { sessionId: session.id, username: session.username, courseId: session.courseId };
  },

  async activities(id, courseId) {
    const session = getSession(id);
    session.courseId = String(courseId || session.courseId || '281');
    log(session, `Đang quét khóa học #${session.courseId}...`);
    const activities = await session.client.getCourseActivities(session.courseId);
    log(session, `Tìm thấy ${activities.length} hoạt động.`, activities.length ? 'success' : 'warning');
    return activities;
  },

  start(id, input) {
    const session = getSession(id);
    if (session.job) throw Object.assign(new Error('Đang có một bài tập được xử lý.'), { status: 409 });
    if (!input.cmid) throw Object.assign(new Error('Vui lòng chọn một bài quiz.'), { status: 400 });
    if (input.type && input.type !== 'quiz') {
      throw Object.assign(new Error('Hiện hỗ trợ quiz Moodle; SCORM/iContent cần mở trực tiếp.'), { status: 400 });
    }
    const job = { id: crypto.randomUUID(), cancelled: false, controller: new AbortController() };
    session.job = job;
    const config = {
      cmid: String(input.cmid),
      delaySeconds: Math.min(10, Math.max(0, Number(input.delaySeconds) || 0)),
      autoSubmit: input.autoSubmit === true
    };
    queueMicrotask(async () => {
      try {
        log(session, `Bắt đầu xử lý quiz #${config.cmid}.`);
        const result = await runQuiz(session, job, config);
        session.subscribers.forEach(response => send(response, { type: 'done', result }));
      } catch (error) {
        const stopped = error.code === 'CANCELLED' || error.name === 'CanceledError';
        log(session, stopped ? 'Tiến trình đã dừng.' : `Lỗi: ${error.message}`, stopped ? 'warning' : 'error');
        session.subscribers.forEach(response => send(response, {
          type: stopped ? 'stopped' : 'error',
          message: error.message
        }));
      } finally {
        if (session.job === job) session.job = null;
      }
    });
    return { jobId: job.id };
  },

  stop(id) {
    const session = getSession(id);
    if (!session.job) return false;
    session.job.cancelled = true;
    session.job.controller.abort();
    return true;
  },

  close(id) {
    const session = sessions.get(id);
    if (!session) return false;
    if (session.job) {
      session.job.cancelled = true;
      session.job.controller.abort();
    }
    session.subscribers.forEach(response => response.end());
    sessions.delete(id);
    return true;
  },

  subscribe(id, response) {
    const session = getSession(id);
    session.subscribers.add(response);
    session.logs.forEach(entry => send(response, { type: 'log', ...entry }));
    send(response, { type: 'ready', running: Boolean(session.job) });
    return () => session.subscribers.delete(response);
  },

  listAnswers: readAnswers,

  addAnswer(question, answer) {
    if (!question || !answer) {
      throw Object.assign(new Error('Cần nhập đầy đủ câu hỏi và đáp án.'), { status: 400 });
    }
    return saveAnswer(question, answer);
  },

  deleteAnswer(id) {
    const answers = readAnswers();
    const next = answers.filter(item => item.id !== id);
    if (next.length !== answers.length) writeAnswers(next);
    return next.length !== answers.length;
  }
};

export const EnglishExerciseInternals = { runQuiz };

setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, id) => {
    if (!session.job && now - session.lastActiveAt > SESSION_TTL_MS) {
      session.subscribers.forEach(response => response.end());
      sessions.delete(id);
    }
  });
}, 15 * 60 * 1000).unref();
