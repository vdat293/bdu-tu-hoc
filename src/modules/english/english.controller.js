/**
 * Module: English (Moodle exercise automation)
 */

import { EnglishExerciseService } from '../../services/english-exercise.service.js';
import { PermissionService } from '../../services/permission.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { safeApiErrorMessage } from '../_shared/safe-api-error.js';

async function resolveEnglishOwner(req) {
  return BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
}

export const EnglishController = {
  // 8. Tools: Moodle English exercise automation
  async loginEnglish(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      return res.json({ result: true, data: await EnglishExerciseService.login({
        ...(req.body || {}),
        ownerMssv
      }) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async getEnglishCourses(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      const data = await EnglishExerciseService.courses(req.params.sessionId, ownerMssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async getEnglishActivities(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      const data = await EnglishExerciseService.activities(req.params.sessionId, req.query.courseId, ownerMssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async startEnglishExercise(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      const data = EnglishExerciseService.start(req.params.sessionId, req.body || {}, ownerMssv);
      return res.status(202).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async startEnglishCourseFinish(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      const data = EnglishExerciseService.startFinish(req.params.sessionId, req.body || {}, ownerMssv);
      return res.status(202).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async stopEnglishExercise(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      return res.json({ result: true, stopped: EnglishExerciseService.stop(req.params.sessionId, ownerMssv) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async closeEnglishSession(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      return res.json({ result: true, closed: EnglishExerciseService.close(req.params.sessionId, ownerMssv) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  streamEnglishExercise(req, res) {
    const streamToken = req.query.streamToken || req.query.token || '';
    try {
      EnglishExerciseService.authorizeStream(req.params.sessionId, streamToken);
    } catch (err) {
      return res.status(err.status || 403).json({ result: false, message: safeApiErrorMessage(err, 'Stream token không hợp lệ.') });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    res.flushHeaders();
    try {
      const unsubscribe = EnglishExerciseService.subscribe(req.params.sessionId, res, streamToken);
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
          if (typeof res.flush === 'function') res.flush();
        } catch {}
      }, 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: safeApiErrorMessage(err, 'Moodle không thể xử lý yêu cầu.') })}\n\n`);
      res.end();
    }
  },

  async getEnglishAnswers(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      await PermissionService.require(ownerMssv, 'moodle:answers:manage', 'Bạn không có quyền quản lý ngân hàng đáp án.');
      return res.json({ result: true, data: EnglishExerciseService.listAnswers() });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async addEnglishAnswer(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      await PermissionService.require(ownerMssv, 'moodle:answers:manage', 'Bạn không có quyền quản lý ngân hàng đáp án.');
      const data = EnglishExerciseService.addAnswer(req.body?.question, req.body?.correctAnswer);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async deleteEnglishAnswer(req, res) {
    try {
      const ownerMssv = await resolveEnglishOwner(req);
      await PermissionService.require(ownerMssv, 'moodle:answers:manage', 'Bạn không có quyền quản lý ngân hàng đáp án.');
      return res.json({ result: true, deleted: EnglishExerciseService.deleteAnswer(req.params.id) });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },
};

