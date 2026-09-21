import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './NotFoundPage.css';

/* Manh mối nằm trong lớp "found" — chỉ tấm kính lúp mới soi ra được. */
const NOTES = [
  { text: 'đã quét sạch', x: 16, y: 64, rotate: -7 },
  { text: 'hồ sơ nguội', x: 62, y: 57, rotate: 4 },
  { text: 'không có ai ở nhà', x: 31, y: 80, rotate: -3 },
  { text: 'soi kỹ 2 lần', x: 72, y: 84, rotate: 5 },
  { text: 'mã lỗi 404', x: 13, y: 88, rotate: -9 },
  { text: 'hết manh mối', x: 83, y: 67, rotate: -5 }
];

/* Nền "Solar flare" kiểu FLOW: 4 stop màu, chia band theo dividers, warp + swirl
   theo thời gian rồi trộn màu bằng trọng số nghịch đảo bình phương khoảng cách. */
export const FLOW_STOPS = ['#FFF6DE', '#FFC24B', '#F4664D', '#8A2E5E'];
export const FLOW_DIVIDERS = [0.25, 0.5, 0.75];
export const FLOW_START_PHASE = 20.75;
const FLOW_SCALE = 50;
const FLOW_DISTORTION = 52;
const FLOW_SWIRL = 10;
const FLOW_SPEED = 28;
const FLOW_FRAME_MS = 1000 / 24;

const FOLLOW_TAU = 0.045;
const IDLE_BEFORE_WANDER = 6000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/* Trộn màu trong Oklab để chỗ chuyển màu giữ được độ bão hoà. */
function oklabFromRgb([red, green, blue]) {
  const r = channelToLinear(red);
  const g = channelToLinear(green);
  const b = channelToLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function rgbFromOklab([l, a, b]) {
  const l3 = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m3 = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s3 = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  ].map((value) => {
    const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, encoded * 255));
  });
}

/* Mỗi màu là một "ring" trôi trên quỹ đạo lissajous quanh tâm field. */
export function flowAnchors(time, count = FLOW_STOPS.length) {
  return Array.from({ length: count }, (_, index) => {
    const seed = index * 0.37;
    const driftX = 0.6 + fract(index / 3) * 0.9;
    const driftY = 0.8 + fract((index + 1) / 4);
    return [
      0.5 + 0.5 * Math.sin(time * driftX + seed),
      0.5 + 0.5 * Math.cos(time * driftY + seed * 1.5)
    ];
  });
}

/* Bề rộng mỗi band màu, chia theo dividers. */
export function flowBandWeights(count, dividers = FLOW_DIVIDERS) {
  const edges = dividers.length === count - 1
    ? dividers
    : Array.from({ length: Math.max(0, count - 1) }, (_, index) => (index + 1) / count);
  const stops = [0, ...edges, 1];
  return Array.from({ length: count }, (_, index) => (stops[index + 1] - stops[index]) * count);
}

