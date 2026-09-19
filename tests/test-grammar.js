import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GrammarService } from '../src/services/grammar.service.js';
import {
  sanitizeGrammarHtml,
  resolveCorrectAnswer,
  optionLetterFor,
  optionsFromRow
} from '../src/utils/grammar-data.js';

console.log('🧪 Kiểm tra grammar service...');

// 1. Validation: uuid sai định dạng phải 400, không chạm DB
await assert.rejects(() => GrammarService.getPath(''), /đúng định dạng/);
await assert.rejects(() => GrammarService.getPath('not-a-uuid'), /đúng định dạng/);
await assert.rejects(() => GrammarService.getPath("'; DROP TABLE grammar_paths; --"), /đúng định dạng/);
await assert.rejects(() => GrammarService.getLesson('not-a-uuid'), /đúng định dạng/);
await assert.rejects(() => GrammarService.saveProgress('', 'x'), /Thiếu mssv|đúng định dạng/);
await assert.rejects(() => GrammarService.saveProgress('24050001', 'not-a-uuid'), /đúng định dạng/);

// 2. Sanitize HTML lý thuyết: gỡ script/iframe/thuộc tính nguy hiểm, giữ thẻ an toàn
const dirty = '<p onclick="x()">Hi <strong>there</strong></p><script>alert(1)</script>'
  + '<table border="1" style="color:red"><tr><td colspan="2">A</td></tr></table>'
  + '<iframe src="https://evil"></iframe><img src="x" onerror="y()">';
const clean = sanitizeGrammarHtml(dirty);
assert.equal(/<script/i.test(clean), false, 'Phải gỡ thẻ script');
assert.equal(/<iframe/i.test(clean), false, 'Phải gỡ thẻ iframe');
assert.equal(/onclick|onerror|style=|border=/i.test(clean), false, 'Phải gỡ thuộc tính nguy hiểm');
assert.equal(clean.includes('<strong>there</strong>'), true, 'Phải giữ thẻ định dạng');
assert.equal(clean.includes('colspan="2"'), true, 'Phải giữ colspan của bảng');
assert.equal(sanitizeGrammarHtml(''), '');

// 3. Chuẩn hóa đáp án: câu đọc hiểu lưu chữ cái A-D -> text; bài thường giữ nguyên
const readingOptions = ['to', 'with', 'for', 'of'];
assert.equal(resolveCorrectAnswer('multiple_choice', 'C', readingOptions), 'for');
assert.equal(resolveCorrectAnswer('multiple_choice', 'a', ['a', 'b', 'c', 'd']), 'a');
assert.equal(resolveCorrectAnswer('fill_blank', 'is', []), 'is');
assert.equal(optionLetterFor('for', readingOptions), 'C');
assert.equal(optionLetterFor('missing', readingOptions), '');
assert.deepEqual(optionsFromRow({ optionA: 'am', optionB: null, optionC: 'are', optionD: ' ' }), ['am', '', 'are', '']);

// 4. Migration tồn tại, đủ bảng, không seed dữ liệu mẫu
const migration = fs.readFileSync('migrations/043_grammar.sql', 'utf8');
for (const table of ['grammar_groups', 'grammar_paths', 'grammar_lessons', 'grammar_rules', 'grammar_exercises', 'grammar_reading_exercises', 'grammar_reading_questions', 'grammar_progress']) {
  assert.match(migration, new RegExp(table), `Thiếu bảng ${table}`);
}
assert.equal(/INSERT\s+INTO\s+grammar_/i.test(migration), false, 'Migration không được seed dữ liệu mẫu');
assert.match(migration, /grammar_progress_completed_idx/, 'Thiếu index hoàn thành bài');
assert.match(migration, /grammar_lessons_path_idx/, 'Thiếu index bài học theo lộ trình');

// 5. Dữ liệu crawl: 8 lộ trình, 246 bài, 10.252 câu thường + 46 bài đọc hiểu
const outputRoot = path.resolve('..', 'tool-crawl', 'crawl-nguphap', 'output');
const dirs = fs.readdirSync(outputRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
assert.equal(dirs.length, 8, 'Phải có 8 lộ trình');

let lessons = 0;
let exercises = 0;
let readings = 0;
let rules = 0;
for (const dir of dirs) {
  const data = JSON.parse(fs.readFileSync(path.join(outputRoot, dir.name, `${dir.name}_full.json`), 'utf8'));
  lessons += data.lessons.length;
  for (const lesson of data.lessons) {
    rules += lesson.rules.length;
    exercises += lesson.exercises.length;
    readings += (lesson.readingExercises || []).length;
  }
}
assert.equal(lessons, 246, 'Tổng số bài học phải là 246');
assert.equal(rules, 1377, 'Tổng số lý thuyết phải là 1377');
assert.equal(exercises, 10252, 'Tổng số câu bài tập phải là 10.252');
assert.equal(readings, 46, 'Tổng số bài đọc hiểu phải là 46');

console.log('✅ Grammar service + sanitizer + dữ liệu crawl OK (8 lộ trình, 246 bài, 46 bài đọc hiểu)');
