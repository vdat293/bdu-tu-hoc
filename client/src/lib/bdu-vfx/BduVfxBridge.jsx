import { useEffect } from 'react';
import { currentUiStyle, isBrutalistVfxStyle, isVfxDisabled } from './palette.js';
import { addFrameUpdater } from './stage.js';
import { createSquashRig } from './spring.js';
import { spawnMicroTap } from './effects.js';

const EXCLUDED_CONTAINER_SELECTOR = [
  '.clay-pb-scope',
  '.wf-gdoc-page',
  '.admin-shell',
  '[data-vfx="off"]',
  '[data-vfx="impact"]'
].join(', ');

const activePopTimers = new WeakMap();
const elementRigs = new WeakMap();

function resolveTargetButton(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const el = target.closest('button, a.btn, [role="button"]');
  if (!el) return null;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
  if (el.closest(EXCLUDED_CONTAINER_SELECTOR)) return null;
  if (typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width < 28 || rect.height < 24) return null;
  return el;
}

function inferTone(el) {
  if (el.dataset?.tone) return el.dataset.tone;
  if (el.classList?.contains('btn-danger')) return 'danger';
  if (el.classList?.contains('btn-success')) return 'success';
  if (el.classList?.contains('btn-secondary') || el.classList?.contains('btn-ghost')) return 'secondary';
  return 'primary';
}

function getOrCreateRig(el) {
  let rig = elementRigs.get(el);
  if (!rig) {
    rig = createSquashRig(el, { low: 0.78, k: 520, d: 15, wide: 0.26 });
    elementRigs.set(el, rig);
  }
  return rig;
}

/**
 * Tier 2 global micro-impact delegation bridge for the student portal.
 * Applies secondary-button spring squash + 3 corner wedges without modifying JSX buttons.
 */
export function BduVfxBridge() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const runRig = (el) => {
      const rig = getOrCreateRig(el);
      addFrameUpdater((dt) => rig.step(dt));
      return rig;
    };

    const handlePointerDown = (event) => {
      if (isVfxDisabled() || currentUiStyle() === 'neumorphism') return;
      const el = resolveTargetButton(event.target);
      if (!el) return;
      const rig = runRig(el);
      rig.press();
    };

    const handleRelease = (event) => {
      const el = resolveTargetButton(event.target);
      if (!el) return;
      const rig = elementRigs.get(el);
      if (rig) {
        rig.release();
        addFrameUpdater((dt) => rig.step(dt));
      }
    };

    const handleClick = (event) => {
      if (isVfxDisabled() || currentUiStyle() === 'neumorphism') return;
      const el = resolveTargetButton(event.target);
      if (!el) return;

      const rig = runRig(el);
      rig.release();
      rig.s.x = Math.min(rig.s.x, 0.8);
      rig.s.v += 3.8;

      const prevTimer = activePopTimers.get(el);
      if (prevTimer) {
        clearTimeout(prevTimer);
      }

      el.classList.remove('bdu-vfx-micro-pop');
      void el.offsetWidth;
      el.classList.add('bdu-vfx-micro-pop');

      const timer = setTimeout(() => {
        activePopTimers.delete(el);
        el.classList.remove('bdu-vfx-micro-pop');
      }, 190);
      activePopTimers.set(el, timer);

      if (isBrutalistVfxStyle()) {
        spawnMicroTap(el, inferTone(el));
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handleRelease);
    document.addEventListener('pointercancel', handleRelease);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handleRelease);
      document.removeEventListener('pointercancel', handleRelease);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return null;
}
