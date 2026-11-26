import { isReducedMotion, readVfxPalette } from './palette.js';
import { addEffect, schedule } from './stage.js';
import { clamp, easeInCubic, easeOutBack, easeOutCubic, lerp } from './spring.js';

const TAU = Math.PI * 2;
const lastImpactByElement = new WeakMap();

function rnd(min = 1, max) {
  if (max === undefined) return Math.random() * min;
  return min + Math.random() * (max - min);
}

function getViewportRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    w: r.width,
    h: r.height,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2
  };
}

function resolveScrollAnchor(el) {
  if (!el || typeof el !== 'object') return null;
  if (typeof el.closest === 'function') {
    const host = el.closest('.bdu-impact-wrap, .bdu-impact-progress__stage');
    if (host) return host;
  }
  return el;
}

function getPath2D() {
  return typeof window !== 'undefined' && typeof window.Path2D === 'function' ? window.Path2D : null;
}

function buildPolygonPath(points) {
  const P2D = getPath2D();
  if (!P2D || !points.length) return null;
  const path = new P2D();
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i];
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/**
 * Cel-shaded cloud/smoke blob:
 * unifies all circles into ONE Path2D, strokes unified ink outline, clips,
 * fills cel-shadow tone, offsets top-left for crisp highlight, and draws inner cumulus arcs.
 */
