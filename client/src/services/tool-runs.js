const runs = new Map();
const listeners = new Map();
const timers = new Map();

export const DEFAULT_TOOL_RUN_MIN_DURATION = 10_000;
const MAX_ESTIMATED_PROGRESS = 96;
const PROGRESS_TICK_MS = 100;

function publish(name) { listeners.get(name)?.forEach((listener) => listener(runs.get(name) || null)); }

function clearTimers(id) {
  const timer = timers.get(id);
  if (!timer) return;
  window.clearInterval(timer.progress);
  window.clearTimeout(timer.completion);
  timers.delete(id);
}

function updateRun(name, id, updates) {
  const current = runs.get(name);
  if (!current || current.id !== id) return null;
  const next = { ...current, ...updates };
  runs.set(name, next);
  publish(name);
  return next;
}

function tickProgress(name, id) {
  const current = runs.get(name);
  if (!current || current.id !== id || current.status !== 'running') return;

  const elapsed = Math.max(0, Date.now() - current.startedAt);
  // Reserve the final few percent for the actual terminal state, so a quick
  // API response visibly approaches completion before it can switch to 100%.
  const elapsedProgress = Math.min(MAX_ESTIMATED_PROGRESS, Math.floor((elapsed / current.minDuration) * 100));
  const progress = Math.max(current.progress, elapsedProgress);
  const stageIndex = Math.max(
    current.stageIndex,
    Math.min(current.stageCount - 1, Math.floor((progress / MAX_ESTIMATED_PROGRESS) * current.stageCount))
  );

  if (progress !== current.progress || stageIndex !== current.stageIndex) {
    updateRun(name, id, { progress, stageIndex });
  }
}

function completeRun(name, id) {
  const current = runs.get(name);
  if (!current || current.id !== id || current.status !== 'running' || !current.pendingTerminal) return;

  const remaining = Math.max(0, current.startedAt + current.minDuration - Date.now());
  if (remaining > 0) {
    const timer = timers.get(id);
    if (timer) {
      window.clearTimeout(timer.completion);
      timer.completion = window.setTimeout(() => completeRun(name, id), remaining);
    }
    return;
  }

  const { status, value } = current.pendingTerminal;
  clearTimers(id);
  updateRun(name, id, {
    status,
    phase: status,
    progress: 100,
    stageIndex: current.stageCount - 1,
    result: status === 'success' ? value : null,
    error: status === 'error' ? value : null,
    pendingTerminal: null
  });
}

function settleRun(name, id, status, value) {
  const current = runs.get(name);
  if (!current || current.id !== id || current.status !== 'running' || current.pendingTerminal) return;

  // Keep the settled API value on the active run. The visible terminal state is
  // intentionally delayed, but the result/error must survive that minimum wait.
  updateRun(name, id, {
    apiSettledAt: Date.now(),
    pendingTerminal: { status, value }
  });
  completeRun(name, id);
}

export function getToolRun(name) { return runs.get(name) || null; }

export function subscribeToolRun(name, listener) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
  listener(runs.get(name) || null);
  return () => listeners.get(name)?.delete(listener);
}

export function startToolRun(name, task, {
  minDuration = DEFAULT_TOOL_RUN_MIN_DURATION,
  stageCount = 1,
  summaryChoices = null
} = {}) {
  const current = runs.get(name);
  if (current?.status === 'running') return current;
  const startedAt = Date.now();
  const safeMinDuration = Number.isFinite(minDuration) && minDuration >= 0
    ? minDuration
    : DEFAULT_TOOL_RUN_MIN_DURATION;
  const safeStageCount = Number.isFinite(stageCount) && stageCount > 0 ? Math.floor(stageCount) : 1;
  const entry = {
    id: `${name}-${startedAt}`,
    status: 'running',
    phase: 'processing',
    progress: 0,
    stageIndex: 0,
    stageCount: safeStageCount,
    startedAt,
    minDuration: safeMinDuration,
    result: null,
    error: null,
    apiSettledAt: null,
    pendingTerminal: null,
    summaryChoices
  };
  runs.set(name, entry);
  publish(name);

  const progressTimer = window.setInterval(() => tickProgress(name, entry.id), PROGRESS_TICK_MS);
  timers.set(entry.id, { progress: progressTimer, completion: null });

  Promise.resolve().then(task).then((result) => {
    settleRun(name, entry.id, 'success', result);
  }).catch((error) => {
    settleRun(name, entry.id, 'error', error);
  });
  return entry;
}
