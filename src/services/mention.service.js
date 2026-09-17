import { query as poolQuery } from '../db/database.js';

const MENTION_PATTERN = /(?:^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]{3,32})/g;
const MAX_MENTION_TOKENS = 10;

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function runnerOf(db) {
  if (db && typeof db.query === 'function') return db;
  return { query: poolQuery };
}

/**
 * Tách các token @MSSV trong nội dung. Dedupe, upper-case, tối đa 10 token.
 */
export function parseMentionTokens(content) {
  const text = String(content || '');
  const tokens = [];
  const seen = new Set();
  MENTION_PATTERN.lastIndex = 0;
  let match;
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    // Bỏ dấu . - thừa ở đầu/cuối (vd: "@MSSV." cuối câu).
    const token = normalizeMssv(match[1].replace(/^[.-]+|[.-]+$/g, ''));
    if (token.length < 3 || token.length > 32 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= MAX_MENTION_TOKENS) break;
  }
  return tokens;
}

/**
 * Chỉ user đã active (từng đăng nhập) mới được tag.
 */
export async function resolveActiveUsers(tokens, db = null) {
  const runner = runnerOf(db);
  const upper = [...new Set((tokens || []).map(normalizeMssv).filter(Boolean))].slice(0, MAX_MENTION_TOKENS);
  if (!upper.length) return [];
  const result = await runner.query(
    'SELECT mssv, full_name FROM students WHERE is_active = TRUE AND UPPER(mssv) = ANY($1)',
    [upper]
  );
  return result.rows;
}

/**
 * Parse + resolve trong một bước. Trả về [{ mssv, full_name }].
 */
export async function extractMentions(content, db = null) {
  const tokens = parseMentionTokens(content);
  if (!tokens.length) return [];
  return resolveActiveUsers(tokens, db);
}

async function resolveActorName(runner, actorMssv) {
  try {
    const result = await runner.query('SELECT full_name FROM students WHERE mssv = $1', [actorMssv]);
    return result.rows[0]?.full_name?.trim() || actorMssv;
  } catch {
    return actorMssv;
  }
}

async function syncMentions(db, { postId, commentId = null, content, actorMssv }) {
  const runner = runnerOf(db);
  const cleanPostId = String(postId ?? '').trim();
  const actor = normalizeMssv(actorMssv);
  if (!/^\d+$/.test(cleanPostId) || !actor) return [];
  const cleanCommentId = commentId == null ? null : String(commentId).trim();
  if (commentId != null && !/^\d+$/.test(cleanCommentId)) return [];

  const mentions = await extractMentions(content, runner);
  if (commentId == null) {
    await runner.query('DELETE FROM confession_mentions WHERE post_id = $1 AND comment_id IS NULL', [cleanPostId]);
  } else {
    await runner.query('DELETE FROM confession_mentions WHERE post_id = $1 AND comment_id = $2', [cleanPostId, cleanCommentId]);
  }

  // Bỏ self-tag.
  const targets = mentions.filter((user) => normalizeMssv(user.mssv) !== actor);
  if (!targets.length) return [];

  for (const user of targets) {
    await runner.query(
      `INSERT INTO confession_mentions (post_id, comment_id, mentioned_mssv, mentioned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [cleanPostId, cleanCommentId, normalizeMssv(user.mssv), actor]
    );
  }

  const actorName = await resolveActorName(runner, actor);
  const created = [];
  for (const user of targets) {
    const result = await runner.query(
      `INSERT INTO notifications (recipient_mssv, actor_mssv, type, post_id, comment_id)
       VALUES ($1, $2, 'mention', $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id, recipient_mssv, actor_mssv, type, post_id, comment_id, is_read, created_at`,
      [normalizeMssv(user.mssv), actor, cleanPostId, cleanCommentId]
    );
    if (result.rowCount) created.push({ ...result.rows[0], actor_name: actorName });
  }
  return created;
}

/**
 * Đồng bộ mentions của bài viết. Chỉ gọi khi post.category === 'confession'.
 * Trả về danh sách notification mention vừa tạo (để publish WS).
 */
export async function syncPostMentions(db, { postId, content, actorMssv }) {
  return syncMentions(db, { postId, commentId: null, content, actorMssv });
}

/**
 * Đồng bộ mentions của bình luận. Chỉ gọi khi post.category === 'confession'.
 */
export async function syncCommentMentions(db, { postId, commentId, content, actorMssv }) {
  if (commentId == null) return [];
  return syncMentions(db, { postId, commentId, content, actorMssv });
}

/**
 * Nếu bình luận là reply (có parentId), notify tác giả bình luận cha.
 * Trả về notification vừa tạo hoặc null (tự reply / đã notify rồi).
 */
export async function createReplyNotification(db, { postId, commentId, parentId, actorMssv }) {
  const runner = runnerOf(db);
  const actor = normalizeMssv(actorMssv);
  const cleanPostId = String(postId ?? '').trim();
  const cleanCommentId = commentId == null ? '' : String(commentId).trim();
  const cleanParentId = parentId == null ? '' : String(parentId).trim();
  if (!actor || !/^\d+$/.test(cleanPostId) || !/^\d+$/.test(cleanCommentId) || !/^\d+$/.test(cleanParentId)) {
    return null;
  }
  const parent = await runner.query(
    'SELECT author_mssv FROM community_post_comments WHERE id = $1 AND post_id = $2',
    [cleanParentId, cleanPostId]
  );
  if (!parent.rowCount) return null;
  const recipient = normalizeMssv(parent.rows[0]?.author_mssv);
  if (!recipient || recipient === actor) return null;

  const actorName = await resolveActorName(runner, actor);
  const result = await runner.query(
    `INSERT INTO notifications (recipient_mssv, actor_mssv, type, post_id, comment_id)
     VALUES ($1, $2, 'reply', $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id, recipient_mssv, actor_mssv, type, post_id, comment_id, is_read, created_at`,
    [recipient, actor, cleanPostId, cleanCommentId]
  );
  if (!result.rowCount) return null;
  return { ...result.rows[0], actor_name: actorName };
}

export const MentionService = {
  parseMentionTokens,
  resolveActiveUsers,
  extractMentions,
  syncPostMentions,
  syncCommentMentions,
  createReplyNotification
};
