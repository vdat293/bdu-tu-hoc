/**
 * Broadcast thông báo cập nhật website qua Discord DM.
 *
 * Cùng một luồng với scripts/discord-broadcast.js: ghi hàng loạt vào
 * notification_outbox type='broadcast', bot (scripts/discord-bot.js) sẽ poll
 * và DM cho sinh viên đã liên kết Discord + đang bật nhận thông báo.
 *
 * occurrence_key chống gửi trùng: cùng key + cùng mssv sẽ bị bỏ qua.
 */
import { isDatabaseConfigured, query } from '../db/database.js';

export const BROADCAST_MAX_TEXT = 3500;
export const BROADCAST_MAX_KEY = 80;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizeBroadcastText(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw httpError('Nội dung thông báo không được để trống.');
  if (text.length > BROADCAST_MAX_TEXT) {
    throw httpError(`Nội dung thông báo tối đa ${BROADCAST_MAX_TEXT} ký tự (hiện tại ${text.length}).`);
  }
  return text;
}

export function buildBroadcastKey(value) {
  const raw = String(value ?? '').trim();
  if (raw) {
    const clean = raw.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, BROADCAST_MAX_KEY);
    if (clean) return clean;
  }
  return `broadcast-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export const BroadcastService = {
  async getRecipients() {
    if (!isDatabaseConfigured()) return { discord: 0 };
    const { rows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM student_notification_prefs p
       WHERE p.discord_user_id IS NOT NULL AND p.notify_discord = TRUE AND p.unsubscribed_at IS NULL`
    );
    return { discord: Number(rows[0]?.total || 0) };
  },

  async enqueue({ text, key = null, actor = null } = {}) {
    const message = normalizeBroadcastText(text);
    const occurrenceKey = buildBroadcastKey(key);
    const actorMssv = String(actor ?? '').trim().slice(0, 32);
    const result = await query(
      `INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
       SELECT p.mssv, 'discord', 'broadcast', $1, 0, NOW(),
              jsonb_build_object('text', $2::text, 'actor', NULLIF($3, '')), 'pending'
       FROM student_notification_prefs p
       WHERE p.discord_user_id IS NOT NULL AND p.notify_discord = TRUE AND p.unsubscribed_at IS NULL
       ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING`,
      [occurrenceKey, message, actorMssv]
    );
    return { occurrence_key: occurrenceKey, enqueued: Number(result.rowCount || 0) };
  },

  async listRecent(limit = 8) {
    if (!isDatabaseConfigured()) return [];
    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 8));
    const { rows } = await query(
      `SELECT occurrence_key,
              MIN(created_at) AS created_at,
              COUNT(*)::int AS recipients,
              COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              (ARRAY_AGG(payload->>'text' ORDER BY created_at DESC))[1] AS text,
              (ARRAY_AGG(payload->>'actor' ORDER BY created_at DESC))[1] AS actor
       FROM notification_outbox
       WHERE channel = 'discord' AND type = 'broadcast'
       GROUP BY occurrence_key
       ORDER BY MIN(created_at) DESC
       LIMIT $1`,
      [safeLimit]
    );
    return rows.map((row) => ({
      occurrence_key: row.occurrence_key,
      created_at: row.created_at,
      recipients: Number(row.recipients || 0),
      sent: Number(row.sent || 0),
      failed: Number(row.failed || 0),
      pending: Number(row.pending || 0),
      skipped: Number(row.skipped || 0),
      text: row.text || '',
      actor: row.actor || ''
    }));
  }
};
