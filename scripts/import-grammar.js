/**
 * Import ngữ pháp từ tool-crawl ra Postgres.
 * Nguồn: ../tool-crawl/crawl-nguphap/output/<slug>/<slug>_full.json
 *        (8 lộ trình, 3 nhóm, 246 bài, ~10k câu hỏi + 46 bài đọc hiểu)
 *
 * Chạy: npm run grammar:import
 *  hoặc: node scripts/import-grammar.js ngu-phap-co-ban (chỉ 1 lộ trình)
 *  Trên VPS có thể trỏ nguồn dữ liệu qua GRAMMAR_CRAWL_ROOT.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, closeDatabase, transaction } from '../src/db/database.js';
import {
  sanitizeGrammarHtml,
  resolveCorrectAnswer,
  optionLetterFor,
  optionsFromRow
} from '../src/utils/grammar-data.js';
import { canArrangeInto, parseArrangeWords } from '../src/utils/grammar-answers.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const crawlRoot = process.env.GRAMMAR_CRAWL_ROOT
  ? path.resolve(process.env.GRAMMAR_CRAWL_ROOT)
  : path.resolve(currentDir, '..', '..', 'tool-crawl', 'crawl-nguphap', 'output');
const extraRoot = path.resolve(currentDir, '..', 'data', 'grammar-practice-extra');

// Độ khó + nhãn hiển thị theo từng lộ trình (khớp trang luyennguphap).
const PATH_META = {
  'ngu-phap-co-ban': { difficulty: 1, banner: 'CƠ BẢN', badge: 'NGỮ PHÁP' },
  'grammar-in-use': { difficulty: 2, banner: 'GRAMMAR', badge: 'IN USE' },
  'toeic-co-ban': { difficulty: 2, banner: 'TOEIC', badge: 'CƠ BẢN' },
  'toeic-trung-cap-500-700': { difficulty: 3, banner: 'TOEIC', badge: '500-700' },
  'toeic-nang-cao-700': { difficulty: 4, banner: 'TOEIC', badge: '700+' },
  'destination-b1': { difficulty: 3, banner: 'B1', badge: 'DESTINATION' },
  'destination-b2': { difficulty: 4, banner: 'B2', badge: 'DESTINATION' },
  'destination-c1-c2': { difficulty: 5, banner: 'C1&C2', badge: 'DESTINATION' }
};

function clean(v, max = 5000) {
  return String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTRA_TYPES = new Set(['multiple_choice', 'fill_blank', 'arrange_words']);

async function upsertRows(table, columns, rows, conflict, update, chunk = 200, client = null) {
  for (let i = 0; i < rows.length; i += chunk) {
    const params = [];
    const tuples = rows.slice(i, i + chunk).map((row) =>
      `(${row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      }).join(',')})`
    );
    const sql = `INSERT INTO ${table} (${columns.join(', ')})
      VALUES ${tuples.join(', ')}
      ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET
      ${update.map((col) => `${col} = EXCLUDED.${col}`).join(', ')}`;
    if (client) await client.query(sql, params);
    else await query(sql, params);
  }
}

async function importPath(slug, data, stats) {
  const meta = PATH_META[slug] || {};
  const group = data.group || {};
  const groupId = group.id || data.groupId || null;
  const now = new Date();

  if (groupId) {
    await upsertRows(
      'grammar_groups',
      ['id', 'name', 'order_idx', 'updated_at'],
      [[groupId, clean(group.name, 200) || 'Ngữ pháp', int(group.order), now]],
      ['id'],
      ['name', 'order_idx', 'updated_at']
    );
  }

  const lessonRows = [];
  const ruleRows = [];
  const exerciseRows = [];
  const readingRows = [];
  const readingQuestionRows = [];
  const arrangeIssues = [];
  let questionTotal = 0;

  // Câu sắp xếp từ phải có ít nhất một thứ tự chip ghép được thành đáp án;
  // nếu không, người học xếp đúng cũng bị chấm sai → cảnh báo khi import.
  const checkArrange = (row) => {
    if (row.type !== 'arrange_words') return;
    const chips = parseArrangeWords(row.question, row.options[0]);
    if (!canArrangeInto(row.answer, chips)) {
      arrangeIssues.push({ id: row.id, question: row.question, answer: row.answer });
    }
  };

  for (const lesson of data.lessons || []) {
    const exercises = lesson.exercises || [];
    const readings = lesson.readingExercises || [];
    const readingQuestions = readings.reduce((n, r) => n + (r.questions || []).length, 0);
    questionTotal += exercises.length + readingQuestions;

    lessonRows.push([
      lesson.id, data.id, clean(lesson.name, 300), clean(lesson.description, 1000),
      int(lesson.order), exercises.length + readingQuestions, now
    ]);

    for (const rule of lesson.rules || []) {
      ruleRows.push([rule.id, lesson.id, clean(rule.title, 300), sanitizeGrammarHtml(rule.content), int(rule.order)]);
    }

    for (const ex of exercises) {
      const type = clean(ex.type, 24) || 'multiple_choice';
      const options = optionsFromRow(ex);
      const answer = resolveCorrectAnswer(type, ex.correctAnswer, options);
      checkArrange({ id: ex.id, type, question: ex.question, options, answer });
      exerciseRows.push([
        ex.id, lesson.id, type, sanitizeGrammarHtml(ex.question),
        options[0], options[1], options[2], options[3],
        answer, optionLetterFor(answer, options),
        sanitizeGrammarHtml(ex.explanation), clean(ex.hint, 1000), int(ex.order)
      ]);
    }

    for (const reading of readings) {
      readingRows.push([reading.id, lesson.id, clean(reading.title, 300), clean(reading.passage, 20000), int(reading.order)]);
      for (const q of reading.questions || []) {
        const type = clean(q.type, 24) || 'multiple_choice';
        const options = optionsFromRow(q);
        const answer = resolveCorrectAnswer(type, q.correctAnswer, options);
        checkArrange({ id: q.id, type, question: q.question, options, answer });
        readingQuestionRows.push([
          q.id, reading.id, type, sanitizeGrammarHtml(q.question),
          options[0], options[1], options[2], options[3],
          answer, optionLetterFor(answer, options),
          sanitizeGrammarHtml(q.explanation), int(q.order)
        ]);
      }
    }
  }

  await upsertRows(
    'grammar_paths',
    ['id', 'group_id', 'slug', 'name', 'description', 'cover_image', 'difficulty', 'banner_label', 'badge_label', 'order_idx', 'lesson_count', 'question_count', 'updated_at'],
    [[
      data.id, groupId, slug, clean(data.name, 300), clean(data.description, 2000), clean(data.coverImage, 500),
      meta.difficulty || 1, clean(meta.banner, 32), clean(meta.badge, 32), int(data.order),
      lessonRows.length, questionTotal, now
    ]],
    ['id'],
    ['group_id', 'slug', 'name', 'description', 'cover_image', 'difficulty', 'banner_label', 'badge_label', 'order_idx', 'lesson_count', 'question_count', 'updated_at']
  );

  await upsertRows(
    'grammar_lessons',
    ['id', 'path_id', 'name', 'description', 'order_idx', 'question_count', 'updated_at'],
    lessonRows,
    ['id'],
    ['path_id', 'name', 'description', 'order_idx', 'question_count', 'updated_at']
  );

  // Bộ luyện thêm được lưu riêng để không nhập chung vào bài tập gốc hay tiến độ gốc.
  const extraDir = path.join(extraRoot, slug);
  let extraFiles = [];
  try {
    extraFiles = (await fs.readdir(extraDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  const knownLessonIds = new Set((data.lessons || []).map((lesson) => String(lesson.id)));
  const extraRows = [];
  const extraBanks = [];
  const extraIds = new Set();
  const extraLessonIds = new Set();
  for (const entry of extraFiles) {
    const filePath = path.join(extraDir, entry.name);
    const bank = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const unitMatch = /^unit-(\d+)\.json$/i.exec(entry.name);
    const lessonId = String(
      (Array.isArray(bank) ? '' : bank.lessonId)
      || (unitMatch && data.lessons.find((lesson) => int(lesson.order) === Number(unitMatch[1]))?.id)
      || ''
    );
    if (!knownLessonIds.has(lessonId)) {
      throw new Error(`${filePath}: lessonId không thuộc lộ trình ${slug}.`);
    }
    // Hai file cùng một bài sẽ làm 2 lệnh DELETE xoá lẫn nhau ở bước dọn câu
    // thừa bên dưới — chỉ cho phép một file cho mỗi bài.
    if (extraLessonIds.has(lessonId)) {
      throw new Error(`${filePath}: bài ${lessonId} đã có file ngân hàng khác, hãy gộp vào một file.`);
    }
    extraLessonIds.add(lessonId);
    const questions = Array.isArray(bank) ? bank : bank.questions;
    if (!Array.isArray(questions)) throw new Error(`${filePath}: cần mảng câu hỏi JSON hoặc thuộc tính questions.`);
    // File rỗng mà vẫn chạy tiếp thì bước DELETE bên dưới sẽ xoá sạch ngân
    // hàng luyện thêm của bài; dừng ngay để tránh mất dữ liệu.
    if (!questions.length) throw new Error(`${filePath}: ngân hàng luyện thêm rỗng, dừng import để tránh xoá dữ liệu.`);
    const bankIds = [];
    for (const ex of questions) {
      const id = String(ex.id || '');
      if (!id || extraIds.has(id)) throw new Error(`${filePath}: thiếu id hoặc id bị trùng (${id || 'trống'}).`);
      if (!UUID_RE.test(id)) throw new Error(`${filePath}: id câu "${id}" không đúng định dạng UUID.`);
      extraIds.add(id);
      bankIds.push(id);
      const type = clean(ex.type, 24) || 'multiple_choice';
      const options = optionsFromRow(ex);
      const answer = resolveCorrectAnswer(type, ex.correctAnswer, options);
      // Ngân hàng luyện thêm phải qua cùng bộ kiểm tra như
      // scripts/import-grammar-extra.js: dạng bài lạ hoặc thiếu đáp án sẽ làm
      // người học không thể trả lời câu đó.
      if (!EXTRA_TYPES.has(type)) throw new Error(`${filePath}: câu ${id} dạng "${type}" không hỗ trợ.`);
      if (!clean(ex.question) || !clean(ex.explanation)) throw new Error(`${filePath}: câu ${id} thiếu câu hỏi hoặc giải thích.`);
      if (!answer) throw new Error(`${filePath}: câu ${id} thiếu đáp án.`);
      checkArrange({ id, type, question: ex.question, options, answer });
      extraRows.push([
        id, lessonId, type, sanitizeGrammarHtml(ex.question),
        options[0], options[1], options[2], options[3],
        answer, optionLetterFor(answer, options),
        sanitizeGrammarHtml(ex.explanation), clean(ex.hint, 1000), int(ex.order)
      ]);
    }
    extraBanks.push({ lessonId, ids: bankIds });
  }

  // Upsert + dọn câu thừa nằm chung một transaction để lỗi giữa chừng không
  // để lại ngân hàng luyện thêm bị xoá dở.
  await transaction(async (client) => {
    await upsertRows(
      'grammar_extra_exercises',
      ['id', 'lesson_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'hint', 'order_idx'],
      extraRows,
      ['id'],
      ['lesson_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'hint', 'order_idx'],
      200,
      client
    );
    for (const bank of extraBanks) {
      await client.query(
        `DELETE FROM grammar_extra_exercises
         WHERE lesson_id = $1 AND NOT (id = ANY($2::uuid[]))`,
        [bank.lessonId, bank.ids]
      );
    }
  });
  await upsertRows(
    'grammar_rules',
    ['id', 'lesson_id', 'title', 'content', 'order_idx'],
    ruleRows,
    ['id'],
    ['lesson_id', 'title', 'content', 'order_idx']
  );
  await upsertRows(
    'grammar_exercises',
    ['id', 'lesson_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'hint', 'order_idx'],
    exerciseRows,
    ['id'],
    ['lesson_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'hint', 'order_idx']
  );
  await upsertRows(
    'grammar_reading_exercises',
    ['id', 'lesson_id', 'title', 'passage', 'order_idx'],
    readingRows,
    ['id'],
    ['lesson_id', 'title', 'passage', 'order_idx']
  );
  await upsertRows(
    'grammar_reading_questions',
    ['id', 'reading_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'order_idx'],
    readingQuestionRows,
    ['id'],
    ['reading_id', 'type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'correct_option', 'explanation', 'order_idx']
  );

  stats.lessons += lessonRows.length;
  stats.rules += ruleRows.length;
  stats.exercises += exerciseRows.length + readingQuestionRows.length;
  stats.extraExercises += extraRows.length;
  stats.readings += readingRows.length;
  stats.questions += questionTotal;
  stats.arrangeIssues += arrangeIssues.length;
  console.log(`✓ ${slug}: ${lessonRows.length} bài, ${ruleRows.length} lý thuyết, ${exerciseRows.length} câu + ${readingQuestionRows.length} câu đọc hiểu`);
  if (arrangeIssues.length) {
    console.warn(`(!) ${slug}: ${arrangeIssues.length} câu arrange_words không xếp được thành đáp án (cần sửa dữ liệu crawl):`);
    for (const issue of arrangeIssues.slice(0, 10)) {
      console.warn(`    - ${issue.id}: "${clean(issue.question, 160)}" → "${clean(issue.answer, 120)}"`);
    }
    if (arrangeIssues.length > 10) console.warn(`    ... và ${arrangeIssues.length - 10} câu khác`);
  }
}

async function main() {
  const filter = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  let entries = [];
  try {
    entries = await fs.readdir(crawlRoot, { withFileTypes: true });
  } catch {
    console.log(`(!) Không tìm thấy thư mục ${crawlRoot}. Bỏ qua import ngữ pháp.`);
    return;
  }

  const stats = { paths: 0, lessons: 0, rules: 0, exercises: 0, extraExercises: 0, readings: 0, questions: 0, arrangeIssues: 0 };
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (filter.length && !filter.includes(slug)) continue;
    const full = path.join(crawlRoot, slug, `${slug}_full.json`);
    let data;
    try {
      data = JSON.parse(await fs.readFile(full, 'utf-8'));
    } catch {
      console.log(`(!) Bỏ qua ${slug}: không đọc được ${full}`);
      continue;
    }
    await importPath(slug, data, stats);
    stats.paths += 1;
  }

  console.log(`\n✓ Đã import ${stats.paths} lộ trình, ${stats.lessons} bài, ${stats.rules} lý thuyết, ${stats.readings} bài đọc hiểu, ${stats.exercises} câu hỏi gốc và ${stats.extraExercises} câu luyện thêm.`);
  if (stats.arrangeIssues) {
    console.warn(`(!) Tổng ${stats.arrangeIssues} câu arrange_words cần kiểm tra lại (xem cảnh báo phía trên).`);
  }
}

try {
  await main();
} catch (error) {
  console.error('grammar import failed:', error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
