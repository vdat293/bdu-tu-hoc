import crypto from 'node:crypto';
import { BduService } from './bdu.service.js';

const identities = new Map();
const pendingResolutions = new Map();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESTORED_TOKEN_TTL_MS = 5 * 60 * 1000;

function normalizeMssv(value) {
  return String(value ?? '').trim().toUpperCase();
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

function cleanup() {
  const now = Date.now();
  for (const [key, identity] of identities) {
    if (identity.expiresAt <= now) identities.delete(key);
  }
}

export const BduIdentityService = {
  register(tokenValue, mssvValue, { expiresIn, cacheTtlMs } = {}) {
    const token = normalizeToken(tokenValue);
    const mssv = normalizeMssv(mssvValue);
    if (!token || !mssv) return;
    cleanup();
    identities.set(tokenKey(token), { mssv, expiresAt: tokenExpiresAt(token, expiresIn, cacheTtlMs) });
  },

  async resolveVerifiedMssv(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (!token) {
      const error = new Error('Thiếu mã xác thực BDU. Vui lòng đăng nhập lại.');
      error.status = 401;
      throw error;
    }
    cleanup();
    const key = tokenKey(token);
    const cached = identities.get(key);
    if (cached) return cached.mssv;

    // A reconnect storm after a deploy must not turn into dozens of identical
    // BDU profile calls. Share one verification per opaque token and let all
    // waiting sockets receive the same authoritative outcome.
    const pending = pendingResolutions.get(key);
    if (pending) return pending;

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
      return await resolution;
    } finally {
      if (pendingResolutions.get(key) === resolution) pendingResolutions.delete(key);
    }
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
