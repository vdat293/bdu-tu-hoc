import crypto from 'node:crypto';
import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

export const DiscordLinkService = {
  // Web tạo mã 6 số sau khi user consent. Hết hạn 10 phút.
  async createCode(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) throw Object.assign(new Error('Database chưa cấu hình.'), { status: 503 });
    const code = String(crypto.randomInt(100000, 999999));
    await query(`
      INSERT INTO discord_link_codes (code, mssv, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes');
    `, [code, clean]);
    return { code, expires_in_minutes: 10 };
  },

  // Bot gọi khi user DM /link <code>.
  async consumeCode(code, discordUserId) {
    const cleanCode = String(code || '').trim();
    const cleanDiscordId = String(discordUserId || '').trim();
    if (!cleanCode || !cleanDiscordId) throw new Error('Thiếu mã liên kết.');
    if (!isDatabaseConfigured()) throw new Error('Database chưa cấu hình.');

    const res = await query(
      `SELECT * FROM discord_link_codes WHERE code = $1 LIMIT 1`,
      [cleanCode]
    );
    const row = res.rows[0];
    if (!row || row.used_at) throw new Error('Mã không hợp lệ hoặc đã dùng.');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Mã đã hết hạn (10 phút). Vào web bấm tạo mã mới.');

    await query(`UPDATE discord_link_codes SET used_at = NOW() WHERE code = $1`, [cleanCode]);
    await query(`
      UPDATE student_notification_prefs SET
        discord_user_id = $2,
        discord_verified_at = NOW(),
        notify_discord = TRUE,
        updated_at = NOW()
      WHERE mssv = $1;
    `, [normalizeMssv(row.mssv), cleanDiscordId]);
    return { mssv: normalizeMssv(row.mssv) };
  },

  async findMssvByDiscordId(discordUserId) {
    const clean = String(discordUserId || '').trim();
    if (!clean || !isDatabaseConfigured()) return null;
    const res = await query(
      `SELECT mssv FROM student_notification_prefs WHERE discord_user_id = $1 AND discord_verified_at IS NOT NULL AND unsubscribed_at IS NULL LIMIT 1`,
      [clean]
    );
    return res.rows[0]?.mssv || null;
  },

  async unlink(discordUserId) {
    const clean = String(discordUserId || '').trim();
    if (!clean || !isDatabaseConfigured()) return false;
    await query(`
      UPDATE student_notification_prefs SET
        discord_user_id = NULL, discord_verified_at = NULL, notify_discord = FALSE, updated_at = NOW()
      WHERE discord_user_id = $1;
    `, [clean]);
    return true;
  }
};
