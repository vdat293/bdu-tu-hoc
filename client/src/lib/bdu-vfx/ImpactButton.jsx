import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { currentUiStyle, isBrutalistVfxStyle, isVfxDisabled } from './palette.js';
import { addFrameUpdater, registerBackLayer } from './stage.js';
import { createSquashRig, Spring } from './spring.js';
import { spawnDoneSpark, spawnImpactBurst, spawnPressCharge } from './effects.js';

/**
 * Tier 1 confirmation button on native <button>:
 * 3-spring squash/rebound + behind-element Canvas 2D backLayer + frontLayer effects + done checkmark spring.
 */
export function ImpactButton({
  ref,
  id,
  type = 'button',
  tone = 'primary',
  className = '',
  disabled = false,
  loading = false,
  doneTrigger = 0,
  onClick,
  ariaLabel,
  title,
  children,
  ...rest
}) {
  const btnRef = useRef(null);
  const backCanvasRef = useRef(null);
  const backLayerRef = useRef(null);
  const rigRef = useRef(null);
  const okSpringRef = useRef(new Spring(0, 420, 14));
  const stopUpdaterRef = useRef(null);

  const invertTimerRef = useRef(null);
  const doneTimerRef = useRef(null);
  const lastDoneTriggerRef = useRef(0);
  const lastImpactAtRef = useRef(null);

  const [inverting, setInverting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const ensureSpringLoop = useCallback(() => {
    if (isVfxDisabled()) return;
    if (stopUpdaterRef.current) return;
    stopUpdaterRef.current = addFrameUpdater((dt) => {
      const btn = btnRef.current;
      if (!btn || !btn.isConnected) {
        stopUpdaterRef.current = null;
        return false;
      }
      const rigMoving = rigRef.current ? rigRef.current.step(dt) : false;
      const ok = okSpringRef.current;
      const okVal = Math.max(0, ok.step(dt));
      btn.style.setProperty('--bdu-ok', okVal.toFixed(3));
      const okMoving = !ok.isSettled(0.002);
      if (!rigMoving && !okMoving) {
        stopUpdaterRef.current = null;
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    const btn = btnRef.current;
    if (btn) {
      rigRef.current = createSquashRig(btn, { low: 0.52, k: 520, d: 15, wide: 0.24 });
    }
    const { layer, dispose } = registerBackLayer(backCanvasRef.current);
    backLayerRef.current = layer;

    return () => {
      dispose();
      backLayerRef.current = null;
      if (stopUpdaterRef.current) {
        stopUpdaterRef.current();
        stopUpdaterRef.current = null;
      }
      if (invertTimerRef.current) clearTimeout(invertTimerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      rigRef.current?.reset();
    };
  }, []);

  const impact = useCallback(() => {
    const el = btnRef.current;
    lastImpactAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (isVfxDisabled()) return;

    const uiStyle = currentUiStyle();
    if (uiStyle === 'neumorphism') return;

    const brutal = isBrutalistVfxStyle();
    if (brutal) {
      if (invertTimerRef.current) clearTimeout(invertTimerRef.current);
      setInverting(true);
      invertTimerRef.current = setTimeout(() => {
        invertTimerRef.current = null;
        setInverting(false);
      }, 185);
    }

    const rig = rigRef.current;
    if (rig) {
      rig.s.x = brutal ? Math.min(rig.s.x, 0.6) : Math.min(rig.s.x, 0.86);
      rig.pop.x = brutal ? 1.24 : 1.07;
      rig.tilt.x = brutal ? -4.8 : 0;
      ensureSpringLoop();
    }

    const ok = okSpringRef.current;
    ok.to = 0;
    ok.x = 0;
    if (el) {
      el.style.setProperty('--bdu-ok', '0');
      if (brutal) {
        spawnImpactBurst(el, tone, {
          backLayer: backLayerRef.current,
          onSecondBeat: () => {
            if (rigRef.current) {
              rigRef.current.s.x = 1.22;
              ensureSpringLoop();
            }
          }
        });
      }
    }
  }, [tone, ensureSpringLoop]);

  const done = useCallback((holdMs = 1800) => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    setIsDone(true);
    okSpringRef.current.to = 1;
    if (isVfxDisabled()) {
      btnRef.current?.style.setProperty('--bdu-ok', '1');
    } else {
      ensureSpringLoop();
      if (btnRef.current && isBrutalistVfxStyle()) {
        spawnDoneSpark(btnRef.current, 'success');
      }
    }
    if (holdMs > 0) {
      doneTimerRef.current = setTimeout(() => {
        doneTimerRef.current = null;
        okSpringRef.current.to = 0;
        if (isVfxDisabled()) {
          btnRef.current?.style.setProperty('--bdu-ok', '0');
        } else {
          ensureSpringLoop();
        }
        setIsDone(false);
      }, holdMs);
    }
  }, [ensureSpringLoop]);

  useImperativeHandle(ref, () => ({
    impact,
    done,
    get element() {
      return btnRef.current;
    },
    get lastImpactAt() {
      return lastImpactAtRef.current;
    }
  }), [impact, done]);

  useEffect(() => {
    if (!doneTrigger) {
      lastDoneTriggerRef.current = 0;
      return;
    }
    if (doneTrigger === lastDoneTriggerRef.current) return;
    lastDoneTriggerRef.current = doneTrigger;
    done(1800);
  }, [doneTrigger, done]);

  const {
    onPointerDown: callerPointerDown,
    onPointerUp: callerPointerUp,
    onPointerLeave: callerPointerLeave,
    onPointerCancel: callerPointerCancel,
    onBlur: callerBlur,
    ...forwardedRest
  } = rest;

  const handlePointerDown = (event) => {
    callerPointerDown?.(event);
    if (disabled || loading || isVfxDisabled() || currentUiStyle() === 'neumorphism') return;
    rigRef.current?.press();
    ensureSpringLoop();
    if (btnRef.current && isBrutalistVfxStyle()) {
      spawnPressCharge(btnRef.current, tone);
    }
  };

  const releasePress = (callerHandler) => (event) => {
    callerHandler?.(event);
    if (rigRef.current) {
      rigRef.current.release();
      ensureSpringLoop();
    }
  };

  const handleClick = (event) => {
    if (disabled || loading) {
      event.preventDefault();
      return;
    }
    rigRef.current?.release();
    impact();
    onClick?.(event);
  };

  const isBlock = /\bbtn-block\b/.test(className);
  const classes = [
    'bdu-impact-btn',
    `bdu-impact-btn--${tone}`,
    inverting && 'bdu-impact-btn--invert',
    isDone && 'is-done',
    className
  ].filter(Boolean).join(' ');

  return (
    <span className={`bdu-impact-wrap${isBlock ? ' bdu-impact-wrap--block' : ''}`}>
      <canvas ref={backCanvasRef} className="bdu-vfx-back-canvas" aria-hidden="true" />
      <button
        ref={btnRef}
        id={id}
        type={type}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        title={title}
        data-vfx="impact"
        data-tone={tone}
        className={classes}
        {...forwardedRest}
        onPointerDown={handlePointerDown}
        onPointerUp={releasePress(callerPointerUp)}
        onPointerLeave={releasePress(callerPointerLeave)}
        onPointerCancel={releasePress(callerPointerCancel)}
        onBlur={releasePress(callerBlur)}
        onClick={handleClick}
      >
        <span className="bdu-impact-btn__content">{children}</span>
        <span className="bdu-impact-btn__check" aria-hidden="true">
          <svg viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5l6 6L21 2.5" />
          </svg>
        </span>
      </button>
    </span>
  );
}
