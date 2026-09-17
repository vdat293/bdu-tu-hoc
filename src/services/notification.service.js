import { query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clampPaging(limit, offset) {
  const safeLimit = Math.trunc(Math.max(1, Math.min(50, Number(limit) || 20)));
  const safeOffset = Math.trunc(Math.max(0, Number(offset) || 0));
  return { safeLimit, safeOffset };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export const NotificationService = {
  /**
   * Liệt kê thông báo của một user, mới nhất trước.
   */
  async listNotifications(recipientMssv, { limit = 20, offset = 0 } = {}) {
    const clean = normalizeMssv(recipientMssv);
    if (!clean) throw httpError('Thiếu MSSV người nhận.', 401);
    const { safeLimit, safeOffset } = clampPaging(limit, offset);

    const listSql = `
      SELECT
        n.id,
        n.recipient_mssv,
        n.actor_mssv,
        COALESCE(NULLIF(s.full_name, ''), n.actor_mssv) AS actor_name,
        n.type,
        n.post_id,
        n.comment_id,
        n.is_read,
        n.created_at,
        p.title AS post_title,
        COALESCE(p.category, 'discussion') AS post_category,
        SUBSTRING(c.content, 1, 140) AS comment_snippet
      FROM notifications n
      LEFT JOIN students s ON s.mssv = n.actor_mssv
      LEFT JOIN community_posts p ON p.id = n.post_id
      LEFT JOIN community_post_comments c ON c.id = n.comment_id
      WHERE n.recipient_mssv = $1
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const [listResult, countResult] = await Promise.all([
      query(listSql, [clean, safeLimit, safeOffset]),
      query('SELECT COUNT(*) AS total FROM notifications WHERE recipient_mssv = $1', [clean])
    ]);
    return {
      items: listResult.rows.map((row) => ({
        ...row,
        post_id: row.post_id != null ? String(row.post_id) : null,
        comment_id: row.comment_id != null ? String(row.comment_id) : null
      })),
      total: Number(countResult.rows[0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset
    };
  },

  async getUnreadCount(recipientMssv) {
    const clean = normalizeMssv(recipientMssv);
    if (!clean) throw httpError('Thiếu MSSV người nhận.', 401);
    const result = await query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE recipient_mssv = $1 AND is_read = FALSE',
      [clean]
    );
    return Number(result.rows[0]?.unread || 0);
  },

  async markRead(recipientMssv, id) {
    const clean = normalizeMssv(recipientMssv);
    if (!clean) throw httpError('Thiếu MSSV người nhận.', 401);
    if (!isUuidLike(id)) throw httpError('Không tìm thấy thông báo.', 404);
    const result = await query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND recipient_mssv = $2
       RETURNING id, is_read;`,
      [String(id).trim(), clean]
    );
    if (!result.rowCount) throw httpError('Không tìm thấy thông báo.', 404);
    return result.rows[0];
  },

  async markAllRead(recipientMssv) {
    const clean = normalizeMssv(recipientMssv);
    if (!clean) throw httpError('Thiếu MSSV người nhận.', 401);
    const result = await query(
      'UPDATE notifications SET is_read = TRUE WHERE recipient_mssv = $1 AND is_read = FALSE',
      [clean]
    );
    return { updated: Number(result.rowCount || 0) };
  }
};
