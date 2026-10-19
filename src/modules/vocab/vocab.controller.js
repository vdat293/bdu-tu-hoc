/**
 * Module: Vocab (Luyện từ vựng)
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { VocabService } from './vocab.service.js';

export const VocabController = {
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

  async saveVocabProgressBatch(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { items } = req.body || {};
      const data = await VocabService.saveProgressBatch(mssv, items);
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('saveVocabProgressBatch error:', err.message);
        return res.status(500).json({ result: false, message: 'Không thể lưu tiến độ.' });
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
};