/* Vẽ trường flow vào buffer RGBA (tách khỏi canvas để test được thuần). */
export function paintFlowField(data, width, height, time, stops = FLOW_STOPS, dividers = FLOW_DIVIDERS) {
  const colors = stops.map((hex) => oklabFromRgb(hexToRgb(hex)));
  const weights = flowBandWeights(colors.length, dividers);
  const anchors = flowAnchors(time, colors.length);
  const distortion = FLOW_DISTORTION / 100;
  const swirl = FLOW_SWIRL / 100;
  const zoom = 0.4 + (FLOW_SCALE / 100) * 1.2;

  for (let y = 0; y < height; y += 1) {
    const row = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      let u = ((x + 0.5) / width - 0.5) / zoom + 0.5;
      let v = (row - 0.5) / zoom + 0.5;

      const falloff = smoothstep(Math.hypot(u - 0.5, v - 0.5));
      const calm = 1 - falloff;
      for (let octave = 1; octave <= 2; octave += 1) {
        u += distortion * calm / octave
          * Math.sin(time + octave * 0.4 * smoothstep(v))
          * Math.cos(0.2 * time + octave * 2.4 * smoothstep(v));
        v += distortion * calm / octave * Math.cos(time + octave * 2 * smoothstep(u));
      }

      const turn = -3 * swirl * falloff;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const du = u - 0.5;
      const dv = v - 0.5;
      u = cos * du - sin * dv + 0.5;
      v = sin * du + cos * dv + 0.5;

      let red = 0;
      let green = 0;
      let blue = 0;
      let total = 0;
      for (let index = 0; index < colors.length; index += 1) {
        const dx = u - anchors[index][0];
        const dy = v - anchors[index][1];
        const squared = dx * dx + dy * dy;
        const weight = weights[index] / (Math.pow(squared, 1.75) + 1e-4);
        red += colors[index][0] * weight;
        green += colors[index][1] * weight;
        blue += colors[index][2] * weight;
        total += weight;
      }

      const share = 1 / Math.max(1e-4, total);
      const [outRed, outGreen, outBlue] = rgbFromOklab([red * share, green * share, blue * share]);
      const offset = (y * width + x) * 4;
      data[offset] = outRed;
      data[offset + 1] = outGreen;
      data[offset + 2] = outBlue;
      data[offset + 3] = 255;
    }
  }
}

function Floor({ variant }) {
  return (
    <>
      <p className={`nf-glyph nf-glyph-${variant}`} aria-hidden="true">404</p>
      {variant === 'found'
        ? NOTES.map((note) => (
            <span
              key={note.text}
              className="nf-note"
              style={{ left: `${note.x}%`, top: `${note.y}%`, '--nf-note-rotate': `${note.rotate}deg` }}
            >
              {note.text}
            </span>
          ))
        : null}
    </>
  );
}

