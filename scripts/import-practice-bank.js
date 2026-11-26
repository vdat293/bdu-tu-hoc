/**
 * Import ngân hàng câu hỏi ôn tập trắc nghiệm vào PostgreSQL (bảng riêng course_practice_*).
 *
 * Chạy:
 *   npm run practice-bank:import -- --course INF0983 --file data/practice-banks/INF0983.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, transaction } from '../src/db/database.js';
import { parsePracticeBankPayload } from '../src/modules/learning/practice-bank.parser.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

function parseArgs(argv) {
  let course = 'INF0983';
  let file = 'data/practice-banks/INF0983.json';
  let description;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--course' && argv[i + 1]) {
      course = argv[++i];
    } else if (arg.startsWith('--course=')) {
      course = arg.slice('--course='.length);
    } else if (arg === '--file' && argv[i + 1]) {
      file = argv[++i];
    } else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
    } else if (arg === '--description' && argv[i + 1]) {
      description = argv[++i];
    } else if (arg.startsWith('--description=')) {
      description = arg.slice('--description='.length);
    } else {
      throw new Error(`Tham số không được hỗ trợ: ${arg}`);
    }
  }

  return { course, file, description };
}

async function upsertQuestionBatch(client, bankId, rows, chunkSize = 100) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const params = [];
    const values = slice.map((item) => {
      const offset = params.length;
      params.push(
        bankId,
        item.external_id,
        item.chapter_index,
        item.chapter_title,
        item.question_text,
        JSON.stringify(item.options),
        item.correct_answer,
        item.explanation
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb, $${offset + 7}, $${offset + 8})`;
    });

    await client.query(
      `INSERT INTO course_practice_questions (
        bank_id, external_id, chapter_index, chapter_title,
        question_text, options, correct_answer, explanation
      )
      VALUES ${values.join(', ')}
      ON CONFLICT (bank_id, external_id) DO UPDATE SET
        chapter_index = EXCLUDED.chapter_index,
        chapter_title = EXCLUDED.chapter_title,
        question_text = EXCLUDED.question_text,
        options = EXCLUDED.options,
        correct_answer = EXCLUDED.correct_answer,
        explanation = EXCLUDED.explanation,
        updated_at = NOW();`,
      params
    );
  }
}

async function run() {
  const { course, file, description } = parseArgs(process.argv.slice(2));
  const resolvedPath = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
  const rawContent = await fs.readFile(resolvedPath, 'utf8');
  const parsed = parsePracticeBankPayload(JSON.parse(rawContent), course, { description });

  const { bankId } = await transaction(async (client) => {
    const bankResult = await client.query(
      `INSERT INTO course_practice_banks (
        course_code, title, description, chapters, question_count, enabled
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, TRUE)
      ON CONFLICT (course_code) DO UPDATE SET
        title = EXCLUDED.title,
        description = CASE
          WHEN EXCLUDED.description <> '' THEN EXCLUDED.description
          ELSE course_practice_banks.description
        END,
        chapters = EXCLUDED.chapters,
        question_count = EXCLUDED.question_count,
        enabled = TRUE,
        updated_at = NOW()
      RETURNING id;`,
      [
        parsed.courseCode,
        parsed.title,
        parsed.description || `Ngân hàng ${parsed.questions.length} câu hỏi ôn tập theo chương và thi thử tổng hợp.`,
        JSON.stringify(parsed.chapters),
        parsed.questions.length
      ]
    );

    const id = bankResult.rows[0].id;
    await upsertQuestionBatch(client, id, parsed.questions);
    return { bankId: id };
  });

  console.log(
    `Imported ${parsed.courseCode} (bank_id=${bankId}): ${parsed.questions.length} questions across ${parsed.chapters.length} chapters.`
  );
}

try {
  await run();
} catch (error) {
  console.error(`Import failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
