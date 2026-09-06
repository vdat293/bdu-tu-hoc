import { request, unwrap } from './http.js';

export async function getMyIdentityPresentation(token, { signal } = {}) {
  const data = await request('/api/students/me/presentation', { token, signal, defaultMessage: 'Không thể tải danh hiệu hiển thị.' });
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
