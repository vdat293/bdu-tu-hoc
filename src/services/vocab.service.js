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
    }

    const { rows } = await query(
      `SELECT w.id, w.set_id, w.term, w.pronunciation, w.pos, w.meaning_vi, w.example, w.audio_url, w.sort_order,
              p.status AS progress
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
      progress: r.progress || 'learning'
    }));
  },

  async saveProgress(mssv, wordId, status) {
    const cleanMssv = cleanStr(mssv, 32);
    const cleanWord = assertUuid(wordId, 'word id');
    const st = status === 'known' ? 'known' : 'learning';
    if (!cleanMssv) throw httpError('Thiếu mssv.', 400);
    const exists = await query('SELECT 1 FROM vocab_words WHERE id = $1', [cleanWord]);
    if (exists.rowCount === 0) throw httpError('Từ vựng không tồn tại.', 404);
    await query(
      `INSERT INTO vocab_progress (mssv, word_id, status, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (mssv, word_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
      [cleanMssv, cleanWord, st]
    );
    return { ok: true };
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
