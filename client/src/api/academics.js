import { request, unwrap } from './http.js';

export function loginStudent(username, password, { signal } = {}) {
  return request('/api/login', {
    method: 'POST', body: { username, password }, signal,
    defaultMessage: 'Đăng nhập không thành công.'
  });
}

export async function getGrades(token, options = {}) {
  const data = await request('/api/grades', {
    method: 'POST', token, signal: options.signal,
    defaultMessage: 'Không thể tải bảng điểm.'
  });
  return unwrap(data, data);
}

export async function getProfile(token, { idsv = '', mssv = '', signal } = {}) {
  const params = new URLSearchParams();
  if (idsv) params.set('IDSV', idsv);
  if (mssv) params.set('MaSV', mssv);
  const query = params.toString() ? `?${params}` : '';
  return request(`/api/profile${query}`, {
    method: 'POST', token, body: { token, idsv, maSV: mssv }, signal,
    defaultMessage: 'Không thể tải thông tin sinh viên.'
  });
}

export async function getSchedule(token, semester, { signal } = {}) {
  const params = new URLSearchParams();
  if (semester) params.set('hoc_ky', semester);
  const query = params.toString() ? `?${params}` : '';
  const data = await request(`/api/schedule${query}`, {
    method: 'POST', token, body: { token, hoc_ky: semester || null }, signal,
    defaultMessage: 'Không thể tải thời khóa biểu.'
  });
  return unwrap(data, data);
}

export async function getMyAcademicRanking(token, { signal } = {}) {
  const data = await request('/api/rankings/me', { token, signal, defaultMessage: 'Không thể tải dữ liệu xếp hạng.' });
  return unwrap(data, data);
}

export async function getAcademicLeaderboard(token, { scope = 'school', metric = 'gpa', signal } = {}) {
  const params = new URLSearchParams({ scope, metric });
  const data = await request(`/api/rankings/leaderboard?${params}`, {
    token, signal, defaultMessage: 'Chưa thể tải bảng xếp hạng.'
  });
  return unwrap(data, data);
}
