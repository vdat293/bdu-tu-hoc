import crypto from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { BduService } from './bdu.service.js';
import { currentRequest } from '../utils/request-context.js';

// Cache token→MSSV có TRẦN (LRU) + TTL theo từng entry. Trước đây là Map không
// giới hạn kèm cleanup() quét toàn bộ mỗi request: vừa rò rỉ bộ nhớ dài hạn
// (mỗi token một entry, không bao giờ thu hồi nếu không đọc lại), vừa tốn O(n)
// mỗi lần xác minh/peek. LRU giữ bộ nhớ có trần và tự loại entry hết hạn khi
// đọc. `perf.now` ghim vào Date.now để TTL đo theo đồng hồ hệ thống (khớp hành
// vi cũ và cho phép test điều khiển thời gian).
const IDENTITY_CACHE_MAX = Number.parseInt(process.env.BDU_IDENTITY_CACHE_MAX || '', 10);
const identities = new LRUCache({
  max: Number.isSafeInteger(IDENTITY_CACHE_MAX) && IDENTITY_CACHE_MAX > 0 ? IDENTITY_CACHE_MAX : 20_000,
  // ttlResolution: 0 → luôn gọi perf.now() thay vì đệm kết quả 1ms. Bộ đệm 1ms
  // của lru-cache dựa trên đồng hồ THẬT nên không tương thích khi test điều khiển
  // Date.now; đặt 0 để TTL luôn đo đúng theo perf.now (Date.now) đã cấu hình.
  ttlResolution: 0,
  perf: { now: () => Date.now() }
});
const pendingResolutions = new Map();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESTORED_TOKEN_TTL_MS = 5 * 60 * 1000;

function normalizeMssv(value) {
  return String(value ?? '').trim().toUpperCase();
}

function markVerifiedRequest(mssv) {
  const req = currentRequest();
  if (req && !req.verifiedMssv) req.verifiedMssv = mssv;
}

function normalizeToken(value) {
  const token = String(value || '').trim();
  return token.startsWith('Bearer ') ? token.slice(7).trim() : token;
}

function tokenKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function restoredTokenTtlMs() {
  const configured = Number.parseInt(process.env.BDU_RESTORED_TOKEN_TTL_MS || '', 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_RESTORED_TOKEN_TTL_MS;
}

function earliestExpiry(...values) {
  return Math.min(...values.filter((value) => Number.isFinite(value)));
}

function tokenExpiresAt(token, expiresIn, cacheTtlMs = null) {
  const now = Date.now();
  const expiresInSeconds = Number(expiresIn);
  const expiresInAt = Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0
    ? now + (expiresInSeconds * 1000)
    : null;
  const cacheTtl = cacheTtlMs === null || cacheTtlMs === undefined ? Number.NaN : Number(cacheTtlMs);
  const cacheExpiresAt = Number.isFinite(cacheTtl) && cacheTtl >= 0 ? now + cacheTtl : null;
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return earliestExpiry(expiresInAt, cacheExpiresAt, now + DEFAULT_TTL_MS);
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const jwtExpiresAt = Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
    return earliestExpiry(jwtExpiresAt, expiresInAt, cacheExpiresAt, now + DEFAULT_TTL_MS);
  } catch {
    return earliestExpiry(expiresInAt, cacheExpiresAt, now + DEFAULT_TTL_MS);
  }
}

function unavailableIdentityError(message = 'Chưa thể xác minh phiên BDU lúc này. Vui lòng thử lại.') {
  const error = new Error(message);
  error.status = 503;
  error.code = 'AUTH_UNAVAILABLE';
  error.retryable = true;
  return error;
}

function findMssv(payload, depth = 0) {
  if (!payload || depth > 8) return '';
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findMssv(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof payload !== 'object') return '';

  const aliases = new Set(['mssv', 'ma_sinh_vien', 'ma_sv', 'masv', 'username', 'user_name']);
  for (const [key, value] of Object.entries(payload)) {
    if (aliases.has(key.toLowerCase())) {
      const candidate = normalizeMssv(value);
      if (/^[A-Z0-9]{6,32}$/.test(candidate)) return candidate;
    }
  }
  for (const value of Object.values(payload)) {
    const found = findMssv(value, depth + 1);
    if (found) return found;
  }
  return '';
}

export const BduIdentityService = {
  register(tokenValue, mssvValue, { expiresIn, cacheTtlMs } = {}) {
    const token = normalizeToken(tokenValue);
    const mssv = normalizeMssv(mssvValue);
    if (!token || !mssv) return;
    // TTL tương đối cho từng entry. Phiên đã hết hạn ngay (expires_in = 0) thì
    // KHÔNG được cache, nếu không request kế tiếp sẽ dùng lại token đã chết.
    const ttl = tokenExpiresAt(token, expiresIn, cacheTtlMs) - Date.now();
    if (ttl > 0) identities.set(tokenKey(token), mssv, { ttl });
  },

  async resolveVerifiedMssv(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (!token) {
      const error = new Error('Thiếu mã xác thực BDU. Vui lòng đăng nhập lại.');
      error.status = 401;
      throw error;
    }
    const key = tokenKey(token);
    const cached = identities.get(key);
    if (cached) {
      markVerifiedRequest(cached);
      return cached;
    }

    // A reconnect storm after a deploy must not turn into dozens of identical
    // BDU profile calls. Share one verification per opaque token and let all
    // waiting sockets receive the same authoritative outcome.
    const pending = pendingResolutions.get(key);
    if (pending) {
      const mssv = await pending;
      markVerifiedRequest(mssv);
      return mssv;
    }

    // A restored browser session may outlive this process. Re-verify it against
    // BDU rather than trusting an MSSV supplied by the browser or JWT claims.
    const resolution = (async () => {
      const profile = await BduService.getProfile(token);
      const mssv = findMssv(profile);
      // Missing identity data is not proof that credentials are bad. It occurs
      // when BDU returns a degraded/partial payload during maintenance.
      if (!mssv) throw unavailableIdentityError();
      // `clear()` can run while a request is in flight (for example, logout).
      // Do not let that old request put an opaque token back into the cache.
      if (pendingResolutions.get(key) === resolution) {
        // Restored opaque sessions have no authoritative expires_in available.
        // Cache their BDU verification only briefly, never for the historical
        // 24-hour fallback; JWT exp still wins if it is earlier.
        this.register(token, mssv, { cacheTtlMs: restoredTokenTtlMs() });
      }
      return mssv;
    })();
    pendingResolutions.set(key, resolution);
    try {
      const mssv = await resolution;
      markVerifiedRequest(mssv);
      return mssv;
    } finally {
      if (pendingResolutions.get(key) === resolution) pendingResolutions.delete(key);
    }
  },

  peek(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (!token) return null;
    return identities.get(tokenKey(token)) || null;
  },

  clear(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (token) {
      const key = tokenKey(token);
      identities.delete(key);
      pendingResolutions.delete(key);
    }
  }
};

export const BduIdentityInternals = {
  findMssv, normalizeMssv, tokenExpiresAt, unavailableIdentityError, restoredTokenTtlMs
};
