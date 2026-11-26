import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { allowRequest } from '../../utils/request-rate-limit.js';
import { PracticeBankService } from './practice-bank.service.js';

function sendPracticeError(res, err, fallbackMessage) {
  const status = err.status || 500;
  const body = { result: false, message: status === 500 ? fallbackMessage : (err.message || fallbackMessage) };
  if (err.code) body.code = err.code;
  return res.status(status).json(body);
}

function setPrivateCache(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
}

function rateLimited(res) {
  return res.status(429).json({
    result: false,
    code: 'RATE_LIMITED',
    message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.'
  });
}

export const PracticeBankController = {
  async getPracticeBankSummary(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await PracticeBankService.getSummary(mssv, req.params.courseCode);
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể tải thông tin phòng ôn tập trắc nghiệm.');
    }
  },

  async getPracticeBankQuestions(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await PracticeBankService.getQuestions(mssv, req.params.courseCode, {
        chapter: req.query?.chapter,
        filter: req.query?.filter,
        search: req.query?.search
      });
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể tải danh sách câu hỏi ôn tập.');
    }
  },

  async answerPracticeBankQuestion(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`practice-bank-answer:${mssv}`, { limit: 900, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const data = await PracticeBankService.answerQuestion(
        mssv,
        req.params.courseCode,
        req.params.questionId,
        req.body?.selectedAnswer
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể lưu câu trả lời ôn tập.');
    }
  },

  async togglePracticeBankBookmark(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`practice-bank-bookmark:${mssv}`, { limit: 400, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const data = await PracticeBankService.toggleBookmark(
        mssv,
        req.params.courseCode,
        req.params.questionId,
        req.body?.bookmarked
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể cập nhật đánh dấu câu hỏi.');
    }
  },

  async startPracticeMockExam(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`practice-bank-exam-start:${mssv}`, { limit: 60, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const body = req.body || {};
      const data = await PracticeBankService.startMockExam(mssv, req.params.courseCode, {
        count: body.count,
        chapters: body.chapters
      });
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể tạo đề thi thử.');
    }
  },

  async submitPracticeMockExam(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`practice-bank-exam-submit:${mssv}`, { limit: 60, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const body = req.body || {};
      const data = await PracticeBankService.submitMockExam(mssv, req.params.courseCode, {
        answers: body.answers,
        durationSeconds: body.durationSeconds,
        chapterIndex: body.chapterIndex
      });
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể chấm bài thi thử.');
    }
  },

  async resetPracticeBankProgress(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`practice-bank-reset:${mssv}`, { limit: 60, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const data = await PracticeBankService.resetProgress(mssv, req.params.courseCode, {
        chapter: req.query?.chapter ?? req.body?.chapter,
        keepBookmarks: req.query?.keepBookmarks !== 'false' && req.body?.keepBookmarks !== false
      });
      return res.json({ result: true, data });
    } catch (err) {
      return sendPracticeError(res, err, 'Không thể đặt lại tiến độ ôn tập.');
    }
  }
};
