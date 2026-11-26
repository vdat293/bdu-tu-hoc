import { isReducedMotion } from './palette.js';
import { clamp } from './spring.js';

export const MAX_PARTICLES = 180;
const SCROLL_CLIP_SELECTOR = '.dashboard-body, .modal-body, .fb-modal-body';

export function findScrollClipContainer(el) {
  if (!el || typeof el.closest !== 'function') return null;
  return el.closest(SCROLL_CLIP_SELECTOR) || null;
}

export function clipContextToScrollContainer(ctx, el) {
  const clipEl = findScrollClipContainer(el);
  if (!ctx || !clipEl || !clipEl.isConnected || typeof clipEl.getBoundingClientRect !== 'function') {
    return false;
  }
  const cr = clipEl.getBoundingClientRect();
  if (cr.width > 0 && cr.height > 0) {
    ctx.beginPath();
    ctx.rect(cr.left, cr.top, cr.width, cr.height);
    ctx.clip();
    return true;
  }
  return false;
}

const frontLayer = {
  c: null,
  g: null,
  live: [],
  dirty: false,
  isFront: true
};

const layers = [frontLayer];
const persistentRenderers = new Set();
const frameUpdaters = new Set();
const timers = [];

let dpr = 1;
let running = false;
let rafId = null;
let lastFrameMs = 0;
let clockNow = 0;
let resizeBound = false;
let canvasCapability = null;

function syncFrontSize() {
  if (typeof window === 'undefined' || !frontLayer.c) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round((window.innerWidth || 0) * dpr));
  const h = Math.max(1, Math.round((window.innerHeight || 0) * dpr));
  if (frontLayer.c.width !== w) frontLayer.c.width = w;
  if (frontLayer.c.height !== h) frontLayer.c.height = h;
}

function ensureFrontCanvas() {
  if (typeof document === 'undefined' || !document.body) return null;
  if (frontLayer.c && frontLayer.c.isConnected) return frontLayer.c;
  const created = document.createElement('canvas');
  created.className = 'bdu-vfx-canvas';
  created.setAttribute('aria-hidden', 'true');
  created.style.position = 'fixed';
  created.style.inset = '0';
  created.style.width = '100vw';
  created.style.height = '100vh';
  created.style.pointerEvents = 'none';
  created.style.zIndex = '2147483000';
  document.body.appendChild(created);
  frontLayer.c = created;
  try {
    frontLayer.g = typeof created.getContext === 'function' ? created.getContext('2d') : null;
  } catch {
    frontLayer.g = null;
  }
  syncFrontSize();
  if (!resizeBound && typeof window !== 'undefined') {
    window.addEventListener('resize', syncFrontSize);
    resizeBound = true;
  }
  return frontLayer.c;
}

export function hasLiveCanvas() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (isReducedMotion()) return false;
  if (canvasCapability !== null) return canvasCapability;
  try {
    const probe = document.createElement('canvas');
    const context = typeof probe.getContext === 'function' ? probe.getContext('2d') : null;
    canvasCapability = Boolean(context);
  } catch {
    canvasCapability = false;
  }
  return canvasCapability;
}

function totalLiveCount() {
  let count = 0;
  for (const layer of layers) {
    count += layer.live.length;
  }
  return count;
}

function trimOldestParticle() {
  for (const layer of layers) {
    if (layer.live.length > 0) {
      layer.live.shift();
      return;
    }
  }
}

function clearAllLayers() {
  for (const layer of layers) {
    layer.live.length = 0;
    layer.dirty = false;
    if (layer.g && layer.c) {
      layer.g.setTransform(1, 0, 0, 1, 0, 0);
      layer.g.clearRect(0, 0, layer.c.width, layer.c.height);
    }
  }
}

function stopLoop() {
  if (rafId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(rafId);
  }
  rafId = null;
  running = false;
  clearAllLayers();
}

