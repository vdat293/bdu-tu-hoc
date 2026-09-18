import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, isDatabaseConfigured, query, transaction } from '../src/db/database.js';
import { resolvePos, normalizePos } from '../src/utils/vocab-pos.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(currentDir, '..', 'data');
const apply = process.argv.includes('--apply');
const noCross = process.argv.includes('--no-cross');
const themeArg = process.argv.find((arg) => arg.startsWith('--theme='));
const theme = themeArg ? themeArg.slice('--theme='.length).trim() : null;
const BATCH_SIZE = 500;

function classify(rawPos, result) {
  const raw = String(rawPos ?? '');
  if (!result.pos) return 'still_empty';
  if (result.source === 'cross') return 'cross_fill';
  if (!raw.trim()) return result.source === 'category' ? 'category' : 'fill_empty';
  if (result.pos === raw) return 'keep';
  if (result.source === 'override') return 'fix_wrong';
  return 'normalize';
}

/**
 * Suy luận chéo theme: term chỉ có DUY NHẤT một nhãn pos ở mọi theme khác
 * (sau chuẩn hoá) thì được dùng để lấp chỗ trống. Term đa nghĩa (2+ nhãn) bị bỏ qua.
 */
async function loadCrossMap() {
  const { rows } = await query("SELECT lower(term) AS term, pos FROM vocab_words WHERE btrim(pos) <> ''");
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.term || '').trim();
    const norm = normalizePos(row.pos);
    if (!key || !norm) continue;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(norm);
  }
  const unique = new Map();
  for (const [term, labels] of grouped) {
    if (labels.size === 1) unique.set(term, [...labels][0]);
  }
  return unique;
}

function topN(rows, n = 20) {
  return rows.slice(0, n).map((row) => ({ term: row.term, from: row.raw, to: row.pos }));
}

async function loadRows() {
  if (theme) {
    const { rows } = await query(
      `SELECT w.id, w.term, w.pos
         FROM vocab_words w
         JOIN vocab_sets s ON s.id = w.set_id
        WHERE s.theme_slug = $1
        ORDER BY w.term, w.id`,
      [theme]
    );
    return rows;
  }
  const { rows } = await query('SELECT id, term, pos FROM vocab_words ORDER BY term, id');
  return rows;
}

try {
  if (!isDatabaseConfigured()) {
    console.error('Thiếu DATABASE_URL - không thể chạy fix-vocab-pos.');
    process.exitCode = 1;
  } else {
    console.log(apply ? '=== APPLY ===' : '=== DRY-RUN ===');
    if (theme) console.log(`Theme: ${theme}`);

    const rows = await loadRows();
    const crossMap = noCross ? null : await loadCrossMap();
    if (crossMap) console.log(`Cross-theme map: ${crossMap.size} term có nhãn duy nhất`);
    const counts = { keep: 0, normalize: 0, fill_empty: 0, fix_wrong: 0, category: 0, cross_fill: 0, still_empty: 0 };
    const changes = [];
    const fixWrong = [];
    const stillEmpty = [];

    for (const row of rows) {
      let result = resolvePos(row.term, row.pos);
      if (!result.pos && crossMap) {
        const candidate = crossMap.get(String(row.term || '').trim().toLowerCase());
        if (candidate) result = { pos: candidate, source: 'cross' };
      }
      const action = classify(row.pos, result);
      counts[action] += 1;
      const raw = String(row.pos ?? '').trim();
      const rawExact = String(row.pos ?? '');
      const detail = { term: row.term, raw, pos: result.pos };
      if (action === 'fix_wrong') fixWrong.push(detail);
      if (action === 'still_empty') stillEmpty.push(detail);
      if (result.pos !== rawExact) changes.push({ id: row.id, raw: rawExact, pos: result.pos });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      theme: theme || null,
      totalRows: rows.length,
      byAction: counts,
      changedRows: changes.length,
      fixWrong: topN(fixWrong),
      stillEmpty: topN(stillEmpty)
    };

    console.log(`Tổng dòng: ${rows.length}`);
    console.log(`Theo action: keep=${counts.keep} normalize=${counts.normalize} fill_empty=${counts.fill_empty} fix_wrong=${counts.fix_wrong} category=${counts.category} still_empty=${counts.still_empty}`);
    console.log(`Dòng cần UPDATE: ${changes.length}`);

    console.log(`\nTop 20 fix_wrong (${fixWrong.length} tổng):`);
    for (const row of topN(fixWrong)) console.log(`  - ${row.term}: "${row.from}" -> "${row.to}"`);

    console.log(`\nTop 20 still_empty (${stillEmpty.length} tổng):`);
    for (const row of topN(stillEmpty)) console.log(`  - ${row.term}`);

    await fs.mkdir(dataDir, { recursive: true });
    const reportPath = path.join(dataDir, 'pos-report.json');
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    console.log(`\nĐã ghi báo cáo: ${reportPath}`);

    if (!apply) {
      console.log('\nDRY-RUN: chưa ghi DB. Thêm --apply để thực thi.');
    } else {
      await query('CREATE TABLE IF NOT EXISTS vocab_words_pos_backup AS SELECT id, pos FROM vocab_words');
      let updated = 0;
      let skipped = 0;
      let batches = 0;
      for (let i = 0; i < changes.length; i += BATCH_SIZE) {
        const chunk = changes.slice(i, i + BATCH_SIZE);
        const batchResult = await transaction(async (client) => {
          let changed = 0;
          let missed = 0;
          for (const item of chunk) {
            const res = await client.query(
              'UPDATE vocab_words SET pos=$1 WHERE id=$2 AND pos=$3',
              [item.pos, item.id, item.raw]
            );
            if (res.rowCount === 1) changed += 1;
            else missed += 1;
          }
          return { changed, missed };
        });
        updated += batchResult.changed;
        skipped += batchResult.missed;
        batches += 1;
      }
      console.log(`\nAPPLY xong: updated=${updated} skipped=${skipped} batches=${batches}`);
      console.log('Backup: vocab_words_pos_backup (id, pos)');
    }
  }
} catch (error) {
  console.error('fix-vocab-pos failed:', error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
