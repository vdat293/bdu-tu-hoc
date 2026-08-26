/**
 * Main API Controller
 */

import { BduService } from '../services/bdu.service.js';
import { WordFmtService } from '../services/wordfmt.service.js';
import { SurveyService } from '../services/survey.service.js';
import path from 'path';
import fs from 'fs';

export const ApiController = {
  // 1. Auth: Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const data = await BduService.login(username, password);
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

  // 8. Learning Hub: Catalog
  getLearningResources(req, res) {
    try {
      const data = BduService.getLearningResources();
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(500).json({ result: false, message: err.message });
    }
  },

  // 9. System: Queue Status & Metrics
  getQueueStatus(req, res) {
    return res.json({
      result: true,
      timestamp: new Date().toISOString(),
      wordFmtQueue: WordFmtService.getQueueStats()
    });
  }
};
