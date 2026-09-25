import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { isTestEnvironment } from '../config/load-env.js';
import { MoodleClient } from './moodle.service.js';

if (isTestEnvironment() && !process.env.ENGLISH_ANSWERS_PATH) {
  const error = new Error('English test mode cần ENGLISH_ANSWERS_PATH trong thư mục tạm.');
  error.code = 'ENGLISH_TEST_ANSWER_PATH_REQUIRED';
  throw error;
}

const ANSWERS_FILE = path.resolve(
  process.env.ENGLISH_ANSWERS_PATH || path.join('data', 'english-answers.json')
);
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
  const payload = `${JSON.stringify(answers, null, 2)}\n`;
  fs.writeFileSync(tempFile, payload, 'utf8');
  try {
    fs.renameSync(tempFile, ANSWERS_FILE);
  } catch (error) {
    // Windows can reject replacing a file that a long-lived local dev process
    // has opened for reading. Keep the atomic rename as the first choice, but
    // fall back to a direct write so answer learning does not fail needlessly.
    const replaceBlocked = process.platform === 'win32'
      && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
    if (!replaceBlocked) {
      try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
      throw error;
    }
    try {
      fs.writeFileSync(ANSWERS_FILE, payload, 'utf8');
      fs.unlinkSync(tempFile);
    } catch (fallbackError) {
      try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
      throw fallbackError;
    }
  }
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
      .replace(/^(The correct answer is|The correct answers are|Đáp án đúng là|Các đáp án đúng là):\s*/i, '')
      .trim();
    if (!answer) {
      answer = block.find('.answer .correct').first().closest('label, div, tr').text().trim();
    }
    if (question && answer) {
      // Review data is untrusted input. Return a candidate for the owner UI,
      // but never persist it as a side effect of an ordinary student's run.
      learned.push({
        id: crypto.randomUUID(),
        question,
        correctAnswer: answer,
        source: 'moodle-review'
      });
    }
  });
  return learned;
}

function normalizeOwnerMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function getSessionRecord(id) {
  const session = sessions.get(id);
  if (!session) {
    throw Object.assign(new Error('Phiên Moodle không còn tồn tại. Vui lòng đăng nhập Moodle lại.'), { status: 404 });
  }
  return session;
}

function getSession(id, ownerMssv = null) {
  const session = getSessionRecord(id);
  if (ownerMssv !== null && normalizeOwnerMssv(ownerMssv) !== session.ownerMssv) {
    throw Object.assign(new Error('Bạn không có quyền truy cập phiên Moodle này.'), { status: 403 });
  }
  session.lastActiveAt = Date.now();
  return session;
}

function getStreamSession(id, streamToken) {
  const session = getSessionRecord(id);
  const expected = Buffer.from(String(session.streamToken || ''));
  const provided = Buffer.from(String(streamToken || ''));
  if (!expected.length || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw Object.assign(new Error('Stream token không hợp lệ.'), { status: 403 });
  }
  session.lastActiveAt = Date.now();
  return session;
}

function send(response, data) {
  try {
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof response.flush === 'function') response.flush();
  } catch {}
}

function log(session, message, type = 'info') {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString('vi-VN'),
    logType: type,
    message
  };
  session.logs.push(entry);
  if (session.logs.length > 300) session.logs.shift();
  session.subscribers.forEach(response => send(response, { type: 'log', logType: type, message, timestamp: entry.timestamp, id: entry.id }));
}

export function matchEnglishOption(options, answer) {
  const wanted = normalizeEnglishQuestion(answer);
  const selectable = options.filter(option => option.inputType !== 'text');
  const exact = selectable.find(option => normalizeEnglishQuestion(option.text) === wanted);
  if (exact) return exact;

  for (const option of selectable) {
    if (option.selectOptions && Array.isArray(option.selectOptions)) {
      const matchedOpt = option.selectOptions.find(opt => normalizeEnglishQuestion(opt.text) === wanted)
        || option.selectOptions.find(opt => {
          const t = normalizeEnglishQuestion(opt.text);
          return wanted.length > 2 && t.length > 2 && (t.includes(wanted) || wanted.includes(t));
        });
      if (matchedOpt) {
        return { name: option.name, value: matchedOpt.value, text: matchedOpt.text };
      }
    }
  }

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
    log(session, 'Gợi ý: Moodle chưa có đáp án của bài quiz này trong ngân hàng. Hãy làm thủ công 1 lần hoặc nộp bài để hệ thống đọc đáp án từ trang review!', 'info');
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
  log(session, `Hoàn thành: điền ${answered}, bỏ qua ${skipped}, đọc ${learned} đáp án từ trang review (chưa tự lưu).`, 'success');
  return { answered, skipped, submitted: true, learned, attemptId: attempt.attemptId };
}

