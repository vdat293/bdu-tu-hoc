import { request, unwrap } from './http.js';

export async function getMyIdentityPresentation(token, { signal } = {}) {
  const data = await request('/api/students/me/presentation', { token, signal, defaultMessage: 'Không thể tải danh hiệu hiển thị.' });
  return unwrap(data, data);
}

export async function getIdentityFrames(token, { signal } = {}) {
  const data = await request('/api/identity/frames', { token, signal, defaultMessage: 'Không thể tải bộ sưu tập khung.' });
  return unwrap(data, data);
}

export async function updateMyIdentityPresentation(token, selectedTitleIds) {
  const data = await request('/api/students/me/presentation', {
    method: 'PUT', token, body: { selectedTitleIds }, defaultMessage: 'Không thể cập nhật danh hiệu hiển thị.'
  });
  return unwrap(data, data);
}

export async function updateMyEquippedFrame(token, frameId) {
  const data = await request('/api/students/me/cosmetics/frame', {
    method: 'PUT', token, body: { frameId }, defaultMessage: 'Không thể cập nhật khung hiển thị.'
  });
  return unwrap(data, data);
}

/**
 * Ảnh đại diện do chính người dùng tải lên (lưu trên Cloudflare R2).
 */
export async function uploadMyAvatar(token, file) {
  const body = new FormData();
  body.append('avatar', file);
  const data = await request('/api/me/avatar', {
    method: 'POST', token, body, defaultMessage: 'Không thể cập nhật ảnh đại diện.'
  });
  return unwrap(data, data);
}

export async function deleteMyAvatar(token) {
  const data = await request('/api/me/avatar', {
    method: 'DELETE', token, defaultMessage: 'Không thể gỡ ảnh đại diện.'
  });
  return unwrap(data, data);
}
