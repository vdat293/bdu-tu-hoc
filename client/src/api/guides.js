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
