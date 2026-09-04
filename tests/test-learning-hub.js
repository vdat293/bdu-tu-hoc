import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractCoursesFromBduGrades,
  normalizeCourseCode,
  LearningServiceInternals
} from '../src/services/learning.service.js';
import { detectSupportedResourceSource } from '../src/services/community.service.js';

console.log('🧪 Kiểm tra kho học tập map từ payload BDU...');

const payload = {
  result: true,
  code: 200,
  data: {
    ds_diem_hocky: [
      {
        hoc_ky: '20261',
        ten_hoc_ky: 'Học kỳ 1 - Năm học 2026 - 2027',
        ds_diem_mon_hoc: [
          { ma_mon: ' inf0103 ', ten_mon: 'Nhập môn Trí tuệ nhân tạo', diem_tk: null }
        ]
      },
      {
        hoc_ky: '20241',
        ten_hoc_ky: 'Học kỳ 1 - Năm học 2024 - 2025',
        ds_diem_mon_hoc: [
          { ma_mon: 'INF0433', ten_mon: 'Nhập môn lập trình', diem_tk: '9.8', diem_tk_chu: 'A' },
          { ma_mon: 'ENG1614', ten_mon: 'Tiếng Anh 1', diem_tk_so: '3.0' }
        ]
      }
    ]
  }
};

const extracted = extractCoursesFromBduGrades(payload);
assert.equal(normalizeCourseCode(' inf 0103 '), 'INF0103');
assert.equal(LearningServiceInternals.normalizeRecordId('42'), '42');
assert.equal(LearningServiceInternals.normalizeRecordId('0'), null);
assert.equal(LearningServiceInternals.normalizeRecordId('1 OR 1=1'), null);
assert.equal(extracted.courses.length, 3);
assert.equal(extracted.enrollments.length, 3);
assert.equal(extracted.enrollments[0].normalizedCode, 'INF0103');
assert.equal(extracted.enrollments[0].hasFinalGrade, false);
assert.equal(extracted.enrollments[1].normalizedCode, 'INF0433');
assert.equal(extracted.enrollments[1].hasFinalGrade, true);

assert.throws(
  () => extractCoursesFromBduGrades({ result: true, data: {} }),
  /Không nhận diện được danh sách học phần/
);

assert.equal(detectSupportedResourceSource('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
assert.equal(detectSupportedResourceSource('https://drive.google.com/file/d/demo/view'), 'drive');
assert.equal(detectSupportedResourceSource('https://github.com/example/course-notes'), 'github');
assert.equal(detectSupportedResourceSource('https://example.com/document.pdf'), null);

const migration = fs.readFileSync('migrations/004_course_learning_hub.sql', 'utf8');
assert.equal(/INSERT\s+INTO\s+courses/i.test(migration), false, 'Migration không được seed môn học');
const interactionMigration = fs.readFileSync('migrations/005_course_post_interactions.sql', 'utf8');
assert.match(interactionMigration, /CREATE TABLE IF NOT EXISTS course_post_likes/);
assert.match(interactionMigration, /CREATE TABLE IF NOT EXISTS course_post_comments/);
assert.match(interactionMigration, /ON DELETE CASCADE/);
const anonymousMigration = fs.readFileSync('migrations/007_anonymous_course_discussions.sql', 'utf8');
assert.match(anonymousMigration, /is_anonymous/);
assert.match(anonymousMigration, /CHECK \(NOT is_anonymous OR kind = 'request'\)/);

const html = fs.readFileSync('public/index.html', 'utf8');
assert.equal(html.includes('id="learning-courses-grid"'), true);
assert.equal(html.includes('id="learning-post-form"'), true);
assert.equal(html.includes('id="learning-composer-modal"'), true);
assert.equal(html.includes('Kho Tài Liệu Theo Học Kỳ'), false);
assert.equal(html.includes('<h2 class="section-title">Kho Tài Liệu</h2>'), true);
assert.equal(html.includes('aria-modal="true"'), true);

const appJs = fs.readFileSync('public/js/app.js', 'utf8');
assert.match(appJs, /learning-semester-group/);
assert.match(appJs, /tài liệu<\/span>/);
assert.match(appJs, /bài viết<\/span>/);
assert.match(appJs, /Xem môn học/);
assert.match(appJs, /handleLearningComposerKeydown/);
assert.match(appJs, /LUẬN BÀN/);
assert.match(appJs, /const postForm = event\.currentTarget/);
assert.doesNotMatch(appJs, /event\.currentTarget\.reset/);
assert.match(appJs, /data-learning-like/);
assert.match(appJs, /data-learning-comments-toggle/);
assert.match(appJs, /data-learning-delete/);
assert.match(appJs, /data-learning-reply/);
assert.match(appJs, /learning-post-anonymous/);
assert.match(appJs, /function getLearningAttachmentMeta/);
assert.match(appJs, /function renderLearningSourceLogo/);
assert.match(appJs, /learning-logo-youtube/);
assert.match(appJs, /learning-logo-drive/);
assert.match(appJs, /learning-logo-github/);
assert.match(appJs, /Xem trên YouTube/);
assert.match(appJs, /Mở Google Drive/);
assert.match(appJs, /Mở trên GitHub/);
assert.match(appJs, /Chỉ hỗ trợ link YouTube, Google Drive hoặc GitHub/);

const learningService = fs.readFileSync('src/services/learning.service.js', 'utf8');
assert.match(learningService, /AS semesters/);
assert.match(learningService, /AS post_count/);
assert.match(learningService, /toggleCoursePostLike/);
assert.match(learningService, /addCoursePostComment/);
assert.match(learningService, /deleteCoursePost/);
assert.match(learningService, /kind === 'request' && normalizeBoolean/);

const client = fs.readFileSync('public/js/api.js', 'utf8');
assert.match(client, /Authorization.*Bearer.*token/s);
assert.match(client, /toggleCourseLearningPostLike/);
assert.match(client, /addCourseLearningPostComment/);
assert.match(client, /deleteCourseLearningPost/);

const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
assert.match(routes, /posts\/:postId\/like/);
assert.match(routes, /posts\/:postId\/comments/);
assert.match(routes, /router\.delete\('\/learning\/courses\/:courseCode\/posts\/:postId'/);

console.log('✅ Kho học tập chỉ nhận mã/tên môn từ phản hồi BDU và phân biệt môn chưa/có điểm.');
