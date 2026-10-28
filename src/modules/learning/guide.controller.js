import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { GuideService } from './guide.service.js';

function sendGuideError(res, err, fallbackMessage) {
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

export const GuideController = {
  async getCourseGuide(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await GuideService.getGuide(mssv, req.params.courseCode);
      return res.json({ result: true, data });
    } catch (err) {
      return sendGuideError(res, err, 'Không thể tải hướng dẫn học tập.');
    }
  },

  async getGuideProgress(req, res) {
    try {
      setPrivateCache(res);
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await GuideService.getProgress(
        mssv,
        req.params.courseCode,
        req.params.lessonId
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendGuideError(res, err, 'Không thể tải tiến độ hướng dẫn.');
    }
  },

  async saveGuideProgress(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const body = req.body || {};
      const data = await GuideService.saveProgress(
        mssv,
        req.params.courseCode,
        req.params.lessonId,
        { stepId: body.stepId, done: body.done, workdir: body.workdir }
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendGuideError(res, err, 'Không thể lưu tiến độ hướng dẫn.');
    }
  }
};
