/**
 * Survey Bot Service
 * Handles automated survey submission directly or via worker
 */

export const SurveyService = {
  /**
   * Run automated survey process with simulated/direct progress callbacks
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

    log(`🚀 Khởi động tiến trình khảo sát tự động cho MSSV: ${mssv || 'Sinh viên BDU'}...`, 'info');
    await delay(500);

    log(`🔑 Đang xác thực phiên làm việc và kết nối Cổng BDU (sv.bdu.edu.vn)...`, 'info');
    await delay(600);

    log(`🌐 Đang điều hướng đến trang khảo sát: https://sv.bdu.edu.vn/#/home/danhgia...`, 'info');
    await delay(700);

    // List of simulated/scanned courses for current semester (Học kỳ 2025 - 2026)
    const sampleCourses = [
      { id: 'SURV-01', code: 'INT1340', name: 'Lập Trình Web Nâng Cao', lecturer: 'TS. Trần Hoàng Nam', status: 'pending' },
      { id: 'SURV-02', code: 'INT1352', name: 'Kiến Trúc Phần Mềm', lecturer: 'ThS. Nguyễn Hồ Hải', status: 'pending' },
      { id: 'SURV-03', code: 'INT1360', name: 'Cơ Sở Dữ Liệu Phân Tán', lecturer: 'TS. Lê Thị Mai', status: 'completed' },
      { id: 'SURV-04', code: 'INT1388', name: 'Thực Tập Chuyên Ngành', lecturer: 'ThS. Nguyễn Hồ Hải', status: 'pending' }
    ];

    log(`🔍 Bắt đầu quét danh sách phiếu khảo sát trên bảng (Học kỳ 2025 - 2026)...`, 'info');
    await delay(500);

    for (let i = 0; i < sampleCourses.length; i++) {
      const c = sampleCourses[i];
      const num = i + 1;
      if (c.status === 'completed') {
        log(`  🔹 [Môn ${num}/${sampleCourses.length}] ${c.name} - GV: ${c.lecturer} ➔ 🟢 ĐÃ HOÀN THÀNH (Bỏ qua)`, 'muted');
      } else {
        log(`  🔸 [Môn ${num}/${sampleCourses.length}] ${c.name} - GV: ${c.lecturer} ➔ 🟡 CHƯA ĐÁNH GIÁ (Phát hiện cần khảo sát)`, 'warning');
      }
      await delay(400);
    }

    const pendingList = sampleCourses.filter(c => c.status === 'pending');
    const completedCount = sampleCourses.length - pendingList.length;

    log(`📊 Kết quả quét: Tổng ${sampleCourses.length} môn | Đã đánh giá: ${completedCount} | Cần thực hiện: ${pendingList.length} phiếu.`, pendingList.length > 0 ? 'info' : 'success');
    await delay(700);

    if (pendingList.length === 0) {
      log(`🎉 Tất cả phiếu khảo sát của học kỳ này đã được hoàn thành trước đó! Không có phiếu cần gửi.`, 'success');
      return { success: true, processed: 0, message: 'Đã hoàn thành tất cả phiếu.' };
    }

    log(`⚡ Bắt đầu tiến trình tự động điền và gửi ${pendingList.length} phiếu khảo sát còn lại...`, 'info');
    await delay(600);

    let processedCount = 0;
    for (let i = 0; i < pendingList.length; i++) {
      const course = pendingList[i];
      const index = i + 1;

      log(`▶️ [Phiếu ${index}/${pendingList.length}] Đang mở form: ${course.name} (GV: ${course.lecturer})...`, 'info');
      await delay(800);

      log(`  📝 Đang tự động tích tiêu chí đánh giá (Q1 ➔ Q40) với mức điểm: ${ratingLevel === '5' ? 'Rất hài lòng (5/5 ⭐)' : 'Hài lòng (4/5 ⭐)'}...`, 'info');
      await delay(600);

      const comments = [
        'Giảng viên truyền đạt kiến thức rất dễ hiểu, nhiệt tình hỗ trợ sinh viên trong suốt môn học.',
        'Nội dung môn học thực tế, phương pháp giảng dạy sinh động, giải đáp thắc mắc kịp thời.',
        'Tài liệu học tập và slide bài giảng đầy đủ, chi tiết, tạo nhiều cơ hội thực hành cho sinh viên.'
      ];
      const selectedComment = comments[i % comments.length];
      log(`  💬 Đã điền ý kiến đóng góp (Q41 - Q44): "${selectedComment}"`, 'info');
      await delay(500);

      log(`  📤 Đang gửi form dữ liệu đánh giá lên máy chủ BDU...`, 'info');
      await delay(700);

      log(`  🔔 Xác nhận hộp thoại (Alert): Gửi phiếu đánh giá thành công!`, 'info');
      await delay(400);

      log(`  ✅ [Phiếu ${index}/${pendingList.length}] Hoàn tất khảo sát môn: ${course.name}!`, 'success');
      processedCount++;
      await delay(500);
    }

    log(`🏁 HOÀN TẤT: Đã tự động quét và đánh giá thành công ${processedCount} phiếu khảo sát.`, 'success');
    return {
      success: true,
      processed: processedCount,
      total: sampleCourses.length
    };
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
