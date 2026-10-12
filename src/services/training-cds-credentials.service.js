/**
 * Lưu mật khẩu app BDU Student (CDS) để tự động đồng bộ tiêu chí 6.16 cho các
 * lần sau. Mật khẩu được mã hóa AES-256-GCM ở application layer bằng
 * NOTIFICATION_ENCRYPTION_KEY và không bao giờ trả về client.
 */

import { TokenVaultService } from './notification-prefs.service.js';
import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

export const TrainingCdsCredentialsService = {
  async save(mssv, password) {
    const clean = normalizeMssv(mssv);
    if (!clean || !password || !isDatabaseConfigured()) return false;
    const { enc_token, iv, auth_tag } = TokenVaultService.encryptToken(password);
    await query(`
      INSERT INTO students (mssv, is_active) VALUES ($1, FALSE)
      ON CONFLICT (mssv) DO NOTHING;
    `, [clean]);
    await query(`
      INSERT INTO training_cds_credentials (mssv, enc_password, iv, auth_tag, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        enc_password = EXCLUDED.enc_password,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        updated_at = NOW();
    `, [clean, enc_token, iv, auth_tag]);
    return true;
  },

  async get(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return null;
    const res = await query(
      'SELECT enc_password, iv, auth_tag FROM training_cds_credentials WHERE mssv = $1 LIMIT 1',
      [clean]
    );
    const row = res.rows[0];
    if (!row) return null;
    try {
      return TokenVaultService.decryptToken({ enc_token: row.enc_password, iv: row.iv, auth_tag: row.auth_tag });
    } catch {
      return null;
    }
  },

  async has(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    const res = await query('SELECT 1 FROM training_cds_credentials WHERE mssv = $1 LIMIT 1', [clean]);
    return res.rows.length > 0;
  },

  async clear(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    await query('DELETE FROM training_cds_credentials WHERE mssv = $1', [clean]);
    return true;
  }
};
