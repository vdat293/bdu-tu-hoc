import { request, unwrap } from './http.js';

export async function getLearningResources(token, { signal } = {}) {
  const data = await request('/api/learning/resources', { token, signal, defaultMessage: 'Không thể tải danh mục tự học.' });
  return unwrap(data, data);
}

export async function getCoursePosts(token, courseCode, { signal } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts`, { token, signal, defaultMessage: 'Không thể tải không gian môn học.' });
  return unwrap(data, data);
}

export async function createCoursePost(token, courseCode, postData) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts`, { method: 'POST', token, body: postData, defaultMessage: 'Không thể đăng nội dung cho môn học.' });
  return unwrap(data, data);
}

export async function deleteCoursePost(token, courseCode, postId) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa bài viết.' });
  return unwrap(data, data);
}

export async function toggleCoursePostLike(token, courseCode, postId) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/like`, { method: 'POST', token, defaultMessage: 'Không thể cập nhật lượt thích.' });
  return unwrap(data, data);
}

export async function getCoursePostComments(token, courseCode, postId, { signal } = {}) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/comments`, { token, signal, defaultMessage: 'Không thể tải bình luận.' });
  return unwrap(data, []);
}

export async function addCoursePostComment(token, courseCode, postId, commentData) {
  const data = await request(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', token, body: commentData, defaultMessage: 'Không thể gửi bình luận.' });
  return unwrap(data, data);
}

export async function getClans(token, { signal } = {}) {
  const data = await request('/api/community/clans', { token, signal, defaultMessage: 'Không thể tải danh sách CLB / Nhóm.' });
  const list = unwrap(data, []);
  if (Array.isArray(list)) list.can_create_clan = Boolean(data?.can_create_clan);
  return list;
}

export async function createClan(token, clanData) {
  const data = await request('/api/community/clans', { method: 'POST', token, body: clanData, defaultMessage: 'Không thể tạo CLB / Nhóm mới.' });
  return unwrap(data, data);
}

export async function joinClan(token, clanId, message = null, answers = undefined) {
  const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/join`, { method: 'POST', token, body: { message, ...(Array.isArray(answers) ? { answers } : {}) }, defaultMessage: 'Không thể gửi yêu cầu tham gia CLB.' });
  return unwrap(data, data);
}

export async function getClanQuiz(token, clanId, { signal } = {}) {
  const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/quiz`, { token, signal, defaultMessage: 'Không thể tải quiz gia nhập CLB.' });
  return unwrap(data, data);
}

export async function updateClanQuiz(token, clanId, config) {
  const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/quiz`, { method: 'PUT', token, body: config, defaultMessage: 'Không thể lưu quiz gia nhập CLB.' });
  return unwrap(data, data);
}

export async function leaveClan(token, clanId) {
  return request(`/api/community/clans/${encodeURIComponent(clanId)}/leave`, { method: 'POST', token, defaultMessage: 'Không thể rời CLB / Nhóm.' });
}

export async function cancelClanJoinRequest(token, clanId) { return request(`/api/community/clans/${encodeURIComponent(clanId)}/join-requests`, { method: 'DELETE', token, defaultMessage: 'Không thể hủy yêu cầu gia nhập.' }); }
export async function getClanJoinRequests(token, clanId, { signal } = {}) { const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/join-requests`, { token, signal, defaultMessage: 'Không thể tải yêu cầu gia nhập.' }); return unwrap(data, []); }
export async function reviewClanJoinRequest(token, clanId, requestId, action) { const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/join-requests/${encodeURIComponent(requestId)}/review`, { method: 'POST', token, body: { action }, defaultMessage: 'Không thể xử lý yêu cầu gia nhập.' }); return unwrap(data, data); }
export async function getClanMembers(token, clanId, { signal } = {}) { const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/members`, { token, signal, defaultMessage: 'Không thể tải thành viên.' }); return unwrap(data, []); }
export async function getClanDocuments(token, clanId, { signal, type, search, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (type && type !== 'all') params.set('type', type);
  if (search) params.set('search', search);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const suffix = params.size ? `?${params}` : '';
  const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/documents${suffix}`, { token, signal, defaultMessage: 'Không thể tải tài liệu CLB.' });
  return unwrap(data, data);
}
export async function updateClanMemberRole(token, clanId, mssv, role) { const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}/members/${encodeURIComponent(mssv)}/role`, { method: 'PATCH', token, body: { role }, defaultMessage: 'Không thể cập nhật vai trò.' }); return unwrap(data, data); }
export async function kickClanMember(token, clanId, mssv) { return request(`/api/community/clans/${encodeURIComponent(clanId)}/members/${encodeURIComponent(mssv)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa thành viên.' }); }
export async function updateClan(token, clanId, changes) { const data = await request(`/api/community/clans/${encodeURIComponent(clanId)}`, { method: 'PATCH', token, body: changes, defaultMessage: 'Không thể cập nhật CLB.' }); return unwrap(data, data); }
export async function disbandClan(token, clanId) { return request(`/api/community/clans/${encodeURIComponent(clanId)}`, { method: 'DELETE', token, defaultMessage: 'Không thể giải tán CLB.' }); }

export async function getCommunityPosts(token, { scope = 'school', scopeId = null, filter = 'all', limit = 20, offset = 0, signal } = {}) {
  const params = new URLSearchParams({ scope, filter, limit: String(limit), offset: String(offset) });
  if (scopeId) params.set('scopeId', String(scopeId));
  const data = await request(`/api/community/posts?${params}`, { token, signal, defaultMessage: 'Không thể tải bảng tin.' });
  return unwrap(data, data);
}

export async function createCommunityPost(token, postData) { const data = await request('/api/community/posts', { method: 'POST', token, body: postData, defaultMessage: 'Không thể đăng bài viết.' }); return unwrap(data, data); }
export async function deleteCommunityPost(token, postId) { return request(`/api/community/posts/${encodeURIComponent(postId)}`, { method: 'DELETE', token, defaultMessage: 'Không thể xóa bài viết.' }); }
export async function toggleCommunityPostLike(token, postId) { const data = await request(`/api/community/posts/${encodeURIComponent(postId)}/like`, { method: 'POST', token, defaultMessage: 'Không thể tương tác like.' }); return unwrap(data, data); }
export async function getCommunityPostComments(token, postId, { signal } = {}) { const data = await request(`/api/community/posts/${encodeURIComponent(postId)}/comments`, { token, signal, defaultMessage: 'Không thể tải bình luận.' }); return unwrap(data, []); }
export async function addCommunityPostComment(token, postId, commentData) { const data = await request(`/api/community/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', token, body: commentData, defaultMessage: 'Không thể thêm bình luận.' }); return unwrap(data, data); }
export async function editCommunityPostComment(token, postId, commentId, content) { const data = await request(`/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', token, body: { content }, defaultMessage: 'Không thể sửa bình luận.' }); return unwrap(data, data); }
export async function deleteCommunityPostComment(token, postId, commentId, reason) { return request(`/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', token, body: { reason }, defaultMessage: 'Không thể xóa bình luận.' }); }
export async function voteClanPoll(token, pollId, optionId) { const data = await request(`/api/community/polls/${encodeURIComponent(pollId)}/vote`, { method: 'POST', token, body: { optionId }, defaultMessage: 'Không thể bình chọn.' }); return unwrap(data, data); }
