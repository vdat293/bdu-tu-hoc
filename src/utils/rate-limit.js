import rateLimit from 'express-rate-limit';

// Global limiter: broad protection against abuse / accidental floods.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { result: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' }
});

// Stricter limiter for authentication endpoints (brute-force protection).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { result: false, message: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.' }
});

// Limiter for heavy / expensive endpoints (ranking, ODP sync, vocab import).
export const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { result: false, message: 'Endpoint nặng: vui lòng thử lại sau.' }
});
