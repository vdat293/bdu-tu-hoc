/**
 * Module: Grammar (Luyện ngữ pháp)
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { GrammarService } from '../../services/grammar.service.js';
import { allowRequest } from '../../utils/request-rate-limit.js';

export const GrammarController = {
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
    let mssv = null;
    try {
      mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { lesson_id, answered, correct, total, completed, responses, answered_before, correct_before } = req.body || {};
      if (!allowRequest(`grammar-save:${mssv}`, { limit: 240, windowMs: 10 * 60 * 1000 })) {
        return res.status(429).json({ result: false, message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.' });
      }
      const data = await GrammarService.saveProgress(mssv, lesson_id, {
        answered,
        correct,
        total,
        completed,
        responses,
        answered_before,
        correct_before
      });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('saveGrammarProgress error:', err.message, { mssv, lessonId: req.body?.lesson_id });
        return res.status(status).json({ result: false, message: 'Không thể lưu tiến độ ngữ pháp.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async saveGrammarExtraProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { lesson_id, completed, responses, answered_before, correct_before } = req.body || {};
      if (!allowRequest(`grammar-save:${mssv}`, { limit: 240, windowMs: 10 * 60 * 1000 })) {
        return res.status(429).json({ result: false, message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.' });
      }
      const data = await GrammarService.saveExtraProgress(mssv, lesson_id, {
        completed,
        responses,
        answered_before,
        correct_before
      });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('saveGrammarExtraProgress error:', err.message, { lessonId: req.body?.lesson_id });
        return res.status(status).json({ result: false, message: 'Không thể lưu tiến độ luyện thêm.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },

  async checkGrammarAnswer(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { lesson_id, question_id, response } = req.body || {};
      if (!allowRequest(`grammar-check:${mssv}`, { limit: 600, windowMs: 10 * 60 * 1000 })) {
        return res.status(429).json({ result: false, message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.' });
      }
      const data = await GrammarService.checkAnswer(lesson_id, question_id, { response });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('checkGrammarAnswer error:', err.message, { lessonId: req.body?.lesson_id });
        return res.status(500).json({ result: false, message: 'Không thể kiểm tra đáp án.' });
      }
      return res.status(status).json({ result: false, message: err.message });
    }
  },
};
