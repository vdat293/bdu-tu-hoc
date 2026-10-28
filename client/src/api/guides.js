import { request, unwrap } from './http.js';

export async function getCourseGuide(token, courseCode, { signal } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guide`, { token, signal, defaultMessage: 'Không thể tải hướng dẫn thực hành.' });
  return unwrap(data, { enabled: false, lessons: [] });
}

export async function getGuideProgress(token, courseCode, lessonId, { signal } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/progress`, { token, signal, defaultMessage: 'Không thể tải tiến độ hướng dẫn.' });
  return unwrap(data, { steps: {}, workdir: null });
}

export async function saveGuideProgress(token, courseCode, lessonId, { stepId, done, workdir } = {}) {
  const body = { stepId, done };
  if (workdir !== undefined) body.workdir = workdir;
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/progress`, { method: 'POST', token, body, defaultMessage: 'Không thể lưu tiến độ hướng dẫn.' });
  return unwrap(data, data);
}

export async function getLabResult(token, courseCode, lessonId, { signal } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/lab-result`, { token, signal, defaultMessage: 'Không thể tải kết quả lab.' });
  return unwrap(data, null);
}

export async function saveLabResult(token, courseCode, lessonId, { token: labToken } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/lab-result`, { method: 'POST', token, body: { token: labToken }, defaultMessage: 'Không thể lưu kết quả lab.' });
  return unwrap(data, data);
}

export async function resetGuideProgress(token, courseCode, lessonId) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/reset`, { method: 'DELETE', token, defaultMessage: 'Không thể làm lại từ đầu.' });
  return unwrap(data, data);
}
