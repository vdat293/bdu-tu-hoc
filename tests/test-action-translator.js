import assert from 'node:assert/strict';
import {
  AUTOMATION_TOOLS,
  classifyAutomationApiRequest,
  classifyAutomationUiEvent,
  describeApiAction,
  describeInteractionEvent,
  describePage,
  formatShortDurationVi,
  isNoiseRequest,
  normalizePagePath,
  normalizePagePattern
} from '../src/modules/admin/action-translator.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

check('normalizePagePath cắt query/hash và dấu gạch chéo cuối', () => {
  assert.equal(normalizePagePath('/gpa/?semester=20251#top'), '/gpa');
  assert.equal(normalizePagePath('/'), '/');
  assert.equal(normalizePagePath('vocab/themes/'), '/vocab/themes');
});

check('normalizePagePattern chuẩn hóa route động để gộp thống kê', () => {
  assert.equal(normalizePagePattern('/vocab/set/1234/quiz'), '/vocab/set/:setId/:mode');
  assert.equal(normalizePagePattern('/learning/INF1003/guides/bai-1/step-2'), '/learning/:courseCode/guides/:lessonId');
  assert.equal(normalizePagePattern('/clans/42'), '/clans/:clanId');
  assert.equal(normalizePagePattern('/confession/profile/24050126'), '/confession/profile/:mssv');
});

check('describePage trả về tiêu đề tiếng Việt và đúng featureId', () => {
  const gpa = describePage('/gpa');
  assert.equal(gpa.title, 'Bảng điểm & GPA');
  assert.equal(gpa.featureId, 'portal');

  const vocab = describePage('/vocab/set/abc/flashcard');
  assert.equal(vocab.featureId, 'vocab');
  assert.match(vocab.title, /Thẻ nhớ/);

  const club = describePage('/clans/5');
  assert.equal(club.featureId, 'clubs');
  assert.equal(club.title, 'Không gian CLB / Nhóm');
});

check('isNoiseRequest phát hiện đúng endpoint polling & telemetry', () => {
  assert.equal(isNoiseRequest('/api/version'), true);
  assert.equal(isNoiseRequest('/api/health'), true);
  assert.equal(isNoiseRequest('/api/service-lock/status'), true);
  assert.equal(isNoiseRequest('/api/notifications/unread-count'), true);
  assert.equal(isNoiseRequest('/api/admin/dashboard/overview'), true);
  assert.equal(isNoiseRequest('/api/telemetry/events'), true);

  assert.equal(isNoiseRequest('/api/wordfmt/format'), false);
  assert.equal(isNoiseRequest('/api/community/posts'), false);
  assert.equal(isNoiseRequest('/api/grades'), false);
});

check('describeApiAction dịch API nghiệp vụ sang tiếng Việt rõ ràng', () => {
  const wf = describeApiAction('POST', '/api/wordfmt/format');
  assert.equal(wf.label, 'Chuẩn hóa tài liệu Word');
  assert.equal(wf.isNoise, false);
  assert.equal(wf.featureId, 'wordfmt');

  const grades = describeApiAction('POST', '/api/grades');
  assert.equal(grades.label, 'Tải bảng điểm & GPA');
  assert.equal(grades.featureId, 'portal');

  const noise = describeApiAction('GET', '/api/version');
  assert.equal(noise.isNoise, true);
});

check('describeInteractionEvent dựng câu tiếng Việt cho mọi loại sự kiện UI', () => {
  assert.equal(
    describeInteractionEvent({ eventType: 'page_view', pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA' }),
    'Mở trang Bảng điểm & GPA'
  );
  assert.equal(
    describeInteractionEvent({ eventType: 'page_leave', pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA', durationMs: 45000 }),
    'Rời trang Bảng điểm & GPA (xem 45 giây)'
  );
  assert.equal(
    describeInteractionEvent({ eventType: 'click', pagePath: '/gpa', targetLabel: 'Xuất CSV' }),
    'Bấm "Xuất CSV"'
  );
  assert.equal(
    describeInteractionEvent({ eventType: 'search', pagePath: '/vocab', targetLabel: 'Từ vựng IT' }),
    'Tìm kiếm "Từ vựng IT"'
  );
  assert.equal(formatShortDurationVi(125000), '2 phút 5 giây');
});

check('classifyAutomationUiEvent và classifyAutomationApiRequest phân biệt dùng thật / chuẩn bị / chỉ xem', () => {
  assert.equal(AUTOMATION_TOOLS.length, 5);

  // WordFmt: format/download => used; preview => tried; page_view => view
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'wordfmt_format', page_path: '/wordfmt' }).tier, 'used');
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'wordfmt_preview', page_path: '/wordfmt' }).tier, 'tried');
  assert.equal(classifyAutomationUiEvent({ event_type: 'page_view', event_name: 'page_view', page_path: '/wordfmt' }).tier, 'view');

  // Survey
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'survey_run', page_path: '/survey' }).tier, 'used');
  assert.equal(classifyAutomationApiRequest('POST', '/api/survey/runs', 200).tier, 'used');
  assert.equal(classifyAutomationApiRequest('GET', '/api/survey/forms', 200).tier, 'view');
  assert.equal(classifyAutomationApiRequest('POST', '/api/survey/runs', 400).tier, 'tried');

  // Training score
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'training_score_submit', page_path: '/training-score' }).tier, 'used');
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'training_score_cds_sync', page_path: '/training-score' }).tier, 'tried');
  assert.equal(classifyAutomationApiRequest('POST', '/api/training-score/submit', 200).tier, 'used');
  assert.equal(classifyAutomationApiRequest('POST', '/api/training-score/cds-sync', 200).tier, 'tried');

  // English
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'english_auto_finish', page_path: '/english' }).tier, 'used');
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'english_login', page_path: '/english' }).tier, 'tried');
  assert.equal(classifyAutomationApiRequest('POST', '/api/english/sess-1/finish-course', 200).tier, 'used');
  assert.equal(classifyAutomationApiRequest('POST', '/api/english/login', 200).tier, 'tried');

  // Enrollment
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'enrollment_start', page_path: '/enrollment' }).tier, 'used');
  assert.equal(classifyAutomationUiEvent({ event_type: 'action', event_name: 'enrollment_save_priority', page_path: '/enrollment' }).tier, 'tried');
  assert.equal(classifyAutomationApiRequest('POST', '/api/enrollment/withdraw', 200).tier, 'used');
  assert.equal(classifyAutomationApiRequest('PUT', '/api/enrollment/priority', 200).tier, 'tried');
  assert.equal(classifyAutomationApiRequest('GET', '/api/enrollment/catalog', 200).tier, 'view');

  // Non-tool pages & polling return null
  assert.equal(classifyAutomationUiEvent({ event_type: 'page_view', page_path: '/gpa' }), null);
  assert.equal(classifyAutomationApiRequest('GET', '/api/version', 200), null);
});

if (failed > 0) {
  console.log(`✗ Action translator: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Action translator: toàn bộ ca đạt.');
}