async function runAutoFinishCourse(session, job, config) {
  const courseId = String(config.courseId);
  const curCourseBefore = session.courses?.find(c => String(c.id) === courseId);
  const initialProgress = curCourseBefore?.progress ?? null;

  log(session, `======================================================`, 'info');
  log(session, `🚀 BẮT ĐẦU DUYỆT KHÓA HỌC: "${curCourseBefore?.fullname || '#' + courseId}"`, 'info');
  if (initialProgress !== null) {
    log(session, `📊 Mức độ hoàn thành hiện tại: ${initialProgress}%`, 'info');
  }
  const activities = await session.client.getCourseActivities(courseId, job.controller.signal);
  log(session, `📋 Danh sách: Tìm thấy ${activities.length} hoạt động trong khóa.`, activities.length ? 'info' : 'warning');
  const manualOnly = activities.filter(activity => activity.type === 'manual');
  log(
    session,
    `🔎 Completion manual-only phát hiện: ${manualOnly.length ? manualOnly.map(activity => `#${activity.cmid}`).join(', ') : 'không có'}${manualOnly.length ? ' (sẽ gọi core_completion_update_activity_completion_status_manually)' : ''}.`,
    manualOnly.length ? 'info' : 'warning'
  );
  if (session.client.lastCourseContentsFailure) {
    log(session, `⚠️ Không đọc được fallback course state: ${session.client.lastCourseContentsFailure}`, 'warning');
  }
  log(session, `======================================================`, 'info');

  let quizzesDone = 0;
  let itemsVisited = 0;
  let errorsCount = 0;

  for (let i = 0; i < activities.length; i++) {
    assertRunning(job);
    const act = activities[i];
    const pct = Math.round(((i + 1) / activities.length) * 100);
    log(session, `[${i + 1}/${activities.length} - ${pct}%] Đang xử lý [${act.type.toUpperCase()}] "${act.title}"...`, 'action');

    if (act.type === 'quiz') {
      try {
        const quizRes = await runQuiz(session, job, { cmid: act.cmid, autoSubmit: config.autoSubmit, delaySeconds: config.delaySeconds });
        quizzesDone++;
        log(session, `  └─ ✅ Đã hoàn thành Quiz "${act.title}" (Điền ${quizRes.answered} câu).`, 'success');
      } catch (err) {
        errorsCount++;
        log(session, `  └─ ⚠️ Bỏ qua Quiz "${act.title}": ${err.message}`, 'warning');
      }
    } else {
      try {
        const res = await session.client.visitActivity(act.type, act.cmid, job.controller.signal);
        itemsVisited++;
        if (res.scormCompleted || (act.type === 'scorm' && res.hvpScoreSent)) {
          log(session, `  └─ ✅ [SCORM 100%] Đã nộp điểm 100% và hoàn thành bài "${act.title}".`, 'success');
        } else if (res.hvpScoreSent) {
          log(session, `  └─ ✅ [HVP 100/100] Đã nộp điểm hoàn thành cho "${act.title}".`, 'success');
        } else if (res.manualCompleted) {
          log(session, `  └─ ✅ [CHECKED] Đã đánh dấu hoàn thành "${act.title}".`, 'success');
        } else {
          log(session, `  └─ ✅ [VISITED] Đã duyệt hoàn thành "${act.title}".`, 'success');
        }
      } catch (err) {
        errorsCount++;
        log(session, `  └─ ⚠️ Lỗi khi duyệt "${act.title}": ${err.message}`, 'warning');
      }
    }
    await wait(config.delaySeconds * 1000, job);
  }

  log(session, `======================================================`, 'info');
  log(session, `🎉 TỔNG KẾT KHÓA HỌC: Xử lý xong ${activities.length} hoạt động (${itemsVisited} nội dung/HVP, ${quizzesDone} bài quiz, ${errorsCount} lỗi/bỏ qua).`, 'success');

  try {
    const updatedCourses = await session.client.getEnrolledCourses(job.controller.signal);
    session.courses = updatedCourses;
    const curCourseAfter = updatedCourses.find(c => String(c.id) === courseId);
    if (curCourseAfter) {
      const newPct = curCourseAfter.progress !== null ? curCourseAfter.progress : 'N/A';
      const diff = initialProgress !== null && curCourseAfter.progress !== null ? (curCourseAfter.progress - initialProgress) : 0;
      const diffText = diff > 0 ? ` (+${diff}%)` : '';
      log(session, `📈 TIẾN ĐỘ MỚI TRÊN MOODLE: ${newPct}%${diffText}`, 'success');
    }
    session.subscribers.forEach(response => send(response, { type: 'courses_updated', courses: updatedCourses }));
  } catch (err) {
    log(session, `Chưa thể cập nhật lại % tiến độ: ${err.message}`, 'warning');
  }
}

