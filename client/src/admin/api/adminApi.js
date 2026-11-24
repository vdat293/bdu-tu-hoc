const AUTH_KEY_STORAGE = 'bdu_admin_key';
const TOKEN_STORAGE = 'bdu_token';
const LABEL_STORAGE = 'bdu_admin_label';
const MSSV_STORAGE = 'bdu_admin_mssv';

export function readAdminAuth() {
  if (typeof window === 'undefined') {
    return { adminKey: '', token: '', label: '', mssv: '' };
  }
  return {
    adminKey: window.sessionStorage.getItem(AUTH_KEY_STORAGE) || '',
    token: window.sessionStorage.getItem(TOKEN_STORAGE) || window.localStorage.getItem(TOKEN_STORAGE) || '',
    label: window.sessionStorage.getItem(LABEL_STORAGE) || '',
    mssv: window.sessionStorage.getItem(MSSV_STORAGE) || ''
  };
}

export function saveAdminAuth({ adminKey = '', token = '', label = 'Quản trị viên', mssv = '' }) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.sessionStorage.setItem(TOKEN_STORAGE, token);
    window.sessionStorage.removeItem(AUTH_KEY_STORAGE);
  } else if (adminKey) {
    window.sessionStorage.setItem(AUTH_KEY_STORAGE, adminKey);
    window.sessionStorage.removeItem(TOKEN_STORAGE);
  }
  window.sessionStorage.setItem(LABEL_STORAGE, label);
  if (mssv) window.sessionStorage.setItem(MSSV_STORAGE, mssv);
  else window.sessionStorage.removeItem(MSSV_STORAGE);
}

export function hasAdminCredentials() {
  const { adminKey, token } = readAdminAuth();
  return Boolean(adminKey || token);
}

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

export class AdminApiError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export async function adminFetch(path, options = {}) {
  const { adminKey, token } = readAdminAuth();
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };

  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (adminKey) headers['x-admin-key'] = adminKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)
    ? JSON.stringify(options.body)
    : options.body;

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body,
    signal: options.signal
  });

  if (res.status === 401 || res.status === 403) {
    if (!options.quiet && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new AdminApiError('Yêu cầu xác thực quyền quản trị viên.', { status: res.status });
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new AdminApiError('Phản hồi máy chủ không hợp lệ.', { status: res.status });
  }

  if (!res.ok || (json && json.result === false)) {
    throw new AdminApiError(json?.message || 'Thao tác không thành công.', { status: res.status });
  }

  return json?.data !== undefined ? json.data : json;
}

export async function loginAdmin(payload) {
  const res = await fetch('/api/admin/dashboard/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.result) {
    throw new Error(json?.message || 'Đăng nhập quản trị thất bại.');
  }
  saveAdminAuth({
    adminKey: json.adminKey || payload.key || '',
    token: json.token || '',
    label: json.name || json.mssv || 'Quản trị viên',
    mssv: json.mssv || ''
  });
  return json;
}

function qs(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const AdminApi = {
  getLive: (signal) => adminFetch('/api/admin/dashboard/live', { signal }),
  getOverview: (timeRange, signal) => adminFetch(`/api/admin/dashboard/overview${qs({ timeRange })}`, { signal }),
  getTimeline: (timeRange, signal) => adminFetch(`/api/admin/dashboard/timeline${qs({ timeRange })}`, { signal }),
  getInteractionsSummary: (timeRange, signal) => adminFetch(`/api/admin/dashboard/interactions/summary${qs({ timeRange })}`, { signal }),
  getInteractionsPages: (params, signal) => adminFetch(`/api/admin/dashboard/interactions/pages${qs(params)}`, { signal }),
  getInteractionsElements: (params, signal) => adminFetch(`/api/admin/dashboard/interactions/elements${qs(params)}`, { signal }),
  getInteractionsFlows: (params, signal) => adminFetch(`/api/admin/dashboard/interactions/flows${qs(params)}`, { signal }),
  getInteractionsStream: (params, signal) => adminFetch(`/api/admin/dashboard/interactions/stream${qs(params)}`, { signal }),
  getAutomationTools: (params, signal) => adminFetch(`/api/admin/dashboard/interactions/tools${qs(params)}`, { signal }),
  getUserUnifiedTimeline: (mssv, params, signal) => adminFetch(`/api/admin/dashboard/interactions/users/${encodeURIComponent(mssv)}/timeline${qs(params)}`, { signal }),
  getUserActivity: (mssv, timeRange, signal) => adminFetch(`/api/admin/dashboard/users/${encodeURIComponent(mssv)}/activity${qs({ timeRange })}`, { signal }),
  getInsightsFeatures: (timeRange, signal) => adminFetch(`/api/admin/dashboard/insights/features${qs({ timeRange })}`, { signal }),
  getInsightsHours: (timeRange, signal) => adminFetch(`/api/admin/dashboard/insights/hours${qs({ timeRange })}`, { signal }),
  getInsightsCohort: (timeRange, signal) => adminFetch(`/api/admin/dashboard/insights/cohort${qs({ timeRange })}`, { signal }),
  getInsightsQuality: (timeRange, signal) => adminFetch(`/api/admin/dashboard/insights/quality${qs({ timeRange })}`, { signal }),
  getDevices: (timeRange, signal) => adminFetch(`/api/admin/dashboard/devices${qs({ timeRange })}`, { signal }),
  getLogs: (params, signal) => adminFetch(`/api/admin/dashboard/logs${qs(params)}`, { signal }),
  getRoutes: (timeRange, signal) => adminFetch(`/api/admin/dashboard/routes${qs({ timeRange })}`, { signal }),
  getVisitedStudents: (params, signal) => adminFetch(`/api/admin/dashboard/visited-students${qs(params)}`, { signal }),
  getSystem: (signal) => adminFetch('/api/admin/dashboard/system', { signal }),
  getVps: (signal) => adminFetch('/api/admin/dashboard/vps', { signal }),
  flushVpsBuffers: () => adminFetch('/api/admin/dashboard/vps/flush-buffers', { method: 'POST' }),
  getRankingSync: (signal) => adminFetch('/api/admin/dashboard/ranking-sync', { signal }),
  updateRankingSync: (enabled) => adminFetch('/api/admin/dashboard/ranking-sync', { method: 'PUT', body: { enabled } }),
  getOdpSync: (signal) => adminFetch('/api/admin/dashboard/odp-sync', { signal }),
  runOdpSync: () => adminFetch('/api/admin/dashboard/odp-sync', { method: 'POST' }),
  getServiceLock: (signal) => adminFetch('/api/admin/dashboard/service-lock', { signal }),
  updateServiceLock: (payload) => adminFetch('/api/admin/dashboard/service-lock', { method: 'PUT', body: payload }),
  purgeLogs: (payload) => adminFetch('/api/admin/dashboard/purge', { method: 'POST', body: payload }),
  getTtcdsPermissions: (signal) => adminFetch('/api/ttcds/permissions', { quiet: true, signal }),
  getTtcdsAudit: (signal) => adminFetch('/api/ttcds/audit?limit=50', { quiet: true, signal }),
  saveTtcdsPermission: (payload) => adminFetch('/api/ttcds/permissions', { method: 'PUT', body: payload })
};
