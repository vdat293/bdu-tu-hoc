/**
 * Import only the supplemental grammar banks into PostgreSQL.
 * This leaves the original grammar exercises and progress untouched.
 * Run: npm run grammar:extra:import [ngu-phap-co-ban] [grammar-in-use]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query, transaction } from '../src/db/database.js';
import {
  sanitizeGrammarHtml,
  resolveCorrectAnswer,
  optionLetterFor,
  optionsFromRow
} from '../src/utils/grammar-data.js';
import { canArrangeInto, parseArrangeWords } from '../src/utils/grammar-answers.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const extraRoot = path.join(rootDir, 'data', 'grammar-practice-extra');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['multiple_choice', 'fill_blank', 'arrange_words']);
const COLUMNS = [
  'id', 'lesson_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d',
  'correct_answer', 'correct_option', 'explanation', 'hint', 'order_idx'
];

function clean(value, max = 5000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function orderFromFilename(name) {
  const match = /^unit-(\d+)\.json$/i.exec(name);
  return match ? Number(match[1]) : null;
}

async function importBankFiles(slugs) {
  const banks = [];
  const globalIds = new Set();
  for (const slug of slugs) {
    const dir = path.join(extraRoot, slug);
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) continue;

    const lessonsResult = await query(
      `SELECT l.id, l.order_idx
       FROM grammar_lessons l
       JOIN grammar_paths p ON p.id = l.path_id
       WHERE p.slug = $1`,
      [slug]
    );
    const lessonByOrder = new Map(lessonsResult.rows.map((lesson) => [Number(lesson.order_idx), lesson.id]));
    const usedLessonIds = new Set();

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      const fileOrder = orderFromFilename(entry.name);
      const lessonId = String(
        (Array.isArray(content) ? '' : content.lessonId)
        || (fileOrder == null ? '' : lessonByOrder.get(fileOrder))
        || ''
      );
      if (!UUID_RE.test(lessonId) || !lessonsResult.rows.some((lesson) => lesson.id === lessonId)) {
        throw new Error(`${filePath}: không tìm thấy lessonId trong lộ trình ${slug}.`);
      }
      if (usedLessonIds.has(lessonId)) throw new Error(`${filePath}: có nhiều file cho cùng một bài học.`);
      usedLessonIds.add(lessonId);

      const questions = Array.isArray(content) ? content : content.questions;
      if (!Array.isArray(questions) || !questions.length) throw new Error(`${filePath}: cần mảng câu hỏi không rỗng.`);
      const ids = [];
      const rows = questions.map((item, index) => {
        const id = String(item?.id || '');
        const type = String(item?.type || '');
        const question = clean(item?.question);
        const explanation = clean(item?.explanation);
        const hint = clean(item?.hint, 1000);
        if (!UUID_RE.test(id) || globalIds.has(id)) throw new Error(`${filePath}: id không hợp lệ hoặc bị lặp (${id || 'trống'}).`);
        if (!TYPES.has(type)) throw new Error(`${filePath}: dạng bài không hỗ trợ (${type || 'trống'}).`);
        if (!question || !explanation || !hint) throw new Error(`${filePath}: câu ${index + 1} thiếu câu hỏi, giải thích hoặc gợi ý.`);
        globalIds.add(id);
        ids.push(id);

        const options = optionsFromRow(item);
        if (type === 'multiple_choice') {
          const nonEmpty = options.filter(Boolean);
          if (nonEmpty.length !== 4 || new Set(nonEmpty.map((value) => value.toLocaleLowerCase('en'))).size !== 4) {
            throw new Error(`${filePath}: câu ${index + 1} cần 4 lựa chọn riêng biệt.`);
          }
        }
        const answer = resolveCorrectAnswer(type, item.correctAnswer, options);
        if (!answer) throw new Error(`${filePath}: câu ${index + 1} thiếu đáp án.`);
        if (type === 'multiple_choice' && options.filter((option) => option === answer).length !== 1) {
          throw new Error(`${filePath}: đáp án trắc nghiệm câu ${index + 1} không khớp duy nhất với lựa chọn.`);
        }
        if (type === 'arrange_words') {
          const chips = parseArrangeWords(question, options[0]);
          if (!canArrangeInto(answer, chips)) throw new Error(`${filePath}: câu sắp xếp ${index + 1} không ghép được thành đáp án.`);
        }

        return [
          id, lessonId, type, sanitizeGrammarHtml(question),
          options[0], options[1], options[2], options[3],
          answer, optionLetterFor(answer, options),
          sanitizeGrammarHtml(explanation), hint, Number(item.order) || index + 1
        ];
      });
      banks.push({ slug, filePath, lessonId, ids, rows });
    }
  }
  return banks;
}

async function upsertBanks(banks) {
  await transaction(async (client) => {
    for (const bank of banks) {
      for (let start = 0; start < bank.rows.length; start += 100) {
        const chunk = bank.rows.slice(start, start + 100);
        const params = [];
        const values = chunk.map((row) => `(${row.map((value) => {
          params.push(value);
          return `$${params.length}`;
        }).join(', ')})`).join(',\n');
        await client.query(
          `INSERT INTO grammar_extra_exercises (${COLUMNS.join(', ')}) VALUES ${values}
           ON CONFLICT (id) DO UPDATE SET
             lesson_id=EXCLUDED.lesson_id, type=EXCLUDED.type, question=EXCLUDED.question,
             option_a=EXCLUDED.option_a, option_b=EXCLUDED.option_b, option_c=EXCLUDED.option_c,
             option_d=EXCLUDED.option_d, correct_answer=EXCLUDED.correct_answer,
             correct_option=EXCLUDED.correct_option, explanation=EXCLUDED.explanation,
             hint=EXCLUDED.hint, order_idx=EXCLUDED.order_idx`,
          params
        );
      }
      await client.query(
        `DELETE FROM grammar_extra_exercises
         WHERE lesson_id = $1 AND NOT (id = ANY($2::uuid[]))`,
        [bank.lessonId, bank.ids]
      );
    }
  });
}

async function main() {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  let slugs = requested;
  if (!slugs.length) {
    slugs = (await fs.readdir(extraRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }
  const banks = await importBankFiles(slugs);
  if (!banks.length) {
    console.log('Không có bộ câu hỏi luyện thêm để import.');
    return;
  }
  await upsertBanks(banks);
  const total = banks.reduce((sum, bank) => sum + bank.rows.length, 0);
  console.log(`✓ Đã nạp ${total} câu luyện thêm cho ${banks.length} bài; không thay đổi bài gốc hoặc tiến độ.`);
}

try {
  await main();
} catch (error) {
  console.error('grammar extra import failed:', error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
