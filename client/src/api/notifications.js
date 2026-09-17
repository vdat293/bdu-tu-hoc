import { request, unwrap } from './http.js';

function itemsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  return [];
}

export async function getNotifications(token, { limit = 20, offset = 0, signal } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  });
  try {
    const data = await request(`/api/notifications?${params}`, {
      token,
      signal,
      defaultMessage: 'Không thể tải thông báo.'
    });
    return itemsFromPayload(unwrap(data, data));
  } catch {
    return [];
  }
}

export async function getUnreadCount(token, { signal } = {}) {
  try {
    const data = await request('/api/notifications/unread-count', {
      token,
      signal,
      defaultMessage: 'Không thể tải số thông báo chưa đọc.'
    });
    const payload = unwrap(data, data);
    if (typeof payload === 'number') return payload;
    const raw = payload?.unread ?? payload?.unread_count ?? payload?.total ?? 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function markNotificationRead(token, id) {
  const data = await request(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    token,
    defaultMessage: 'Không thể đánh dấu đã đọc.'
  });
  return unwrap(data, data);
}

export async function markAllNotificationsRead(token) {
  const data = await request('/api/notifications/read-all', {
    method: 'POST',
    token,
    defaultMessage: 'Không thể đánh dấu đã đọc tất cả.'
  });
  return unwrap(data, data);
}