function tickFrame(nowMs) {
  if (!running) return;
  const rawDt = lastFrameMs ? (nowMs - lastFrameMs) / 1000 : 0.016;
  const dt = clamp(rawDt, 0.001, 0.034);
  lastFrameMs = nowMs;
  clockNow += dt;

  if (isReducedMotion()) {
    timers.length = 0;
    for (const fn of frameUpdaters) fn(1);
    frameUpdaters.clear();
    stopLoop();
    return;
  }

  // Run scheduled animation-clock callbacks (e.g. Beat 2 & staggered smoke rings)
  if (timers.length) {
    const due = [];
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      if (timers[i].at <= clockNow) {
        due.push(timers[i]);
        timers.splice(i, 1);
      }
    }
    due.sort((a, b) => a.at - b.at);
    for (const q of due) q.fn();
  }

  // Run lightweight spring frame updaters (auto-remove when settled)
  if (frameUpdaters.size) {
    for (const fn of [...frameUpdaters]) {
      const keep = fn(dt, clockNow);
      if (keep === false) {
        frameUpdaters.delete(fn);
      }
    }
  }

  dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const vw = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
  const vh = typeof window !== 'undefined' ? (window.innerHeight || 900) : 900;
  const rectCache = new Map();
  const getCachedRect = (el) => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    let rect = rectCache.get(el);
    if (!rect) {
      rect = el.getBoundingClientRect();
      rectCache.set(el, rect);
    }
    return rect;
  };

  for (const layer of layers) {
    if (!layer.isFront && (!layer.c || !layer.c.isConnected)) {
      layer.live.length = 0;
      layer.dirty = false;
      continue;
    }

    const hasPersistent = layer.isFront && persistentRenderers.size > 0;
    if (!layer.live.length && !layer.dirty && !hasPersistent) continue;

    for (let i = layer.live.length - 1; i >= 0; i -= 1) {
      const item = layer.live[i];
      item.t += dt;
      if (item.dead || item.t >= item.life || (item.anchor && !item.anchor.isConnected)) {
        item.dead = true;
        layer.live.splice(i, 1);
      }
    }

    let backRect = null;
    if (layer.isFront) {
      syncFrontSize();
    } else if (layer.c) {
      backRect = getCachedRect(layer.c);
      if (backRect) {
        const bw = Math.max(1, Math.round(backRect.width * dpr));
        const bh = Math.max(1, Math.round(backRect.height * dpr));
        if (layer.c.width !== bw) layer.c.width = bw;
        if (layer.c.height !== bh) layer.c.height = bh;
      }
    }

    const g = layer.g;
    if (g && layer.c) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, layer.c.width / dpr, layer.c.height / dpr);
      if (!layer.isFront && backRect) {
        g.translate(-backRect.left, -backRect.top);
      }
      g.lineJoin = 'round';
      g.lineCap = 'round';

      if (layer.isFront) {
        for (const renderer of persistentRenderers) {
          g.save();
          try {
            renderer(g, dt, clockNow);
          } finally {
            g.restore();
          }
        }
      }

      for (const item of layer.live) {
        let dx = 0;
        let dy = 0;
        if (item.anchor) {
          if (!item.anchor.isConnected) {
            item.dead = true;
            continue;
          }
          const cur = getCachedRect(item.anchor);
          if (!cur) continue;
          if (item.hasOriginBox && cur.width === 0 && cur.height === 0) continue;
          if (
            item.hasOriginBox &&
            (cur.bottom < -320 || cur.top > vh + 320 || cur.right < -320 || cur.left > vw + 320)
          ) {
            continue;
          }
          dx = cur.left + cur.width / 2 - item.originX;
          dy = cur.top + cur.height / 2 - item.originY;
        }

        const progress = clamp(item.t / item.life, 0, 1);
        g.save();
        try {
          if (layer.isFront && item.clipEl && item.clipEl.isConnected) {
            const cr = getCachedRect(item.clipEl);
            if (cr && cr.width > 0 && cr.height > 0) {
              g.beginPath();
              g.rect(cr.left, cr.top, cr.width, cr.height);
              g.clip();
            }
          }
          if (dx !== 0 || dy !== 0) {
            g.translate(dx, dy);
          }
          item.draw(g, progress, item.t, dt);
        } finally {
          g.restore();
        }
      }
    } else if (layer.isFront) {
      for (const renderer of persistentRenderers) {
        renderer(null, dt, clockNow);
      }
    }

    layer.dirty = layer.live.length > 0 || hasPersistent;
  }

  const anyLive =
    timers.length > 0 ||
    frameUpdaters.size > 0 ||
    persistentRenderers.size > 0 ||
    layers.some((l) => l.live.length > 0 || l.dirty);

  if (!anyLive) {
    stopLoop();
    return;
  }

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    rafId = window.requestAnimationFrame(tickFrame);
  } else {
    stopLoop();
  }
}

