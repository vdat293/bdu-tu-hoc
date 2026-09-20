/**
 * Main API Controller
 */

import { BduService } from '../services/bdu.service.js';
import { WordFmtService } from '../services/wordfmt.service.js';
import { SurveyService } from '../services/survey.service.js';
import { EnglishExerciseService } from '../services/english-exercise.service.js';
import { AcademicRankingService } from '../services/academic-ranking.service.js';
import { BduIdentityService } from '../services/bdu-identity.service.js';
import { StudentService } from '../services/student.service.js';
import { CommunityService } from '../services/community.service.js';
import { LearningService } from '../services/learning.service.js';
import { IdentityPresentationService } from '../services/identity-presentation.service.js';
import { IdentityAdminService } from '../services/identity-admin.service.js';
import { AvatarOverrideService } from '../services/avatar-override.service.js';
import { CommunityRealtime } from '../services/community-realtime.service.js';
import { MentionService } from '../services/mention.service.js';
import { NotificationService } from '../services/notification.service.js';
import { ReminderDigestService } from '../services/reminder-digest.service.js';
import { NotificationPrefsService, TokenVaultService } from '../services/notification-prefs.service.js';
import { ScheduleSnapshotService } from '../services/schedule-snapshot.service.js';
import { DiscordLinkService } from '../services/discord-link.service.js';
import { DiscordOAuthService } from '../services/discord-oauth.service.js';
import { getClanQuiz, saveClanQuiz } from '../services/clan-quiz.service.js';
import { ClanRoleService } from '../services/clan-role.service.js';
import { AchievementService } from '../services/achievement.service.js';
import { AcademicSnapshotService } from '../services/academic-snapshot.service.js';
import { EntertainmentGameService, EntertainmentGameInternals, viewerStateFor } from '../services/entertainment-game.service.js';
import { SurveyRunService } from '../services/survey-run.service.js';
import { PermissionService } from '../services/permission.service.js';
import { FacebookImportService } from '../services/facebook-import.service.js';
import { VocabService } from '../services/vocab.service.js';
import { GrammarService } from '../services/grammar.service.js';
import { BroadcastService } from '../services/broadcast.service.js';
import { query } from '../db/database.js';
import path from 'path';
import fs from 'fs';

// Vite emits dist/client/build.json on every production build. Reading it here
// lets an open tab compare its embedded __BUILD_ID__ with the deployed one.
let cachedBuildId = null;
function resolveBuildId() {
  const envBuildId = String(process.env.BUILD_ID || '').trim();
  if (envBuildId) return envBuildId;
  if (cachedBuildId) return cachedBuildId;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'dist', 'client', 'build.json'), 'utf8');
    cachedBuildId = String(JSON.parse(raw)?.build_id || '').trim() || null;
  } catch {
    cachedBuildId = null;
  }
  return cachedBuildId;
}

function publishMentionNotifications(created) {
  if (!Array.isArray(created)) return;
  for (const item of created) {
    try {
      const isAnonymous = Boolean(item?.actor_is_anonymous);
      CommunityRealtime.publishNotification(item?.recipient_mssv, {
        id: item?.id,
        type: item?.type,
        actor_mssv: isAnonymous ? null : item?.actor_mssv,
        actor_name: isAnonymous ? null : (item?.actor_name || item?.actor_mssv),
        actor_is_anonymous: isAnonymous,
        post_id: item?.post_id != null ? String(item.post_id) : null,
        comment_id: item?.comment_id != null ? String(item.comment_id) : null,
        created_at: item?.created_at
      });
    } catch (error) {
      console.warn('[notifications] Không thể publish realtime:', error.message);
    }
    // Push tag/reply qua Discord DM ngay (fire-and-forget, chỉ khi user đã link).
    try {
      ReminderDigestService.pushMention({
        recipient_mssv: item?.recipient_mssv,
        actor_name: item?.actor_is_anonymous ? null : (item?.actor_name || item?.actor_mssv),
        type: item?.type === 'reply' ? 'reply' : 'mention',
        post_id: item?.post_id != null ? String(item.post_id) : null,
        comment_id: item?.comment_id != null ? String(item.comment_id) : null
      }).catch(() => {});
    } catch {}
  }
}

