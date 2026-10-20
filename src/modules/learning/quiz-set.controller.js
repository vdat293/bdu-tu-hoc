import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { QuizSetService } from './quiz-set.service.js';
import { allowRequest } from '../../utils/request-rate-limit.js';

function sendQuizSetError(res, err, fallbackMessage) {
  const status = err.status || 500;
  const body = { result: false, message: err.message || fallbackMessage };
  if (err.code) body.code = err.code;
  if (err.errors) body.errors = err.errors;
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

export const QuizSetController = {
  async listQuizSets(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await QuizSetService.listSets(mssv, req.params.courseCode);
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể tải bộ đề trắc nghiệm.');
    }
  },

  async createQuizSet(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`quiz-set-create:${mssv}`, { limit: 20, windowMs: 60 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const data = await QuizSetService.createSet(
        mssv,
        req.params.courseCode,
        req.body || {}
      );
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể tạo bộ đề trắc nghiệm.');
    }
  },

  async deleteQuizSet(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await QuizSetService.deleteSet(
        mssv,
        req.params.courseCode,
        req.params.setId
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể xóa bộ đề trắc nghiệm.');
    }
  },

  async getQuizSetPart(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await QuizSetService.getPart(
        mssv,
        req.params.courseCode,
        req.params.setId,
        req.params.partIndex,
        req.query?.mode
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể tải phần của bộ đề.');
    }
  },

  async startQuizSetPart(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`quiz-set-start:${mssv}`, { limit: 120, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const body = req.body || {};
      const data = await QuizSetService.startPart(
        mssv,
        req.params.courseCode,
        req.params.setId,
        req.params.partIndex,
        { mode: body.mode, restart: body.restart === true }
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể bắt đầu làm phần trắc nghiệm.');
    }
  },

  async answerQuizSetReview(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`quiz-set-answer:${mssv}`, { limit: 600, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const body = req.body || {};
      const data = await QuizSetService.answerReview(
        mssv,
        req.params.courseCode,
        req.params.setId,
        req.params.partIndex,
        { mode: body.mode, questionId: body.questionId, response: body.response }
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể chấm câu trả lời ôn tập.');
    }
  },

  async saveQuizSetProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      if (!allowRequest(`quiz-set-progress:${mssv}`, { limit: 240, windowMs: 10 * 60 * 1000 })) {
        return rateLimited(res);
      }
      const body = req.body || {};
      const data = await QuizSetService.saveProgress(
        mssv,
        req.params.courseCode,
        req.params.setId,
        req.params.partIndex,
        { mode: body.mode, responses: body.responses, completed: body.completed }
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendQuizSetError(res, err, 'Không thể lưu tiến độ làm bài.');
    }
  }
};
