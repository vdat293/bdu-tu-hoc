import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BduService } from '../src/services/bdu.service.js';
import { SurveyService } from '../src/services/survey.service.js';

console.log('🧪 Kiểm tra xác minh loại bỏ dữ liệu mock...');

const originalFetch = globalThis.fetch;
const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  return {
    ok: true,
    status: 200,
    async json() {
      return { data: { ds_nhom_cau_hoi: [] } };
    }
  };
};

try {
  // 1. Kiểm tra BduService.getSchedule không trả về dữ liệu giả
  const emptySchedule = await BduService.getSchedule('', null);
  assert.equal(emptySchedule.isRealData, false, 'Khi không có token, isRealData phải là false');
  assert.equal(Array.isArray(emptySchedule.items), true, 'items phải là mảng');
  assert.equal(emptySchedule.items.length, 0, 'items phải rỗng khi không có token');
  assert.equal(emptySchedule.semesters.length, 0, 'semesters phải rỗng khi không có token');
  console.log('✅ PASS: BduService.getSchedule trả về mảng rỗng khi không có dữ liệu thực.');

  // 2. SurveyService phải xử lý payload rỗng mà không gọi mạng thật
  const logs = [];
  const surveyResult = await SurveyService.runAutoSurvey({
    token: 'test-token',
    mssv: 'TEST0001',
    ratingLevel: '5',
    onLog: (l) => logs.push(l.message)
  });

  assert.equal(surveyResult.processed, 0, 'processed phải là 0 khi không có phiếu khảo sát');
  assert.equal(surveyResult.total, 0, 'total phải là 0 khi không có môn học');
  assert.equal(fetchCalls.length, 1, 'test chỉ được gọi một request survey đã mock');
  const logText = logs.join(' ');
  assert.equal(logText.includes('INT1340'), false, 'Log không được chứa mã môn mock INT1340');
  assert.equal(logText.includes('TS. Trần Hoàng Nam'), false, 'Log không được chứa tên giảng viên mock');
  console.log('✅ PASS: SurveyService không sử dụng sampleCourses mock và không gọi BDU thật.');

  // 3. Kiểm tra index.html không chứa sinh viên mock tĩnh
  const htmlContent = fs.readFileSync('public/index.html', 'utf8');
  assert.equal(htmlContent.includes('Trần Minh Hoàng'), false, 'index.html không được chứa tên mock Trần Minh Hoàng');
  assert.equal(htmlContent.includes('Lê Thị Thảo'), false, 'index.html không được chứa tên mock Lê Thị Thảo');
  assert.equal(htmlContent.includes('id="learning-courses-grid"'), true, 'index.html phải để kho môn học được render từ API');
  assert.equal(htmlContent.includes('<article class="learning-course-card'), false, 'index.html không được chứa thẻ môn học tĩnh');
  assert.equal(htmlContent.includes('<option value="20261">Học kỳ 1 (2026 - 2027)</option>'), false, 'index.html không được chứa option học kỳ tĩnh');
  assert.equal(htmlContent.includes('14 Sao'), false, 'index.html không được chứa 14 Sao');
  const appJsContent = fs.readFileSync('public/js/app.js', 'utf8');
  assert.equal(appJsContent.includes('(14 Sao) ⭐'), false, 'app.js không được chứa 14 Sao');
  console.log('✅ PASS: Đã xóa sạch nhãn ảo 14 Sao khỏi giao diện.');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('🎉 TẤT CẢ KIỂM TRA LOẠI BỎ MOCK DATA ĐỀU ĐẠT CHUẨN!');
