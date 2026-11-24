import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTelemetry,
  enableTelemetryForTests,
  flushTelemetry,
  installTelemetryListeners,
  resetTelemetryForTests,
  trackAction,
  trackPageView
} from '../../client/src/services/telemetry.js';

describe('client telemetry SDK', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: true, accepted: 1 }), { status: 202 })));
    enableTelemetryForTests(true);
    configureTelemetry({ token: 'student-token-123' });
  });

  afterEach(() => {
    resetTelemetryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tracks page_view and active dwell duration on page_leave when navigating', async () => {
    trackPageView('/gpa', 'Bảng điểm & GPA');
    await vi.advanceTimersByTimeAsync(12_000);
    trackPageView('/wordfmt', 'Chuẩn hóa Word BDU');

    await flushTelemetry();
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer student-token-123');
    const allEvents = fetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events);

    expect(allEvents.map((e) => e.event_type)).toEqual(['page_view', 'page_leave', 'page_view']);
    expect(allEvents[0].page_path).toBe('/gpa');
    expect(allEvents[1].page_path).toBe('/gpa');
    expect(allEvents[1].duration_ms).toBe(12000);
    expect(allEvents[2].page_path).toBe('/wordfmt');
    expect(allEvents[2].metadata.fromPath).toBe('/gpa');
  });

  it('auto-captures button clicks while ignoring inputs and data-track-ignore regions', async () => {
    const teardown = installTelemetryListeners();
    document.body.innerHTML = `
      <div>
        <button id="btn-sim" type="button">Mô phỏng GPA</button>
        <input id="secret-input" type="password" value="hunter2" />
        <div data-track-ignore="true">
          <button id="btn-ignored" type="button">Bỏ qua nút này</button>
        </div>
      </div>
    `;

    document.getElementById('btn-sim').click();
    document.getElementById('secret-input').click();
    document.getElementById('btn-ignored').click();

    await flushTelemetry();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      event_type: 'click',
      event_name: 'ui_click',
      target_label: 'Mô phỏng GPA',
      target_id: 'btn-sim'
    });
    teardown();
  });

  it('sends semantic actions with Authorization header and keepalive on pagehide', async () => {
    const teardown = installTelemetryListeners();
    trackPageView('/wordfmt', 'Chuẩn hóa Word BDU');
    vi.advanceTimersByTime(3_000);
    trackAction('wordfmt_format', { label: 'Chạy chuẩn hóa file Word', featureId: 'wordfmt' });

    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    expect(fetch).toHaveBeenCalled();
    const [, opts] = fetch.mock.calls[fetch.mock.calls.length - 1];
    expect(opts.keepalive).toBe(true);
    const payload = JSON.parse(opts.body);
    expect(payload.events.some((e) => e.event_name === 'wordfmt_format')).toBe(true);
    expect(payload.events.some((e) => e.event_type === 'page_leave' && e.duration_ms === 3000)).toBe(true);
    teardown();
  });
});