function drawCelBlob(ctx, circles, palette, lw = 1.5, { lx = -1, arcs = false, deep = 1 } = {}) {
  const P2D = getPath2D();
  if (!P2D || !circles.length) return;
  const u = new P2D();
  for (const [x, y, r] of circles) {
    if (r > 0.3) {
      u.moveTo(x + r, y);
      u.arc(x, y, r, 0, TAU);
    }
  }

  ctx.save();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = palette.line;
  ctx.stroke(u);
  ctx.restore();

  ctx.save();
  ctx.clip(u);
  ctx.fillStyle = palette.shade;
  ctx.fillRect(-1e4, -1e4, 2e4, 2e4);
  const r0 = circles[0] ? circles[0][2] : 8;
  ctx.save();
  ctx.translate(lx * r0 * 0.2 * deep, -r0 * 0.26 * deep);
  ctx.fillStyle = palette.fill;
  ctx.fill(u);
  ctx.restore();

  if (arcs) {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = lw * 0.75;
    ctx.beginPath();
    for (const [x, y, rr] of circles) {
      if (rr > 3) {
        ctx.moveTo(x + Math.cos(-2.7) * rr, y + Math.sin(-2.7) * rr);
        ctx.arc(x, y, rr, -2.7, -0.5);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Cel-shaded closed polygon/star shape with crisp outline and 2-tone offset fill.
 */
function drawCelShape(ctx, path, palette, lw = 1.4, off = 3, fill = palette.fill) {
  if (!path) return;
  ctx.save();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = palette.line;
  ctx.stroke(path);
  ctx.restore();

  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = palette.shade;
  ctx.fillRect(-1e4, -1e4, 2e4, 2e4);
  ctx.translate(-off * 0.7, -off);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.restore();
}

function drawWedgeTicks(ctx, x, y, { n = 3, r = 14, len = 10, dir = -0.8, fan = 0.42, color }) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const angle = dir + (i - (n - 1) / 2) * fan;
    const r0 = r;
    const r1 = r + len;
    const hw = 0.075 + 2.2 / (r1 + 8);
    ctx.moveTo(x + Math.cos(angle) * r0, y + Math.sin(angle) * r0);
    ctx.lineTo(x + Math.cos(angle - hw) * r1, y + Math.sin(angle - hw) * r1);
    ctx.lineTo(x + Math.cos(angle + hw) * r1, y + Math.sin(angle + hw) * r1);
    ctx.closePath();
  }
  ctx.fill();
}

function drawSparkleStar(ctx, x, y, radius, rot, fill, stroke) {
  if (radius < 0.8) return;
  const q = radius * 0.16;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.quadraticCurveTo(q, -q, radius * 0.72, 0);
  ctx.quadraticCurveTo(q, q, 0, radius);
  ctx.quadraticCurveTo(-q, q, -radius * 0.72, 0);
  ctx.quadraticCurveTo(-q, -q, 0, -radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}

function spawnTicks(x, y, { n = 3, r = 14, len = 12, dir = -Math.PI / 2, fan = 0.45, life = 0.38, color, anchor = null }) {
  addEffect(life, (ctx, k) => {
    const a = easeOutCubic(clamp(k / 0.5));
    const b = easeInCubic(clamp((k - 0.4) / 0.6));
    const r0 = r + len * b * 1.25;
    const r1 = r + len * a * 1.25;
    if (r1 - r0 < 0.6) return;
    drawWedgeTicks(ctx, x, y, { n, r: r0, len: r1 - r0, dir, fan, color });
  }, { anchor });
}

function spawnWobbleArcs(x, y, { dir = 1, r = 16, life = 0.42, color, anchor = null }) {
  addEffect(life, (ctx, k) => {
    const lw = 2.2 * (1 - k);
    if (lw < 0.2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const c = dir > 0 ? 0 : Math.PI;
    for (const d of [0, 7]) {
      const rr = r + d + easeOutCubic(k) * 8;
      ctx.moveTo(x - dir * r + Math.cos(c - 0.45) * rr, y + Math.sin(c - 0.45) * rr);
      ctx.arc(x - dir * r, y, rr, c - 0.45, c + 0.45);
    }
    ctx.stroke();
  }, { anchor });
}

function spawnSpeedLines(x, y, { n = 3, dir = Math.PI, len = 36, spread = 12, life = 0.28, color, anchor = null }) {
  for (let i = 0; i < n; i += 1) {
    const offset = rnd(-spread, spread);
    const length = len * rnd(0.55, 1.25);
    const delay = rnd(0, 0.22);
    const width = rnd(1.1, 2.5);
    addEffect(life, (ctx, k) => {
      const kk = clamp((k - delay) / (1 - delay));
      if (kk <= 0) return;
      const a = easeOutCubic(kk);
      const b = easeInCubic(kk);
      const px = x - Math.sin(dir) * offset;
      const py = y + Math.cos(dir) * offset;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.2, width * (1 - b));
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(dir) * length * b * 1.4, py + Math.sin(dir) * length * b * 1.4);
      ctx.lineTo(px + Math.cos(dir) * length * (0.2 + a * 1.2), py + Math.sin(dir) * length * (0.2 + a * 1.2));
      ctx.stroke();
    }, { anchor });
  }
}

function spawnPuff(x, y, { n = 5, size = 13, vx = 0, vy = -18, life = 0.85, spread = 1, palette, anchor = null }) {
  const lobes = Array.from({ length: n }, (_, i) => ({
    a: (i / n) * TAU + rnd(0.6),
    d: rnd(0.25, 0.9) * size * spread,
    r: rnd(0.55, 1) * size,
    ph: rnd(TAU),
    sp: rnd(0.6, 1.3)
  }));
  lobes.unshift({ a: 0, d: 0, r: size, ph: 0, sp: 1 });

  addEffect(life, (ctx, k, t) => {
    const grow = easeOutBack(clamp(t / 0.22));
    const die = 1 - easeInCubic(clamp((k - 0.55) / 0.45));
    const px = x + vx * easeOutCubic(k) * life;
    const py = y + vy * easeOutCubic(k) * life;
    const circles = lobes.map((l) => [
      px + Math.cos(l.a + t * 0.9 * l.sp) * l.d * (0.5 + easeOutCubic(k) * 0.9),
      py + Math.sin(l.a + t * 0.9 * l.sp) * l.d * (0.5 + easeOutCubic(k) * 0.9) - easeOutCubic(k) * 5 * l.sp,
      l.r * grow * die * (1 + Math.sin(t * 9 + l.ph) * 0.05)
    ]);
    drawCelBlob(ctx, circles, palette, 1.5, { lx: 0.5, arcs: size > 6.5, deep: 1.5 });
  }, { anchor });
}

/**
 * Anime impact star:
 * accent pins + shaded star + crisp cel-shaded star, exiting via hollowing points.
 */
function spawnSpikyBurst(x, y, { r = 90, spikes = 17, life = 0.48, layer, palette, anchor = null }) {
  const jitter = Array.from({ length: spikes * 2 }, (_, i) => (i % 2 ? rnd(0.34, 0.5) : rnd(0.75, 1.15)));
  const rot = rnd(TAU);
  const pins = Array.from({ length: 8 }, (_, i) => ({
    a: (i / 8) * TAU + rnd(0.5),
    l: rnd(1.25, 1.75),
    w: rnd(0.03, 0.055)
  }));

  addEffect(life, (ctx, k) => {
    const P2D = getPath2D();
    if (!P2D) return;
    const R = r * easeOutCubic(clamp(k / 0.3));
    const hollow = 1 + easeInCubic(clamp((k - 0.35) / 0.65)) * 1.3;
    const r0 = R * 0.6 * Math.min(1.9, hollow);

    const star = (rad, turn, inner = 1) => {
      const p = new P2D();
      for (let i = 0; i < jitter.length; i += 1) {
        const a = rot + turn + (i / jitter.length) * TAU;
        const rr = rad * (i % 2 ? jitter[i] * inner : jitter[i]);
        const sx = x + Math.cos(a) * rr;
        const sy = y + Math.sin(a) * rr;
        if (i === 0) p.moveTo(sx, sy);
        else p.lineTo(sx, sy);
      }
      p.closePath();
      return p;
    };

    ctx.save();
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    for (const pin of pins) {
      const l = R * pin.l;
      if (l <= r0) continue;
      ctx.moveTo(x + Math.cos(pin.a - pin.w) * r0, y + Math.sin(pin.a - pin.w) * r0);
      ctx.lineTo(x + Math.cos(pin.a) * l, y + Math.sin(pin.a) * l);
      ctx.lineTo(x + Math.cos(pin.a + pin.w) * r0, y + Math.sin(pin.a + pin.w) * r0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();

    const big = star(R * 1.16, 0.19, hollow);
    ctx.save();
    ctx.fillStyle = palette.shade;
    ctx.fill(big);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.4;
    ctx.stroke(big);
    ctx.restore();

    drawCelShape(ctx, star(R * 0.84, 0, hollow), palette, 1.4, 3);
  }, { layer, anchor });
}

/**
 * Tumbling cel-shaded crystal shards with inner facet crease line.
 */
function spawnShards(x, y, { n = 11, speed = 250, size = 8.5, life = 0.9, dir = -Math.PI / 2, arc = TAU, grav = 300, palette, anchor = null }) {
  for (let i = 0; i < n; i += 1) {
    const a = dir + rnd(-arc, arc) / 2;
    const v = speed * rnd(0.5, 1.15);
    const s = size * rnd(0.6, 1.35);
    const spin = rnd(-7, 7);
    const pts = [[-1.4, 0.1], [-0.6, -0.7], [1.2, -0.45], [1.5, 0.15], [0.4, 0.75]].map(([px, py]) => [
      px * rnd(0.8, 1.2),
      py * rnd(0.8, 1.2)
    ]);
    const shardFill = i % 3 === 0 ? palette.pop : palette.fill;

    addEffect(life * rnd(0.7, 1), (ctx, k, t) => {
      const px = x + Math.cos(a) * v * t;
      const py = y + Math.sin(a) * v * t + grav * t * t;
      const sc = s * (1 - easeInCubic(clamp((k - 0.6) / 0.4)));
      if (sc <= 0.6) return;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(spin * t + a);
      const path = buildPolygonPath(pts.map(([u, w]) => [u * sc, w * sc]));
      drawCelShape(ctx, path, palette, 1.1, sc * 0.45, shardFill);
      if (sc > 2.5) {
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 0.95;
        ctx.beginPath();
        ctx.moveTo(pts[1][0] * sc, pts[1][1] * sc);
        ctx.lineTo(pts[4][0] * sc, pts[4][1] * sc);
        ctx.stroke();
      }
      ctx.restore();
    }, { anchor });
  }
}

/**
 * Lumpy drifting anime smoke ring with cel-shaded thickness.
 */
function spawnDonut(x, y, { r = 24, vx = 24, vy = -50, life = 1.15, tilt = -0.25, palette, anchor = null }) {
  const ph = rnd(TAU);
  addEffect(life, (ctx, k, t) => {
    const P2D = getPath2D();
    if (!P2D) return;
    const s = easeOutBack(clamp(t / 0.22)) * (1 - easeInCubic(clamp((k - 0.6) / 0.4)));
    if (s < 0.03) return;
    const px = x + vx * easeOutCubic(k) * life;
    const py = y + vy * easeOutCubic(k) * life;
    const hole = 0.42 + 0.22 * k;
    const p = new P2D();

    for (const [m, bump] of [[1, 0.09], [hole, 0.05]]) {
      for (let i = 0; i <= 48; i += 1) {
        const a = (i / 48) * TAU;
        const rr = r * s * m * (1 + bump * Math.sin(a * 9 + ph + t * 2));
        const ex = Math.cos(a) * rr;
        const ey = Math.sin(a) * rr * 0.52;
        const sx = px + ex * Math.cos(tilt) - ey * Math.sin(tilt);
        const sy = py + ex * Math.sin(tilt) + ey * Math.cos(tilt);
        if (i === 0) p.moveTo(sx, sy);
        else p.lineTo(sx, sy);
      }
    }

    ctx.save();
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = palette.line;
    ctx.stroke(p);
    ctx.restore();

    ctx.save();
    ctx.clip(p, 'evenodd');
    ctx.fillStyle = palette.shade;
    ctx.fillRect(-1e4, -1e4, 2e4, 2e4);
    ctx.translate(r * 0.06, -r * 0.2);
    ctx.fillStyle = palette.fill;
    ctx.fill(p, 'evenodd');
    ctx.restore();
  }, { anchor });
}

/**
 * Tier 1 press-down charge: 3 inward wedges above, side wobble arcs, and bottom speed lines.
 */
export function spawnPressCharge(el, tone = 'primary') {
  if (isReducedMotion()) return;
  const r = getViewportRect(el);
  if (!r) return;
  const anchor = resolveScrollAnchor(el);
  const palette = readVfxPalette(tone);
  spawnTicks(r.cx, r.top - 6, { n: 3, r: 4, len: 14, dir: -Math.PI / 2, fan: 0.5, life: 0.34, color: palette.accent, anchor });
  spawnWobbleArcs(r.left - 6, r.cy, { dir: -1, r: 10, life: 0.3, color: palette.line, anchor });
  spawnWobbleArcs(r.right + 6, r.cy, { dir: 1, r: 10, life: 0.3, color: palette.line, anchor });
  spawnSpeedLines(r.cx, r.bottom + 10, { n: 3, dir: 0, len: 16, spread: 8, life: 0.25, color: palette.line, anchor });
}

/**
 * Tier 1 two-beat anime impact burst:
 * Beat 1 (0ms): spiky burst behind button + 11 cel-shards + 4 corner clouds + ticks.
 * Beat 2 (195ms): button spring-tall callback + wobble arcs + 3 drifting smoke rings + bottom shards.
 */
export function spawnImpactBurst(el, tone = 'primary', { backLayer = null, onSecondBeat = null } = {}) {
  if (isReducedMotion()) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (el && typeof el === 'object') {
    const prev = lastImpactByElement.get(el);
    if (prev !== undefined && now - prev < 90) return;
    lastImpactByElement.set(el, now);
  }

  const r = getViewportRect(el);
  if (!r) return;
  const anchor = resolveScrollAnchor(el);
  const palette = readVfxPalette(tone);

  // Beat 1: Behind-button spiky burst + shards + 4 corner puffs + upper-corner ticks
  spawnSpikyBurst(r.cx, r.cy, {
    r: clamp(r.w * 0.48, 66, 98),
    spikes: 17,
    life: 0.48,
    layer: backLayer,
    palette,
    anchor
  });
  spawnShards(r.cx, r.cy, { n: 11, speed: 255, size: 8.5, life: 0.92, arc: TAU, grav: 300, palette, anchor });
  for (const [dx, dy] of [[-1, -0.5], [1, -1], [-1, 0.9], [1, 1]]) {
    spawnPuff(r.cx + dx * (r.w / 2 + 6), r.cy + dy * 24, {
      size: rnd(11, 15),
      n: 5,
      vx: dx * 44,
      vy: dy * 28 - 6,
      life: rnd(0.72, 1.0),
      palette,
      anchor
    });
  }
  spawnTicks(r.cx - 88, r.cy - 62, { dir: -2.4, n: 2, r: 4, len: 20, life: 0.44, color: palette.accent, anchor });
  spawnTicks(r.cx + 98, r.cy - 54, { dir: -0.7, n: 2, r: 4, len: 20, life: 0.44, color: palette.accent, anchor });

  // Beat 2: Tall spring pop + side wobbles + 3 rising smoke rings + bottom crystal drops
  schedule(195, () => {
    if (anchor && !anchor.isConnected) return;
    onSecondBeat?.();
    const cur = getViewportRect(el) || r;
    spawnWobbleArcs(cur.left - 8, cur.cy, { dir: -1, r: 15, life: 0.42, color: palette.line, anchor });
    spawnWobbleArcs(cur.right + 8, cur.cy, { dir: 1, r: 15, life: 0.42, color: palette.line, anchor });
    spawnDonut(cur.cx + 6, cur.cy - 42, { r: 28, vx: 22, vy: -50, life: 1.2, palette, anchor });
    schedule(90, () => {
      if (anchor && !anchor.isConnected) return;
      const c2 = getViewportRect(el) || cur;
      spawnDonut(c2.cx + 50, c2.cy - 48, { r: 17, vx: 32, vy: -38, life: 1.05, palette, anchor });
    });
    schedule(170, () => {
      if (anchor && !anchor.isConnected) return;
      const c3 = getViewportRect(el) || cur;
      spawnDonut(c3.cx + 80, c3.cy - 44, { r: 10, vx: 38, vy: -28, life: 0.92, palette, anchor });
    });
    spawnShards(cur.cx - 28, cur.cy + 28, { n: 2, speed: 22, size: 5.5, dir: Math.PI / 2, arc: 1, grav: 380, life: 0.75, palette, anchor });
    spawnShards(cur.cx + 32, cur.cy + 28, { n: 2, speed: 22, size: 5.5, dir: Math.PI / 2, arc: 1, grav: 380, life: 0.75, palette, anchor });
  });
}

/**
 * Tier 2 micro-impact tap: 3 crisp corner wedges (~440ms).
 */
export function spawnMicroTap(el, tone = 'primary') {
  if (isReducedMotion()) return;
  const r = getViewportRect(el);
  if (!r) return;
  const anchor = resolveScrollAnchor(el);
  const palette = readVfxPalette(tone);
  spawnTicks(r.right - 8, r.top - 2, {
    n: 3,
    r: 5,
    len: 16,
    dir: -1.05,
    fan: 0.36,
    life: 0.46,
    color: palette.accent,
    anchor
  });
}

/**
 * Completion glint next to the checkmark on ImpactButton.
 */
export function spawnDoneSpark(el, tone = 'success') {
  if (isReducedMotion()) return;
  const r = getViewportRect(el);
  if (!r) return;
  const anchor = resolveScrollAnchor(el);
  const palette = readVfxPalette(tone);
  const x = r.right - 14;
  const y = r.top + 4;
  addEffect(0.6, (ctx, k, t) => {
    const rad = 14 * Math.pow(Math.sin(k * Math.PI), 0.6);
    drawSparkleStar(ctx, x, y, rad, Math.sin(t * 3) * 0.2, palette.fill, palette.accent);
  }, { anchor });
  spawnTicks(x + 10, y - 10, { n: 2, r: 6, len: 12, dir: -0.8, fan: 0.42, life: 0.38, color: palette.accent, anchor });
}

const STORM_LOBES = [
  [0, -0.95, 1],
  [0.78, -0.55, 0.74],
  [-0.72, -0.78, 0.72],
  [0.36, -1.7, 0.7],
  [-0.4, -1.62, 0.62],
  [1.1, -1.32, 0.52],
  [-1.18, -0.28, 0.52],
  [0.62, 0.3, 0.5],
  [-0.86, 0.5, 0.52],
  [-1.5, 0.82, 0.38],
  [-2.05, 1.0, 0.24],
  [0.16, 0.72, 0.4]
];

/**
 * Draws the storm-cloud progress overlay onto the shared Canvas 2D stage.
 */
export function renderProgressOverlay(ctx, barRect, state, palette, dt, tt, anchorEl = null) {
  if (!ctx || !barRect || barRect.width <= 0 || barRect.height <= 0) return;
  const anchor = resolveScrollAnchor(anchorEl);

  const L = barRect.left;
  const R = barRect.right;
  const cx = L + barRect.width / 2;
  const cy = barRect.top + barRect.height / 2;
  const p = clamp(state.p, 0, 1);
  const done = Boolean(state.done);
  const lead = L + 4 + (barRect.width - 8) * p;
  const gy = barRect.bottom + 28;

  // Ground line & blades
  const reach = clamp(p * 1.25 + (done ? 1 : 0), 0, 1);
  const gx1 = lerp(L + 10, R - 10, reach);
  if (reach > 0.02) {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(L + 10, gy);
    ctx.lineTo(gx1, gy);
    for (let x = L + 26; x < gx1 - 6; x += 37) {
      ctx.moveTo(x, gy);
      ctx.lineTo(x + 3, gy - 4);
      ctx.moveTo(x + 5, gy);
      ctx.lineTo(x + 6.5, gy - 2.5);
    }
    ctx.stroke();
  }

  // Cel-shaded pebbles lifting as the edge passes + accent pop ticks
  for (const q of state.pebbles) {
    const px = L + barRect.width * q.u;
    q.lift.to = !done && lead > px - 16 ? 1 : 0;
    const up = Math.max(0, q.lift.step(dt));
    if (reach < q.u - 0.04 && up < 0.01) continue;
    const py = gy - q.s * 0.7 - up * (7 + q.s * 1.5) + Math.sin(tt * 3 + q.ph) * 2 * up;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(q.rot + up * Math.sin(tt * 2 + q.ph) * 0.5);
    drawCelShape(ctx, buildPolygonPath(q.pts.map(([ux, uy]) => [ux * q.s, uy * q.s])), palette, 1.1, q.s * 0.5);
    ctx.restore();

    if (up > 0.15 && up < 0.9 && q.lift.v > 0.6) {
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (const a of [-1.9, -1.57, -1.24]) {
        ctx.moveTo(px + Math.cos(a) * (q.s + 5), py + Math.sin(a) * (q.s + 5));
        ctx.lineTo(px + Math.cos(a) * (q.s + 11), py + Math.sin(a) * (q.s + 11));
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Trailing puffs, speed lines, and occasional leading-edge accent ticks
  if (!done && p > 0.06 && state.spd > 0.02) {
    state.emitAcc += dt * (4 + state.spd * 60);
    while (state.emitAcc >= 1) {
      state.emitAcc -= 1;
      const S = 10 + 25 * Math.sqrt(p);
      if (Math.random() < 0.5) {
        spawnPuff(lead - S * rnd(0.9, 1.6), barRect.top - S * rnd(0.1, 0.9), {
          size: rnd(3, 5.5) + p * 3,
          n: 2,
          vx: -rnd(40, 90),
          vy: rnd(-12, 4),
          life: rnd(0.4, 0.7),
          palette,
          anchor
        });
      } else {
        spawnSpeedLines(lead - S * 1.4, barRect.top - S * rnd(0.2, 1.3), {
          n: 1,
          dir: Math.PI,
          len: 30 + state.spd * 160,
          spread: 3,
          life: 0.3,
          color: palette.line,
          anchor
        });
      }
      if (Math.random() < 0.16) {
        spawnTicks(lead + S * 1.1, barRect.top - S * 1.5, { dir: -0.7, n: 3, r: 4, len: 8, life: 0.35, color: palette.accent, anchor });
      }
    }
  }

  // Rolling 12-lobe storm cloud at leading edge
  state.cloudSize.to = done || p < 0.015 ? 0 : 10 + 25 * Math.sqrt(p);
  state.lag.to = state.spd;
  const S = Math.max(0, state.cloudSize.step(dt));
  const drag = state.lag.step(dt);
  if (S > 0.6) {
    const lobes = STORM_LOBES.map(([lx, ly, lr], idx) => {
      const w = 1.4 + (idx % 4) * 0.3;
      const ph = idx * 0.9;
      const boil = 1 + 0.16 * Math.sin(tt * w + ph);
      const roll = 0.82 + 0.22 * Math.sin(tt * 2.6 - idx * 0.9);
      return [
        lead + 3 + (lx + Math.cos(tt * w * 0.7 + ph) * 0.1 - drag * 1.6 * Math.max(0, -ly) * 0.5) * S,
        cy - 3 + (ly + Math.sin(tt * w * 0.7 + ph) * 0.1) * S,
        lr * S * boil * roll
      ];
    });
    drawCelBlob(ctx, lobes, palette, 1.6, { lx: 1, arcs: true, deep: 1.7 });
  }

  // Two resting clouds + ground puffs after completion
  state.rest.to = done ? 1 : 0;
  const rs = Math.max(0, state.rest.step(dt));
  if (rs > 0.02) {
    for (const [rx, d] of [[L + 34, -1], [R - 40, 1]]) {
      const resting = [
        [rx, gy - 9 * rs, 8 * rs],
        [rx + 8 * d, gy - 6 * rs, 6 * rs],
        [rx - 6 * d, gy - 5 * rs, 5.5 * rs],
        [rx + 2 * d, gy - 15 * rs, 5.5 * rs]
      ].map(([cx0, cy0, rr], n) => [cx0, cy0, rr * (1 + Math.sin(tt * 3 + n) * 0.06)]);
      drawCelBlob(ctx, resting, palette, 1.3, { lx: 1, arcs: true });
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(rx + d * 18, gy - 6);
      ctx.lineTo(rx + d * 25, gy - 6);
      ctx.moveTo(rx + d * 19, gy - 1.5);
      ctx.lineTo(rx + d * 23, gy - 1.5);
      ctx.stroke();
    }
  }

  // Spring-popping completion checkmark + 4 accent bursts + sparkle star above bar
  state.check.to = done ? 1 : 0;
  const c = Math.max(0, state.check.step(dt));
  if (c > 0.02) {
    ctx.save();
    ctx.translate(cx + 4, barRect.top - 48);
    ctx.rotate((1 - c) * -0.5);
    ctx.scale(c, c);

    ctx.save();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 9;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-26, 2);
    ctx.lineTo(-7, 20);
    ctx.lineTo(28, -24);
    ctx.stroke();

    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (const [a, d] of [[-2.6, 54], [-2.95, 56], [-0.35, 52], [-0.1, 56]]) {
      ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d * 0.7);
      ctx.lineTo(Math.cos(a) * (d + 13), Math.sin(a) * (d + 13) * 0.7);
    }
    ctx.stroke();
    ctx.restore();

    drawSparkleStar(ctx, 68, 22, 14 * (0.9 + 0.1 * Math.sin(tt * 5)), 0, palette.fill, palette.ink);
    ctx.restore();
  }
}

/**
 * Fires the 100% completion burst around & behind the progress bar.
 */
export function spawnProgressCompleteBurst(el, tone = 'primary', backLayer = null) {
  if (isReducedMotion()) return;
  const r = getViewportRect(el);
  if (!r) return;
  const anchor = resolveScrollAnchor(el);
  const palette = readVfxPalette(tone);
  spawnSpikyBurst(r.right - 72, r.cy, { r: 90, spikes: 15, life: 0.5, layer: backLayer, palette, anchor });
  spawnSpikyBurst(r.right - 58, r.cy, { r: 40, spikes: 11, life: 0.3, palette, anchor });
  spawnShards(r.right - 58, r.cy, { n: 11, speed: 265, size: 7, life: 0.9, arc: TAU, grav: 340, palette, anchor });
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + rnd(0.5);
    spawnPuff(r.right - 68 + Math.cos(a) * 68, r.cy + Math.sin(a) * 32, {
      size: rnd(8, 13),
      n: 4,
      vx: Math.cos(a) * 46,
      vy: Math.sin(a) * 30 - 8,
      life: rnd(0.6, 1.0),
      palette,
      anchor
    });
  }
}