async function runAutoFinishAllCourses(session, job, config) {
  log(session, '🚀 BẮT ĐẦU TỰ ĐỘNG DUYỆT & HOÀN THÀNH TẤT CẢ KHÓA HỌC...', 'info');
  const courses = await session.client.getEnrolledCourses(job.controller.signal);
  session.courses = courses;
  log(session, `Tìm thấy tổng cộng ${courses.length} khóa học. Sẽ tiến hành xử lý tuần tự từng khóa học.`, 'info');

  for (let idx = 0; idx < courses.length; idx++) {
    assertRunning(job);
    const course = courses[idx];
    log(session, `\n--- [Khóa ${idx + 1}/${courses.length}] "${course.fullname}" (Hiện tại: ${course.progress}%) ---`, 'info');
    try {
      await runAutoFinishCourse(session, job, { ...config, courseId: course.id });
    } catch (err) {
      if (err.code === 'CANCELLED') throw err;
      log(session, `Bỏ qua lỗi khóa học #${course.id}: ${err.message}`, 'error');
    }
  }

  log(session, '🎉 ĐÃ HOÀN THÀNH DUYỆT & TỰ ĐỘNG HOÀN THÀNH TẤT CẢ KHÓA HỌC!', 'success');
}

export class EnglishExerciseQueueManager {
  constructor(maxConcurrency = Math.max(1, Number(process.env.MAX_CONCURRENT_ENGLISH_JOBS) || 5)) {
    this.maxConcurrency = maxConcurrency;
    this.runningJobs = new Map();
    this.waitingQueue = [];
  }

  get runningCount() {
    return this.runningJobs.size;
  }

  get waitingCount() {
    return this.waitingQueue.length;
  }

  getQueuePosition(jobId) {
    const idx = this.waitingQueue.findIndex(j => j.id === jobId);
    return idx >= 0 ? idx + 1 : 0;
  }

  enqueue(job) {
    if (this.runningJobs.size < this.maxConcurrency) {
      this._startJob(job);
    } else {
      job.status = 'queued';
      this.waitingQueue.push(job);
      const pos = this.waitingQueue.length;
      log(
        job.session,
        `⏳ [HÀNG CHỜ] Hệ thống đang chạy tối đa ${this.maxConcurrency} luồng. Bạn đang ở vị trí #${pos} trong hàng chờ. Xin vui lòng chờ...`,
        'warning'
      );
      this._notifyJobQueue(job, pos);
    }
  }

  _notifyJobQueue(job, position) {
    job.session.subscribers.forEach(response => send(response, {
      type: 'queue_update',
      status: job.status,
      position,
      totalWaiting: this.waitingQueue.length,
      runningCount: this.runningJobs.size,
      maxConcurrency: this.maxConcurrency
    }));
  }

  _startJob(job) {
    job.status = 'running';
    this.runningJobs.set(job.id, job);

    log(
      job.session,
      `🚀 [BẮT ĐẦU] Bắt đầu thực thi bài tập (Luồng ${this.runningJobs.size}/${this.maxConcurrency})...`,
      'action'
    );

    this._notifyJobQueue(job, 0);

    queueMicrotask(async () => {
      try {
        await job.runFn();
      } catch (error) {
        const stopped = error.code === 'CANCELLED' || error.name === 'CanceledError' || job.cancelled;
        log(job.session, stopped ? 'Tiến trình đã dừng.' : `Lỗi: ${error.message}`, stopped ? 'warning' : 'error');
        job.session.subscribers.forEach(response => send(response, {
          type: stopped ? 'stopped' : 'error',
          message: error.message
        }));
      } finally {
        this.runningJobs.delete(job.id);
        if (typeof job.onCleanup === 'function') {
          job.onCleanup();
        }
        this._processNext();
      }
    });
  }

  _processNext() {
    while (this.runningJobs.size < this.maxConcurrency && this.waitingQueue.length > 0) {
      const nextJob = this.waitingQueue.shift();
      this._broadcastWaitingPositions();
      log(
        nextJob.session,
        `🟢 [ĐÃ ĐẾN LƯỢT] Đã đến lượt bạn! Bắt đầu tiến trình làm bài...`,
        'action'
      );
      this._startJob(nextJob);
    }
  }

