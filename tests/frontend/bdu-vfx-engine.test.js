import { afterEach, describe, expect, it, vi } from 'vitest';
import { Spring } from '../../client/src/lib/bdu-vfx/spring.js';
import { readVfxPalette, isReducedMotion } from '../../client/src/lib/bdu-vfx/palette.js';
import {
  MAX_PARTICLES,
  addEffect,
  getActiveEffectCount,
  isRunning,
  registerBackLayer,
  resetStageForTests
} from '../../client/src/lib/bdu-vfx/stage.js';
import {
  spawnDoneSpark,
  spawnImpactBurst,
  spawnMicroTap,
  spawnPressCharge
} from '../../client/src/lib/bdu-vfx/effects.js';

describe('bdu-vfx core engine', () => {
  afterEach(() => {
    resetStageForTests();
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('converges Spring stably with sub-stepping', () => {
    const s = new Spring(0, 320, 20);
    s.to = 1;
    for (let i = 0; i < 120; i += 1) s.step(1 / 60);
    expect(s.x).toBeCloseTo(1, 2);
    expect(s.isSettled(0.01)).toBe(true);
  });

  it('switches canvas palette tokens between Light and Dark mode', () => {
    document.body.className = 'theme-light';
    expect(readVfxPalette('primary')).toMatchObject({
      ink: '#111111',
      primary: '#1D4ED8',
      accent: '#F59E0B',
      pop: '#FACC15',
      surface: '#FFFFFF',
      shade: '#93C5FD',
      line: '#1E40AF',
      success: '#10B981',
      danger: '#EF4444',
      active: '#1D4ED8'
    });

    document.body.className = 'theme-dark';
    expect(readVfxPalette('danger')).toMatchObject({
      ink: '#E4E4E7',
      primary: '#3B82F6',
      accent: '#FB7185',
      surface: '#1A1E26',
      shade: '#9F1239',
      line: '#FDA4AF',
      success: '#34D399',
      danger: '#FB7185',
      active: '#FB7185'
    });
  });

  it('caps active particles at MAX_PARTICLES (180) and stops rAF when drained', () => {
    const rafQueue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    for (let i = 0; i < 260; i += 1) addEffect(0.2, () => {});
    expect(getActiveEffectCount()).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(isRunning()).toBe(true);

    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    while (rafQueue.length && now < 1400) {
      now += 30;
      const cb = rafQueue.shift();
      cb(now);
    }
    expect(getActiveEffectCount()).toBe(0);
    expect(isRunning()).toBe(false);
  });

  it('does not drop first spawnImpactBurst when performance.now() < 90 and throttles >50 rapid clicks', () => {
    let now = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    spawnImpactBurst(btn, 'primary');
    expect(getActiveEffectCount()).toBeGreaterThan(0);

    const afterFirst = getActiveEffectCount();
    // Immediate spam clicks within 90ms on same element are throttled
    for (let i = 0; i < 60; i += 1) {
      now += 1;
      spawnImpactBurst(btn, 'primary');
    }
    expect(getActiveEffectCount()).toBe(afterFirst);
    expect(getActiveEffectCount()).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it('degrades safely in jsdom without Path2D or 2D context and respects reduced motion', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    expect(() => {
      spawnPressCharge(btn, 'primary');
      spawnImpactBurst(btn, 'primary');
      spawnMicroTap(btn, 'primary');
      spawnDoneSpark(btn, 'success');
    }).not.toThrow();

    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    expect(isReducedMotion()).toBe(true);
    resetStageForTests();
    addEffect(0.5, () => {});
    expect(getActiveEffectCount()).toBe(0);
  });

  it('tracks scroll delta on both frontLayer and backLayer and clips to .dashboard-body', () => {
    const createMockCtx = () => {
      const ctx = {
        lineJoin: 'miter',
        lineCap: 'butt',
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn()
      };
      return ctx;
    };

    const frontCtx = createMockCtx();
    const backCtx = createMockCtx();
    const dashboardBody = document.createElement('div');
    dashboardBody.className = 'dashboard-body';
    const wrap = document.createElement('span');
    wrap.className = 'bdu-impact-wrap';
    const backCanvas = document.createElement('canvas');
    const btn = document.createElement('button');
    wrap.appendChild(backCanvas);
    wrap.appendChild(btn);
    dashboardBody.appendChild(wrap);
    document.body.appendChild(dashboardBody);

    let scrollOffsetY = 0;
    const makeRect = (left, top, width, height) => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({})
    });

    dashboardBody.getBoundingClientRect = () => makeRect(240, 78, 960, 700);
    wrap.getBoundingClientRect = () => makeRect(400, 500 + scrollOffsetY, 220, 44);
    btn.getBoundingClientRect = () => makeRect(400, 500 + scrollOffsetY, 220, 44);
    backCanvas.getBoundingClientRect = () => makeRect(240, 340 + scrollOffsetY, 540, 364);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContextMock(type) {
      if (type !== '2d') return null;
      return this === backCanvas ? backCtx : frontCtx;
    });

    const rafQueue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { layer: backLayer, dispose } = registerBackLayer(backCanvas);
    const frontDraw = vi.fn();
    const backDraw = vi.fn();

    addEffect(0.5, frontDraw, { anchor: wrap });
    addEffect(0.5, backDraw, { layer: backLayer, anchor: wrap });

    // Immediate scroll of +140px before the next animation frame
    scrollOffsetY = 140;
    now += 16;
    const cb = rafQueue.shift();
    cb(now);

    expect(frontCtx.rect).toHaveBeenCalledWith(240, 78, 960, 700);
    expect(frontCtx.clip).toHaveBeenCalled();
    expect(frontCtx.translate).toHaveBeenCalledWith(0, 140);
    expect(frontDraw).toHaveBeenCalledTimes(1);

    // Back layer translates by -br (-(340+140)) and then +delta (+140), keeping net Y = -340
    expect(backCtx.translate).toHaveBeenNthCalledWith(1, -240, -480);
    expect(backCtx.translate).toHaveBeenNthCalledWith(2, 0, 140);
    expect(backDraw).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('drops anchored particles immediately on disconnect and cancels pending Beat 2', () => {
    const rafQueue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const wrap = document.createElement('span');
    wrap.className = 'bdu-impact-wrap';
    const btn = document.createElement('button');
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    const onSecondBeat = vi.fn();
    spawnImpactBurst(btn, 'primary', { onSecondBeat });
    expect(getActiveEffectCount()).toBeGreaterThan(0);

    wrap.remove();
    while (rafQueue.length && now < 1300) {
      now += 30;
      const cb = rafQueue.shift();
      cb(now);
    }

    expect(onSecondBeat).not.toHaveBeenCalled();
    expect(getActiveEffectCount()).toBe(0);
  });
});
