import { request, unwrap } from './http.js';

export async function getGrammarGroups(token, { signal } = {}) {
  const data = await request('/api/grammar/groups', { token, signal, defaultMessage: 'Không thể tải danh sách ngữ pháp.' });
  return unwrap(data, []);
}

export async function getGrammarPath(token, pathId, { signal } = {}) {
  const data = await request(`/api/grammar/paths/${encodeURIComponent(pathId)}`, { token, signal, defaultMessage: 'Không thể tải lộ trình ngữ pháp.' });
  return unwrap(data, null);
}

export async function getGrammarLesson(token, lessonId, { signal } = {}) {
  const data = await request(`/api/grammar/lessons/${encodeURIComponent(lessonId)}`, { token, signal, defaultMessage: 'Không thể tải bài học.' });
  return unwrap(data, null);
}

export async function saveGrammarProgress(token, lessonId, payload = {}) {
  const data = await request('/api/grammar/progress', {
    method: 'POST',
    token,
    body: {
      lesson_id: lessonId,
      answered: payload.answered,
      correct: payload.correct,
      total: payload.total,
      completed: Boolean(payload.completed),
      responses: Array.isArray(payload.responses) ? payload.responses : undefined,
      answered_before: payload.answeredBefore,
      correct_before: payload.correctBefore
    },
    defaultMessage: 'Không thể lưu tiến độ ngữ pháp.'
  });
  return unwrap(data, data);
}

export async function checkGrammarAnswer(token, lessonId, questionId, response) {
  const data = await request('/api/grammar/answer', {
    method: 'POST',
    token,
    body: { lesson_id: lessonId, question_id: questionId, response: response ?? null },
    defaultMessage: 'Không thể kiểm tra đáp án.'
  });
  return unwrap(data, null);
}

export async function saveGrammarExtraProgress(token, lessonId, payload = {}) {
  const data = await request('/api/grammar/extra-progress', {
    method: 'POST',
    token,
    body: {
      lesson_id: lessonId,
      completed: Boolean(payload.completed),
      responses: Array.isArray(payload.responses) ? payload.responses : [],
      answered_before: payload.answeredBefore,
      correct_before: payload.correctBefore
    },
    defaultMessage: 'Không thể lưu tiến độ luyện thêm.'
  });
  return unwrap(data, data);
}
