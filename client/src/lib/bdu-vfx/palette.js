export const LIGHT_PALETTE = Object.freeze({
  ink: '#111111',
  primary: '#1D4ED8',
  accent: '#F59E0B',
  pop: '#FACC15',
  surface: '#FFFFFF',
  fill: '#FFFFFF',
  shade: '#93C5FD',
  line: '#1E40AF',
  success: '#10B981',
  danger: '#EF4444'
});

export const DARK_PALETTE = Object.freeze({
  ink: '#E4E4E7',
  primary: '#3B82F6',
  accent: '#FDE047',
  pop: '#FDE047',
  surface: '#1A1E26',
  fill: '#F8FAFC',
  shade: '#3B82F6',
  line: '#93C5FD',
  success: '#34D399',
  danger: '#FB7185'
});

function isDarkThemeActive() {
  if (typeof document === 'undefined') return false;
  if (document.body?.classList?.contains('theme-dark')) return true;
  return document.documentElement?.dataset?.theme === 'dark';
}

/**
 * Reads active Light/Dark BDU Neo-Brutalism cel-shading palette and maps tone -> active/line/shade.
 */
export function readVfxPalette(tone = 'primary') {
  const dark = isDarkThemeActive();
  const base = dark ? DARK_PALETTE : LIGHT_PALETTE;
  if (tone === 'danger') {
    return {
      ...base,
      active: base.danger,
      accent: base.danger,
      line: dark ? '#FDA4AF' : '#B91C1C',
      shade: dark ? '#9F1239' : '#FCA5A5'
    };
  }
  if (tone === 'success') {
    return {
      ...base,
      active: base.success,
      accent: base.success,
      line: dark ? '#6EE7B7' : '#047857',
      shade: dark ? '#065F46' : '#6EE7B7'
    };
  }
  if (tone === 'secondary') {
    return {
      ...base,
      active: base.pop,
      accent: base.accent,
      line: dark ? '#FDE047' : '#111111',
      shade: dark ? '#854D0E' : '#FDE68A'
    };
  }
  return { ...base, active: base.primary };
}

export function isReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

export function isVfxSettingOff() {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.dataset?.vfx === 'off';
}

export function isVfxDisabled() {
  return isReducedMotion() || isVfxSettingOff();
}

export function currentUiStyle() {
  if (typeof document === 'undefined') return 'brutalism';
  return document.documentElement?.dataset?.uiStyle || 'brutalism';
}

export function isBrutalistVfxStyle() {
  return currentUiStyle() === 'brutalism';
}

export function subscribeVfxDisabled(listener) {
  const unsubMotion = subscribeReducedMotion(() => listener(isVfxDisabled()));
  if (
    typeof document === 'undefined'
    || typeof window === 'undefined'
    || typeof window.MutationObserver !== 'function'
    || typeof listener !== 'function'
  ) {
    return unsubMotion;
  }
  const observer = new window.MutationObserver(() => listener(isVfxDisabled()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-vfx'] });
  return () => {
    unsubMotion();
    observer.disconnect();
  };
}

export function subscribeReducedMotion(listener) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof listener !== 'function') {
    return () => {};
  }
  let mq;
  try {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return () => {};
  }
  if (!mq) return () => {};
  const handler = (event) => listener(Boolean(event?.matches));
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }
  if (typeof mq.addListener === 'function') {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }
  return () => {};
}
