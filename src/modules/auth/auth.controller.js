/**
 * Auth domain controller.
 *
 * Tách từ `src/controllers/api.controller.js` (STEP 2) — thân method giữ
 * nguyên văn, chỉ dịch đường dẫn import.
 */

import { BduService } from '../../services/bdu.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { StudentService } from '../../services/student.service.js';
import { AcademicSnapshotService } from '../../services/academic-snapshot.service.js';
import { NotificationPrefsService, TokenVaultService } from '../../services/notification-prefs.service.js';
import { ScheduleSnapshotService } from '../../services/schedule-snapshot.service.js';

export const AuthController = {
  // 1. Auth: Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const data = await BduService.login(username, password);
      BduIdentityService.register(data.token, data.mssv, { expiresIn: data.expires_in });
      req.verifiedMssv = data.mssv;
      StudentService.recordLogin(data.mssv, data.name).catch((err) => {
        console.error('[StudentService] Lỗi cập nhật trạng thái đăng nhập:', err.message);
      });
      // Chụp snapshot học lực ngay sau login (fire-and-forget): thẻ GPA/tín chỉ
      // trên hồ sơ confession cần dữ liệu này mà không phụ thuộc token còn sống.
      if (AcademicSnapshotService.hasDatabase()) {
        BduService.getGrades(data.token)
          .then((grades) => AcademicSnapshotService.saveFromGrades(data.mssv, grades, { source: 'bdu_login' }))
          .catch((err) => {
            console.warn('[AcademicSnapshot] Không thể lưu học lực khi đăng nhập:', err.message);
          });
      }
      // Opt-in nhắc lịch: chỉ khi user đã bật + xác nhận trước đó mới
      // rotate vault token + snapshot lịch. Mặc định TẮT nên skip hoàn toàn.
      NotificationPrefsService.get(data.mssv)
        .then((prefs) => {
          if (!NotificationPrefsService.isConsented(prefs)) return;
          return TokenVaultService.save(data.mssv, data.token, data.expires_in)
            .then(() => ScheduleSnapshotService.syncFromToken(data.mssv, data.token))
            .catch((err) => console.warn('[ScheduleSnapshot] Không thể snapshot khi đăng nhập:', err.message));
        })
        .catch(() => {});
      return res.json(data);
    } catch (err) {
      console.error('Login error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Lỗi kết nối máy chủ BDU.'
      });
    }
  },
};
