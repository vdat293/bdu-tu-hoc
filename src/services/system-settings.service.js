import { isDatabaseConfigured, query } from '../db/database.js';

/**
 * Cấu hình runtime của hệ thống (bật/tắt theo mùa từ /admin).
 *
 * Ví dụ key "ranking_sync" với value { enabled: false }: tắt lịch đồng bộ
 * xếp hạng cho tới khi bật lại, không cần sửa env hay restart server.
 *
 * Cache ngắn 30 giây để scheduler/API không phải query liên tục; mọi lần ghi
 * đều xoá cache ngay nên thao tác trong /admin có hiệu lực tức thì.
 * Lưu ý: cache là per-process — hệ thống hiện chạy đúng 1 instance (xem
 * docker-compose `deploy.replicas: 1`); nếu scale ngang phải chuyển sang
 * đọc thẳng DB tại thời điểm scheduler chạy.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map();

export const SystemSettingsService = {
  async get(key, fallback = null) {
    if (!isDatabaseConfigured()) return fallback;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const result = await query('SELECT value FROM system_settings WHERE key = $1', [key]);
    const value = result.rows.length ? result.rows[0].value : fallback;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  },

  async getRecord(key) {
    if (!isDatabaseConfigured()) return null;
    const result = await query(
      'SELECT key, value, updated_at, updated_by FROM system_settings WHERE key = $1',
      [key]
    );
    return result.rows[0] || null;
  },

  async set(key, value, updatedBy = null) {
    const result = await query(`
      INSERT INTO system_settings (key, value, updated_at, updated_by)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING key, value, updated_at, updated_by
    `, [
      String(key),
      JSON.stringify(value ?? null),
      updatedBy ? String(updatedBy).slice(0, 80) : null
    ]);
    cache.delete(key);
    return result.rows[0];
  },

  invalidate(key) {
    cache.delete(key);
  }
};
