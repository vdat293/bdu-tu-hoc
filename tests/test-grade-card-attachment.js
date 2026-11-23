import assert from 'node:assert/strict';
import {
  isGradeCardAttachment,
  sanitizeGradeCardAttachment
} from '../src/services/community.service.js';

// 1. Nhận diện đúng loại grade_card
assert.equal(isGradeCardAttachment({ type: 'grade_card' }), true);
assert.equal(isGradeCardAttachment({ type: 'image' }), false);
assert.equal(isGradeCardAttachment(null), false);

// 2. Chuẩn hoá dữ liệu và tự tính tier chống giả mạo
const cleanA = sanitizeGradeCardAttachment({
  type: 'grade_card',
  course_name: '  Lập trình Web  ',
  course_code: 'INF1003',
  semester: 'HK1 2026-2027',
  credits: 3,
  score_10: '9,15',
  score_4: 4.0,
  letter: 'a',
  tier: 'fail'
});

assert.deepEqual(cleanA, {
  type: 'grade_card',
  course_name: 'Lập trình Web',
  course_code: 'INF1003',
  semester: 'HK1 2026-2027',
  credits: 3,
  score_10: 9.15,
  score_4: 4,
  letter: 'A',
  status: 'passed',
  tier: 'excellent'
});

// Cố tình gửi tier=excellent cho điểm F phải bị tính lại thành fail
const spoofedF = sanitizeGradeCardAttachment({
  type: 'grade_card',
  course_name: 'Giải tích 1',
  score_10: 2.5,
  letter: 'F',
  tier: 'excellent'
});
assert.equal(spoofedF.tier, 'fail');
assert.equal(spoofedF.status, 'failed');

// 3. Từ chối payload thiếu môn hoặc thiếu điểm / ngoài khoảng
assert.equal(sanitizeGradeCardAttachment({ type: 'grade_card', course_name: '' }), null);
assert.equal(sanitizeGradeCardAttachment({ type: 'grade_card', course_name: 'Toán' }), null);
assert.equal(sanitizeGradeCardAttachment({ type: 'grade_card', course_name: 'Toán', score_10: 15 }), null);

console.log('test-grade-card-attachment: ok');
