import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isVfxDisabled, readVfxPalette, subscribeVfxDisabled } from './palette.js';
import { addPersistentRenderer, clipContextToScrollContainer, hasLiveCanvas, registerBackLayer } from './stage.js';
import { renderProgressOverlay, spawnProgressCompleteBurst } from './effects.js';
import { Spring, clamp, lerp } from './spring.js';

function createInitialPebbles() {
  return [0.14, 0.31, 0.5, 0.69, 0.87].map((u, idx) => ({
    u,
    s: 3.8 + (idx % 3) * 0.85,
    ph: idx * 1.3,
    rot: (idx - 2) * 0.18,
    lift: new Spring(0, 70, 7),
    pts: [[-1, 0.4], [-0.5, -0.8], [0.5, -1], [1, 0.1], [0.3, 0.9]]
  }));
}

/**
 * Tier 1 cel-glass progress bar with storm cloud leading edge,
 * cel-shaded pebbles + pop ticks, behind-bar 100% burst, and spring-animated badge.
 */
export function ImpactProgress({
  ref,
  id,
  progress,
  label = 'Đang xử lý…',
  doneLabel = 'Hoàn tất 100% ✓',
  isComplete = false,
  tone = 'primary',
  onComplete,
  className = '',
  style
}) {
  const rootRef = useRef(null);
  const barRef = useRef(null);
  const backCanvasRef = useRef(null);
  const backLayerRef = useRef(null);
  const badgeRef = useRef(null);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const pRef = useRef(0);
  const goalRef = useRef(0);
  const doneTriggeredRef = useRef(false);
  const lastStepBucketRef = useRef(-1);
  const badgeSpringRef = useRef(new Spring(1, 500, 13));

  const overlayStateRef = useRef({
    p: 0,
    spd: 0,
    done: false,
    emitAcc: 0,
    pebbles: createInitialPebbles(),
    cloudSize: new Spring(0, 90, 13),
    lag: new Spring(0, 120, 16),
    rest: new Spring(0, 160, 14),
    check: new Spring(0, 260, 13)
  });

  const [displayPct, setDisplayPct] = useState(0);
  const [doneState, setDoneState] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => isVfxDisabled());

  const syncDom = useCallback((nextP, markComplete) => {
    const pct = markComplete ? 100 : Math.floor(clamp(nextP, 0, 1) * 100);
    if (rootRef.current && rootRef.current.getAttribute('aria-valuenow') !== String(pct)) {
      rootRef.current.setAttribute('aria-valuenow', String(pct));
    }
    setDisplayPct((prev) => (prev === pct ? prev : pct));

    const bucket = Math.floor(pct / 5);
    if (!markComplete && bucket !== lastStepBucketRef.current && pct > 0) {
      lastStepBucketRef.current = bucket;
      badgeSpringRef.current.x = 1.12;
    }

    if (markComplete && !doneTriggeredRef.current) {
      doneTriggeredRef.current = true;
      setDoneState(true);
      badgeSpringRef.current.x = 1.48;
      if (barRef.current && !isVfxDisabled()) {
        spawnProgressCompleteBurst(barRef.current, tone, backLayerRef.current);
      }
      onCompleteRef.current?.();
    }
  }, [tone]);

  const set = useCallback((ratio01, instant = false) => {
    const next = clamp(Number(ratio01) || 0, 0, 1);
    if (doneTriggeredRef.current && next >= 1) return;

    if (next < pRef.current - 0.001) {
      doneTriggeredRef.current = false;
      setDoneState(false);
    }

    goalRef.current = next;
    const immediate = Boolean(instant || next < pRef.current || !hasLiveCanvas());
    if (immediate) {
      pRef.current = next;
      overlayStateRef.current.p = next;
      overlayStateRef.current.done = next >= 1;
      syncDom(next, next >= 1);
    }
  }, [syncDom]);

  const reset = useCallback(() => {
    doneTriggeredRef.current = false;
    lastStepBucketRef.current = -1;
    goalRef.current = 0;
    pRef.current = 0;
    badgeSpringRef.current.x = 1;
    badgeSpringRef.current.v = 0;
    if (badgeRef.current) {
      badgeRef.current.style.transform = 'skewX(-10deg) scale(1)';
    }
    const s = overlayStateRef.current;
    s.p = 0;
    s.spd = 0;
    s.done = false;
    s.emitAcc = 0;
    s.cloudSize.x = 0;
    s.cloudSize.to = 0;
    s.rest.x = 0;
    s.rest.to = 0;
    s.check.x = 0;
    s.check.to = 0;
    setDoneState(false);
    setDisplayPct(0);
  }, []);

  useImperativeHandle(ref, () => ({
    set,
    reset,
    get value() {
      return goalRef.current;
    },
    get p() {
      return pRef.current;
    }
  }), [set, reset]);

  useEffect(() => {
    const { layer, dispose } = registerBackLayer(backCanvasRef.current);
    backLayerRef.current = layer;
    return () => {
      dispose();
      backLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (progress === undefined && !isComplete) return;
    if (isComplete) {
      if (pRef.current < 0.05 && hasLiveCanvas()) {
        set(0.92, true);
      }
      set(1, !hasLiveCanvas());
    } else {
      const clamped = clamp(Number.isFinite(progress) ? progress : 0, 0, 100);
      set(clamped / 100, !hasLiveCanvas());
    }
  }, [progress, isComplete, set]);

  useEffect(() => {
    if (reducedMotion || !hasLiveCanvas()) return undefined;
    const dispose = addPersistentRenderer((ctx, dt, tt) => {
      const s = overlayStateRef.current;
      const prevP = pRef.current;
      if (!doneTriggeredRef.current && pRef.current < goalRef.current) {
        const rate = clamp((goalRef.current - pRef.current) * 3, 0.12, 0.9);
        pRef.current = Math.min(goalRef.current, pRef.current + dt * rate);
      }
      s.spd = lerp(s.spd, dt > 0 ? (pRef.current - prevP) / dt : 0, Math.min(1, dt * 8));
      s.p = pRef.current;
      s.done = doneTriggeredRef.current || pRef.current >= 1;

      if (!doneTriggeredRef.current && pRef.current >= 1) {
        syncDom(1, true);
      } else {
        syncDom(pRef.current, doneTriggeredRef.current);
      }

      if (badgeRef.current) {
        const sc = badgeSpringRef.current.step(dt);
        badgeRef.current.style.transform = `skewX(-10deg) scale(${sc.toFixed(3)})`;
      }

      const bar = barRef.current;
      if (!ctx || !bar) return;
      const rect = bar.getBoundingClientRect();
      const vh = typeof window !== 'undefined' ? (window.innerHeight || 900) : 900;
      if (rect.bottom <= -80 || rect.top >= vh + 80) return;

      clipContextToScrollContainer(ctx, bar);
      renderProgressOverlay(ctx, rect, s, readVfxPalette(tone), dt, tt, bar);
    });
    return dispose;
  }, [tone, syncDom, reducedMotion]);

  useEffect(() => subscribeVfxDisabled((next) => {
    setReducedMotion(next);
    if (next) {
      pRef.current = goalRef.current;
      overlayStateRef.current.p = goalRef.current;
      overlayStateRef.current.done = goalRef.current >= 1;
      syncDom(goalRef.current, goalRef.current >= 1);
      if (badgeRef.current) {
        badgeRef.current.style.transform = 'skewX(-10deg) scale(1)';
      }
    }
  }), [syncDom]);

  const visualPct = doneState ? 100 : displayPct;
  const barRatio = clamp(doneState ? 1 : pRef.current, 0, 1);

  return (
    <div
      ref={rootRef}
      id={id}
      className={`bdu-impact-progress${doneState ? ' is-complete' : ''}${className ? ` ${className}` : ''}`}
      data-tone={tone}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={visualPct}
      style={style}
    >
      <div className="bdu-impact-progress__stage">
        <canvas ref={backCanvasRef} className="bdu-vfx-back-canvas" aria-hidden="true" />
        <div ref={barRef} className="bdu-impact-progress__bar">
          <span
            className="bdu-impact-progress__fill"
            style={{ width: `${(barRatio * 100).toFixed(2)}%` }}
          />
        </div>
      </div>
      <div className="bdu-impact-progress__meta">
        <span ref={badgeRef} className="bdu-impact-progress__badge">
          {doneState ? doneLabel : `${visualPct}%`}
        </span>
      </div>
    </div>
  );
}
