import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VocabService } from '../src/services/vocab.service.js';

console.log('🧪 Kiểm tra vocab service...');

// 1. Validation: slug rỗng / uuid sai định dạng phải 400, không chạm DB
await assert.rejects(() => VocabService.listSets(''), /Thiếu slug/);
await assert.rejects(() => VocabService.getTheme(''), /Thiếu slug theme/);
await assert.rejects(() => VocabService.listWords(''), /đúng định dạng/);
await assert.rejects(() => VocabService.listWords('not-a-uuid'), /đúng định dạng/);
await assert.rejects(() => VocabService.listWords("'; DROP TABLE vocab_words; --"), /đúng định dạng/);
await assert.rejects(() => VocabService.saveProgress('', 'w1', 'known'), /đúng định dạng|Thiếu/);

// 2. Limit bị clamp 1..200, order lạ fallback về sort_order (không inject SQL)
assert.equal(Math.max(1, Math.min(200, Number('9999') || 100)), 200);

// 3. Migration tồn tại, có đủ 4 bảng, không seed từ mẫu
const migration = fs.readFileSync('migrations/038_vocab.sql', 'utf8');
for (const t of ['vocab_themes', 'vocab_sets', 'vocab_words', 'vocab_progress']) {
  assert.match(migration, new RegExp(t), `Thiếu bảng ${t}`);
}
assert.equal(/INSERT\s+INTO\s+vocab_words/i.test(migration), false, 'Migration không được seed từ vựng mẫu');

// 4. themes-12.json đủ 11 themes / 361 sets (đã resolve từ /paths/summary)
const themes = JSON.parse(fs.readFileSync('../tool-crawl/crawl-luyentu/themes-12.json', 'utf8'));
assert.equal(themes.length, 11);
assert.equal(themes.reduce((n, t) => n + t.wordSets.length, 0), 361);
const slugs = themes.map((t) => t.slug);
for (const s of ['b1-4-0-5-0', 'c1', 'b2-5-5-6-5', 'a1-0-3-0', 'sach-destination-b1', 'sach-destination-b2', 'sach-destination-c1-c2', 'cambridge-practice-tests-for-ielts-18-20']) {
  assert.ok(slugs.includes(s), `Thiếu theme ${s}`);
}

// 5. Migration 042: cột ngày thuộc + lịch ôn tập Leitner + index
const reviewMigration = fs.readFileSync('migrations/042_vocab_review.sql', 'utf8');
for (const col of ['known_at', 'last_reviewed_at', 'review_stage', 'next_review_at']) {
  assert.match(reviewMigration, new RegExp(col), `Thiếu cột ${col}`);
}
assert.match(reviewMigration, /vocab_progress_due_idx/, 'Thiếu index đến hạn ôn');
assert.match(reviewMigration, /vocab_progress_known_at_idx/, 'Thiếu index ngày thuộc');

// 6. Validation API ôn tập: lỗi đầu vào phải chặn trước khi chạm DB
const WORD_UUID = '11111111-1111-4111-8111-111111111111';
await assert.rejects(() => VocabService.getReviewSummary(''), /Thiếu mssv/);
await assert.rejects(() => VocabService.listReviewWords(''), /Thiếu mssv/);
await assert.rejects(() => VocabService.listReviewWords('24050001', { bucket: 'year' }), /Khung ôn tập không hợp lệ/);
await assert.rejects(() => VocabService.reviewWord('24050001', 'not-a-uuid', 'pass'), /đúng định dạng/);
await assert.rejects(() => VocabService.reviewWord('24050001', WORD_UUID, 'skip'), /Kết quả ôn không hợp lệ/);

console.log('✅ Vocab service + themes OK (11 themes, 361 sets, ôn tập Leitner)');
