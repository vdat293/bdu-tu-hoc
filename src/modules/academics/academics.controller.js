/**
 * Academics domain controller (học lực, xếp hạng, lịch học).
 *
 * Tách từ `src/controllers/api.controller.js` (STEP 2) — thân method giữ
 * nguyên văn, chỉ dịch đường dẫn import. Bản sao token thiếu `.trim()` trong
 * `getSchedule` đã dùng chung `bearerToken()`.
 */

import { BduService } from '../../services/bdu.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { LearningService } from '../../services/learning.service.js';
import { AchievementService } from './achievement.service.js';
import { AcademicSnapshotService } from '../../services/academic-snapshot.service.js';
import { AcademicRankingService } from '../../services/academic-ranking.service.js';
import { RankingSchedulerService } from '../../services/ranking-scheduler.service.js';
import { ScheduleSnapshotService } from '../../services/schedule-snapshot.service.js';
import { bearerToken } from '../_shared/bearer-token.js';

export const AcademicsController = {
  // 2. Student: Grades
  async getGrades(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const data = await BduService.getGrades(authHeader);

      // Chỉ đồng bộ mã/tên học phần từ chính payload BDU vừa xác thực.
      // Lỗi DB không được làm mất chức năng xem điểm gốc của sinh viên.
      if (LearningService.hasDatabase()) {
        try {
          const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
          await LearningService.syncStudentCourses(mssv, data);
          await AchievementService.syncFromGrades(mssv, data);
          await AcademicSnapshotService.saveFromGrades(mssv, data, { source: 'bdu_grades' });
        } catch (syncError) {
          console.error('[StudentDataSync] Không thể đồng bộ học phần/thành tựu:', syncError.message);
        }
      }
      return res.json(data);
    } catch (err) {
      console.error('Grades error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bảng điểm.'
      });
    }
  },

  // 2b. Student: verified personal academic ranking
  async getMyAcademicRanking(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      if (!AcademicRankingService.hasDatabase()) {
        return res.status(503).json({
          result: false,
          code: 'RANKING_DATABASE_NOT_CONFIGURED',
          message: 'Bảng xếp hạng đang được chuẩn bị. Vui lòng quay lại sau.'
        });
      }
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const ranking = await AcademicRankingService.getLatestByMssv(mssv);
      if (!ranking) {
        return res.status(404).json({
          result: false,
          code: 'RANKING_NOT_FOUND',
          message: 'Chưa có dữ liệu xếp hạng cho MSSV này trong snapshot gần nhất.'
        });
      }
      return res.json({ result: true, data: ranking });
    } catch (err) {
      const databaseMissing = err.code === 'DATABASE_NOT_CONFIGURED';
      console.error('Academic ranking error:', err.message);
      return res.status(databaseMissing ? 503 : (err.status || 500)).json({
        result: false,
        code: databaseMissing ? 'RANKING_DATABASE_NOT_CONFIGURED' : 'RANKING_LOOKUP_FAILED',
        message: databaseMissing
          ? 'Bảng xếp hạng đang được chuẩn bị. Vui lòng quay lại sau.'
          : (err.status === 401
            ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            : 'Chưa thể tải thành tích lúc này. Vui lòng thử lại sau.')
      });
    }
  },

  async getAcademicLeaderboard(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      if (!AcademicRankingService.hasDatabase()) {
        return res.status(503).json({
          result: false,
          code: 'LEADERBOARD_UNAVAILABLE',
          message: 'Bảng xếp hạng đang được chuẩn bị. Vui lòng quay lại sau.'
        });
      }
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const leaderboard = await AcademicRankingService.getLeaderboard({
        scope: req.query.scope,
        metric: req.query.metric,
        viewerMssv: mssv
      });
      if (!leaderboard) {
        return res.status(404).json({
          result: false,
          code: 'LEADERBOARD_NOT_READY',
          message: 'Chưa có dữ liệu xếp hạng. Vui lòng quay lại sau lần cập nhật tiếp theo.'
        });
      }
      return res.json({ result: true, data: leaderboard });
    } catch (err) {
      console.error('Academic leaderboard error:', err.message);
      const status = err.status === 400 || err.status === 401 ? err.status : 500;
      const message = status === 400
        ? err.message
        : status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Chưa thể tải bảng xếp hạng lúc này. Vui lòng thử lại sau.';
      return res.status(status).json({ result: false, code: 'LEADERBOARD_LOAD_FAILED', message });
    }
  },

  async getAcademicRankingStatus(req, res) {
    try {
      // Chỉ phiên BDU hợp lệ mới xem được tình trạng snapshot. Không trả raw
      // error_message hoặc metadata vì có thể chứa chi tiết vận hành nội bộ.
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const status = await AcademicRankingService.getStatus();
      const latest = status.latestRun;
      let syncEnabled = process.env.RANKING_SYNC_ENABLED !== 'false';
      try {
        syncEnabled = await RankingSchedulerService.isEnabled();
      } catch {
        // Giữ giá trị từ env nếu không đọc được cấu hình runtime.
      }
      return res.json({
        result: true,
        data: {
          configured: status.configured,
          sync_enabled: syncEnabled,
          sync_hour: Number.parseInt(process.env.RANKING_SYNC_HOUR || '3', 10),
          latest_run: latest ? {
            status: latest.status,
            trigger_source: latest.trigger_source,
            started_at: latest.started_at,
            completed_at: latest.completed_at,
            target_nkhk: latest.target_nkhk,
            current_activity_nkhk: latest.current_activity_nkhk,
            cohorts: latest.cohorts,
            student_count: latest.student_count,
            excluded_no_recent_activity_count: latest.excluded_no_recent_activity_count,
            has_warnings: Array.isArray(latest.metadata?.warnings) && latest.metadata.warnings.length > 0
          } : null
        }
      });
    } catch (err) {
      const status = err.status === 401 ? 401 : 500;
      console.error('Academic ranking status error:', err.message);
      return res.status(status).json({
        result: false,
        code: status === 401 ? 'RANKING_STATUS_UNAUTHORIZED' : 'RANKING_STATUS_UNAVAILABLE',
        message: status === 401 ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' : 'Chưa thể kiểm tra trạng thái đồng bộ lúc này.'
      });
    }
  },

  // 4. Student: Schedule
  async getSchedule(req, res) {
    try {
      const token = req.body?.token || bearerToken(req) || req.query?.token || '';
      const hocKy = req.query?.hoc_ky || req.query?.hocKy || req.body?.hoc_ky || req.body?.hocKy || null;

      const scheduleData = await BduService.getSchedule(token, hocKy);
      // Opportunistic snapshot: user đang online xem lịch + đã consent
      // thì lưu luôn để bot /lich đọc được mà không cần gọi BDU lại.
      if (token && scheduleData?.isRealData) {
        BduIdentityService.resolveVerifiedMssv(token)
          .then((mssv) => ScheduleSnapshotService.syncFromToken(mssv, token, hocKy))
          .catch(() => {});
      }
      return res.json({ result: true, data: scheduleData });
    } catch (err) {
      console.error('Schedule error:', err.message);
      return res.status(500).json({ result: false, message: err.message });
    }
  },
};
