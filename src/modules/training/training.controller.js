/**
 * Module: Training score (điểm rèn luyện BDU)
 *
 * Tự chấm mục 5 rồi lưu lên cổng BDU, và đồng bộ tiêu chí 6.16 qua app sinh viên.
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { TrainingScoreService, MUC5_ROLE_OPTIONS } from '../../services/training-score.service.js';
import { TrainingCdsCredentialsService } from '../../services/training-cds-credentials.service.js';
import { bearerToken } from '../_shared/bearer-token.js';
import { safeApiErrorMessage } from '../_shared/safe-api-error.js';

export const TrainingController = {
  // 3b. Tools: điểm rèn luyện (DGRL) - tự chấm mục 5 rồi lưu lên cổng BDU.
  async getTrainingSemesters(req, res) {
    try {
      const data = await TrainingScoreService.listSemesters({ token: bearerToken(req) });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể tải danh sách học kỳ điểm rèn luyện.') });
    }
  },

  async getTrainingCriteria(req, res) {
    try {
      const authorization = req.headers.authorization || '';
      const mssv = await BduIdentityService.resolveVerifiedMssv(authorization);
      const { summary, selection } = await TrainingScoreService.getCriteria({
        token: bearerToken(req),
        hocKy: req.query.hocKy,
        mssv
      });
      return res.json({ result: true, data: { summary, selection, roleOptions: MUC5_ROLE_OPTIONS } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể tải tiêu chí điểm rèn luyện.') });
    }
  },

  async submitTrainingScore(req, res) {
    try {
      const authorization = req.headers.authorization || '';
      const mssv = await BduIdentityService.resolveVerifiedMssv(authorization);
      const roles = Array.isArray(req.body?.roles)
        ? req.body.roles.filter((code) => typeof code === 'string')
        : [];
      const result = await TrainingScoreService.autoScore({
        token: bearerToken(req),
        hocKy: req.body?.hocKy,
        mssv,
        roles,
        penalty: Boolean(req.body?.penalty),
        bonus616: req.body?.bonus616,
        ghiChuSv: typeof req.body?.ghiChuSv === 'string' ? req.body.ghiChuSv : undefined
      });
      return res.json({ result: true, data: { summary: result.summary, selection: result.selection } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể lưu điểm rèn luyện.') });
    }
  },

  async syncTraining616(req, res) {
    let mssv;
    try {
      mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
    } catch (err) {
      return res.status(err.status || 401).json({ result: false, message: 'Vui lòng đăng nhập lại cổng BDU.' });
    }
    try {
      const providedPassword = typeof req.body?.cdsPassword === 'string' ? req.body.cdsPassword.trim() : '';
      let password = providedPassword;
      if (!password) password = await TrainingCdsCredentialsService.get(mssv);
      if (!password) throw Object.assign(new Error('Chưa có mật khẩu app sinh viên. Hãy nhập mật khẩu để đồng bộ.'), { status: 400 });

      const data = await TrainingScoreService.syncCriterion616({ mssv, password, hocKy: req.body?.hocKy });

      // Chỉ lưu khi người dùng nhập mật khẩu mới và tích "Lưu đồng bộ".
      const savedSync = Boolean(providedPassword && req.body?.saveSync);
      if (savedSync) await TrainingCdsCredentialsService.save(mssv, providedPassword).catch(() => false);
      return res.json({ result: true, data: { ...data, savedSync } });
    } catch (err) {
      // Sai mật khẩu CDS (401) không phải hết phiên BDU: trả 400 để client hiện lỗi inline.
      const status = err.status === 401 ? 400 : (err.status || 500);
      return res.status(status).json({ result: false, message: safeApiErrorMessage(err, 'Không thể đồng bộ tiêu chí 6.16 từ app sinh viên.') });
    }
  },

  async getTrainingCdsCredentials(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      const saved = await TrainingCdsCredentialsService.has(mssv).catch(() => false);
      return res.json({ result: true, data: { saved } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể kiểm tra đồng bộ app sinh viên.') });
    }
  },

  async deleteTrainingCdsCredentials(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      await TrainingCdsCredentialsService.clear(mssv);
      return res.json({ result: true, data: { saved: false } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể xoá đồng bộ app sinh viên.') });
    }
  }
};