export const ApiController = {
  // 1. Auth: Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const data = await BduService.login(username, password);
      BduIdentityService.register(data.token, data.mssv, { expiresIn: data.expires_in });
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
      return res.json({
        result: true,
        data: {
          configured: status.configured,
          sync_enabled: process.env.RANKING_SYNC_ENABLED !== 'false',
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

  // 3. Student: Profile
  async getProfile(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const token = req.body?.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader);
      const idsv = req.query?.IDSV || req.query?.idsv || req.body?.idsv || '';
      let maSV = req.query?.MaSV || req.query?.maSV || req.query?.mssv || req.body?.maSV || req.body?.mssv || req.body?.userName || '';

      if (!token) {
        return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.' });
      }

      if (!maSV) {
        try {
          maSV = await BduIdentityService.resolveVerifiedMssv(token);
        } catch {}
      }

      const profileData = await BduService.getProfile(token, idsv, maSV);
      try {
        const verifiedMssv = maSV || await BduIdentityService.resolveVerifiedMssv(token);
        await IdentityPresentationService.recordProfile(verifiedMssv, profileData);
      } catch (profileSyncError) {
        console.warn('[IdentityPresentation] Không thể lưu ảnh hồ sơ:', profileSyncError.message);
      }
      return res.json(profileData);
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // 4. Student: Schedule
  async getSchedule(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const token = req.body?.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader) || req.query?.token || '';
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

  // 5. Tools: Format DOCX
  async formatDocx(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ result: false, message: 'Vui lòng chọn file Word (.docx) để tải lên.' });
      }

      const {
        instructor,
        student,
        studentId,
        topic,
        className,
        documentTitle,
        docTitle,
        institution,
        institute,
        faculty,
        course,
        location,
        month,
        year,
        documentMode,
        documentType,
        frontMatter,
        profile,
        onlyExistingCaptions,
        skipProposal
      } = req.body;
      const inputPath = req.file.path;

      const result = await WordFmtService.formatDocx({
        inputPath,
        instructor,
        student,
        studentId,
        topic,
        className,
        documentTitle: documentTitle || docTitle,
        institution,
        institute,
        faculty,
        course,
        location,
        month,
        year,
        documentMode,
        documentType,
        frontMatter,
        profile,
        onlyExistingCaptions: onlyExistingCaptions === 'true' || onlyExistingCaptions === true,
        skipProposal: skipProposal === 'true' || skipProposal === true
      });

      // Cleanup uploaded temp file
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }

      return res.json({
        result: true,
        message: 'Định dạng văn bản thành công!',
        downloadUrl: `/api/wordfmt/download/${result.outputFile}`,
        fileSize: result.fileSize,
        report: result.report
      });
    } catch (err) {
      console.error('WordFmt format error:', err.message);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        result: false,
        message: err.message || 'Không thể định dạng file DOCX.'
      });
    }
  },

  // 6. Tools: Download Formatted DOCX
  downloadFormattedDocx(req, res) {
    const filename = req.params.filename;
    const filePath = path.resolve('temp', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ result: false, message: 'File không tồn tại hoặc đã hết hạn.' });
    }

    res.download(filePath, `BDU_ChuanHoa_${filename}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
    });
  },

  // 7. Tools: Survey Live Stream (SSE)
  async getSurveyForms(req, res) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const data = await SurveyService.listAvailableSurveys({ token });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Survey forms error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải danh sách khảo sát.' });
    }
  },

  async streamSurvey(req, res) {
    const { token, mssv, ratingLevel, genderLevel, attendanceLevel } = req.query;
    let selectedSurveys = null;
    let courseRatings = null;
    try {
      if (req.query.selected) selectedSurveys = JSON.parse(req.query.selected);
      if (req.query.courseRatings) courseRatings = JSON.parse(req.query.courseRatings);
    } catch {
      selectedSurveys = null;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    // CDN/WAF có thể nén hoặc đệm luồng streaming; giữ nguyên byte để log
    // tiến độ hiện ra tức thời thay vì dồn thành từng cục.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await SurveyService.runAutoSurvey({
        token,
        mssv,
        ratingLevel: ratingLevel || '5',
        genderLevel: genderLevel || '0',
        attendanceLevel: attendanceLevel || '1',
        courseRatings: courseRatings || {},
        selectedSurveys,
        onLog: (logData) => {
          sendEvent({ type: 'log', logType: logData.type, message: logData.message, timestamp: logData.timestamp });
        },
        onCourseDone: (courseData) => {
          sendEvent({ type: 'course_done', ...courseData });
        }
      });
      sendEvent({ type: result.success ? 'done' : 'error', message: result.message, result });
      res.end();
    } catch (err) {
      sendEvent({ type: 'error', message: err.message || 'Lỗi khi thực hiện khảo sát.' });
      res.end();
    }
  },

  // Survey runs are created with an authenticated POST. SSE only observes an
  // existing run, so reconnecting a stream can never submit a survey twice.
  async startSurveyRun(req, res) {
    try {
      const authorization = req.headers.authorization || '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : authorization.trim();
      const mssv = await BduIdentityService.resolveVerifiedMssv(authorization);
      const { run, reused } = SurveyRunService.start({
        mssv,
        token,
        options: {
          ratingLevel: req.body?.ratingLevel || '5',
          genderLevel: req.body?.genderLevel || '0',
          attendanceLevel: req.body?.attendanceLevel || '1',
          courseRatings: req.body?.courseRatings && typeof req.body.courseRatings === 'object' ? req.body.courseRatings : {},
          selectedSurveys: Array.isArray(req.body?.selectedSurveys) ? req.body.selectedSurveys : null
        }
      });
      return res.status(reused ? 200 : 202).json({ result: true, data: { ...run, reused } });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể khởi chạy khảo sát.'
      });
    }
  },

  async getSurveyRun(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      const run = SurveyRunService.getForStudent(req.params.runId, mssv);
      if (!run) return res.status(404).json({ result: false, message: 'Không tìm thấy lượt khảo sát hoặc lượt này đã hết hạn.' });
      return res.json({ result: true, data: run });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể kiểm tra trạng thái khảo sát.' });
    }
  },

  async streamSurveyRun(req, res) {
    // EventSource cannot attach Authorization. A random, short-lived run ID is
    // therefore the stream capability; status reads remain bearer-protected.
    if (!SurveyRunService.hasRun(req.params.runId)) {
      return res.status(404).json({ result: false, message: 'Không tìm thấy lượt khảo sát hoặc lượt này đã hết hạn.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');

    const write = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = SurveyRunService.subscribe(req.params.runId, write);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },

  // 8. Tools: Moodle English exercise automation
  async loginEnglish(req, res) {
    try {
      return res.json({ result: true, data: await EnglishExerciseService.login(req.body || {}) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  async getEnglishCourses(req, res) {
    try {
      const data = await EnglishExerciseService.courses(req.params.sessionId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  async getEnglishActivities(req, res) {
    try {
      const data = await EnglishExerciseService.activities(req.params.sessionId, req.query.courseId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  startEnglishExercise(req, res) {
    try {
      const data = EnglishExerciseService.start(req.params.sessionId, req.body || {});
      return res.status(202).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  startEnglishCourseFinish(req, res) {
    try {
      const data = EnglishExerciseService.startFinish(req.params.sessionId, req.body || {});
      return res.status(202).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  stopEnglishExercise(req, res) {
    try {
      return res.json({ result: true, stopped: EnglishExerciseService.stop(req.params.sessionId) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  closeEnglishSession(req, res) {
    return res.json({ result: true, closed: EnglishExerciseService.close(req.params.sessionId) });
  },

  streamEnglishExercise(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    res.flushHeaders();
    try {
      const unsubscribe = EnglishExerciseService.subscribe(req.params.sessionId, res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
          if (typeof res.flush === 'function') res.flush();
        } catch {}
      }, 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  },

  getEnglishAnswers(req, res) {
    return res.json({ result: true, data: EnglishExerciseService.listAnswers() });
  },

  addEnglishAnswer(req, res) {
    try {
      const data = EnglishExerciseService.addAnswer(req.body?.question, req.body?.correctAnswer);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  deleteEnglishAnswer(req, res) {
    return res.json({ result: true, deleted: EnglishExerciseService.deleteAnswer(req.params.id) });
  },

  // 9. Learning Hub: Catalog
  async getLearningResources(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      let data = await LearningService.getStudentCourses(mssv);

      // Hỗ trợ truy cập thẳng vào tab kho học tập sau khi server vừa khởi động:
      // nếu chưa từng đồng bộ, lấy lại dữ liệu thật từ BDU thay vì trả môn mẫu.
      if (!data.synced_at) {
        const grades = await BduService.getGrades(authHeader);
        await LearningService.syncStudentCourses(mssv, grades);
        data = await LearningService.getStudentCourses(mssv);
      }
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải kho học tập theo môn.'
      });
    }
  },

  async getCourseLearningPosts(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.getCoursePosts(mssv, req.params.courseCode);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải không gian môn học.'
      });
    }
  },

  async createCourseLearningPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const post = await LearningService.createCoursePost(
        mssv,
        req.params.courseCode,
        req.body || {}
      );
      CommunityRealtime.publishCoursePostCreated({
        postId: post.id,
        courseCode: req.params.courseCode,
        category: post.kind || 'request'
      });
      return res.status(201).json({ result: true, data: post });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể đăng nội dung cho môn học.'
      });
    }
  },

  async deleteCourseLearningPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.deleteCoursePost(mssv, req.params.courseCode, req.params.postId);
      CommunityRealtime.publishCoursePostDeleted({
        postId: req.params.postId,
        courseCode: req.params.courseCode
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể xóa bài viết.'
      });
    }
  },

  async toggleCourseLearningPostLike(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.toggleCoursePostLike(mssv, req.params.courseCode, req.params.postId);
      CommunityRealtime.publishCoursePostLikeChanged({
        postId: req.params.postId,
        courseCode: req.params.courseCode,
        likeCount: data.like_count
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật lượt thích.'
      });
    }
  },

  async getCourseLearningPostComments(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.getCoursePostComments(mssv, req.params.courseCode, req.params.postId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bình luận.'
      });
    }
  },

  async addCourseLearningPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.addCoursePostComment(
        mssv,
        req.params.courseCode,
        req.params.postId,
        req.body || {}
      );
      const metadata = await LearningService.getCoursePostRealtimeMetadata(
        mssv,
        req.params.courseCode,
        req.params.postId
      );
      CommunityRealtime.publishCourseCommentChanged({
        type: 'created',
        postId: metadata.postId,
        commentId: data?.id,
        parentId: data?.parent_id,
        commentCount: metadata.commentCount,
        courseCode: metadata.courseCode
      });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể gửi bình luận.'
      });
    }
  },

  async getMyIdentityPresentation(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.getPresentation(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh hiệu hiển thị.'
      });
    }
  },

  // Catalog khung cho site độc lập /games: cần đăng nhập nhưng không cần quyền admin.
  async getIdentityFrames(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const frames = await IdentityPresentationService.listFrameCatalog();
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.json({ result: true, data: { frames } });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        code: err.code || 'IDENTITY_FRAMES_FAILED',
        message: err.message || 'Không thể tải danh sách khung.'
      });
    }
  },

  /**
   * Hồ sơ công khai của một sinh viên (mở từ tag @MSSV trong Confession):
   * presentation (tên, avatar, khung, danh hiệu, clan) + học lực tích lũy
   * (GPA hệ 10/4, tín chỉ đạt, xếp loại) kèm thứ hạng nổi bật.
   */
  async getStudentProfile(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const mssv = String(req.params.mssv || '').trim().toUpperCase();
      if (!mssv) {
        return res.status(400).json({ result: false, message: 'Thiếu MSSV cần xem hồ sơ.' });
      }
      const presentation = await IdentityPresentationService.getPresentation(mssv);
      let snapshot = await AcademicSnapshotService.getSnapshot(mssv).catch(() => null);
      // Chính chủ mở hồ sơ mà chưa có snapshot (user cũ chưa đăng nhập lại):
      // chụp ngay từ payload điểm BDU đang có token, để GPA hệ 10 không trống.
      if (!snapshot && requesterMssv === mssv) {
        try {
          const grades = await BduService.getGrades(req.headers.authorization);
          snapshot = await AcademicSnapshotService.saveFromGrades(mssv, grades, { source: 'profile_view' });
        } catch (snapshotError) {
          console.warn('[AcademicSnapshot] Không thể chụp học lực khi mở hồ sơ:', snapshotError.message);
        }
      }
      const ranking = AcademicRankingService.hasDatabase()
        ? await AcademicRankingService.getLatestByMssv(mssv).catch(() => null)
        : null;
      const toNumberOrNull = (value) => {
        const number = Number(value);
        return value === null || value === undefined || !Number.isFinite(number) ? null : number;
      };
      const academic = {
        gpa_10: toNumberOrNull(snapshot?.gpa_10),
        gpa_4: toNumberOrNull(snapshot?.gpa_4) ?? toNumberOrNull(ranking?.gpa_tich_luy_he_4),
        earned_credits: toNumberOrNull(snapshot?.earned_credits) ?? toNumberOrNull(ranking?.tin_chi_dat_tich_luy),
        classification: snapshot?.classification || ranking?.xep_loai_tich_luy || null,
        semester_code: snapshot?.semester_code || ranking?.nkhk || null,
        updated_at: snapshot?.updated_at || ranking?.dong_bo_luc || null,
        source: snapshot ? 'snapshot' : (ranking ? 'ranking' : null),
        rank_gpa: ranking?.xep_hang_noi_bat?.gpa_tich_luy || null,
        rank_credits: ranking?.xep_hang_noi_bat?.tin_chi_tich_luy || null
      };
      return res.json({ result: true, data: { ...presentation, academic } });
    } catch (err) {
      console.error('Get student profile error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải hồ sơ sinh viên.'
      });
    }
  },

  async updateMyIdentityPresentation(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.updateSelectedTitles(
        mssv,
        req.body?.selectedTitleIds
      );
      CommunityRealtime.publishIdentityChanged(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật danh hiệu hiển thị.'
      });
    }
  },

  async updateMyEquippedFrame(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.updateEquippedFrame(mssv, req.body?.frameId);
      CommunityRealtime.publishIdentityChanged(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update equipped frame error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật khung hiển thị.'
      });
    }
  },

  async requireIdentityAdmin(req, res, next) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      req.identityAdminMssv = actor;
      return next();
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không có quyền quản trị.' });
    }
  },

  async requireCommunityModerator(req, res, next) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await PermissionService.require(actor, 'community:mod_access', 'Bạn không có quyền kiểm duyệt bảng tin.');
      req.communityModeratorMssv = actor;
      return next();
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không có quyền kiểm duyệt.' });
    }
  },

  async getFacebookImportStatus(req, res) {
    return res.json({ result: true, data: FacebookImportService.getStatus() });
  },

  async runFacebookImport(req, res) {
    try {
      const data = await FacebookImportService.runOnce({ trigger: req.communityModeratorMssv || 'admin' });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Facebook import error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể kéo bài viết từ Facebook.'
      });
    }
  },

  async getAdminIdentityItems(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listItems({
        type: req.query.type,
        includeInactive: req.query.includeInactive === 'true'
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải catalog quyền hiển thị.' });
    }
  },

  async createAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.createItem({ ...req.body, actorMssv: actor });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Create identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tạo item mới.' });
    }
  },

  async updateAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.updateItem({ ...req.body, id: req.params.id, actorMssv: actor });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cập nhật item.' });
    }
  },

  async deleteAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.deleteItem({ id: req.params.id, actorMssv: actor, reason: req.body?.reason });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể xóa item.' });
    }
  },

  async getAdminIdentityGrants(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listGrants(req.params.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải grant.' });
    }
  },

  async createAdminIdentityGrant(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.grant({
        ...req.body,
        actorMssv: actor
      });
      CommunityRealtime.publishIdentityChanged(data.mssv);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Create identity grant error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cấp quyền hiển thị.' });
    }
  },

  async revokeAdminIdentityGrant(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.revoke({
        grantId: req.params.grantId,
        actorMssv: actor,
        reason: req.body?.reason
      });
      CommunityRealtime.publishIdentityChanged(data.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Revoke identity grant error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể thu hồi quyền hiển thị.' });
    }
  },

  async getAdminIdentityAudit(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listAudit({ mssv: req.query.mssv, limit: req.query.limit });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải audit log.' });
    }
  },

  async grantAdminSystemRole(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.grantRole({ ...req.body, actorMssv: actor });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cấp role quản trị.' });
    }
  },

  async revokeAdminSystemRole(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.revokeRole({
        mssv: req.params.mssv,
        role: req.params.role,
        actorMssv: actor
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể thu hồi role quản trị.' });
    }
  },

  async getAdminAvatars(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await AvatarOverrideService.list({ search: req.query.search, limit: req.query.limit });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải danh sách avatar.' });
    }
  },

  async getAdminAvatar(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await AvatarOverrideService.getByMssv(req.params.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải avatar sinh viên.' });
    }
  },

  async uploadAdminAvatar(req, res) {
    try {
      const actor = req.identityAdminMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await AvatarOverrideService.upload({
        mssv: req.params.mssv,
        actorMssv: actor,
        file: req.file
      });
      CommunityRealtime.publishIdentityChanged(data.mssv, {
        avatarUrl: data.resolved_url,
        avatarSource: data.source
      });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Upload avatar override error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cập nhật ảnh đại diện.' });
    }
  },

  async deleteAdminAvatar(req, res) {
    try {
      const actor = req.identityAdminMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await AvatarOverrideService.remove({ mssv: req.params.mssv, actorMssv: actor });
      CommunityRealtime.publishIdentityChanged(data.mssv, {
        avatarUrl: data.resolved_url,
        avatarSource: data.source
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete avatar override error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể gỡ ảnh đại diện.' });
    }
  },

  // 10. System: Queue Status & Metrics
  getQueueStatus(req, res) {
    return res.json({
      result: true,
      timestamp: new Date().toISOString(),
      wordFmtQueue: WordFmtService.getQueueStats(),
      communityRealtime: CommunityRealtime.getStatus()
    });
  },

  // 10a. System: deployed build id for the "có bản mới" client banner
  getVersion(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ result: true, build_id: resolveBuildId() });
  },

  // 10b. Entertainment games: database-backed rooms + server-authoritative moves
  getEntertainmentGames(req, res) {
    return res.json({
      result: true,
      data: {
        games: EntertainmentGameInternals.PUBLIC_GAME_METAS.map((game) => ({
          id: game.id,
          label: game.label,
          tagline: game.tagline || '',
          players: game.players || 2,
          clock: game.clock !== false,
          order: game.order || 0
        })),
        realtime: { websocket_path: '/ws/community', room_prefix: 'game:' }
      }
    });
  },

  async listEntertainmentRooms(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      const data = await EntertainmentGameService.listRooms({
        mssv,
        gameType: req.query.gameType || req.query.game_type,
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LIST_FAILED', message: err.message || 'Không thể tải danh sách phòng.' });
    }
  },

  async createEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.createRoom({
        mssv,
        gameType: req.body?.gameType || req.body?.game_type,
        visibility: req.body?.visibility,
        name: req.body?.name,
        allowSpectators: req.body?.allowSpectators ?? req.body?.allow_spectators,
        allowChat: req.body?.allowChat ?? req.body?.allow_chat,
        turnSeconds: req.body?.turnSeconds ?? req.body?.turn_seconds,
        ttlSeconds: req.body?.ttlSeconds || req.body?.ttl_seconds
      });
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_CREATE_FAILED', message: err.message || 'Không thể tạo phòng.' });
    }
  },

  async getEntertainmentRoom(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      // Không cần tham số role: service tự xác định người chơi hay khán giả theo mssv.
      const data = await EntertainmentGameService.getRoom(req.params.roomRef, { mssv });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LOAD_FAILED', message: err.message || 'Không thể tải phòng.' });
    }
  },

  async joinEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.joinRoom(req.params.roomRef, mssv);
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_JOIN_FAILED', message: err.message || 'Không thể tham gia phòng.' });
    }
  },

  async leaveEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.leaveRoom(req.params.roomRef, mssv);
      // State trả cho người vừa rời cũng phải che theo ghế (battleship).
      const safeData = data.state ? { ...data, state: viewerStateFor(data.game_type, data.state, data.seat) } : data;
      if (data.deleted) {
        CommunityRealtime.publishGameRoomClosed(data.room_code, {
          reason: 'player_left',
          actor: mssv,
          message: 'Người tạo phòng đã rời đi. Phòng đã tự động đóng.'
        });
      } else if (data.forfeited) {
        CommunityRealtime.publishGameForfeited(data);
        CommunityRealtime.publishGameRoomUpdated({ room_code: data.room_code, status: 'finished', state_version: data.state_version, players: null });
      }
      return res.json({ result: true, data: safeData });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'ROOM_LEAVE_FAILED', message: err.message || 'Không thể rời phòng.' });
    }
  },

  async rematchEntertainmentRoom(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.requestRematch(req.params.roomRef, mssv);
      if (data.ready) {
        CommunityRealtime.publishGameRematchStarted(data.room_code, data);
      } else {
        CommunityRealtime.publishGameRematchRequested(data.room_code, data);
      }
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'REMATCH_FAILED', message: err.message || 'Không thể gửi yêu cầu đánh lại.' });
    }
  },

  async makeEntertainmentMove(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.makeMove(req.params.roomRef, mssv, req.body?.move || req.body, {
        clientMoveId: req.body?.clientMoveId || req.body?.client_move_id
      });
      // Broadcast state đầy đủ (đã che theo từng client trong gateway), còn phản hồi
      // HTTP cho người đi chỉ chứa state theo góc nhìn của chính họ.
      CommunityRealtime.publishGameMove(data);
      return res.json({
        result: true,
        data: {
          ...data,
          state: viewerStateFor(data.game_type, data.state, data.seat)
        }
      });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'MOVE_REJECTED', message: err.message || 'Nước đi không được chấp nhận.' });
    }
  },

  async listEntertainmentMoves(req, res) {
    try {
      let mssv = null;
      if (req.headers.authorization) {
        try { mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization); } catch {}
      }
      const data = await EntertainmentGameService.listMoves(req.params.roomRef, { after: req.query.after, limit: req.query.limit, mssv });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'MOVE_HISTORY_FAILED', message: err.message || 'Không thể tải lịch sử nước đi.' });
    }
  },

  async createEntertainmentChallenge(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.createChallenge(req.params.roomRef, mssv, {
        challengedMssv: req.body?.challengedMssv || req.body?.challenged_mssv,
        expiresInSeconds: req.body?.expiresInSeconds || req.body?.expires_in_seconds,
        postToConfession: req.body?.postToConfession ?? req.body?.post_to_confession,
        confessionAnonymous: req.body?.confessionAnonymous ?? req.body?.confession_anonymous
      });
      CommunityRealtime.publishGameChallengeCreated(data);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_CREATE_FAILED', message: err.message || 'Không thể tạo challenge.' });
    }
  },

  async acceptEntertainmentChallenge(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await EntertainmentGameService.acceptChallenge(req.params.challengeId, mssv, req.body?.inviteCode || req.body?.code || req.query?.code);
      CommunityRealtime.publishGameRoomUpdated(data);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_ACCEPT_FAILED', message: err.message || 'Không thể nhận challenge.' });
    }
  },

  async getEntertainmentChallenge(req, res) {
    try {
      const data = await EntertainmentGameService.getChallenge(req.params.challengeId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, code: err.code || 'CHALLENGE_LOAD_FAILED', message: err.message || 'Không thể tải challenge.' });
    }
  },

  // 11. Góc Tự Học Số (Community Hub) & CLB
  async getCommunityPosts(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      const filter = String(req.query.filter || 'all').trim().toLowerCase();
      const validFilters = ['all', 'mine', 'anon', 'pinned', 'announcement', 'material', 'poll', 'discussion'];
      if (!validFilters.includes(filter)) {
        return res.status(400).json({ result: false, message: 'Bộ lọc bài viết không hợp lệ.' });
      }
      if (filter === 'mine') {
        viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      } else if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const { scope, scopeId, limit, offset, category, hasAttachments, isPinned } = req.query;
      if (scope === 'clan' && !viewerMssv) {
        return res.status(401).json({ result: false, message: 'Vui lòng đăng nhập để xem bài viết CLB.' });
      }
      const data = await CommunityService.getPosts({
        scope,
        scopeId,
        viewerMssv,
        authorMssv: filter === 'mine' ? viewerMssv : null,
        isAnonymous: filter === 'anon' ? true : null,
        category: filter === 'announcement' ? 'announcement' : (filter === 'poll' ? 'poll' : (filter === 'discussion' ? 'discussion' : (category || null))),
        hasAttachments: filter === 'material' ? true : (hasAttachments === 'true' ? true : null),
        isPinned: filter === 'pinned' ? true : (isPinned !== undefined ? isPinned : null),
        limit,
        offset
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get community posts error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách bài viết.'
      });
    }
  },

  async getCommunityPost(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const post = await CommunityService.getPostById(req.params.id, viewerMssv);
      if (!post) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy bài viết.' });
      }
      if (post.scope === 'clan' && !viewerMssv) {
        return res.status(401).json({ result: false, message: 'Vui lòng đăng nhập để xem bài viết CLB.' });
      }
      return res.json({ result: true, data: post });
    } catch (err) {
      console.error('Get community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bài viết.'
      });
    }
  },

  async createCommunityPost(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { title, content, scope, scopeId, isAnonymous, attachments, category, isPinned, poll } = req.body || {};
      const post = await CommunityService.createPost({
        authorMssv: mssv,
        title,
        content,
        scope,
        scopeId,
        isAnonymous,
        attachments,
        category,
        isPinned,
        poll
      });
      CommunityRealtime.publishPostCreated(post);
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncPostMentions(null, {
            postId: post.id,
            content: `${title || ''}\n${content || ''}`,
            actorMssv: mssv,
            isAnonymous: Boolean(post?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.status(201).json({ result: true, data: post });
    } catch (err) {
      console.error('Create community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tạo bài viết.'
      });
    }
  },

  async deleteCommunityPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.deletePost(req.params.id, mssv);
      CommunityRealtime.publishPostDeleted(data);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể xóa bài viết.'
      });
    }
  },

  async updateCommunityPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { title, content, isAnonymous, attachments } = req.body || {};
      const data = await CommunityService.updatePost({
        postId: req.params.id,
        requesterMssv: mssv,
        title,
        content,
        isAnonymous,
        attachments
      });
      CommunityRealtime.publishPostUpdated(data);
      if (data?.category === 'confession' && (title !== undefined || content !== undefined)
        && typeof data?.content === 'string') {
        try {
          const created = await MentionService.syncPostMentions(null, {
            postId: data.id,
            content: `${data.title || ''}\n${data.content || ''}`,
            actorMssv: mssv,
            isAnonymous: Boolean(data?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể chỉnh sửa bài viết.'
      });
    }
  },

  async toggleClanPostPin(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.togglePinPost(req.params.id, mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Toggle clan post pin error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể ghim bài viết.'
      });
    }
  },

  async getClanDocuments(req, res) {
    try {
      const viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      res.setHeader('Cache-Control', 'private, no-store');
      const { type, search, limit, offset } = req.query;
      const data = await CommunityService.getClanDocuments(req.params.id, {
        type,
        search,
        limit,
        offset,
        viewerMssv
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get clan documents error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải kho tài liệu CLB.'
      });
    }
  },

  async voteClanPoll(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { pollId } = req.params;
      const { optionId } = req.body || {};
      const data = await CommunityService.voteClanPoll(pollId, optionId, mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Vote clan poll error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể thực hiện bình chọn.'
      });
    }
  },

  async toggleCommunityPostLike(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const data = await CommunityService.toggleLike(req.params.id, mssv);
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishPostLikeChanged({
        postId: req.params.id,
        likeCount: data.like_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Toggle like error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tương tác like.'
      });
    }
  },

  async getCommunityPostComments(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const data = await CommunityService.getComments(req.params.id, viewerMssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get comments error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bình luận.'
      });
    }
  },

  async addCommunityPostComment(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { content, parentId, isAnonymous } = req.body || {};
      const comment = await CommunityService.addComment({
        postId: req.params.id,
        authorMssv: mssv,
        content,
        parentId,
        isAnonymous
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'created',
        postId: req.params.id,
        commentId: comment?.id,
        parentId: comment?.parent_id,
        commentCount: comment?.comment_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncCommentMentions(null, {
            postId: req.params.id,
            commentId: comment?.id,
            content,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          const reply = await MentionService.createReplyNotification(null, {
            postId: req.params.id,
            commentId: comment?.id,
            parentId: comment?.parent_id,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          publishMentionNotifications([...created, ...(reply ? [reply] : [])]);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.status(201).json({ result: true, data: comment });
    } catch (err) {
      console.error('Add comment error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể thêm bình luận.'
      });
    }
  },

  async editCommunityPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const comment = await CommunityService.editComment({
        postId: req.params.id,
        commentId: req.params.commentId,
        requesterMssv: mssv,
        content: req.body?.content
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'updated',
        postId: req.params.id,
        commentId: comment?.id,
        parentId: comment?.parent_id,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncCommentMentions(null, {
            postId: req.params.id,
            commentId: comment?.id,
            content: req.body?.content,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.json({ result: true, data: comment });
    } catch (err) {
      console.error('Edit comment error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể sửa bình luận.' });
    }
  },

  async deleteCommunityPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.deleteComment({
        postId: req.params.id,
        commentId: req.params.commentId,
        requesterMssv: mssv,
        reason: req.body?.reason
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'deleted',
        postId: req.params.id,
        commentId: req.params.commentId,
        commentCount: data.comment_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete comment error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể xóa bình luận.' });
    }
  },

  async searchActiveStudents(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await StudentService.searchActiveStudents(req.query?.q, req.query?.limit);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Search active students error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tìm kiếm sinh viên.'
      });
    }
  },

  async getNotifications(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { limit, offset } = req.query || {};
      const { items, total, limit: safeLimit, offset: safeOffset } = await NotificationService.listNotifications(mssv, { limit, offset });
      return res.json({ result: true, data: items, total, limit: safeLimit, offset: safeOffset });
    } catch (err) {
      console.error('Get notifications error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải thông báo.'
      });
    }
  },

  async getUnreadNotificationCount(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const unread = await NotificationService.getUnreadCount(mssv);
      return res.json({ result: true, data: { unread } });
    } catch (err) {
      console.error('Get unread notification count error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải số thông báo chưa đọc.'
      });
    }
  },

  async markNotificationRead(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await NotificationService.markRead(mssv, req.params.id);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Mark notification read error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể đánh dấu đã đọc.'
      });
    }
  },

  async markAllNotificationsRead(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await NotificationService.markAllRead(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Mark all notifications read error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể đánh dấu đã đọc tất cả.'
      });
    }
  },

  // 11b. Nhắc lịch học opt-in (Email/Discord). Mặc định TẮT.
  async getReminderPrefs(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      return res.json({
        result: true,
        data: prefs ? {
          consented: NotificationPrefsService.isConsented(prefs),
          notify_email: prefs.notify_email,
          notify_discord: prefs.notify_discord,
          email: prefs.email,
          email_verified_at: prefs.email_verified_at,
          discord_linked: Boolean(prefs.discord_user_id && prefs.discord_verified_at),
          discord_username: prefs.discord_username || null,
          discord_verified_at: prefs.discord_verified_at,
          discord_dm_blocked: Boolean(prefs.discord_dm_blocked_at),
          discord_invite_url: process.env.DISCORD_INVITE_URL || null,
          remind_offsets: prefs.remind_offsets
        } : { consented: false }
      });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  async consentReminders(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { xac_nhan } = req.body || {};
      const prefs = await NotificationPrefsService.consent(mssv, { xac_nhan });
      // Snapshot ngay bằng token hiện tại để bot có dữ liệu tức thì.
      const token = req.headers.authorization || req.body?.token || '';
      if (token) {
        ScheduleSnapshotService.syncFromToken(mssv, token).catch((err) =>
          console.warn('[ScheduleSnapshot] consent sync fail:', err.message));
        TokenVaultService.save(mssv, String(token).replace(/^Bearer\s+/i, ''), null).catch(() => {});
      }
      return res.json({ result: true, data: { consented: true, consent_at: prefs.consent_at } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  async revokeReminders(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await NotificationPrefsService.revoke(mssv);
      return res.json({ result: true, data: { consented: false } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  async createDiscordLinkCode(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      const data = await DiscordLinkService.createCode(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // Discord OAuth 1-click: frontend lấy URL rồi mở popup Authorize.
  async createDiscordOAuthUrl(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      const data = await DiscordOAuthService.createAuthUrl(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // Trang /discord-callback gọi sau khi Discord redirect về kèm ?code&state.
  async completeDiscordOAuth(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { state, code } = req.body || {};
      const data = await DiscordOAuthService.complete({ mssv, state, code });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // Gỡ liên kết Discord để đổi tài khoản. Giữ consent + snapshot lịch.
  async unlinkDiscordLink(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await NotificationPrefsService.unlinkDiscord(mssv);
      return res.json({ result: true, data: { linked: false } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // Bắn 1 tin DM thử để kiểm tra kênh (dùng sau khi user mở kênh DM/server).
  async sendDiscordTest(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      if (!prefs?.discord_user_id) {
        return res.status(400).json({ result: false, message: 'Bạn chưa liên kết Discord.' });
      }
      await query(`
        INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
        VALUES ($1, 'discord', 'welcome', $2, 0, NOW(), $3, 'pending')
        ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING;
      `, [
        mssv,
        `test:${Date.now()}`,
        JSON.stringify({ text: '🔔 Tin thử nè! Thấy tin này là kênh nhận tin của bạn đã mở, từ giờ bot sẽ nhắc ở đây nhé.' }).slice(0, 1000)
      ]);
      return res.json({ result: true, data: { queued: true } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message });
    }
  },

  // 12. CLB / Nhóm Học Tập (Clans & Guilds)
  async getClans(req, res) {
    try {
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const [clans, canCreate] = await Promise.all([
        StudentService.listClans(viewerMssv),
        viewerMssv ? StudentService.canCreateClan(viewerMssv) : Promise.resolve(false)
      ]);
      return res.json({ result: true, data: clans, can_create_clan: canCreate });
    } catch (err) {
      console.error('Get clans error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách CLB / Nhóm.'
      });
    }
  },

  async createClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const canCreate = await StudentService.canCreateClan(mssv);
      if (!canCreate) {
        return res.status(403).json({
          result: false,
          message: 'Chỉ những thành viên có danh hiệu #TTCDS mới được phép tạo CLB / Nhóm.'
        });
      }

      const { code, name, tag, description, avatarUrl } = req.body || {};
      const clan = await StudentService.createClan({
        code,
        name,
        tag,
        description,
        avatarUrl,
        leaderMssv: mssv,
        enforcePermission: true
      });
      return res.status(201).json({ result: true, data: clan });
    } catch (err) {
      console.error('Create clan error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tạo CLB / Nhóm.'
      });
    }
  },

  async joinClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.requestJoinClan(mssv, req.params.id, req.body?.message, req.body?.answers);
      return res.json({
        result: true,
        data: result,
        status: result.status,
        message: result.status === 'approved'
          ? 'Bạn đã vượt qua quiz và được tự động duyệt vào CLB.'
          : 'Yêu cầu tham gia đã được gửi tới Trưởng CLB và đang chờ phê duyệt.'
      });
    } catch (err) {
      console.error('Join clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể gửi yêu cầu tham gia CLB / Nhóm.'
      });
    }
  },

  async getClanJoinRequests(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const requests = await StudentService.getPendingJoinRequests(req.params.id, requesterMssv);
      return res.json({ result: true, data: requests });
    } catch (err) {
      console.error('Get clan join requests error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể tải danh sách yêu cầu gia nhập.'
      });
    }
  },

  async reviewClanJoinRequest(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const reviewerMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { action } = req.body || {};
      const result = await StudentService.reviewJoinRequest(req.params.id, reviewerMssv, req.params.requestId, action);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Review clan join request error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể xử lý yêu cầu gia nhập.'
      });
    }
  },

  async cancelClanJoinRequest(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const success = await StudentService.cancelJoinRequest(mssv, req.params.id);
      return res.json({ result: true, cancelled: success });
    } catch (err) {
      console.error('Cancel clan join request error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể hủy yêu cầu gia nhập.'
      });
    }
  },

  async leaveClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const success = await StudentService.leaveClan(mssv, req.params.id);
      return res.json({ result: true, left: success });
    } catch (err) {
      console.error('Leave clan error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể rời CLB / Nhóm.'
      });
    }
  },

  async getClanMembers(req, res) {
    try {
      const members = await StudentService.getClanMembers(req.params.id);
      return res.json({ result: true, data: members });
    } catch (err) {
      console.error('Get clan members error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách thành viên.'
      });
    }
  },

  async updateClanMemberRole(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { role } = req.body || {};
      const result = await StudentService.updateMemberRole(req.params.id, requesterMssv, req.params.mssv, role);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Update clan member role error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật quyền thành viên.'
      });
    }
  },

  async kickClanMember(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.kickMember(req.params.id, requesterMssv, req.params.mssv);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Kick clan member error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể mời thành viên ra khỏi nhóm.'
      });
    }
  },

  async updateClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const clan = await StudentService.updateClanInfo(req.params.id, requesterMssv, req.body || {});
      return res.json({ result: true, data: clan });
    } catch (err) {
      console.error('Update clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật thông tin CLB.'
      });
    }
  },

  async getClanQuiz(req, res) {
    try {
      const quiz = await getClanQuiz(req.params.id);
      return res.json({ result: true, data: quiz });
    } catch (err) {
      console.error('Get clan quiz error:', err.message);
      return res.status(err.status || 500).json({ result: false, code: err.code, message: err.message || 'Không thể tải quiz CLB.' });
    }
  },

  async getClanRoles(req, res) {
    try {
      if (req.headers.authorization) {
        try {
          await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const data = await ClanRoleService.getRoleLabels(req.params.id);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get clan roles error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải tên chức danh CLB.'
      });
    }
  },

  async updateClanRoles(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const roles = Array.isArray(req.body) ? req.body : (req.body?.roles ?? []);
      const data = await ClanRoleService.updateRoleLabels(req.params.id, mssv, roles);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update clan roles error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật tên chức danh CLB.'
      });
    }
  },

  async updateClanQuiz(req, res) {
    try {
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const quiz = await saveClanQuiz(req.params.id, requesterMssv, req.body || {});
      return res.json({ result: true, data: quiz });
    } catch (err) {
      console.error('Update clan quiz error:', err.message);
      return res.status(err.status || 400).json({ result: false, code: err.code, message: err.message || 'Không thể lưu cấu hình quiz CLB.' });
    }
  },

  async disbandClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.disbandClan(req.params.id, requesterMssv);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Disband clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể giải tán CLB.'
      });
    }
  },

  // 10. Luyện từ vựng (clone luyentu: Flashcard/Quiz/Typing/Ghép cặp)
  async listVocabThemes(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await VocabService.listThemes();
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách theme luyện từ.'
      });
    }
  },

  async getVocabTheme(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await VocabService.getTheme(req.params.slug, { mssv });
      if (!data) return res.status(404).json({ result: false, message: 'Không tìm thấy theme.' });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('getVocabTheme error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải theme.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async listVocabSets(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await VocabService.listSets(req.params.slug, { mssv });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách bộ từ.'
      });
    }
  },

  async getVocabSet(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await VocabService.getSetInfo(req.params.setId, { mssv });
      if (!data) return res.status(404).json({ result: false, message: 'Không tìm thấy bộ từ.' });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('getVocabSet error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải bộ từ.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async listVocabWords(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { q, status, limit, order } = req.query || {};
      const info = await VocabService.getSetInfo(req.params.setId, { mssv });
      if (!info) return res.status(404).json({ result: false, message: 'Không tìm thấy bộ từ.' });
      const data = await VocabService.listWords(req.params.setId, { q, status, mssv, limit, order });
      return res.json({ result: true, data: { set: info, words: data } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        // Ẩn chi tiết DB (22P02 uuid, 23503 fk...) khỏi client
        console.error('listVocabWords error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải từ vựng.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async saveVocabProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { word_id, status } = req.body || {};
      const data = await VocabService.saveProgress(mssv, word_id, status);
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('saveVocabProgress error:', err.message);
        return res.status(400).json({ result: false, message: 'Không thể lưu tiến độ.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  // 10b. Ôn tập từ vựng theo lịch (Leitner ngày/tuần/tháng)
  async getVocabReviewSummary(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await VocabService.getReviewSummary(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('getVocabReviewSummary error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải lịch ôn tập.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async listVocabReviewWords(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { bucket, limit } = req.query || {};
      const data = await VocabService.listReviewWords(mssv, { bucket, limit });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('listVocabReviewWords error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải từ cần ôn.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async reviewVocabWord(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { word_id, result } = req.body || {};
      const data = await VocabService.reviewWord(mssv, word_id, result);
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('reviewVocabWord error:', err.message);
        return res.status(400).json({ result: false, message: 'Không thể lưu kết quả ôn tập.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  // 10c. Luyện ngữ pháp (clone luyennguphap: lý thuyết + trắc nghiệm/điền từ/sắp xếp + đọc hiểu)
  async listGrammarGroups(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await GrammarService.listGroups({ mssv });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('listGrammarGroups error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải danh sách ngữ pháp.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async getGrammarPath(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await GrammarService.getPath(req.params.pathId, { mssv });
      if (!data) return res.status(404).json({ result: false, message: 'Không tìm thấy lộ trình.' });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('getGrammarPath error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải lộ trình.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async getGrammarLesson(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await GrammarService.getLesson(req.params.lessonId, { mssv });
      if (!data) return res.status(404).json({ result: false, message: 'Không tìm thấy bài học.' });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('getGrammarLesson error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể tải bài học.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async saveGrammarProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { lesson_id, answered, correct, total, completed } = req.body || {};
      const data = await GrammarService.saveProgress(mssv, lesson_id, { answered, correct, total, completed });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('saveGrammarProgress error:', err.message);
        return res.status(400).json({ result: false, message: 'Không thể lưu tiến độ ngữ pháp.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  // 10d. Thông báo cập nhật website qua Discord DM (gửi từ Admin Tool)
  async getAdminBroadcast(req, res) {
    try {
      const [recipients, recent] = await Promise.all([
        BroadcastService.getRecipients(),
        BroadcastService.listRecent(8)
      ]);
      return res.json({ result: true, data: { recipients, recent } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('getAdminBroadcast error:', err.message);
      return res.status(status).json({ result: false, message: err.message || 'Không thể tải thông tin thông báo.' });
    }
  },

  async sendAdminBroadcast(req, res) {
    try {
      const { text, key } = req.body || {};
      const data = await BroadcastService.enqueue({ text, key, actor: req.identityAdminMssv || null });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('sendAdminBroadcast error:', err.message);
      return res.status(status).json({ result: false, message: err.message || 'Không thể gửi thông báo.' });
    }
  }
};