export default function NotFoundPage() {
  const pageRef = useRef(null);
  const lensRef = useRef(null);
  const canvasRef = useRef(null);

  /* Trang 404 đứng ngoài AppLayout: tự đặt nền sáng vì đây là skin riêng. */
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    document.title = 'Không tìm thấy trang · BDU Tự Học';
    return () => {
      document.documentElement.dataset.theme = 'light';
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add('theme-light');
    };
  }, []);

  /* Nền flow: vẽ ở 1/4 độ phân giải rồi để trình duyệt phóng mượt lên. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let image = null;
    let phase = FLOW_START_PHASE;
    let raf = 0;
    let lastFrame = performance.now();
    let lastPaint = 0;

    const paint = () => {
      if (!image) return;
      paintFlowField(image.data, image.width, image.height, phase);
      context.putImageData(image, 0, 0);
    };

    const measure = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      const boxWidth = Math.max(1, box?.width || canvas.clientWidth || 320);
      const boxHeight = Math.max(1, box?.height || canvas.clientHeight || 240);
      const nextWidth = clamp(Math.round(boxWidth / 4), 140, 400);
      const nextHeight = Math.max(1, Math.round((nextWidth * boxHeight) / boxWidth));
      if (nextWidth === width && nextHeight === height && image) return;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      image = context.createImageData(width, height);
      paint();
    };

    measure();

    const loop = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      phase += (FLOW_SPEED / 100) * 1.2 * dt;
      if (now - lastPaint >= FLOW_FRAME_MS) {
        lastPaint = now;
        paint();
      }
      raf = window.requestAnimationFrame(loop);
    };

    if (!reduced) raf = window.requestAnimationFrame(loop);

    let observer = null;
    if (typeof window.ResizeObserver === 'function') {
      observer = new window.ResizeObserver(() => measure());
      observer.observe(canvas.parentElement || canvas);
    }
    window.addEventListener('resize', measure);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    const lens = lensRef.current;
    if (!page || !lens) return undefined;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const state = { w: 0, h: 0, radius: 72, lx: 0, ly: 0, tx: 0, ty: 0, wander: 0, lastPointer: -1e9 };

    const measure = () => {
      const rect = page.getBoundingClientRect();
      state.w = rect.width;
      state.h = rect.height;
      const radius = parseFloat(window.getComputedStyle(page).getPropertyValue('--nf-lens-r'));
      state.radius = Number.isFinite(radius) && radius > 0 ? radius : 72;
    };

    const paint = () => {
      page.style.setProperty('--nf-lx', `${state.lx.toFixed(2)}px`);
      page.style.setProperty('--nf-ly', `${state.ly.toFixed(2)}px`);
    };

    const frame = (dt, now) => {
      if (now - state.lastPointer > IDLE_BEFORE_WANDER) {
        state.wander += dt;
        state.tx = state.w * 0.5 + Math.sin(state.wander * 0.4) * state.w * 0.28;
        state.ty = state.h * 0.58 + Math.sin(state.wander * 0.62 + 1.1) * state.h * 0.2;
      }
      state.tx = clamp(state.tx, state.radius, Math.max(state.radius, state.w - state.radius));
      state.ty = clamp(state.ty, state.radius, Math.max(state.radius, state.h - state.radius));

      const follow = 1 - Math.exp(-dt / FOLLOW_TAU);
      state.lx += (state.tx - state.lx) * follow;
      state.ly += (state.ty - state.ly) * follow;
      paint();
    };

    const onPointerMove = (event) => {
      if (event.pointerType === 'touch' && event.buttons === 0) return;
      const rect = page.getBoundingClientRect();
      state.tx = event.clientX - rect.left;
      state.ty = event.clientY - rect.top;
      state.lastPointer = performance.now();
    };

    const onResize = () => {
      measure();
      frame(0, performance.now());
    };

    measure();
    state.lx = state.tx = state.w * (reduced ? 0.54 : 0.5);
    state.ly = state.ty = state.h * (reduced ? 0.66 : 0.54);
    state.lastPointer = reduced ? performance.now() : -1e9;
    frame(0, performance.now());

    let raf = 0;
    let previous = performance.now();
    if (!reduced) {
      page.classList.add('is-live');
      page.addEventListener('pointermove', onPointerMove, { passive: true });
      page.addEventListener('pointerdown', onPointerMove, { passive: true });
      const loop = (now) => {
        const dt = clamp((now - previous) / 1000, 0.0005, 0.05);
        previous = now;
        frame(dt, now);
        raf = window.requestAnimationFrame(loop);
      };
      raf = window.requestAnimationFrame(loop);
    }

    window.addEventListener('resize', onResize);
    let observer = null;
    if (typeof window.ResizeObserver === 'function') {
      observer = new window.ResizeObserver(onResize);
      observer.observe(page);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      page.classList.remove('is-live');
      page.removeEventListener('pointermove', onPointerMove);
      page.removeEventListener('pointerdown', onPointerMove);
      page.style.removeProperty('--nf-lx');
      page.style.removeProperty('--nf-ly');
    };
  }, []);

  return (
    <section className="nf-page" ref={pageRef} aria-labelledby="nf-title">
      <div className="nf-flow" aria-hidden="true">
        <canvas className="nf-flow-canvas" ref={canvasRef} />
        <span className="nf-flow-grain" />
      </div>

      <header className="nf-brand">
        <img src="/assets/images/logo-hao-quang-transparent.png" alt="" />
        <span>BDU Tự Học</span>
      </header>

      <div className="nf-copy">
        <h1 id="nf-title" className="nf-title">Không tìm thấy trang</h1>
        <p className="nf-desc">Đường dẫn này không thuộc cổng sinh viên BDU Tự Học.</p>
        <Link className="btn btn-primary nf-cta" to="/gpa">Về bảng điểm</Link>
      </div>

      <div className="nf-floor" aria-hidden="true"><Floor variant="base" /></div>
      <div className="nf-found" aria-hidden="true"><Floor variant="found" /></div>

      <div className="nf-lens" ref={lensRef} aria-hidden="true">
        <span className="nf-lens-handle" />
        <span className="nf-lens-glass" />
        <span className="nf-lens-ring" />
      </div>
    </section>
  );
}
