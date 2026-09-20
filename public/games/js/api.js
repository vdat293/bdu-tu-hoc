import { getSession, recoverInvalidSession } from './session.js';

// Gọi API BDU: tự gắn Bearer token, bóc { result, data } và chuẩn hoá lỗi thành
// Error có .status/.code để view xử lý (401 thì tự đưa về trang đăng nhập).
export async function api(path, { method = 'GET', body = null, signal = null, silentAuth = false } = {}) {
  const session = getSession();
  const headers = new Headers();
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
  const hasBody = body !== null && body !== undefined;
  if (hasBody && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    method,
    headers,
    signal,
    body: hasBody ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  });

  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }

  if (!response.ok || payload?.result === false) {
    const error = new Error(payload?.message || 'Không thể kết nối máy chủ.');
    error.code = payload?.code || '';
    error.status = response.status;
    const authError = response.status === 401 || error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_INVALID';
    if (authError && session?.token && !silentAuth) recoverInvalidSession();
    throw error;
  }
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

export const GamesApi = {
  listGames: () => api('/api/entertainment/games'),
  createRoom: (payload) => api('/api/entertainment/rooms', { method: 'POST', body: payload }),
  getRoom: (code) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}`),
  joinRoom: (code) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: {} }),
  leaveRoom: (code) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}/leave`, { method: 'POST', body: {} }),
  rematch: (code) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}/rematch`, { method: 'POST', body: {} }),
  listMoves: (code) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}/moves`),
  move: (code, move, clientMoveId) => api(`/api/entertainment/rooms/${encodeURIComponent(code)}/moves`, {
    method: 'POST',
    body: { move, clientMoveId }
  }),
  frames: () => api('/api/identity/frames', { silentAuth: true }),
  myPresentation: () => api('/api/students/me/presentation', { silentAuth: true })
};
