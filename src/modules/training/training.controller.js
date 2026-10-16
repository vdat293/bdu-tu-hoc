/**
 * Module: Training score (điểm rèn luyện BDU)
 *
 * Tự chấm mục 5 rồi lưu lên cổng BDU; tiêu chí 6.16 lấy từ kho sự kiện ODP
 * bằng service account, sinh viên không cần nhập thêm mật khẩu.
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { TrainingScoreService, MUC5_ROLE_OPTIONS } from './training-score.service.js';
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
      const data = await TrainingScoreService.syncCriterion616({ mssv, hocKy: req.body?.hocKy });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err, 'Không thể lấy danh sách sự kiện cho tiêu chí 6.16.') });
    }
  }
};
