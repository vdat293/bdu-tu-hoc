import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToolRun, startToolRun, subscribeToolRun } from '../../client/src/services/tool-runs.js';

async function flushTask() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('tool runs', () => {
  it('keeps a settled result pending until the ten-second progress gate ends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T15:00:00.000Z'));
    const name = 'wordfmt-progress-gate';
    const result = { downloadUrl: '/api/wordfmt/download/ready.docx' };
    const updates = [];
    const unsubscribe = subscribeToolRun(name, (run) => updates.push(run));

    startToolRun(name, () => Promise.resolve(result), { minDuration: 10_000, stageCount: 7 });
    await flushTask();

    expect(getToolRun(name)).toMatchObject({ status: 'running', progress: 0, pendingTerminal: { status: 'success', value: result } });

    await vi.advanceTimersByTimeAsync(9_999);
    const pending = getToolRun(name);
    expect(pending).toMatchObject({ status: 'running', progress: expect.any(Number), pendingTerminal: { status: 'success', value: result } });
    expect(pending.progress).toBeLessThanOrEqual(96);
    expect(pending.stageIndex).toBeLessThanOrEqual(6);

    const observedProgress = updates.filter((run) => run?.status === 'running').map((run) => run.progress);
    expect(observedProgress.every((progress, index) => index === 0 || progress >= observedProgress[index - 1])).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(getToolRun(name)).toMatchObject({ status: 'success', progress: 100, stageIndex: 6, result, pendingTerminal: null });
    unsubscribe();
  });

  it('does not report a terminal state before a slow API settles, then gates errors safely too', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T15:01:00.000Z'));
    const name = 'wordfmt-late-error';
    let rejectTask;
    const task = new Promise((resolve, reject) => {
      rejectTask = reject;
    });

    startToolRun(name, () => task, { minDuration: 10_000, stageCount: 7 });
    await flushTask();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getToolRun(name)).toMatchObject({ status: 'running', progress: 96, pendingTerminal: null });

    rejectTask(new Error('private backend stack trace'));
    await flushTask();
    expect(getToolRun(name)).toMatchObject({ status: 'error', progress: 100, stageIndex: 6 });
  });
});
