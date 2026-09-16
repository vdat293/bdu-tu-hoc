import { createSurveyRun, getSurveyRunStatus } from '../../api/tools.js';

const ACTIVE_STATUSES = new Set(['starting', 'queued', 'running']);
const TERMINAL_STATUSES = new Set(['success', 'error']);
const RUN_STORAGE_KEY = 'bdu_survey_active_run';
const POLL_INTERVAL_MS = 3_000;

let activeRun = null;
let eventSource = null;
let pollTimer = null;
const listeners = new Set();

function publish() { listeners.forEach((listener) => listener(activeRun)); }

function readStoredRunId() {
  try { return window.sessionStorage.getItem(RUN_STORAGE_KEY); } catch { return null; }
}

function rememberRun(runId) {
  try { window.sessionStorage.setItem(RUN_STORAGE_KEY, runId); } catch { /* Storage can be unavailable in private contexts. */ }
}

function forgetRun() {
  try { window.sessionStorage.removeItem(RUN_STORAGE_KEY); } catch { /* Storage can be unavailable in private contexts. */ }
}

function stopTransport() {
  eventSource?.close();
  eventSource = null;
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function isTerminal(run = activeRun) {
  return TERMINAL_STATUSES.has(run?.status);
}

function isActive(run = activeRun) {
  return ACTIVE_STATUSES.has(run?.status);
}

function setRun(next) {
  activeRun = next;
  if (isTerminal(next)) {
    stopTransport();
    forgetRun();
  }
  publish();
  return activeRun;
}

function applySnapshot(snapshot, { publishState = true } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return activeRun;
  const logs = Array.isArray(snapshot.logs) ? snapshot.logs : (activeRun?.logs || []);
  const next = {
    ...activeRun,
    ...snapshot,
    logs,
    completedKeys: Array.isArray(snapshot.completedKeys) ? snapshot.completedKeys : (activeRun?.completedKeys || []),
    transport: activeRun?.transport || 'connected'
  };
  if (!snapshot.runId && activeRun?.runId) next.runId = activeRun.runId;
  return publishState ? setRun(next) : (activeRun = next);
}

function appendLog(message, type = 'info', timestamp = new Date().toLocaleTimeString('vi-VN')) {
  if (!activeRun) return;
  setRun({
    ...activeRun,
    logs: [...(activeRun.logs || []), { message, type, at: timestamp }].slice(-300)
  });
}

function scheduleStatusPoll(token, runId) {
  if (pollTimer || !runId || !isActive()) return;
  const poll = async () => {
    pollTimer = null;
    try {
      const run = await getSurveyRunStatus(token, runId);
      applySnapshot(run);
      if (isTerminal()) return;
    } catch (error) {
      if (activeRun?.runId === runId && isActive()) {
        appendLog(`Không thể kiểm tra trạng thái backend: ${error.message || 'lỗi kết nối'}.`, 'warning');
      }
    }
    if (activeRun?.runId === runId && isActive()) {
      pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  pollTimer = window.setTimeout(poll, 0);
}

function connectEventStream(token, runId) {
  if (!runId || isTerminal()) return;
  eventSource?.close();
  const source = new EventSource(`/api/tool-runs/${encodeURIComponent(runId)}/events`);
  eventSource = source;

  source.onopen = () => {
    if (activeRun?.runId === runId) setRun({ ...activeRun, transport: 'connected' });
  };

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'snapshot' || data.type === 'done') {
        applySnapshot(data.run);
      } else if (data.type === 'log') {
        appendLog(data.message, data.logType || 'info', data.timestamp);
      } else if (data.type === 'course_done') {
        if (!activeRun || activeRun.runId !== runId) return;
        const surveyKey = data.surveyKey;
        const completedKeys = surveyKey && !activeRun.completedKeys?.includes(surveyKey)
          ? [...(activeRun.completedKeys || []), surveyKey]
          : (activeRun.completedKeys || []);
        setRun({ ...activeRun, completedKeys });
      }
    } catch {
      appendLog('Nhận được log không hợp lệ từ máy chủ.', 'warning');
    }
  };

  source.onerror = () => {
    if (!activeRun || activeRun.runId !== runId || isTerminal()) return;
    source.close();
    if (eventSource === source) eventSource = null;
    setRun({ ...activeRun, transport: 'disconnected' });
    appendLog('Mất live log; backend có thể vẫn đang chạy. Đang kiểm tra lại trạng thái…', 'warning');
    // Never reconnect this EventSource automatically. A browser content filter
    // may block it; authenticated polling cannot submit the survey twice.
    scheduleStatusPoll(token, runId);
  };
}

export function subscribeSurvey(listener) {
  listeners.add(listener);
  listener(activeRun);
  return () => listeners.delete(listener);
}

export function getSurveyRun() { return activeRun; }

export async function startSurvey({ token, ...options }) {
  if (isActive()) return activeRun;
  stopTransport();
  setRun({ status: 'starting', transport: 'connecting', logs: [], completedKeys: [], runId: null, startedAt: new Date().toISOString() });
  try {
    const run = await createSurveyRun(token, options);
    applySnapshot(run, { publishState: false });
    setRun({ ...activeRun, transport: 'connecting' });
    rememberRun(run.runId);
    if (!isTerminal()) connectEventStream(token, run.runId);
    return activeRun;
  } catch (error) {
    setRun({
      ...activeRun,
      status: 'error',
      error: error.message || 'Không thể khởi chạy khảo sát.',
      finishedAt: new Date().toISOString()
    });
    throw error;
  }
}

export async function restoreSurveyRun(token) {
  if (!token || isActive() || isTerminal()) return activeRun;
  const runId = readStoredRunId();
  if (!runId) return null;
  try {
    const run = await getSurveyRunStatus(token, runId);
    applySnapshot(run, { publishState: false });
    setRun({ ...activeRun, transport: 'connecting' });
    if (!isTerminal()) connectEventStream(token, runId);
    return activeRun;
  } catch (error) {
    // A lost in-memory run must never be started again automatically.
    if (error?.status === 404) forgetRun();
    return null;
  }
}

export function clearSurveyLogs() {
  if (activeRun) setRun({ ...activeRun, logs: [] });
}
