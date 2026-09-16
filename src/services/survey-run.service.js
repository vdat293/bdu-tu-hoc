import { randomUUID } from 'node:crypto';
import { SurveyService } from './survey.service.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const MAX_LOGS = 300;
const RETENTION_MS = 30 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function cleanMessage(error) {
  return String(error?.message || error || 'Lỗi khi thực hiện khảo sát.');
}

function cloneResult(result) {
  if (!result || typeof result !== 'object') return result || null;
  return {
    success: Boolean(result.success),
    processed: Number(result.processed) || 0,
    total: Number(result.total) || 0,
    message: String(result.message || ''),
    failures: Array.isArray(result.failures)
      ? result.failures.map((failure) => ({ message: String(failure?.message || 'Không thể gửi khảo sát.') }))
      : []
  };
}

/**
 * Keeps survey work independent from a browser EventSource connection. The
 * process intentionally stays in memory: production runs exactly one Node
 * replica, and BDU bearer tokens must never be persisted to PostgreSQL.
 */
export class SurveyRunManager {
  constructor({ runSurvey = (options) => SurveyService.runAutoSurvey(options), retentionMs = RETENTION_MS } = {}) {
    this.runSurvey = runSurvey;
    this.retentionMs = retentionMs;
    this.runs = new Map();
    this.activeRunByMssv = new Map();
    this.listeners = new Map();
  }

  serialize(run) {
    if (!run) return null;
    return {
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      completedKeys: [...run.completedKeys],
      logs: run.logs.map((entry) => ({ ...entry })),
      result: cloneResult(run.result),
      error: run.error || null
    };
  }

  prune() {
    const cutoff = Date.now() - this.retentionMs;
    for (const [runId, run] of this.runs) {
      if (ACTIVE_STATUSES.has(run.status) || new Date(run.updatedAt).getTime() > cutoff) continue;
      this.runs.delete(runId);
      this.listeners.delete(runId);
    }
  }

  getForStudent(runId, mssv) {
    this.prune();
    const run = this.runs.get(String(runId));
    if (!run || run.mssv !== String(mssv)) return null;
    return this.serialize(run);
  }

  hasRun(runId) {
    this.prune();
    return this.runs.has(String(runId));
  }

  start({ mssv, token, options = {} }) {
    this.prune();
    const studentId = String(mssv || '').trim();
    if (!studentId) throw Object.assign(new Error('Không xác định được sinh viên cho lượt khảo sát.'), { status: 401 });
    if (!token) throw Object.assign(new Error('Thiếu mã xác thực (Token).'), { status: 401 });

    const currentId = this.activeRunByMssv.get(studentId);
    const current = currentId ? this.runs.get(currentId) : null;
    if (current && ACTIVE_STATUSES.has(current.status)) {
      return { run: this.serialize(current), reused: true };
    }

    const startedAt = nowIso();
    const run = {
      id: randomUUID(),
      mssv: studentId,
      token,
      options: { ...options },
      status: 'queued',
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      completedKeys: [],
      logs: [],
      result: null,
      error: null
    };
    this.runs.set(run.id, run);
    this.activeRunByMssv.set(studentId, run.id);
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    queueMicrotask(() => this.execute(run.id));
    return { run: this.serialize(run), reused: false };
  }

  subscribe(runId, listener) {
    const key = String(runId);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    const run = this.runs.get(key);
    if (run) listener({ type: 'snapshot', run: this.serialize(run) });
    return () => this.listeners.get(key)?.delete(listener);
  }

  emit(run, event) {
    this.listeners.get(run.id)?.forEach((listener) => {
      try { listener(event); } catch { /* A closed SSE response is harmless. */ }
    });
  }

  update(run, fields) {
    Object.assign(run, fields, { updatedAt: nowIso() });
  }

  appendLog(run, logData) {
    const entry = {
      type: logData?.type || 'info',
      message: String(logData?.message || ''),
      timestamp: logData?.timestamp || new Date().toLocaleTimeString('vi-VN')
    };
    run.logs = [...run.logs, entry].slice(-MAX_LOGS);
    this.update(run, {});
    this.emit(run, { type: 'log', ...entry });
  }

  markCourseDone(run, courseData) {
    const surveyKey = String(courseData?.surveyKey || '');
    if (surveyKey && !run.completedKeys.includes(surveyKey)) run.completedKeys.push(surveyKey);
    this.update(run, {});
    this.emit(run, { type: 'course_done', ...courseData });
  }

  async execute(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'queued') return;
    this.update(run, { status: 'running' });
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });

    try {
      const result = await this.runSurvey({
        token: run.token,
        mssv: run.mssv,
        ...run.options,
        onLog: (entry) => this.appendLog(run, entry),
        onCourseDone: (course) => this.markCourseDone(run, course)
      });
      const safeResult = cloneResult(result);
      const status = safeResult?.success ? 'success' : 'error';
      this.update(run, {
        status,
        result: safeResult,
        error: status === 'error' ? (safeResult?.message || 'Không thể hoàn tất khảo sát.') : null,
        finishedAt: nowIso()
      });
      this.activeRunByMssv.delete(run.mssv);
      this.emit(run, { type: 'done', run: this.serialize(run) });
    } catch (error) {
      const message = cleanMessage(error);
      this.appendLog(run, { type: 'warning', message });
      this.update(run, { status: 'error', error: message, finishedAt: nowIso() });
      this.activeRunByMssv.delete(run.mssv);
      this.emit(run, { type: 'done', run: this.serialize(run) });
    } finally {
      // Do not retain the BDU bearer token after work has finished.
      run.token = null;
    }
  }
}

export const SurveyRunService = new SurveyRunManager();
