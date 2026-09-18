/**
 * Import vocab từ tool-crawl ra Postgres.
 * Nguồn:
 *  1. ../tool-crawl/crawl-luyentu/themes-12.json + themes-extra.json -> seed themes+sets
 *  2. ../tool-crawl/crawl-luyentu/output/<slug>/*_full_vocabularies.json (words, sau khi có JWT fresh)
 *
 * Chạy: DATABASE_URL=... npm run vocab:import
 *  hoặc: node scripts/import-vocab.js --themes-only
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, closeDatabase } from '../src/db/database.js';
import { resolvePos } from '../src/utils/vocab-pos.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(currentDir, '..');
const crawlRoot = path.resolve(websiteRoot, '..', 'tool-crawl', 'crawl-luyentu');
const THEME_FILES = ['themes-12.json', 'themes-extra.json'];

function clean(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

async function loadThemes() {
  const all = [];
  for (const file of THEME_FILES) {
    try {
      const raw = await fs.readFile(path.join(crawlRoot, file), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) all.push(...parsed);
    } catch { /* file chưa có thì bỏ qua */ }
  }
  return all;
}

async function seedThemes() {
  const themes = await loadThemes();
  let setCount = 0;
  for (const t of themes) {
    await query(
      `INSERT INTO vocab_themes (slug, luyentu_id, title, description, difficulty, total_sets, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (slug) DO UPDATE SET luyentu_id=EXCLUDED.luyentu_id, title=EXCLUDED.title,
         description=EXCLUDED.description, difficulty=EXCLUDED.difficulty, total_sets=EXCLUDED.total_sets, updated_at=NOW()`,
      [t.slug, t.id || null, clean(t.name, 200), '', Number(t.difficulty) || 1, (t.wordSets || []).length]
    );
    for (const [i, ws] of (t.wordSets || []).entries()) {
      await query(
        `INSERT INTO vocab_sets (id, theme_slug, name, order_idx, vocab_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (id) DO UPDATE SET theme_slug=EXCLUDED.theme_slug, name=EXCLUDED.name,
           order_idx=EXCLUDED.order_idx, vocab_count=EXCLUDED.vocab_count, updated_at=NOW()`,
        [ws.id, t.slug, clean(ws.name, 200), Number(ws.order ?? i), Number(ws.vocabularyCount) || 0]
      );
      setCount += 1;
    }
  }
  console.log(`✓ Seeded ${themes.length} themes, ${setCount} sets`);
}

async function importWords() {
  const { readdir } = await import('node:fs/promises');
  // Chỉ import các theme đã seed từ themes-12/themes-extra (bỏ qua file lẻ ở output root)
  const themes = await loadThemes();
  const allowed = themes.length ? new Set(themes.map((t) => t.slug)) : null;
  let total = 0;
  let skipped = 0;
  let entries = [];
  try {
    entries = await readdir(crawlRoot === '' ? '.' : path.join(crawlRoot, 'output'), { withFileTypes: true });
  } catch {
    console.log('(!) Chưa có thư mục output, bỏ qua import words.');
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (allowed && !allowed.has(e.name)) { skipped += 1; continue; }
    const dir = path.join(crawlRoot, 'output', e.name);
    let files = [];
    try { files = await readdir(dir); } catch { continue; }
    const full = files.find((f) => f.endsWith('_full_vocabularies.json'));
    if (!full) continue;
    const raw = await fs.readFile(path.join(dir, full), 'utf-8');
    let list;
    try { list = JSON.parse(raw); } catch { continue; }
    if (!Array.isArray(list)) list = list.data || [];
    for (const w of list) {
      const setId = w.wordSetId || w.word_set_id;
      if (!setId) continue;
      await query(
        `INSERT INTO vocab_words (id, set_id, term, pronunciation, pos, meaning_vi, example, notes, audio_url, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET term=EXCLUDED.term, pronunciation=EXCLUDED.pronunciation,
           pos=CASE WHEN EXCLUDED.pos = '' THEN vocab_words.pos ELSE EXCLUDED.pos END,
           meaning_vi=EXCLUDED.meaning_vi, example=EXCLUDED.example,
           notes=EXCLUDED.notes, audio_url=EXCLUDED.audio_url, sort_order=EXCLUDED.sort_order`,
        [
          w.id, setId, clean(w.term || w.word, 200), clean(w.pronunciation, 200),
          resolvePos(clean(w.term || w.word, 200), w.partOfSpeech || w.pos).pos,
          clean(w.meaning, 1000), clean(w.example, 2000),
          clean(w.notes, 1000), clean(w.audio, 500), Number(w.sortOrder) || 0
        ]
      );
      total += 1;
    }
    console.log(`✓ ${e.name}: ${list.length} words`);
  }
  // refresh vocab_count từ số từ crawl được (nếu có)
  await query(`UPDATE vocab_sets s SET vocab_count = COALESCE((SELECT COUNT(*) FROM vocab_words w WHERE w.set_id = s.id), s.vocab_count) WHERE EXISTS (SELECT 1 FROM vocab_words w WHERE w.set_id = s.id)`);
  return total;
}

const themesOnly = process.argv.includes('--themes-only');
try {
  await seedThemes();
  if (!themesOnly) {
    const n = await importWords();
    console.log(`✓ Tổng words import: ${n}`);
  }
} catch (e) {
  console.error('vocab import failed:', e.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
