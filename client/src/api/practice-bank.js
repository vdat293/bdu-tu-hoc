import { request, unwrap } from './http.js';

function courseBase(courseCode) {
  return `/api/learning/courses/${encodeURIComponent(courseCode || '')}/practice-bank`;
}

export async function getPracticeBankSummary(token, courseCode, { signal } = {}) {
  const data = await request(courseBase(courseCode), {
    token,
    signal,
    defaultMessage: 'Không thể tải thông tin phòng ôn tập trắc nghiệm.'
  });
  return unwrap(data, { enabled: false });
}

export async function getPracticeBankQuestions(token, courseCode, { chapter = 'all', filter = 'all', search = '', signal } = {}) {
  const params = new URLSearchParams();
  if (chapter !== undefined && chapter !== null && chapter !== 'all') {
    params.set('chapter', String(chapter));
  }
  if (filter && filter !== 'all') {
    params.set('filter', String(filter));
  }
  if (search && String(search).trim()) {
    params.set('search', String(search).trim());
  }
  const qs = params.toString();
  const data = await request(`${courseBase(courseCode)}/questions${qs ? `?${qs}` : ''}`, {
    token,
    signal,
    defaultMessage: 'Không thể tải danh sách câu hỏi ôn tập.'
  });
  return unwrap(data, { questions: [] });
}

export async function answerPracticeQuestion(token, courseCode, questionId, selectedAnswer) {
  const data = await request(`${courseBase(courseCode)}/questions/${encodeURIComponent(questionId)}/answer`, {
    method: 'POST',
    token,
    body: { selectedAnswer },
    defaultMessage: 'Không thể lưu câu trả lời ôn tập.'
  });
  return unwrap(data, data);
}

export async function togglePracticeBookmark(token, courseCode, questionId, bookmarked) {
  const body = typeof bookmarked === 'boolean' ? { bookmarked } : {};
  const data = await request(`${courseBase(courseCode)}/questions/${encodeURIComponent(questionId)}/bookmark`, {
    method: 'POST',
    token,
    body,
    defaultMessage: 'Không thể cập nhật đánh dấu câu hỏi.'
  });
  return unwrap(data, data);
}

export async function startPracticeMockExam(token, courseCode, { count = 50, chapters = [] } = {}) {
  const data = await request(`${courseBase(courseCode)}/exam/start`, {
    method: 'POST',
    token,
    body: { count, chapters },
    defaultMessage: 'Không thể khởi tạo bài thi thử.'
  });
  return unwrap(data, data);
}

export async function submitPracticeMockExam(token, courseCode, { answers, durationSeconds, chapterIndex = null } = {}) {
  const data = await request(`${courseBase(courseCode)}/exam/submit`, {
    method: 'POST',
    token,
    body: { answers, durationSeconds, chapterIndex },
    defaultMessage: 'Không thể nộp bài thi thử.'
  });
  return unwrap(data, data);
}

export async function resetPracticeProgress(token, courseCode, { chapter = null, keepBookmarks = true } = {}) {
  const params = new URLSearchParams();
  if (chapter !== null && chapter !== undefined && chapter !== 'all') {
    params.set('chapter', String(chapter));
  }
  params.set('keepBookmarks', keepBookmarks ? 'true' : 'false');
  const data = await request(`${courseBase(courseCode)}/progress?${params.toString()}`, {
    method: 'DELETE',
    token,
    defaultMessage: 'Không thể đặt lại tiến độ ôn tập.'
  });
  return unwrap(data, data);
}
