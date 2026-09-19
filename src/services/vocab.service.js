import { isDatabaseConfigured, query } from '../db/database.js';

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanStr(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v, label = 'id') {
  if (!UUID_RE.test(String(v || '').trim())) {
    throw httpError(`${label} không đúng định dạng.`, 400);
  }
  return String(v).trim();
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export const VocabService = {
  hasDatabase() {
    return isDatabaseConfigured();
  },

  async listThemes() {
    if (!isDatabaseConfigured()) return [];
    const { rows } = await query(
      `SELECT t.slug, t.title, t.description, t.difficulty, t.total_sets,
              COALESCE((SELECT COUNT(*) FROM vocab_sets s WHERE s.theme_slug = t.slug), 0) AS set_count,
              COALESCE((SELECT SUM(s.vocab_count) FROM vocab_sets s WHERE s.theme_slug = t.slug), 0) AS word_count
       FROM vocab_themes t ORDER BY t.difficulty ASC, t.title ASC`
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      difficulty: Number(r.difficulty),
      total_sets: Number(r.set_count || r.total_sets || 0),
      word_count: Number(r.word_count || 0)
    }));
  },

  async getTheme(themeSlug, { mssv = null } = {}) {
    const slug = cleanStr(themeSlug, 128);
    if (!slug) throw httpError('Thiếu slug theme.', 400);
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const { rows } = await query(
      `SELECT t.slug, t.title, t.description, t.difficulty,
              COALESCE((SELECT COUNT(*) FROM vocab_sets s WHERE s.theme_slug = t.slug), 0) AS set_count,
              COALESCE((SELECT SUM(s.vocab_count) FROM vocab_sets s WHERE s.theme_slug = t.slug), 0) AS total_words,
              COALESCE((SELECT COUNT(*) FROM vocab_words w JOIN vocab_sets s2 ON s2.id = w.set_id
                        JOIN vocab_progress p ON p.word_id = w.id AND p.mssv = NULLIF($2,'') AND p.status='known'
                        WHERE s2.theme_slug = t.slug), 0) AS known_words
       FROM vocab_themes t WHERE t.slug = $1`,
      [slug, safeMssv]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      difficulty: Number(row.difficulty),
      total_sets: Number(row.set_count),
      total_words: Number(row.total_words),
      known_words: Number(row.known_words)
    };
  },

  async listSets(themeSlug, { mssv = null } = {}) {
    const slug = cleanStr(themeSlug, 128);
    if (!slug) throw httpError('Thiếu slug theme.', 400);
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const { rows } = await query(
      `SELECT s.id, s.theme_slug, s.name, s.order_idx, s.vocab_count,
              COALESCE((SELECT COUNT(*) FROM vocab_words w WHERE w.set_id = s.id), 0) AS crawled,
              COALESCE((SELECT COUNT(*) FROM vocab_words w
                        JOIN vocab_progress p ON p.word_id = w.id AND p.mssv = NULLIF($2,'') AND p.status='known'
                        WHERE w.set_id = s.id), 0) AS known_count
       FROM vocab_sets s WHERE s.theme_slug = $1 ORDER BY s.order_idx ASC`,
      [slug, safeMssv]
    );
    return rows.map((r) => ({
      id: r.id,
      theme_slug: r.theme_slug,
      name: r.name,
      order: Number(r.order_idx),
      vocab_count: Number(r.vocab_count),
      crawled: Number(r.crawled),
      known_count: Number(r.known_count)
    }));
  },

  async listWords(setId, { q = '', status, mssv = null, limit = 100, order = 'order' } = {}) {
    const cleanId = assertUuid(setId, 'set id');
    const lim = Math.max(1, Math.min(200, Number(limit) || 100));
    const needle = escapeLike(cleanStr(q, 120));
    const orderSql = order === 'random' ? 'ORDER BY RANDOM()' : 'ORDER BY w.sort_order ASC';
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';

    // JOIN progress của user (nếu có) để UI hiển thị Đã thuộc/Chưa thuộc
    const params = [cleanId, safeMssv];
    let whereExtra = '';
    let idx = 3;
    if (needle) {
      whereExtra += ` AND (w.term ILIKE $${idx} ESCAPE '\\' OR w.meaning_vi ILIKE $${idx} ESCAPE '\\')`;
      params.push(`%${needle}%`);
      idx += 1;
    }
    if (safeMssv && status === 'known') {
      whereExtra += ` AND p.status = 'known'`;
    } else if (safeMssv && status === 'unlearned') {
      whereExtra += ` AND (p.status IS NULL OR p.status <> 'known')`;
    } else if (safeMssv && status === 'due') {
      whereExtra += ` AND p.status = 'known' AND p.next_review_at <= NOW()`;
    }

    const { rows } = await query(
      `SELECT w.id, w.set_id, w.term, w.pronunciation, w.pos, w.meaning_vi, w.example, w.audio_url, w.sort_order,
              p.status AS progress, p.known_at, p.next_review_at, p.review_stage
       FROM vocab_words w
       LEFT JOIN vocab_progress p ON p.word_id = w.id AND p.mssv = NULLIF($2, '')
       WHERE w.set_id = $1 ${whereExtra} ${orderSql} LIMIT ${lim}`,
      params
    );
    return rows.map((r) => ({
      id: r.id,
      set_id: r.set_id,
      term: r.term,
      pronunciation: r.pronunciation,
      pos: r.pos,
      meaning: r.meaning_vi,
      example: r.example,
      audio: r.audio_url,
      progress: r.progress || 'learning',
      known_at: r.known_at || null,
      next_review_at: r.next_review_at || null,
      review_stage: Number(r.review_stage || 0)
    }));
  },

  async saveProgress(mssv, wordId, status) {
    const cleanMssv = cleanStr(mssv, 32);
    const cleanWord = assertUuid(wordId, 'word id');
    const st = status === 'known' ? 'known' : 'learning';
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const exists = await query('SELECT 1 FROM vocab_words WHERE id = $1', [cleanWord]);
    if (exists.rowCount === 0) throw httpError('Từ vựng không tồn tại.', 404);
    if (st === 'known') {
      // Lần đầu thuộc -> đặt mốc ôn 1 ngày. Đã thuộc sẵn thì giữ nguyên lịch ôn.
      await query(
        `INSERT INTO vocab_progress (mssv, word_id, status, known_at, review_stage, next_review_at, updated_at)
         VALUES ($1, $2, 'known', NOW(), 0, NOW() + INTERVAL '1 day', NOW())
         ON CONFLICT (mssv, word_id) DO UPDATE SET
           status = 'known',
           known_at = COALESCE(vocab_progress.known_at, NOW()),
           review_stage = CASE WHEN vocab_progress.status = 'known' THEN vocab_progress.review_stage ELSE 0 END,
           next_review_at = CASE WHEN vocab_progress.status = 'known' THEN vocab_progress.next_review_at ELSE NOW() + INTERVAL '1 day' END,
           updated_at = NOW()`,
        [cleanMssv, cleanWord]
      );
    } else {
      await query(
        `INSERT INTO vocab_progress (mssv, word_id, status, review_stage, updated_at)
         VALUES ($1, $2, 'learning', 0, NOW())
         ON CONFLICT (mssv, word_id) DO UPDATE SET
           status = 'learning', known_at = NULL, next_review_at = NULL, review_stage = 0, updated_at = NOW()`,
        [cleanMssv, cleanWord]
      );
    }
    return { ok: true };
  },

  /**
   * Ghi nhận kết quả một từ trong lượt ôn tập.
   * pass: stage 0 -> +7 ngày, stage 1 -> +30 ngày, stage 2 -> thành thạo (ngừng nhắc).
   * fail: quay về mốc 1 ngày.
   */
  async reviewWord(mssv, wordId, result) {
    const cleanMssv = cleanStr(mssv, 32);
    const cleanWord = assertUuid(wordId, 'word id');
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    if (result !== 'pass' && result !== 'fail') throw httpError('Kết quả ôn không hợp lệ.', 400);

    const passSql = `UPDATE vocab_progress
       SET review_stage = LEAST(review_stage + 1, 3),
           next_review_at = CASE LEAST(review_stage + 1, 3)
             WHEN 1 THEN NOW() + INTERVAL '7 days'
             WHEN 2 THEN NOW() + INTERVAL '30 days'
             ELSE NULL
           END,
           last_reviewed_at = NOW(), updated_at = NOW()
       WHERE mssv = $1 AND word_id = $2 AND status = 'known'
       RETURNING review_stage, next_review_at`;
    const failSql = `UPDATE vocab_progress
       SET review_stage = 0, next_review_at = NOW() + INTERVAL '1 day',
           last_reviewed_at = NOW(), updated_at = NOW()
       WHERE mssv = $1 AND word_id = $2 AND status = 'known'
       RETURNING review_stage, next_review_at`;

    const { rows } = await query(result === 'pass' ? passSql : failSql, [cleanMssv, cleanWord]);
    if (rows.length === 0) throw httpError('Từ chưa được đánh dấu thuộc.', 404);
    const row = rows[0];
    return {
      ok: true,
      stage: Number(row.review_stage),
      next_review_at: row.next_review_at || null,
      mastered: Number(row.review_stage) >= 3
    };
  },

  async getReviewSummary(mssv) {
    const cleanMssv = cleanStr(mssv, 32);
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE next_review_at <= NOW()) AS due_day,
         COUNT(*) FILTER (WHERE next_review_at <= NOW() + INTERVAL '7 days') AS due_week,
         COUNT(*) FILTER (WHERE next_review_at <= NOW() + INTERVAL '30 days') AS due_month,
         COUNT(*) FILTER (WHERE next_review_at IS NULL) AS mastered,
         COUNT(*) AS known_total
       FROM vocab_progress
       WHERE mssv = $1 AND status = 'known'`,
      [cleanMssv]
    );
    const row = rows[0] || {};
    return {
      due_day: Number(row.due_day || 0),
      due_week: Number(row.due_week || 0),
      due_month: Number(row.due_month || 0),
      mastered: Number(row.mastered || 0),
      known_total: Number(row.known_total || 0)
    };
  },

  async listReviewWords(mssv, { bucket = 'day', limit = 50 } = {}) {
    const cleanMssv = cleanStr(mssv, 32);
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const buckets = {
      day: `p.next_review_at <= NOW()`,
      week: `p.next_review_at <= NOW() + INTERVAL '7 days'`,
      month: `p.next_review_at <= NOW() + INTERVAL '30 days'`,
      all: `p.next_review_at IS NOT NULL`
    };
    const bucketKey = String(bucket || 'day');
    if (!buckets[bucketKey]) throw httpError('Khung ôn tập không hợp lệ.', 400);
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));

    const { rows } = await query(
      `SELECT w.id, w.set_id, w.term, w.pronunciation, w.pos, w.meaning_vi, w.example, w.audio_url, w.sort_order,
              p.status AS progress, p.known_at, p.next_review_at, p.review_stage,
              s.name AS set_name, s.theme_slug, t.title AS theme_title
       FROM vocab_progress p
       JOIN vocab_words w ON w.id = p.word_id
       JOIN vocab_sets s ON s.id = w.set_id
       JOIN vocab_themes t ON t.slug = s.theme_slug
       WHERE p.mssv = $1 AND p.status = 'known' AND ${buckets[bucketKey]}
       ORDER BY p.next_review_at ASC NULLS LAST, w.term ASC
       LIMIT ${lim}`,
      [cleanMssv]
    );
    return rows.map((r) => ({
      id: r.id,
      set_id: r.set_id,
      term: r.term,
      pronunciation: r.pronunciation,
      pos: r.pos,
      meaning: r.meaning_vi,
      example: r.example,
      audio: r.audio_url,
      progress: r.progress || 'known',
      known_at: r.known_at || null,
      next_review_at: r.next_review_at || null,
      review_stage: Number(r.review_stage || 0),
      set_name: r.set_name,
      theme_slug: r.theme_slug,
      theme_title: r.theme_title
    }));
  },

  async getSetInfo(setId, { mssv = null } = {}) {
    const cleanId = assertUuid(setId, 'set id');
    const safeMssv = mssv ? String(mssv).slice(0, 32) : '';
    const { rows } = await query(
      `SELECT s.id, s.theme_slug, s.name, s.order_idx, t.title AS theme_title, t.difficulty,
              COALESCE((SELECT COUNT(*) FROM vocab_words w WHERE w.set_id = s.id), 0) AS crawled,
              COALESCE((SELECT COUNT(*) FROM vocab_words w
                        JOIN vocab_progress p ON p.word_id = w.id AND p.mssv = NULLIF($2,'') AND p.status='known'
                        WHERE w.set_id = s.id), 0) AS known_count
       FROM vocab_sets s JOIN vocab_themes t ON t.slug = s.theme_slug WHERE s.id = $1`,
      [cleanId, safeMssv]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      theme_slug: row.theme_slug,
      name: row.name,
      order_idx: row.order_idx,
      theme_title: row.theme_title,
      difficulty: row.difficulty,
      crawled: Number(row.crawled),
      known_count: Number(row.known_count)
    };
  }
};
