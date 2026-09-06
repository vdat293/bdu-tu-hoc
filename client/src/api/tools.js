import { request, unwrap } from './http.js';

export async function formatDocx(token, formData, { signal } = {}) {
  const data = await request('/api/wordfmt/format', { method: 'POST', token, body: formData, signal, defaultMessage: 'Định dạng file thất bại.' });
  return data;
}

export async function loginEnglish(credentials, { signal } = {}) {
  const data = await request('/api/english/login', { method: 'POST', body: credentials, signal, defaultMessage: 'Không thể đăng nhập Moodle.' });
  return unwrap(data, data);
}

export async function getEnglishActivities(sessionId, courseId, { signal } = {}) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/activities?courseId=${encodeURIComponent(courseId)}`, { signal, defaultMessage: 'Không thể quét danh sách bài tập.' });
  return unwrap(data, data);
}

export async function startEnglishExercise(sessionId, options) {
  const data = await request(`/api/english/${encodeURIComponent(sessionId)}/start`, { method: 'POST', body: options, defaultMessage: 'Không thể khởi chạy bài tập.' });
  return unwrap(data, data);
}

export async function stopEnglishExercise(sessionId) { return request(`/api/english/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', defaultMessage: 'Không thể dừng tiến trình.' }); }
export async function closeEnglishSession(sessionId) { return request(`/api/english/${encodeURIComponent(sessionId)}`, { method: 'DELETE', defaultMessage: 'Không thể đóng phiên Moodle.' }); }
export async function getEnglishAnswers() { const data = await request('/api/english/answers', { defaultMessage: 'Không thể tải ngân hàng đáp án.' }); return unwrap(data, []); }
export async function saveEnglishAnswer(question, correctAnswer) { const data = await request('/api/english/answers', { method: 'POST', body: { question, correctAnswer }, defaultMessage: 'Không thể lưu đáp án.' }); return unwrap(data, data); }
export async function deleteEnglishAnswer(id) { return request(`/api/english/answers/${encodeURIComponent(id)}`, { method: 'DELETE', defaultMessage: 'Không thể xóa đáp án.' }); }

export function createEventStream(path, { onMessage, onError, onOpen } = {}) {
  const source = new EventSource(path);
  if (onMessage) source.onmessage = onMessage;
  if (onError) source.onerror = onError;
  if (onOpen) source.onopen = onOpen;
  return () => source.close();
}
