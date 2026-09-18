import crypto from 'node:crypto';
import '../config/load-env.js';
import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function getEncryptionKey() {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY || '';
  if (!raw) {
    const error = new Error('Chưa cấu hình NOTIFICATION_ENCRYPTION_KEY.');
    error.code = 'NOTIFICATION_KEY_MISSING';
    throw error;
  }
  // Cho phép base64 32 bytes hoặc chuỗi 32 ký tự.
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {}
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length === 32) return buf;
  const error = new Error('NOTIFICATION_ENCRYPTION_KEY phải là 32 bytes (openssl rand -base64 32).');
  error.code = 'NOTIFICATION_KEY_INVALID';
  throw error;
}

export const TokenVaultService = {
  encryptToken(plainToken) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plainToken), 'utf8'), cipher.final()]);
    return {
      enc_token: enc.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64')
    };
  },

  decryptToken({ enc_token, iv, auth_tag }) {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(String(iv), 'base64')
    );
    decipher.setAuthTag(Buffer.from(String(auth_tag), 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(String(enc_token), 'base64')),
      decipher.final()
    ]);
    return dec.toString('utf8');
  },

  // Chỉ gọi khi prefs cho phép (consent còn hiệu lực). Rotate mỗi lần login.
  async save(mssv, plainToken, expiresIn = null) {
    const clean = normalizeMssv(mssv);
    if (!clean || !plainToken || !isDatabaseConfigured()) return null;
    const { enc_token, iv, auth_tag } = this.encryptToken(plainToken);
    const expiresAt = Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;
    await query(`
      INSERT INTO bdu_token_vault (mssv, enc_token, iv, auth_tag, expires_at, revoked_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NULL, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        enc_token = EXCLUDED.enc_token,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL,
        updated_at = NOW();
    `, [clean, enc_token, iv, auth_tag, expiresAt]);
    return true;
  },

  async getValidToken(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return null;
    const res = await query('SELECT * FROM bdu_token_vault WHERE mssv = $1 LIMIT 1', [clean]);
    const row = res.rows[0];
    if (!row || row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
    try {
      return this.decryptToken(row);
    } catch {
      return null;
    }
  },

  async revoke(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    await query('UPDATE bdu_token_vault SET revoked_at = NOW(), updated_at = NOW() WHERE mssv = $1', [clean]);
    return true;
  },

  async destroy(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    await query('DELETE FROM bdu_token_vault WHERE mssv = $1', [clean]);
    return true;
  }
};

export const NotificationPrefsService = {
  async get(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return null;
    const res = await query('SELECT * FROM student_notification_prefs WHERE mssv = $1 LIMIT 1', [clean]);
    return res.rows[0] || null;
  },

  isConsented(prefs) {
    return Boolean(prefs && prefs.consent_at && !prefs.unsubscribed_at);
  },

  // Bật: bắt buộc xac_nhan=true từ client (giống diary_submit).
  async consent(mssv, { xac_nhan = false } = {}) {
    const clean = normalizeMssv(mssv);
    if (!clean) throw Object.assign(new Error('Thiếu MSSV.'), { status: 401 });
    if (xac_nhan !== true) {
      throw Object.assign(new Error('Bạn cần tích xác nhận đồng ý mới bật nhắc lịch.'), { status: 400 });
    }
    if (!isDatabaseConfigured()) throw Object.assign(new Error('Database chưa cấu hình.'), { status: 503 });
    await query(`
      INSERT INTO students (mssv, is_active) VALUES ($1, FALSE)
      ON CONFLICT (mssv) DO NOTHING;
    `, [clean]);
    const res = await query(`
      INSERT INTO student_notification_prefs (mssv, consent_at, unsubscribed_at, updated_at)
      VALUES ($1, NOW(), NULL, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        consent_at = NOW(),
        unsubscribed_at = NULL,
        consent_version = student_notification_prefs.consent_version + 1,
        updated_at = NOW()
      RETURNING *;
    `, [clean]);
    return res.rows[0];
  },

  // Tắt hẳn: xóa vault + snapshot + outbox pending + ĐỊNH DANH Discord cũ.
  // Phải xóa link Discord ở đây, nếu không bật lại sẽ tưởng vẫn còn link
  // và bỏ qua bước kết nối (bug đã gặp). Muốn giữ link thì dùng unlinkDiscord.
  async revoke(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    await TokenVaultService.destroy(clean);
    await query(`DELETE FROM schedule_snapshots WHERE mssv = $1`, [clean]);
    await query(`DELETE FROM notification_outbox WHERE mssv = $1 AND status = 'pending'`, [clean]);
    await query(`DELETE FROM discord_link_codes WHERE mssv = $1`, [clean]);
    await query(`DELETE FROM discord_oauth_states WHERE mssv = $1`, [clean]);
    await query(`
      UPDATE student_notification_prefs
      SET unsubscribed_at = NOW(),
        notify_email = FALSE,
        notify_discord = FALSE,
        discord_user_id = NULL,
        discord_username = NULL,
        discord_verified_at = NULL,
        updated_at = NOW()
      WHERE mssv = $1;
    `, [clean]);
    return true;
  },

  // Gỡ liên kết Discord để đổi tài khoản. Giữ consent + snapshot,
  // chỉ xóa định danh Discord và hàng đợi discord chưa gửi.
  async unlinkDiscord(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return false;
    await query(`
      UPDATE student_notification_prefs SET
        discord_user_id = NULL,
        discord_username = NULL,
        discord_verified_at = NULL,
        notify_discord = FALSE,
        updated_at = NOW()
      WHERE mssv = $1;
    `, [clean]);
    await query(`DELETE FROM discord_link_codes WHERE mssv = $1`, [clean]);
    await query(`DELETE FROM discord_oauth_states WHERE mssv = $1`, [clean]);
    await query(`DELETE FROM notification_outbox WHERE mssv = $1 AND channel = 'discord' AND status = 'pending'`, [clean]);
    return true;
  },

  async updateChannels(mssv, { notify_email, notify_discord, email, remind_offsets } = {}) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return null;
    const prefs = await this.get(clean);
    if (!this.isConsented(prefs)) {
      throw Object.assign(new Error('Bạn cần bật đồng ý nhận nhắc lịch trước.'), { status: 400 });
    }
    const res = await query(`
      UPDATE student_notification_prefs SET
        notify_email = COALESCE($2, notify_email),
        notify_discord = COALESCE($3, notify_discord),
        email = COALESCE($4, email),
        remind_offsets = COALESCE($5, remind_offsets),
        updated_at = NOW()
      WHERE mssv = $1
      RETURNING *;
    `, [
      clean,
      typeof notify_email === 'boolean' ? notify_email : null,
      typeof notify_discord === 'boolean' ? notify_discord : null,
      email ? String(email).trim().slice(0, 255) : null,
      Array.isArray(remind_offsets) ? remind_offsets.map(Number).filter((n) => n > 0 && n <= 1440) : null
    ]);
    return res.rows[0] || null;
  }
};
