/**
 * Discord alert cho auto đăng ký: khi token BDU hết hạn và không thể tự gia
 * hạn, enqueue vào notification_outbox (bot Discord poll và DM user đã link).
 */
import { isDatabaseConfigured, query } from '../../db/database.js';

export const EnrollmentNotifyService = {
  async notifyTokenExpired({ mssv, runId, message }) {
    if (!mssv || !runId) return false;
    if (!isDatabaseConfigured()) return false;
    try {
      const prefs = await query(
        'SELECT discord_user_id, notify_discord, unsubscribed_at FROM student_notification_prefs WHERE mssv = $1 LIMIT 1',
        [String(mssv)]
      );
      const row = prefs.rows[0];
      if (!row?.discord_user_id || row.notify_discord !== true || row.unsubscribed_at) return false;
      await query(
        `INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, scheduled_for, payload, status)
         VALUES ($1, 'discord', 'enrollment_alert', $2, NOW(), $3, 'pending')
         ON CONFLICT DO NOTHING`,
        [String(mssv), `enrollment:${runId}:token_expired`, JSON.stringify({ text: String(message || '').slice(0, 1500) })]
      );
      return true;
    } catch {
      return false;
    }
  }
};
