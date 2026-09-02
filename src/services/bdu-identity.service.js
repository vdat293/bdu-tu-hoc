import crypto from 'node:crypto';
import { BduService } from './bdu.service.js';

const identities = new Map();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

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

function tokenExpiresAt(token) {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return Date.now() + DEFAULT_TTL_MS;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : Date.now() + DEFAULT_TTL_MS;
  } catch {
    return Date.now() + DEFAULT_TTL_MS;
  }
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
  register(tokenValue, mssvValue) {
    const token = normalizeToken(tokenValue);
    const mssv = normalizeMssv(mssvValue);
    if (!token || !mssv) return;
    cleanup();
    identities.set(tokenKey(token), { mssv, expiresAt: tokenExpiresAt(token) });
  },

  async resolveVerifiedMssv(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (!token) {
      const error = new Error('Thiếu mã xác thực BDU. Vui lòng đăng nhập lại.');
      error.status = 401;
      throw error;
    }
    cleanup();
    const cached = identities.get(tokenKey(token));
    if (cached) return cached.mssv;

    // A restored browser session may outlive this process. Re-verify it against
    // BDU rather than trusting an MSSV supplied by the browser or JWT claims.
    const profile = await BduService.getProfile(token);
    const mssv = findMssv(profile);
    if (!mssv) {
      const error = new Error('Không xác minh được MSSV từ phiên BDU hiện tại.');
      error.status = 401;
      throw error;
    }
    this.register(token, mssv);
    return mssv;
  },

  clear(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (token) identities.delete(tokenKey(token));
  }
};

export const BduIdentityInternals = { findMssv, normalizeMssv };
