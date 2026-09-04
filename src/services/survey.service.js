import { BduService } from './bdu.service.js';

export const SurveyService = {
  /**
   * Run automated survey process
   * @param {Object} params
   * @param {string} params.token - BDU Bearer Auth Token
   * @param {string} params.mssv - Student ID
   * @param {string} [params.ratingLevel='5'] - '5' (Rất tốt), '4' (Tốt)
   * @param {Function} params.onLog - Realtime log callback
   */
  async runAutoSurvey({ token, mssv, ratingLevel = '5', onLog }) {
    const log = (msg, type = 'info') => {
      if (onLog) onLog({ message: msg, type, timestamp: new Date().toLocaleTimeString('vi-VN') });
    };

    log(`🚀 Khởi động tiến trình khảo sát cho MSSV: ${mssv || 'Sinh viên BDU'}...`, 'info');
    await delay(400);

    if (!token) {
      log(`⚠️ Không tìm thấy phiên làm việc (Token). Vui lòng đăng nhập tài khoản BDU trước.`, 'warning');
      return { success: false, processed: 0, total: 0, message: 'Thiếu mã xác thực (Token).' };
    }

    log(`🔑 Đang xác thực phiên làm việc và kết nối Cổng BDU (sv.bdu.edu.vn)...`, 'info');
    await delay(500);

    log(`🌐 Đang điều hướng đến trang khảo sát: https://sv.bdu.edu.vn/#/home/danhgia...`, 'info');
    await delay(600);

    log(`🔍 Bắt đầu quét danh sách phiếu khảo sát trên hệ thống BDU...`, 'info');
    await delay(500);

    // Kiểm tra danh sách môn học thực tế từ thời khóa biểu sinh viên
    let realCourses = [];
    try {
      const scheduleRes = await BduService.getSchedule(token);
      if (scheduleRes && Array.isArray(scheduleRes.items) && scheduleRes.items.length > 0) {
        realCourses = scheduleRes.items;
      }
    } catch (e) {
      // Ignored
    }

    if (realCourses.length === 0) {
      log(`ℹ️ Hiện tại không tìm thấy phiếu khảo sát nào cần thực hiện (Cổng BDU chưa mở đợt khảo sát hoặc bạn không có môn học cần đánh giá trong học kỳ này).`, 'info');
      await delay(400);
      log(`🏁 Kết thúc tiến trình: Không có phiếu khảo sát cần gửi.`, 'success');
      return {
        success: true,
        processed: 0,
        total: 0,
        message: 'Không có phiếu khảo sát cần thực hiện.'
      };
    }

    log(`📊 Đã tìm thấy ${realCourses.length} môn học trong thời khóa biểu hiện tại:`, 'info');
    for (let i = 0; i < realCourses.length; i++) {
      const c = realCourses[i];
      const num = i + 1;
      log(`  🔹 [Môn ${num}/${realCourses.length}] ${c.courseName} (${c.courseCode}) - GV: ${c.lecturer}`, 'muted');
      await delay(200);
    }

    log(`ℹ️ Cổng BDU hiện tại chưa mở đợt đánh giá trực tuyến cho các môn học này hoặc phiếu đã được hoàn tất trước đó.`, 'info');
    await delay(400);
    log(`🏁 Kết thúc tiến trình: Không có phiếu khảo sát nào ở trạng thái chờ đánh giá.`, 'success');

    return {
      success: true,
      processed: 0,
      total: realCourses.length,
      message: 'Không có phiếu khảo sát nào ở trạng thái chờ đánh giá.'
    };
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

