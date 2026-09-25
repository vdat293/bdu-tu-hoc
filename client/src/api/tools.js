import { request, unwrap } from './http.js';

export async function formatDocx(token, formData, { signal } = {}) {
  const data = await request('/api/wordfmt/format', { method: 'POST', token, body: formData, signal, defaultMessage: 'Định dạng file thất bại.' });
  return data;
}

export async function downloadWordFmt(token, url, { signal } = {}) {
  return request(url, { token, responseType: 'blob', signal, defaultMessage: 'Không thể tải file Word đã chuẩn hóa.' });
}

export async function getSurveyForms(token, { signal } = {}) {
  const data = await request('/api/survey/forms', {
    token,
    signal,
    defaultMessage: 'Không thể tải danh sách môn khảo sát.'
  });
  return unwrap(data, data)?.items || [];
}

export async function createSurveyRun(token, options, { signal } = {}) {
  const data = await request('/api/survey/runs', {
    method: 'POST',
    token,
    body: options,
    signal,
    defaultMessage: 'Không thể khởi chạy khảo sát.'
  });
  return unwrap(data, data);
}

export async function getSurveyRunStatus(token, runId, { signal } = {}) {
  const data = await request(`/api/survey/runs/${encodeURIComponent(runId)}`, {
    token,
    signal,
    defaultMessage: 'Không thể kiểm tra trạng thái khảo sát.'
  });
  return unwrap(data, data);
}

export async function loginEnglish(token, credentials, { signal } = {}) {
  const data = await request('/api/english/login', { method: 'POST', token, body: credentials, signal, defaultMessage: 'Không thể đăng nhập Moodle.' });
  return unwrap(data, data);
}

export async function getEnglishCourses(token, sessionId, { signal } = {}) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/courses`, { token, signal, defaultMessage: 'Không thể tải danh sách khóa học.' });
  return unwrap(data, data);
}

export async function getEnglishActivities(token, sessionId, courseId, { signal } = {}) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/activities?courseId=${encodeURIComponent(courseId)}`, { token, signal, defaultMessage: 'Không thể quét danh sách bài tập.' });
  return unwrap(data, data);
}

export async function startEnglishExercise(token, sessionId, options) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/start`, { method: 'POST', token, body: options, defaultMessage: 'Không thể khởi chạy bài tập.' });
  return unwrap(data, data);
}

export async function startEnglishCourseFinish(token, sessionId, options) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/finish-course`, { method: 'POST', token, body: options, defaultMessage: 'Không thể khởi chạy tự động hoàn thành khóa học.' });
  return unwrap(data, data);
}

export async function stopEnglishExercise(token, sessionId) { return request(`/api/english/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', token, defaultMessage: 'Không thể dừng tiến trình.' }); }
export async function closeEnglishSession(token, sessionId) { return request(`/api/english/${encodeURIComponent(sessionId)}`, { method: 'DELETE', token, defaultMessage: 'Không thể đóng phiên Moodle.' }); }
export async function getEnglishAnswers(token) { const data = await request('/api/english/answers', { token, defaultMessage: 'Không thể tải ngân hàng đáp án.' }); return unwrap(data, []); }
export async function saveEnglishAnswer(token, question, correctAnswer) { const data = await request('/api/english/answers', { method: 'POST', token, body: { question, correctAnswer }, defaultMessage: 'Không thể lưu đáp án.' }); return unwrap(data, data); }
export async function deleteEnglishAnswer(token, id) { return request(`/api/english/answers/${encodeURIComponent(id)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa đáp án.' }); }

export function createEventStream(path, { onMessage, onError, onOpen } = {}) {
  const source = new EventSource(path);
  if (onMessage) source.onmessage = onMessage;
  if (onError) source.onerror = onError;
  if (onOpen) source.onopen = onOpen;
  return () => source.close();
}
