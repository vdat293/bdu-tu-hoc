/**
 * Module: Survey (khảo sát BDU)
 */

import { SurveyService } from '../../services/survey.service.js';
import { SurveyRunService } from '../../services/survey-run.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { bearerToken } from '../_shared/bearer-token.js';

export const SurveyController = {
  // 7. Tools: Survey Live Stream (SSE)
  async getSurveyForms(req, res) {
    try {
      const token = bearerToken(req);
      const data = await SurveyService.listAvailableSurveys({ token });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Survey forms error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải danh sách khảo sát.' });
    }
  },

  async streamSurvey(req, res) {
    const { token, mssv, ratingLevel, genderLevel, attendanceLevel } = req.query;
    let selectedSurveys = null;
    let courseRatings = null;
    try {
      if (req.query.selected) selectedSurveys = JSON.parse(req.query.selected);
      if (req.query.courseRatings) courseRatings = JSON.parse(req.query.courseRatings);
    } catch {
      selectedSurveys = null;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    // CDN/WAF có thể nén hoặc đệm luồng streaming; giữ nguyên byte để log
    // tiến độ hiện ra tức thời thay vì dồn thành từng cục.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await SurveyService.runAutoSurvey({
        token,
        mssv,
        ratingLevel: ratingLevel || '5',
        genderLevel: genderLevel || '0',
        attendanceLevel: attendanceLevel || '1',
        courseRatings: courseRatings || {},
        selectedSurveys,
        onLog: (logData) => {
          sendEvent({ type: 'log', logType: logData.type, message: logData.message, timestamp: logData.timestamp });
        },
        onCourseDone: (courseData) => {
          sendEvent({ type: 'course_done', ...courseData });
        }
      });
      sendEvent({ type: result.success ? 'done' : 'error', message: result.message, result });
      res.end();
    } catch (err) {
      sendEvent({ type: 'error', message: err.message || 'Lỗi khi thực hiện khảo sát.' });
      res.end();
    }
  },

  // Survey runs are created with an authenticated POST. SSE only observes an
  // existing run, so reconnecting a stream can never submit a survey twice.
  async startSurveyRun(req, res) {
    try {
      const authorization = req.headers.authorization || '';
      const token = bearerToken(req);
      const mssv = await BduIdentityService.resolveVerifiedMssv(authorization);
      const { run, reused } = SurveyRunService.start({
        mssv,
        token,
        options: {
          ratingLevel: req.body?.ratingLevel || '5',
          genderLevel: req.body?.genderLevel || '0',
          attendanceLevel: req.body?.attendanceLevel || '1',
          courseRatings: req.body?.courseRatings && typeof req.body.courseRatings === 'object' ? req.body.courseRatings : {},
          selectedSurveys: Array.isArray(req.body?.selectedSurveys) ? req.body.selectedSurveys : null
        }
      });
      return res.status(reused ? 200 : 202).json({ result: true, data: { ...run, reused } });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể khởi chạy khảo sát.'
      });
    }
  },

  async getSurveyRun(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      const run = SurveyRunService.getForStudent(req.params.runId, mssv);
      if (!run) return res.status(404).json({ result: false, message: 'Không tìm thấy lượt khảo sát hoặc lượt này đã hết hạn.' });
      return res.json({ result: true, data: run });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể kiểm tra trạng thái khảo sát.' });
    }
  },

  async streamSurveyRun(req, res) {
    // EventSource cannot attach Authorization. A random, short-lived run ID is
    // therefore the stream capability; status reads remain bearer-protected.
    if (!SurveyRunService.hasRun(req.params.runId)) {
      return res.status(404).json({ result: false, message: 'Không tìm thấy lượt khảo sát hoặc lượt này đã hết hạn.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');

    const write = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = SurveyRunService.subscribe(req.params.runId, write);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
};

