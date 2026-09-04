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
import { AchievementService } from '../services/achievement.service.js';
import path from 'path';
import fs from 'fs';

export const ApiController = {
  // 1. Auth: Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const data = await BduService.login(username, password);
      BduIdentityService.register(data.token, data.mssv);
      StudentService.recordLogin(data.mssv, data.name).catch((err) => {
        console.error('[StudentService] Lỗi cập nhật trạng thái đăng nhập:', err.message);
      });
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

  // 3. Student: Profile
  async getProfile(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const token = req.body?.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader);
      const idsv = req.query?.IDSV || req.query?.idsv || req.body?.idsv || '';
      const maSV = req.query?.MaSV || req.query?.maSV || req.query?.mssv || req.body?.maSV || req.body?.mssv || req.body?.userName || '';

      if (!token) {
        return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.' });
      }

      const profileData = await BduService.getProfile(token, idsv, maSV);
      try {
        const verifiedMssv = await BduIdentityService.resolveVerifiedMssv(token);
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

      const { instructor, student, studentId, topic, className, documentTitle, frontMatter, profile } = req.body;
      const inputPath = req.file.path;

      const result = await WordFmtService.formatDocx({
        inputPath,
        instructor,
        student,
        studentId,
        topic,
        className,
        documentTitle,
        frontMatter,
        profile
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
  async streamSurvey(req, res) {
    const { token, mssv, ratingLevel } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await SurveyService.runAutoSurvey({
        token,
        mssv,
        ratingLevel: ratingLevel || '5',
        onLog: (logData) => {
          sendEvent({ type: 'log', ...logData });
        }
      });
      sendEvent({ type: 'done', message: 'Toàn bộ tiến trình khảo sát đã kết thúc thành công.' });
      res.end();
    } catch (err) {
      sendEvent({ type: 'error', message: err.message || 'Lỗi khi thực hiện khảo sát.' });
      res.end();
    }
  },

  // 8. Tools: Moodle English exercise automation
  async loginEnglish(req, res) {
    try {
      return res.json({ result: true, data: await EnglishExerciseService.login(req.body || {}) });
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
    res.flushHeaders();
    try {
      const unsubscribe = EnglishExerciseService.subscribe(req.params.sessionId, res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
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

  async updateMyIdentityPresentation(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.updateSelectedTitles(
        mssv,
        req.body?.selectedTitleIds
      );
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật danh hiệu hiển thị.'
      });
    }
  },

  // 10. System: Queue Status & Metrics
  getQueueStatus(req, res) {
    return res.json({
      result: true,
      timestamp: new Date().toISOString(),
      wordFmtQueue: WordFmtService.getQueueStats()
    });
  },

  // 11. Góc Tự Học Số (Community Hub) & CLB
  async getCommunityPosts(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      const filter = String(req.query.filter || 'all').trim().toLowerCase();
      const validFilters = ['all', 'mine', 'anon', 'pinned', 'announcement', 'material'];
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
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể xóa bài viết.'
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
      res.setHeader('Cache-Control', 'private, no-store');
      const { type, search, limit, offset } = req.query;
      const data = await CommunityService.getClanDocuments(req.params.id, {
        type,
        search,
        limit,
        offset
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
      return res.status(201).json({ result: true, data: comment });
    } catch (err) {
      console.error('Add comment error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể thêm bình luận.'
      });
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
      const clans = await StudentService.listClans(viewerMssv);
      return res.json({ result: true, data: clans });
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
      const { code, name, tag, description, avatarUrl } = req.body || {};
      const clan = await StudentService.createClan({
        code,
        name,
        tag,
        description,
        avatarUrl,
        leaderMssv: mssv
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
      const member = await StudentService.joinClan(mssv, req.params.id);
      return res.json({ result: true, data: member });
    } catch (err) {
      console.error('Join clan error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tham gia CLB / Nhóm.'
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
  }
};
