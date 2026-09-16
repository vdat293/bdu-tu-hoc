import { request, unwrap } from './http.js';

function getAdminHeaders(adminKey) {
  const headers = {};
  const key = adminKey || (typeof window !== 'undefined' && window.sessionStorage?.getItem('bdu_admin_key'));
  if (key) {
    headers['x-admin-key'] = key;
  }
  return headers;
}

export async function fetchDashboardOverview({ token, adminKey, timeRange = '24h', signal } = {}) {
  const query = new URLSearchParams({ timeRange });
  const data = await request(`/api/admin/dashboard/overview?${query}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải thống kê tổng quan.'
  });
  return unwrap(data, {});
}

export async function fetchDashboardTimeline({ token, adminKey, timeRange = '24h', signal } = {}) {
  const query = new URLSearchParams({ timeRange });
  const data = await request(`/api/admin/dashboard/timeline?${query}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải biểu đồ lưu lượng.'
  });
  return unwrap(data, []);
}

export async function fetchDashboardEndpoints({ token, adminKey, timeRange = '24h', limit = 10, signal } = {}) {
  const query = new URLSearchParams({ timeRange, limit: String(limit) });
  const data = await request(`/api/admin/dashboard/endpoints?${query}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải top endpoints.'
  });
  return unwrap(data, []);
}

export async function fetchDashboardUsers({ token, adminKey, timeRange = '24h', limit = 15, signal } = {}) {
  const query = new URLSearchParams({ timeRange, limit: String(limit) });
  const data = await request(`/api/admin/dashboard/users?${query}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải danh sách sinh viên tích cực.'
  });
  return unwrap(data, []);
}

export async function fetchDashboardDevices({ token, adminKey, timeRange = '24h', signal } = {}) {
  const query = new URLSearchParams({ timeRange });
  const data = await request(`/api/admin/dashboard/devices?${query}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải thống kê thiết bị.'
  });
  return unwrap(data, { devices: [], os: [], browsers: [] });
}

export async function fetchDashboardLogs({
  token,
  adminKey,
  page = 1,
  limit = 50,
  mssv = '',
  ip = '',
  status = 'all',
  method = 'all',
  path = '',
  search = '',
  timeRange = '24h',
  signal
} = {}) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  if (mssv) params.set('mssv', mssv);
  if (ip) params.set('ip', ip);
  if (status && status !== 'all') params.set('status', status);
  if (method && method !== 'all') params.set('method', method);
  if (path) params.set('path', path);
  if (search) params.set('search', search);
  if (timeRange) params.set('timeRange', timeRange);

  const data = await request(`/api/admin/dashboard/logs?${params}`, {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải nhật ký truy cập.'
  });
  return unwrap(data, { logs: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } });
}

export async function fetchDashboardSystem({ token, adminKey, signal } = {}) {
  const data = await request('/api/admin/dashboard/system', {
    token,
    headers: getAdminHeaders(adminKey),
    signal,
    defaultMessage: 'Không thể tải thông số hệ thống.'
  });
  return unwrap(data, null);
}

export async function purgeDashboardLogs({ token, adminKey, olderThanDays = 14 } = {}) {
  const data = await request('/api/admin/dashboard/purge', {
    method: 'POST',
    token,
    headers: getAdminHeaders(adminKey),
    body: { olderThanDays },
    defaultMessage: 'Không thể dọn dẹp log cũ.'
  });
  return unwrap(data, {});
}
