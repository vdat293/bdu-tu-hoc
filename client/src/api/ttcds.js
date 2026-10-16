import { request, unwrap } from './http.js';

/** Tách list MSSV paste từ textarea: phẩy / khoảng trắng / chấm phẩy, UPPER-trim, khử trùng. */
export function parseMssvList(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[,\s;]+/)) {
    const mssv = raw.trim().toUpperCase();
    if (!mssv || seen.has(mssv)) continue;
    seen.add(mssv);
    out.push(mssv);
  }
  return out;
}

export async function getTtcdsCapabilities(token, { signal } = {}) {
  const data = await request('/api/ttcds/capabilities', { token, signal, defaultMessage: 'Không thể tải quyền Trung tâm CĐS.' });
  const body = data?.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
  return { can_access: Boolean(body?.can_access), level: body?.level ?? null };
}

export async function getTtcdsGroups(token, { signal } = {}) {
  const data = await request('/api/ttcds/groups', { token, signal, defaultMessage: 'Không thể tải danh sách nhóm.' });
  return unwrap(data, []);
}

export async function createTtcdsGroup(token, { name, mentor } = {}) {
  const data = await request('/api/ttcds/groups', { method: 'POST', token, body: { name, mentor }, defaultMessage: 'Không thể tạo nhóm.' });
  return unwrap(data, data);
}

export async function deleteTtcdsGroup(token, groupId) {
  return request(`/api/ttcds/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa nhóm.' });
}

export async function getTtcdsGroupMembers(token, groupId, { signal } = {}) {
  const data = await request(`/api/ttcds/groups/${encodeURIComponent(groupId)}/members`, { token, signal, defaultMessage: 'Không thể tải danh sách thành viên.' });
  return unwrap(data, []);
}

export async function addTtcdsGroupMember(token, groupId, { mssv, note } = {}) {
  const data = await request(`/api/ttcds/groups/${encodeURIComponent(groupId)}/members`, { method: 'POST', token, body: { mssv, note }, defaultMessage: 'Không thể thêm thành viên.' });
  return unwrap(data, data);
}

export async function removeTtcdsGroupMember(token, groupId, mssv) {
  return request(`/api/ttcds/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(mssv)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa thành viên.' });
}

export async function searchTtcdsStudents(token, q, { signal, limit } = {}) {
  const params = new URLSearchParams({ q: String(q ?? '').trim() });
  if (limit !== undefined && limit !== null && limit !== '') params.set('limit', String(limit));
  const data = await request(`/api/ttcds/students/search?${params}`, { token, signal, defaultMessage: 'Không thể tìm kiếm sinh viên.' });
  return unwrap(data, data);
}

export async function getTtcdsStudent(token, mssv, { signal } = {}) {
  const data = await request(`/api/ttcds/students/${encodeURIComponent(String(mssv ?? '').trim().toUpperCase())}`, { token, signal, defaultMessage: 'Không thể tải thông tin sinh viên.' });
  return unwrap(data, data);
}
