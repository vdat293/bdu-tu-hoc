import { request, unwrap } from './http.js';

export async function getReminderPrefs(token, { signal } = {}) {
  const data = await request('/api/reminders/prefs', {
    token,
    signal,
    defaultMessage: 'Không thể tải trạng thái nhắc lịch.'
  });
  return unwrap(data, { consented: false });
}

export async function consentReminders(token, { xac_nhan = false } = {}) {
  const data = await request('/api/reminders/consent', {
    method: 'POST',
    token,
    body: { xac_nhan },
    defaultMessage: 'Không thể bật nhắc lịch.'
  });
  return unwrap(data, data);
}

export async function revokeReminders(token) {
  const data = await request('/api/reminders/revoke', {
    method: 'DELETE',
    token,
    defaultMessage: 'Không thể tắt nhắc lịch.'
  });
  return unwrap(data, data);
}

export async function createDiscordLinkCode(token) {
  const data = await request('/api/reminders/discord/code', {
    method: 'POST',
    token,
    defaultMessage: 'Không thể tạo mã liên kết Discord.'
  });
  return unwrap(data, data);
}

export function readBduToken() {
  try {
    return window.localStorage.getItem('bdu_token') || window.sessionStorage.getItem('bdu_token') || '';
  } catch {
    return '';
  }
}

export async function createDiscordOAuthUrl(token) {
  const data = await request('/api/reminders/discord/oauth-url', {
    method: 'POST',
    token,
    defaultMessage: 'Không thể tạo liên kết Discord.'
  });
  return unwrap(data, data);
}

export async function completeDiscordOAuth(token, { state, code } = {}) {
  const data = await request('/api/reminders/discord/oauth-complete', {
    method: 'POST',
    token,
    body: { state, code },
    defaultMessage: 'Không thể kết nối Discord.'
  });
  return unwrap(data, data);
}

export async function unlinkDiscordLink(token) {
  const data = await request('/api/reminders/discord/link', {
    method: 'DELETE',
    token,
    defaultMessage: 'Không thể gỡ liên kết Discord.'
  });
  return unwrap(data, data);
}

export async function sendDiscordTest(token) {
  const data = await request('/api/reminders/discord/test', {
    method: 'POST',
    token,
    defaultMessage: 'Không thể gửi tin thử.'
  });
  return unwrap(data, data);
}
