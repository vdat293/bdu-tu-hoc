/** Shared motion policy; loaded before the application bundles. */
(() => {
  const key = 'bdu_motion_mode';
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const valid = new Set(['full', 'balanced', 'reduced']);
  let mode;
  try { mode = localStorage.getItem(key); } catch { mode = null; }
  if (!valid.has(mode)) mode = media.matches ? 'reduced' : 'balanced';
  const apply = () => {
    document.documentElement.dataset.motion = media.matches ? 'reduced' : mode;
    document.documentElement.classList.toggle('motion-paused', document.hidden);
    window.dispatchEvent(new CustomEvent('bdu:motionchange', { detail: { mode, effectiveMode: media.matches ? 'reduced' : mode } }));
  };
  window.BDUMotion = {
    get mode() { return mode; },
    get effectiveMode() { return media.matches ? 'reduced' : mode; },
    canAnimate() { return !document.hidden && this.effectiveMode !== 'reduced'; },
    setMode(next) { if (!valid.has(next)) return false; mode = next; try { localStorage.setItem(key, next); } catch {} apply(); return true; }
  };
  apply();
  media.addEventListener?.('change', apply);
  media.addListener?.(apply);
  document.addEventListener('visibilitychange', apply);
})();
