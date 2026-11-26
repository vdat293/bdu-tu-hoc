export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeInCubic(t) {
  const u = clamp(t, 0, 1);
  return u * u * u;
}

export function easeOutBack(t) {
  const u = clamp(t, 0, 1) - 1;
  return 1 + 2.70158 * u * u * u + 1.70158 * u * u;
}

/**
 * Fixed-substep damped spring for crisp overshoot and settle behavior
 * across 60Hz/120Hz/144Hz refresh rates.
 */
export class Spring {
  constructor(initial = 0, stiffness = 320, damping = 20) {
    this.x = initial;
    this.v = 0;
    this.to = initial;
    this.k = stiffness;
    this.d = damping;
  }

  step(dt) {
    if (!(dt > 0)) return this.x;
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      this.v += (-this.k * (this.x - this.to) - this.d * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  isSettled(eps = 0.001) {
    return Math.abs(this.x - this.to) < eps && Math.abs(this.v) < eps;
  }
}

/**
 * 3-spring squash/pop/tilt rig driving inline transform
 * on a target element and clearing transform cleanly once settled.
 */
export function createSquashRig(el, { low = 0.54, k = 520, d = 15, wide = 0.24 } = {}) {
  const s = new Spring(1, k, d);
  const pop = new Spring(1, 300, 12);
  const tilt = new Spring(0, 260, 10);

  return {
    s,
    pop,
    tilt,
    press() {
      if (el && !el.disabled) {
        s.to = low;
      }
    },
    release() {
      s.to = 1;
    },
    reset() {
      s.x = 1;
      s.v = 0;
      s.to = 1;
      pop.x = 1;
      pop.v = 0;
      pop.to = 1;
      tilt.x = 0;
      tilt.v = 0;
      tilt.to = 0;
      if (el) el.style.transform = '';
    },
    step(dt) {
      if (!el || !el.isConnected) return false;
      const y = s.step(dt);
      const p = pop.step(dt);
      const r = tilt.step(dt);
      const still =
        Math.abs(y - 1) < 0.001 &&
        Math.abs(s.v) < 0.01 &&
        Math.abs(p - 1) < 0.001 &&
        Math.abs(pop.v) < 0.01 &&
        Math.abs(r) < 0.02 &&
        Math.abs(tilt.v) < 0.05 &&
        s.to === 1 &&
        pop.to === 1 &&
        tilt.to === 0;

      if (still) {
        if (el.style.transform) el.style.transform = '';
        return false;
      }
      const sx = ((1 + (1 - y) * wide) * p).toFixed(4);
      const sy = (y * p).toFixed(4);
      el.style.transform = `rotate(${r.toFixed(2)}deg) scale(${sx}, ${sy})`;
      return true;
    }
  };
}