  _broadcastWaitingPositions() {
    this.waitingQueue.forEach((job, idx) => {
      const pos = idx + 1;
      this._notifyJobQueue(job, pos);
      log(job.session, `⏳ [HÀNG CHỜ] Bạn hiện đã lên vị trí #${pos} trong hàng chờ. Xin vui lòng chờ...`, 'info');
    });
  }

  cancel(jobId) {
    const queueIdx = this.waitingQueue.findIndex(j => j.id === jobId);
    if (queueIdx >= 0) {
      const [removed] = this.waitingQueue.splice(queueIdx, 1);
      removed.cancelled = true;
      log(removed.session, `⏹️ Đã hủy tiến trình khỏi hàng chờ.`, 'warning');
      removed.session.subscribers.forEach(response => send(response, { type: 'stopped' }));
      if (typeof removed.onCleanup === 'function') removed.onCleanup();
      this._broadcastWaitingPositions();
      return true;
    }

    const running = this.runningJobs.get(jobId);
    if (running) {
      running.cancelled = true;
      running.controller.abort();
      return true;
    }

    return false;
  }
}

export const englishExerciseQueue = new EnglishExerciseQueueManager();

export const EnglishExerciseService = {
  async login({ username, password, courseId, ownerMssv }) {
    if (!username || !password) {
      throw Object.assign(new Error('Vui lòng nhập tài khoản và mật khẩu Moodle.'), { status: 400 });
    }
    const cleanOwnerMssv = normalizeOwnerMssv(ownerMssv);
    if (!cleanOwnerMssv) {
      throw Object.assign(new Error('Thiếu MSSV BDU đã xác minh.'), { status: 401 });
    }
    const client = new MoodleClient();
    await client.login(String(username).trim(), String(password));
    let courses = [];
    try {
      courses = await client.getEnrolledCourses();
    } catch (err) {
      console.error('[Moodle] Lỗi quét danh sách khóa học:', err.message);
    }
    const defaultCourseId = String(courseId || courses[0]?.id || '281');
    const streamToken = crypto.randomBytes(32).toString('base64url');
    const session = {
      id: crypto.randomUUID(),
      ownerMssv: cleanOwnerMssv,
      streamToken,
      client,
      username: String(username).trim(),
      courseId: defaultCourseId,
      courses,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      logs: [],
      subscribers: new Set(),
      job: null
    };
    sessions.set(session.id, session);
    log(session, `Đăng nhập Moodle thành công: ${session.username}. Tìm thấy ${courses.length} khóa học.`, 'success');
    return {
      sessionId: session.id,
      streamToken,
      username: session.username,
      courseId: session.courseId,
      courses: session.courses
    };
  },

  async courses(id, ownerMssv) {
    const session = getSession(id, ownerMssv);
    log(session, 'Đang cập nhật danh sách khóa học...');
    const courses = await session.client.getEnrolledCourses();
    session.courses = courses;
    log(session, `Đã cập nhật ${courses.length} khóa học.`, 'success');
    return courses;
  },

  async activities(id, courseId, ownerMssv) {
    const session = getSession(id, ownerMssv);
    session.courseId = String(courseId || session.courseId || '281');
    log(session, `Đang quét khóa học #${session.courseId}...`);
    const activities = await session.client.getCourseActivities(session.courseId);
    log(session, `Tìm thấy ${activities.length} hoạt động.`, activities.length ? 'success' : 'warning');
    return activities;
  },

  start(id, input, ownerMssv) {
    const session = getSession(id, ownerMssv);
    if (session.job) throw Object.assign(new Error('Đang có một bài tập được xử lý hoặc đang chờ trong hàng.'), { status: 409 });
    if (!input.cmid) throw Object.assign(new Error('Vui lòng chọn một bài tập.'), { status: 400 });
    const job = {
      id: crypto.randomUUID(),
      sessionId: id,
      session,
      cancelled: false,
      controller: new AbortController(),
      status: 'pending'
    };
    session.job = job;
    const config = {
      cmid: String(input.cmid),
      type: String(input.type || 'quiz').toLowerCase(),
      delaySeconds: Math.min(10, Math.max(0, Number(input.delaySeconds) || 0)),
      autoSubmit: input.autoSubmit === true
    };

    englishExerciseQueue.enqueue({
      ...job,
      runFn: async () => {
        if (config.type === 'quiz') {
          log(session, `🚀 Bắt đầu xử lý bài Quiz #${config.cmid}...`, 'action');
          const result = await runQuiz(session, job, config);
          session.subscribers.forEach(response => send(response, { type: 'done', result }));
        } else {
          log(session, `⚡ Đang xử lý hoạt động [${config.type.toUpperCase()}] #${config.cmid}...`, 'action');
          const res = await session.client.visitActivity(config.type, config.cmid, job.controller.signal);
          if (res.scormCompleted || (config.type === 'scorm' && res.hvpScoreSent)) {
            log(session, `✅ Đã nộp điểm 100% & hoàn thành trọn vẹn bài [SCORM] #${config.cmid}!`, 'success');
          } else if (res.hvpScoreSent) {
            log(session, `✅ Đã nộp điểm 100/100 thành công cho bài [HVP] #${config.cmid}!`, 'success');
          } else if (res.manualCompleted) {
            log(session, `✅ Đã đánh dấu hoàn thành cho hoạt động [${config.type.toUpperCase()}] #${config.cmid}!`, 'success');
          } else {
            log(session, `✅ Đã duyệt hoàn thành [${config.type.toUpperCase()}] #${config.cmid}.`, 'success');
          }

          try {
            const updatedCourses = await session.client.getEnrolledCourses(job.controller.signal);
            session.courses = updatedCourses;
            const cur = updatedCourses.find(c => String(c.id) === String(session.courseId));
            if (cur) {
              log(session, `📈 Tiến độ mới của khóa: ${cur.progress}%`, 'success');
            }
            session.subscribers.forEach(response => send(response, { type: 'courses_updated', courses: updatedCourses }));
          } catch {}

          session.subscribers.forEach(response => send(response, { type: 'done', result: { visited: true, cmid: config.cmid, type: config.type } }));
        }
      },
      onCleanup: () => {
        if (session.job === job) session.job = null;
      }
    });

    return { jobId: job.id };
  },

  startFinish(id, input, ownerMssv) {
    const session = getSession(id, ownerMssv);
    if (session.job) throw Object.assign(new Error('Đang có một tiến trình bài tập đang chạy hoặc đang chờ trong hàng.'), { status: 409 });
    const job = {
      id: crypto.randomUUID(),
      sessionId: id,
      session,
      cancelled: false,
      controller: new AbortController(),
      status: 'pending'
    };
    session.job = job;
    const config = {
      courseId: input.courseId ? String(input.courseId) : null,
      allCourses: input.allCourses === true,
      delaySeconds: Math.min(10, Math.max(0, Number(input.delaySeconds) || 0)),
      autoSubmit: input.autoSubmit !== false
    };

    englishExerciseQueue.enqueue({
      ...job,
      runFn: async () => {
        if (config.allCourses) {
          await runAutoFinishAllCourses(session, job, config);
        } else if (config.courseId) {
          await runAutoFinishCourse(session, job, config);
        } else {
          throw new Error('Vui lòng chọn một khóa học hoặc chọn duyệt tất cả khóa học.');
        }
        session.subscribers.forEach(response => send(response, { type: 'done' }));
      },
      onCleanup: () => {
        if (session.job === job) session.job = null;
      }
    });

    return { jobId: job.id };
  },

  stop(id, ownerMssv) {
    const session = getSession(id, ownerMssv);
    if (!session.job) return false;
    const ok = englishExerciseQueue.cancel(session.job.id);
    session.job = null;
    return ok;
  },

  close(id, ownerMssv) {
    const session = getSession(id, ownerMssv);
    if (session.job) {
      englishExerciseQueue.cancel(session.job.id);
      session.job = null;
    }
    session.subscribers.forEach(response => response.end());
    sessions.delete(id);
    return true;
  },

  authorizeStream(id, streamToken) {
    getStreamSession(id, streamToken);
    return true;
  },

  subscribe(id, response, streamToken) {
    const session = getStreamSession(id, streamToken);
    session.subscribers.add(response);
    session.logs.forEach(entry => send(response, { type: 'log', ...entry }));
    const position = session.job ? englishExerciseQueue.getQueuePosition(session.job.id) : 0;
    send(response, {
      type: 'ready',
      running: Boolean(session.job && position === 0),
      queued: Boolean(session.job && position > 0),
      position,
      totalWaiting: englishExerciseQueue.waitingCount,
      runningCount: englishExerciseQueue.runningCount,
      maxConcurrency: englishExerciseQueue.maxConcurrency
    });
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

export const EnglishExerciseInternals = { runQuiz, EnglishExerciseQueueManager, englishExerciseQueue };

setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, id) => {
    if (!session.job && now - session.lastActiveAt > SESSION_TTL_MS) {
      session.subscribers.forEach(response => response.end());
      sessions.delete(id);
    }
  });
}, 15 * 60 * 1000).unref();