function ensureRunning() {
  if (running) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  ensureFrontCanvas();
  running = true;
  lastFrameMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  rafId = window.requestAnimationFrame(tickFrame);
}

/**
 * Registers an element-local canvas positioned behind its host control (z-index: -1)
 * so spiky bursts render cleanly behind buttons and progress bars without hiding text.
 */
export function registerBackLayer(canvas) {
  if (!canvas) {
    return { layer: null, dispose: () => {} };
  }
  let g = null;
  try {
    g = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    g = null;
  }
  const layer = {
    c: canvas,
    g,
    live: [],
    dirty: false,
    isFront: false
  };
  layers.push(layer);
  return {
    layer,
    dispose() {
      layer.live.length = 0;
      layer.dirty = false;
      const idx = layers.indexOf(layer);
      if (idx > 0) layers.splice(idx, 1);
    }
  };
}

/**
 * Schedules a callback on the shared rAF animation clock (auto-skipped under reduced motion).
 */
export function schedule(delayMs, fn) {
  if (typeof document === 'undefined' || !document.body) return;
  if (isReducedMotion() || typeof fn !== 'function') return;
  timers.push({ at: clockNow + Math.max(0, delayMs) / 1000, fn });
  ensureRunning();
}

/**
 * Registers a spring/DOM updater that runs on the shared rAF loop until it returns false.
 */
export function addFrameUpdater(fn) {
  if (typeof fn !== 'function') return () => {};
  frameUpdaters.add(fn);
  ensureRunning();
  return () => {
    frameUpdaters.delete(fn);
  };
}

/**
 * Schedules a short-lived canvas effect on either the global front overlay or a component backLayer.
 */
export function addEffect(lifeSec, drawFn, layerOrOptions) {
  if (typeof document === 'undefined' || !document.body) return null;
  if (isReducedMotion()) return null;
  if (typeof drawFn !== 'function' || !(lifeSec > 0)) return null;

  const opts = layerOrOptions && typeof layerOrOptions === 'object' ? layerOrOptions : null;
  const targetLayer = opts && opts.layer ? opts.layer : frontLayer;
  const weight = typeof layerOrOptions === 'number' ? layerOrOptions : (opts && opts.weight) || 1;
  const anchor = opts && opts.anchor ? opts.anchor : null;
  const clipEl = opts && 'clipEl' in opts
    ? opts.clipEl
    : (anchor ? findScrollClipContainer(anchor) : null);

  let originX = 0;
  let originY = 0;
  let hasOriginBox = false;
  if (anchor && typeof anchor.getBoundingClientRect === 'function') {
    const ar = anchor.getBoundingClientRect();
    originX = ar.left + ar.width / 2;
    originY = ar.top + ar.height / 2;
    hasOriginBox = ar.width > 0 || ar.height > 0;
  }

  while (totalLiveCount() >= MAX_PARTICLES) {
    trimOldestParticle();
  }

  const entry = {
    t: 0,
    life: lifeSec,
    weight,
    dead: false,
    anchor,
    clipEl,
    originX,
    originY,
    hasOriginBox,
    draw: drawFn
  };
  targetLayer.live.push(entry);
  ensureRunning();
  return entry;
}

/**
 * Registers a persistent per-frame renderer (e.g. for an active ImpactProgress bar).
 */
export function addPersistentRenderer(renderFn) {
  if (typeof renderFn !== 'function') return () => {};
  persistentRenderers.add(renderFn);
  ensureRunning();
  return () => {
    persistentRenderers.delete(renderFn);
    if (
      !timers.length &&
      !frameUpdaters.size &&
      !persistentRenderers.size &&
      layers.every((l) => !l.live.length && !l.dirty)
    ) {
      stopLoop();
    }
  };
}

export function isRunning() {
  return running;
}

export function getActiveEffectCount() {
  return totalLiveCount();
}

export function resetStageForTests() {
  timers.length = 0;
  frameUpdaters.clear();
  persistentRenderers.clear();
  layers.splice(1);
  stopLoop();
  if (resizeBound && typeof window !== 'undefined') {
    window.removeEventListener('resize', syncFrontSize);
    resizeBound = false;
  }
  if (frontLayer.c && frontLayer.c.parentNode) {
    frontLayer.c.parentNode.removeChild(frontLayer.c);
  }
  frontLayer.c = null;
  frontLayer.g = null;
  canvasCapability = null;
  lastFrameMs = 0;
  clockNow = 0;
}
