/**
 * Main API Controller
 */

import { BduService } from '../services/bdu.service.js';
import { WordFmtService } from '../services/wordfmt.service.js';
import { SurveyService } from '../services/survey.service.js';
import { EnglishExerciseService } from '../services/english-exercise.service.js';
import { AcademicRankingService } from '../services/academic-ranking.service.js';
import { BduIdentityService } from '../services/bdu-identity.service.js';
import path from 'path';
import fs from 'fs';

export const ApiController = {
  // 1. Auth: Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const data = await BduService.login(username, password);
      BduIdentityService.register(data.token, data.mssv);
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
  getLearningResources(req, res) {
    try {
      const data = BduService.getLearningResources();
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(500).json({ result: false, message: err.message });
    }
  },

  // 10. System: Queue Status & Metrics
  getQueueStatus(req, res) {
    return res.json({
      result: true,
      timestamp: new Date().toISOString(),
      wordFmtQueue: WordFmtService.getQueueStats()
    });
  }
};
