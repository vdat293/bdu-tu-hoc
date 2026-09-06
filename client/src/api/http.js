export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.') {
    super(message, { status: 401, code: 401 });
    this.name = 'SessionExpiredError';
  }
}

function notifySessionExpired(message) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bdu:session_expired', { detail: { message } }));
  }
}

async function parseResponse(response, responseType) {
  if (responseType === 'blob') return response.blob();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return await response.json(); } catch { return null; }
  }
  return response.text();
}

export async function request(path, {
  token,
  method = 'GET',
  body,
  headers = {},
  signal,
  responseType = 'json',
  defaultMessage = 'Thao tác không thành công.'
} = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (body && !(body instanceof FormData) && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: body && !(body instanceof FormData) && typeof body !== 'string' ? JSON.stringify(body) : body,
    signal
  });
  const data = await parseResponse(response, responseType);
  const message = typeof data === 'object' && data?.message ? data.message : defaultMessage;
  const isExpired = response.status === 401 || data?.code === 401 || /hết hạn|expired/i.test(message);
  if (isExpired) {
    notifySessionExpired(message);
    throw new SessionExpiredError(message);
  }
  if (!response.ok || (data && typeof data === 'object' && data.result === false)) {
    throw new ApiError(message, { status: response.status, code: data?.code, details: data });
  }
  return data;
}

export function unwrap(data, fallback = data) {
  if (data && typeof data === 'object' && 'data' in data) return data.data;
  return fallback;
}
