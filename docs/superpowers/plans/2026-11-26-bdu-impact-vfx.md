# BDU Impact VFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tự xây dựng hoàn chỉnh hệ thống hiệu ứng tương tác **BDU Impact VFX** (click xác nhận & loading) theo phong cách Anime/Manga Impact bản Neo-Brutalism BDU trên toàn cổng sinh viên theo 2 mức độ (Đậm/Nhẹ), đồng thời gỡ bỏ 100% thư viện Sakuga VFX cũ.

**Architecture:** Một lõi Canvas 2D + vật lý lò xo `Spring` tự viết không dependency (`client/src/lib/bdu-vfx/`) có vòng lặp `requestAnimationFrame` tự ngủ khi rảnh và bảng màu động theo Light/Dark. Tầng 1 (Mức Đậm) cung cấp React native components `<ImpactButton>` và `<ImpactProgress>` (không Shadow DOM); Tầng 2 (Mức Nhẹ) gắn 1 `<BduVfxBridge />` tại `App.jsx` dùng event delegation (có luật loại trừ vùng bảo toàn) kèm nâng cấp bộ loader chung trong `Loading.jsx`.

**Tech Stack:** React 19.1 (`ref` prop trực tiếp + `useImperativeHandle`), Vite 7, Canvas 2D API, CSS Custom Properties, Vitest 3 + jsdom + `@testing-library/react`, ESLint 9.

**Spec:** [docs/superpowers/specs/2026-11-26-bdu-impact-vfx-design.md](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/docs/superpowers/specs/2026-11-26-bdu-impact-vfx-design.md)

## Global Constraints

- **0 thư viện ngoài & 0 Sakuga VFX:** Không cài thêm package nào; cuối kế hoạch không còn bất kỳ file, import, custom element (`sakuga-button`, `sakuga-progress`) hoặc token CSS (`--sk-*`, `.wf-sakuga-*`, `.sakuga-dot`) nào của Sakuga trong `client/`, `public/`, `tests/`.
- **ESLint globals (`eslint.config.js`):** Chỉ các global trong `eslint.config.js` mới được gọi trực tiếp (`window`, `document`, `performance`, `setTimeout`, ...). Mọi API trình duyệt khác (`requestAnimationFrame`, `cancelAnimationFrame`, `matchMedia`, `devicePixelRatio`, `innerWidth`, `innerHeight`, `getComputedStyle`, `Path2D`) **BẮT BUỘC** truy cập qua `window.*` có kiểm tra tồn tại để vừa qua `npm run lint:frontend` vừa an toàn trên jsdom/SSR.
- **Bảng màu Canvas động (Light / Dark):**
  - Light: `ink #111111`, `primary #1D4ED8`, `accent #FACC15`, `surface #FFFFFF`, `shade #DBEAFE`, `success #10B981`, `danger #EF4444`.
  - Dark: `ink #E4E4E7`, `primary #3B82F6`, `accent #FDE047`, `surface #1A1E26`, `shade #1E3A8A`, `success #34D399`, `danger #FB7185`.
- **Hiệu năng & Accessibility:** Giới hạn `MAX_PARTICLES = 180`, `devicePixelRatio <= 2`, canvas `pointer-events: none; z-index: 2147483000`, vòng lặp rAF dừng hoàn toàn khi rảnh; luôn lắng nghe và tôn trọng `prefers-reduced-motion: reduce`; **không âm thanh**, **không chữ tiếng Nhật**.
- **Vùng bảo toàn:** Không chạm `client/src/admin/**`, `.clay-pb-scope` (`INF0983`), `.wf-gdoc-page` (tờ A4 WordFmt), `GradeShareCard` artwork, `StudentScene` 3D, Avatar Signature Frames, `public/games/**`, `public/killer-sudoku/**`.
- **Giữ nguyên working tree Neo-Brutalism:** Không `git add -A` hay tự động `git commit` gộp các thay đổi Neo-Brutalism chưa commit sẵn trên repo; giữ thay đổi sạch trên working tree trừ khi người dùng yêu cầu commit riêng.

## Review Focus

1. **Môi trường jsdom / thiếu Canvas 2D hoặc `Path2D` / `matchMedia`:** Render, click `<ImpactButton>`, cập nhật `<ImpactProgress>` và click qua `<BduVfxBridge>` khi `canvas.getContext('2d') === null` hoặc `window.Path2D === undefined` không được throw và vẫn giữ đủ hành vi click/submit/ARIA. *(Gắn test ở Task 1 & Task 2)*
2. **Spam click & giới hạn `MAX_PARTICLES = 180` + tự ngủ rAF:** Bấm liên tiếp >50 lần không làm số hạt vượt `180`, không tràn bộ nhớ, và khi các hạt hết `life` vòng lặp `rAF` tự dừng (`isRunning() === false`). *(Gắn test ở Task 1)*
3. **Thay đổi động `prefers-reduced-motion: reduce`:** Khi bật reduced motion (từ đầu hoặc qua sự kiện `change`), không thêm hiệu ứng vào canvas và không gắn class chớp đảo màu/micro-pop, nhưng `onClick`, dấu tích `✓` (`done`) và giá trị `aria-valuenow` của progress vẫn cập nhật đúng. *(Gắn test ở Task 1 & Task 2)*
4. **Cách ly vùng bảo toàn & chống kích hoạt kép ở `<BduVfxBridge>`:** Click bên trong `.clay-pb-scope`, `.wf-gdoc-page`, `.admin-shell`, `[data-vfx="off"]`, nút `disabled`, nút kích thước `< 28×24px`, hoặc `<ImpactButton>` (`data-vfx="impact"`) tuyệt đối không kích hoạt micro-tap của Bridge. *(Gắn test ở Task 3)*
5. **Hợp đồng `EnglishPage` (99%→100% / dừng 99% khi lỗi) và `WordFmtPage` (7 stages + `doneTrigger`):** Sai mật khẩu Moodle dừng ở `0.995` (99%) không gọi `onComplete`; đúng mật khẩu lên `1` (100%), mở khóa cuộn và vào danh sách khóa học; WordFmt giữ nguyên luồng review → progress → tải về kích hoạt `doneTrigger`. *(Gắn test ở Task 4 & Task 5)*

---

## File Structure Map

- `client/src/lib/bdu-vfx/spring.js` — Vật lý lò xo `Spring` bước cố định `<= 0.008s` và các hàm easing.
- `client/src/lib/bdu-vfx/palette.js` — Đọc bảng màu Neo-Brutalism theo `theme-light`/`theme-dark` + `tone`, và theo dõi `prefers-reduced-motion`.
- `client/src/lib/bdu-vfx/stage.js` — Singleton `<canvas class="bdu-vfx-canvas">`, vòng lặp `rAF` tự ngủ khi rảnh, cap `MAX_PARTICLES = 180`, quản lý hiệu ứng ngắn hạn & persistent renderers.
- `client/src/lib/bdu-vfx/effects.js` — Các primitive hình họa Anime/Manga Impact bản Neo-Brutalism BDU (0 chữ tiếng Nhật): `spawnPressCharge`, `spawnImpactBurst`, `spawnMicroTap`, `spawnDoneSpark`, `renderProgressOverlay`.
- `client/src/lib/bdu-vfx/ImpactButton.jsx` — Nút Mức Đậm native `<button data-vfx="impact">`.
- `client/src/lib/bdu-vfx/ImpactProgress.jsx` — Thanh tiến trình Mức Đậm `role="progressbar"` + overlay canvas cuộn luồng khí/sỏi/nổ 100%.
- `client/src/lib/bdu-vfx/BduVfxBridge.jsx` — Delegation toàn cổng sinh viên cho Mức Nhẹ, tôn trọng danh sách loại trừ.
- `client/src/lib/bdu-vfx/bdu-vfx.css` — Style Neo-Brutalism cho nút impact, thanh progress, micro-pop, và kinetic loader.
- `client/src/lib/bdu-vfx/index.js` — Barrel export sạch cho toàn hệ thống VFX.

---

### Task 1: Lõi Engine BDU Impact VFX (`spring`, `palette`, `stage`, `effects`)

**Files:**
- Create: `client/src/lib/bdu-vfx/spring.js`
- Create: `client/src/lib/bdu-vfx/palette.js`
- Create: `client/src/lib/bdu-vfx/stage.js`
- Create: `client/src/lib/bdu-vfx/effects.js`
- Test: `tests/frontend/bdu-vfx-engine.test.js`

**Interfaces:**
- Consumes: Browser DOM / `window.*` APIs (safe fallback khi thiếu trên jsdom).
- Produces:
  - `spring.js`: `clamp(v, min = 0, max = 1)`, `lerp(a, b, t)`, `easeOutCubic(t)`, `easeInCubic(t)`, `easeOutBack(t)`, `class Spring { constructor(initial = 0, stiffness = 320, damping = 20); x; v; to; step(dt); isSettled(eps = 0.001); }`
  - `palette.js`: `LIGHT_PALETTE`, `DARK_PALETTE`, `readVfxPalette(tone = 'primary')`, `isReducedMotion()`, `subscribeReducedMotion(listener)`
  - `stage.js`: `MAX_PARTICLES = 180`, `addEffect(lifeSec, drawFn, weight = 1)`, `addPersistentRenderer(renderFn)` (trả về hàm `dispose()`), `isRunning()`, `getActiveEffectCount()`, `resetStageForTests()`
  - `effects.js`: `spawnPressCharge(el, tone = 'primary')`, `spawnImpactBurst(el, tone = 'primary')`, `spawnMicroTap(el, tone = 'primary')`, `spawnDoneSpark(el, tone = 'success')`, `renderProgressOverlay(ctx, barRect, state, palette)`

- [ ] **Step 1: Viết bộ test thất bại cho lõi engine tại `tests/frontend/bdu-vfx-engine.test.js`**

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Spring } from '../../client/src/lib/bdu-vfx/spring.js';
import { readVfxPalette, isReducedMotion } from '../../client/src/lib/bdu-vfx/palette.js';
import {
  MAX_PARTICLES,
  addEffect,
  getActiveEffectCount,
  isRunning,
  resetStageForTests
} from '../../client/src/lib/bdu-vfx/stage.js';
import { spawnImpactBurst, spawnMicroTap, spawnPressCharge, spawnDoneSpark } from '../../client/src/lib/bdu-vfx/effects.js';

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
    expect(readVfxPalette('primary')).toMatchObject({ ink: '#111111', primary: '#1D4ED8', accent: '#FACC15' });
    document.body.className = 'theme-dark';
    expect(readVfxPalette('danger')).toMatchObject({ ink: '#E4E4E7', active: '#FB7185', accent: '#FDE047' });
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
    // Advance past 0.2s life in 2 frames
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
    addEffect(0.5, () => {});
    expect(getActiveEffectCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/frontend/bdu-vfx-engine.test.js`
Expected: FAIL vì chưa tồn tại các file trong `client/src/lib/bdu-vfx/`.

- [ ] **Step 3: Cài đặt `spring.js`, `palette.js`, `stage.js` và `effects.js`**

- `client/src/lib/bdu-vfx/spring.js`: Cài `clamp`, `lerp`, `easeOutCubic`, `easeInCubic`, `easeOutBack` và `Spring` tích phân vòng lặp bước `<= 0.008s`.
- `client/src/lib/bdu-vfx/palette.js`: Định nghĩa `LIGHT_PALETTE` & `DARK_PALETTE` đúng các mã hex ở Global Constraints; `readVfxPalette(tone)` trả về palette kèm trường `active` ứng với `tone` (`primary`, `success`, `danger`, `secondary` -> `accent`); `isReducedMotion()` đọc an toàn qua `window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches` và `subscribeReducedMotion(listener)` đăng ký sự kiện `change`.
- `client/src/lib/bdu-vfx/stage.js`: Quản lý singleton `<canvas class="bdu-vfx-canvas" aria-hidden="true">` gắn `document.body` (`position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483000`), tỉ lệ `Math.min(2, window.devicePixelRatio || 1)`, giới hạn `MAX_PARTICLES = 180` (cắt phần tử cũ nhất khi vượt), tự hủy vòng `rAF` & xóa canvas khi `effects.length === 0 && persistentRenderers.size === 0`, bỏ qua `addEffect` khi `isReducedMotion()` hoặc khi `document.body` không có; khi `canvas.getContext('2d')` trả về `null` (jsdom), vẫn cho vòng đời effect kết thúc sạch mà không throw.
- `client/src/lib/bdu-vfx/effects.js`: Cài đặt 5 hàm vẽ thuần Canvas 2D (chỉ dùng `ctx.beginPath`/`moveTo`/`lineTo`/`arc`/`ellipse`/`quadraticCurveTo`, không phụ thuộc bắt buộc `Path2D`, 0 chữ tiếng Nhật, viền sắc + cel-shading 2 tông):
  - `spawnPressCharge(el, tone)`: 3 vạch `ticks` hướng tâm + 2 cặp nét cong nén 2 bên.
  - `spawnImpactBurst(el, tone)`: `spikyBurst` 2 lớp (gai `accent`/`active` viền `ink` + lõi `surface`), 9 mảnh vỡ đa giác `shards` có trọng lực, 4 cụm luồng khí góc cạnh `angularPuff` tản ra 4 góc, 1 `shockRing` elip; kèm throttle tối thiểu `90ms` trên cùng 1 phần tử để chống spam.
  - `spawnMicroTap(el, tone)`: 3 vạch `ticks` gọn ở góc trên-phải của phần tử (~`240ms`).
  - `spawnDoneSpark(el, tone)`: ngôi sao 4 cánh lấp lánh + 2 vạch nhấn cạnh góc phải nút.
  - `renderProgressOverlay(ctx, barRect, state, palette)`: đường mặt đất + vạch tốc độ bên dưới thanh, 5 viên sỏi hình học bật lò xo khi đầu thanh đi qua, cụm luồng khí góc cạnh cuộn theo đầu thanh tỉ lệ với `state.progress` & `state.speed`, vệt tốc độ bắn về sau khi đang tăng tốc, và chuỗi bùng nổ 100% + dấu tích `✓` lớn bật lò xo + sao lấp lánh + 2 cụm khí nghỉ trên mặt đất.

- [ ] **Step 4: Chạy test xác nhận pass & lint sạch**

Run: `npx vitest run tests/frontend/bdu-vfx-engine.test.js && npm run lint:frontend`
Expected: PASS tất cả test và 0 lỗi ESLint.

---

### Task 2: Components Mức Đậm (`ImpactButton`, `ImpactProgress`) & Styles (`bdu-vfx.css`, `index.js`)

**Files:**
- Create: `client/src/lib/bdu-vfx/ImpactButton.jsx`
- Create: `client/src/lib/bdu-vfx/ImpactProgress.jsx`
- Create: `client/src/lib/bdu-vfx/bdu-vfx.css`
- Create: `client/src/lib/bdu-vfx/index.js`
- Test: `tests/frontend/bdu-vfx.test.jsx`

**Interfaces:**
- Consumes: `Spring`, `clamp` (`spring.js`), `readVfxPalette`, `isReducedMotion` (`palette.js`), `addPersistentRenderer` (`stage.js`), `spawnPressCharge`, `spawnImpactBurst`, `spawnDoneSpark`, `renderProgressOverlay` (`effects.js`).
- Produces:
  - `ImpactButton({ ref, id, type = 'button', tone = 'primary', className = '', disabled = false, loading = false, doneTrigger = 0, onClick, ariaLabel, title, children, ...rest })`
    - Render `<button data-vfx="impact" data-tone={tone} ...>` native; `ref` expose `{ impact(), done(holdMs = 1800), element }`.
  - `ImpactProgress({ ref, id, progress, label = 'Đang xử lý…', doneLabel = 'Hoàn tất 100% ✓', isComplete = false, tone = 'primary', onComplete, className = '', style })`
    - Render `<div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} ...>`; `ref` expose `{ set(ratio01, instant = false), reset(), get value(), get p() }`.
  - `index.js` re-export `ImpactButton`, `ImpactProgress` (và `BduVfxBridge` sau Task 3).

- [ ] **Step 1: Viết bộ test thất bại cho `ImpactButton` & `ImpactProgress` tại `tests/frontend/bdu-vfx.test.jsx`**

```jsx
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImpactButton, ImpactProgress } from '../../client/src/lib/bdu-vfx/index.js';
import { resetStageForTests } from '../../client/src/lib/bdu-vfx/stage.js';

describe('ImpactButton & ImpactProgress', () => {
  afterEach(() => {
    cleanup();
    resetStageForTests();
    vi.restoreAllMocks();
  });

  it('renders a native button with data-vfx="impact", fires onClick, toggles invert flash, and supports doneTrigger', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const ref = createRef();
    const { rerender } = render(
      <ImpactButton ref={ref} id="btn-test" tone="primary" onClick={onClick} doneTrigger={0}>
        Xác nhận
      </ImpactButton>
    );
    const btn = screen.getByRole('button', { name: /Xác nhận/i });
    expect(btn).toHaveAttribute('data-vfx', 'impact');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.className).toContain('bdu-impact-btn--invert');

    act(() => { vi.advanceTimersByTime(200); });
    expect(btn.className).not.toContain('bdu-impact-btn--invert');

    rerender(
      <ImpactButton ref={ref} id="btn-test" tone="primary" onClick={onClick} doneTrigger={1}>
        Xác nhận
      </ImpactButton>
    );
    expect(btn.className).toContain('is-done');
    act(() => { vi.advanceTimersByTime(1900); });
    expect(btn.className).not.toContain('is-done');
    vi.useRealTimers();
  });

  it('suppresses invert flash when prefers-reduced-motion is active while still invoking onClick', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    const onClick = vi.fn();
    render(<ImpactButton onClick={onClick}>Lưu</ImpactButton>);
    const btn = screen.getByRole('button', { name: 'Lưu' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.className).not.toContain('bdu-impact-btn--invert');
  });

  it('supports both controlled progress/isComplete props and imperative set()/reset() ref API', () => {
    const onComplete = vi.fn();
    const ref = createRef();
    render(<ImpactProgress ref={ref} id="prog-test" label="Đang tải" doneLabel="100% ✓" onComplete={onComplete} />);
    const bar = screen.getByRole('progressbar', { name: 'Đang tải' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    act(() => { ref.current.set(0.995, true); });
    expect(ref.current.value).toBeCloseTo(0.995, 3);
    expect(bar).toHaveAttribute('aria-valuenow', '99');
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { ref.current.set(1, true); });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100% ✓')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/frontend/bdu-vfx.test.jsx`
Expected: FAIL vì chưa có `ImpactButton`, `ImpactProgress`, `index.js`.

- [ ] **Step 3: Cài đặt `ImpactButton.jsx`, `ImpactProgress.jsx`, `bdu-vfx.css`, `index.js`**

- `ImpactButton.jsx`: Dùng React 19 `ref` prop + `useImperativeHandle(ref, ...)`. Khi `pointerdown` nén CSS `--bdu-sq-x` / `--bdu-sq-y` + gọi `spawnPressCharge`; khi `click` (nếu không `disabled`) kích hoạt `.bdu-impact-btn--invert` trong `150ms` (trừ khi `isReducedMotion()`) + `.bdu-impact-btn--rebound` + gọi `spawnImpactBurst`, sau đó gọi `onClick?.(event)`. Khi `doneTrigger` tăng hoặc gọi `ref.done(holdMs)` bật state `done` (hiện SVG dấu tích `✓` trượt mở + gọi `spawnDoneSpark`), dọn toàn bộ timeout trong cleanup unmount.
- `ImpactProgress.jsx`: Hỗ trợ đồng thời controlled (`progress` 0–100 + `isComplete`) và imperative ref (`set(ratio01, instant)`, `reset()`, getter `value` & `p`). Lưu tiến trình hiển thị mượt `p` tiến dần tới `goal` qua `addPersistentRenderer` khi trình duyệt có 2D canvas, hoặc nhảy trực tiếp trong jsdom/reduced-motion (`instant = true`). Tại mốc `>= 1`, gọi `onComplete?.()` đúng 1 lần cho mỗi chu kỳ (reset lại khi `reset()` hoặc khi `progress` giảm về `< 0.05`). Render track viền `3px solid var(--border-color)`, fill sọc chéo chạy tốc độ, badge `%` nghiêng `-8deg` có bóng cứng.
- `bdu-vfx.css`: Style Neo-Brutalism khớp cả `body.theme-light` & `body.theme-dark`, keyframes sọc tốc độ, rebound, micro-pop, và kinetic loader; tắt toàn bộ animation trong `@media (prefers-reduced-motion: reduce)`.
- `index.js`: Import `./bdu-vfx.css` và export `{ ImpactButton, ImpactProgress }`.

- [ ] **Step 4: Chạy test xác nhận pass & lint sạch**

Run: `npx vitest run tests/frontend/bdu-vfx.test.jsx && npm run lint:frontend`
Expected: PASS và 0 lỗi ESLint.

---

### Task 3: Bridge Toàn Cục Mức Nhẹ (`BduVfxBridge`) & Nâng Cấp Bộ Loader Chung (`Loading.jsx`)

**Files:**
- Create: `client/src/lib/bdu-vfx/BduVfxBridge.jsx`
- Modify: `client/src/lib/bdu-vfx/index.js`
- Modify: `client/src/app/App.jsx:1-14`
- Modify: `client/src/components/feedback/Loading.jsx:1-24`
- Modify: `client/src/styles/app.css:50-77`
- Test: `tests/frontend/bdu-vfx.test.jsx`

**Interfaces:**
- Consumes: `spawnMicroTap` (`effects.js`), `isReducedMotion` (`palette.js`).
- Produces:
  - `BduVfxBridge()` — Component render `null`, lắng nghe `click` trên `document` và kích hoạt micro-tap + class `.bdu-vfx-micro-pop` (`180ms`) trên các nút hợp lệ, loại trừ `.clay-pb-scope`, `.wf-gdoc-page`, `.admin-shell`, `[data-vfx="off"]`, `[data-vfx="impact"]`, nút `disabled`/`aria-disabled="true"`, và nút có `rect.width < 28 || rect.height < 24`.
  - `Loading.jsx` giữ nguyên 6 export (`Spinner`, `SkeletonBlock`, `PageSpinner`, `InlineSpinner`, `ButtonSpinner`, `AsyncState`), thay phần tử spinner bên trong sang 3 khối vuông chuyển động nhịp Neo-Brutalist (`.bdu-kinetic-loader` / `.bdu-kinetic-cube`).

- [ ] **Step 1: Bổ sung test thất bại cho `BduVfxBridge` và `Loading.jsx` vào `tests/frontend/bdu-vfx.test.jsx`**

Thêm suite `describe('BduVfxBridge & Kinetic Loading', ...)` kiểm chứng:
- Click một `<button className="btn">Lọc</button>` (mock `getBoundingClientRect` trả `width: 80, height: 36`) gắn class `bdu-vfx-micro-pop` và gỡ sau `200ms`.
- Click bên trong `.clay-pb-scope`, `.wf-gdoc-page`, `.admin-shell`, `[data-vfx="off"]`, `<ImpactButton>` (`data-vfx="impact"`), nút `disabled`, hoặc nút `16×16` **không** gắn `bdu-vfx-micro-pop`.
- `<PageSpinner label="Đang tải bảng điểm…" />`, `<InlineSpinner />`, `<ButtonSpinner />` render `.bdu-kinetic-loader` với đúng 3 `.bdu-kinetic-cube` và giữ nguyên `role="status"` / `aria-busy="true"`.

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npx vitest run tests/frontend/bdu-vfx.test.jsx`
Expected: FAIL ở suite `BduVfxBridge & Kinetic Loading`.

- [ ] **Step 3: Cài đặt `BduVfxBridge.jsx`, gắn vào `App.jsx`, và nâng cấp `Loading.jsx`**

- Tạo `client/src/lib/bdu-vfx/BduVfxBridge.jsx` với bộ lọc loại trừ nghiêm ngặt (kiểm tra `isReducedMotion()`, `closest('.clay-pb-scope, .wf-gdoc-page, .admin-shell, [data-vfx="off"], [data-vfx="impact"]')`, `disabled`/`aria-disabled`, và kích thước `rect.width >= 28 && rect.height >= 24`), thêm `.bdu-vfx-micro-pop` tự gỡ sau `190ms` + gọi `spawnMicroTap(el, tone)`.
- Export `BduVfxBridge` từ `client/src/lib/bdu-vfx/index.js`.
- Trong `client/src/app/App.jsx`, render `<BduVfxBridge />` bên trong `<AppProviders>` (tuyệt đối không gắn trong `client/src/admin/AdminApp.jsx`).
- Cập nhật `client/src/components/feedback/Loading.jsx` và `client/src/styles/app.css` để `Spinner` render 3 khối `.bdu-kinetic-cube` viền đen bóng cứng (giữ class `.spinner` để không vỡ selector cũ nếu có).

- [ ] **Step 4: Chạy test xác nhận pass & lint sạch**

Run: `npx vitest run tests/frontend/bdu-vfx.test.jsx && npm run lint:frontend`
Expected: PASS và 0 lỗi ESLint.

---

### Task 4: Chuyển Đổi WordFmt sang BDU Impact VFX & Xóa `SakugaVfx.jsx`

**Files:**
- Modify: `client/src/features/wordfmt/WordFmtPage.jsx:12,874-924,1332-1342`
- Modify: `client/src/features/wordfmt/DocxReviewWorkspace.jsx:11,442-451`
- Modify: `client/src/styles/wordfmt-status.css:1-230`
- Modify: `client/src/styles/wordfmt-preview.css:2108-2114`
- Delete: `client/src/features/wordfmt/SakugaVfx.jsx`
- Test: `tests/frontend/wordfmt-page.test.jsx`

**Interfaces:**
- Consumes: `ImpactButton`, `ImpactProgress` từ `../../lib/bdu-vfx/index.js`.
- Produces: WordFmt sử dụng 100% `ImpactButton` (`#btn-start-wordfmt`, `#btn-confirm-wordfmt`, `#btn-download-docx`) và `ImpactProgress` (giữ nguyên 7 stages, `doneTrigger={downloadDoneCount}`, và tờ A4 `.wf-gdoc-page` nguyên vẹn).

- [ ] **Step 1: Cập nhật & kiểm tra test `tests/frontend/wordfmt-page.test.jsx`**

Rà soát các assertion trong `tests/frontend/wordfmt-page.test.jsx` (đảm bảo kiểm tra nút `#btn-start-wordfmt`, `#btn-confirm-wordfmt`, `#btn-download-docx` mang `data-vfx="impact"` và tiến trình `role="progressbar"` hoạt động ở cả trạng thái `running` & `success`).

- [ ] **Step 2: Thay thế Sakuga trong `WordFmtPage.jsx`, `DocxReviewWorkspace.jsx` và dọn CSS WordFmt**

- Đổi import `SakugaButton`/`SakugaProgress` → `ImpactButton`/`ImpactProgress` từ `../../lib/bdu-vfx/index.js`.
- Đổi class `.wf-sakuga-*` trong `WordFmtPage.jsx`, `DocxReviewWorkspace.jsx`, `wordfmt-status.css`, `wordfmt-preview.css` sang `.wf-vfx-*` gọn gàng; xóa sạch toàn bộ block `--sk-*` và fallback Sakuga cũ trong `wordfmt-status.css`.
- Xóa file `client/src/features/wordfmt/SakugaVfx.jsx`.

- [ ] **Step 3: Chạy test WordFmt xác nhận pass**

Run: `npx vitest run tests/frontend/wordfmt-page.test.jsx && npm run lint:frontend`
Expected: PASS toàn bộ test WordFmt và 0 lỗi ESLint.

---

### Task 5: Chuyển Đổi `EnglishPage` & Xóa Sạch Toàn Bộ File Vendor Sakuga VFX

**Files:**
- Modify: `client/src/features/english/EnglishPage.jsx:14-15,42-44,92-155,229-314,599-697`
- Modify: `client/src/styles/app.css:5986-6001`
- Modify: `tests/frontend/english-page.test.jsx:1-118`
- Delete: `client/src/features/english/sakuga-button.js`
- Delete: `client/src/features/english/sakuga-progress.js`
- Delete: `public/assets/vendor/sakuga-vfx/button.js`
- Delete: `public/assets/vendor/sakuga-vfx/progress.js`
- Delete: `public/sakuga-vfx/button.js`
- Delete: `public/sakuga-vfx/progress.js`

**Interfaces:**
- Consumes: `ImpactButton`, `ImpactProgress` từ `../../lib/bdu-vfx/index.js`.
- Produces: `EnglishPage` giữ nguyên toàn bộ hợp đồng tương tác (mờ form `#english-login-form-content`, khóa cuộn `document.body.style.overflow = 'hidden'`, overlay `#english-connect-progress-wrap` + `#english-connect-status` với 3 `.bdu-vfx-dot`, `#english-connect-progress` chạy lên `0.995` rồi nhảy lên `1` khi hợp lệ hoặc dừng ở `0.995` khi lỗi).

- [ ] **Step 1: Cập nhật `tests/frontend/english-page.test.jsx` theo component mới (test fail trước)**

Đổi selector trong `tests/frontend/english-page.test.jsx`:
- `sakuga-button#btn-english-connect` → `button#btn-english-connect[data-vfx="impact"]`
- `sakuga-progress#english-connect-progress` → `#english-connect-progress[role="progressbar"]` (đọc `aria-valuenow`: `99` khi lỗi, `100` khi thành công)
- `.sakuga-dot` → `.bdu-vfx-dot`
- Giữ nguyên toàn bộ kiểm chứng làm mờ form, khóa/mở cuộn, hiển thị `#english-login-error` và danh sách khóa học.

- [ ] **Step 2: Chạy test xác nhận fail trước khi sửa `EnglishPage.jsx`**

Run: `npx vitest run tests/frontend/english-page.test.jsx`
Expected: FAIL vì `EnglishPage.jsx` vẫn đang render `<sakuga-button>` / `<sakuga-progress>`.

- [ ] **Step 3: Chuyển đổi `EnglishPage.jsx`, dọn `app.css`, và xóa sạch 6 file Sakuga cũ**

- Bỏ `import './sakuga-button.js'` & `import './sakuga-progress.js'`, thay bằng `import { ImpactButton, ImpactProgress } from '../../lib/bdu-vfx/index.js'`.
- Thay `<sakuga-button ref={sakugaBtnRef} ...>` → `<ImpactButton ref={connectBtnRef} id="btn-english-connect" type="submit" tone="primary" disabled={busy}>` (giữ `connectBtnRef.current?.impact()` & `done()`).
- Thay `<sakuga-progress ref={sakugaProgressRef} ...>` → `<ImpactProgress ref={connectProgressRef} id="english-connect-progress" label="Đang đăng nhập, chờ tí…" doneLabel="100% ✓" onComplete={...} />`, dùng ref `{ set, reset, value, p }` để bảo toàn nhịp chạy `0.08 → 0.995` và nhảy `1` khi login thành công (dừng `0.995` khi lỗi).
- Đổi `.sakuga-dot` / `@keyframes sakugaDotBounce` ở `client/src/styles/app.css` sang `.bdu-vfx-dot` / `@keyframes bduVfxDotBounce` (và dọn inline style của `#english-connect-status` sang token Neo-Brutalism, bỏ biến `--sk-*`).
- Xóa 6 file Sakuga và thư mục rỗng `public/assets/vendor/sakuga-vfx/` & `public/sakuga-vfx/`.

- [ ] **Step 4: Chạy test `english-page.test.jsx` xác nhận pass**

Run: `npx vitest run tests/frontend/english-page.test.jsx && npm run lint:frontend`
Expected: PASS và 0 lỗi ESLint.

---

### Task 6: Gắn `<ImpactButton>` (Mức Đậm) Cho Các Điểm Xác Nhận Chính Trên Cổng Sinh Viên

**Files:**
- Modify: `client/src/features/auth/LoginPage.jsx:158-161`
- Modify: `client/src/components/feedback/ConfirmDialog.jsx:51-58`
- Modify: `client/src/features/survey/SurveyPage.jsx:329-331,384,459-461`
- Modify: `client/src/features/training-score/TrainingScorePage.jsx:484`
- Modify: `client/src/features/enrollment/EnrollmentPage.jsx:994,1136`
- Modify: `client/src/features/confession/ConfessionPage.jsx:2037-2051,2166-2174`
- Modify: `client/src/features/learning/QuizRunner.jsx:539-546,555-562`
- Modify: `client/src/features/learning/QuizTestRunner.jsx:525-532,555-562`
- Test: `tests/frontend/bdu-vfx.test.jsx`

**Interfaces:**
- Consumes: `ImpactButton` từ `client/src/lib/bdu-vfx/index.js`.
- Produces: Toàn bộ 8 điểm xác nhận / CTA trọng điểm trên cổng sinh viên mang hiệu ứng Mức Đậm, giữ nguyên 100% ID, class layout (`.btn-block`, `.btn-lg`, `.fb-submit-post-btn`, `.enroll-primary`), trạng thái `disabled` và hành vi submit/onClick.

- [ ] **Step 1: Thêm test xác nhận tích hợp cho `ConfirmDialog` và `LoginPage` trong `tests/frontend/bdu-vfx.test.jsx`**

Kiểm chứng:
- Nút xác nhận của `useConfirm()` có `data-vfx="impact"` và `data-tone="danger"` khi `danger: true` (hoặc `primary` khi `danger: false`), bấm vào vẫn resolve `true`.
- Nút hủy của `useConfirm()` vẫn là nút thường (không mang `data-vfx="impact"`).

- [ ] **Step 2: Chạy test xác nhận fail trước khi chỉnh `ConfirmDialog.jsx`**

Run: `npx vitest run tests/frontend/bdu-vfx.test.jsx`
Expected: FAIL ở test tích hợp `ConfirmDialog`.

- [ ] **Step 3: Thay thế các nút xác nhận trọng điểm sang `<ImpactButton>`**

- `LoginPage.jsx`: `#btn-login` → `<ImpactButton type="submit" id="btn-login" tone="primary" className="btn btn-primary btn-block" disabled={busy}>`.
- `ConfirmDialog.jsx`: Nút xác nhận → `<ImpactButton type="button" tone={request.danger ? 'danger' : 'primary'} className={request.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)} autoFocus>`.
- `SurveyPage.jsx`: `#btn-start-survey` và 2 nút xác nhận trong modal chọn môn / cấu hình → `<ImpactButton>`.
- `TrainingScorePage.jsx`: Nút `Xác nhận lưu` trong modal `#modal-dgrl-confirm` → `<ImpactButton>`.
- `EnrollmentPage.jsx`: Nút lưu danh sách ưu tiên (`saveList`) và nút kích hoạt đăng ký (`handleStart`) → `<ImpactButton>`.
- `ConfessionPage.jsx`: `#btn-submit-cfs` (`Đăng`) và `#btn-submit-cfs-edit` (`Lưu thay đổi`) → `<ImpactButton>`.
- `QuizRunner.jsx` & `QuizTestRunner.jsx`: Nút `Nộp bài` / `Xem kết quả` (trong footer và hộp thoại xác nhận nộp bài) → `<ImpactButton>`.

- [ ] **Step 4: Chạy toàn bộ test frontend xác nhận pass**

Run: `npm run test:frontend && npm run lint:frontend`
Expected: PASS toàn bộ suite frontend hiện có + test mới và 0 lỗi ESLint.

---

### Task 7: Kiểm Toán Sạch Sakuga, Build & Kiểm Thử Trình Duyệt Thật (Antigravity Browser)

**Files:**
- Verify only (sửa lỗi trực tiếp nếu phát hiện khi kiểm thử trực quan).

- [ ] **Step 1: Kiểm toán không còn sót bất kỳ dấu vết `sakuga` nào**

Run:
```powershell
Select-String -Path (Get-ChildItem -Recurse -File -Path client,public,tests -Include *.js,*.jsx,*.css,*.html) -Pattern "sakuga|--sk-" -CaseSensitive:$false
```
Expected: 0 kết quả trả về.

- [ ] **Step 2: Chạy đủ bộ kiểm tra tự động frontend & build production**

Run: `npm run lint:frontend && npm run test:frontend && npm run build:client`
Expected: Exit code `0`, build `dist/` thành công không lỗi/warning module.

- [ ] **Step 3: Kiểm thử trực quan trên trình duyệt thật (Antigravity browser)**

Khởi động server local (`npm run dev:server` hoặc server sẵn có) và dùng browser subagent kiểm tra thực tế:
1. **Desktop (1440×900) & Mobile (390×844), Light ↔ Dark**:
   - Đăng nhập (`LoginPage` `#btn-login`): bấm thử thấy nén–bật + tia nổ Xanh–Vàng–Đen (Light) và Xanh sáng–Vàng sáng–Trắng (Dark), không chữ tiếng Nhật, không tràn ngang.
   - `WordFmtPage`: bấm nút gửi / review / progress / tải về thấy luồng khí góc cạnh + sỏi bật + nổ 100% + dấu tích, tờ giấy A4 `.wf-gdoc-page` giữ nguyên sạch sẽ.
   - `EnglishPage`: kiểm tra nút `#btn-english-connect` & thanh `#english-connect-progress` khi nhập sai/chờ tải (không gửi tác vụ ghi thật).
   - Các nút thường ngày (Mức Nhẹ): bấm tab/bộ lọc/nút phụ thấy độ nảy gọn + vạch tia nhỏ không rối mắt; bộ `PageSpinner`/`Loading` hiển thị 3 khối nhịp Neo-Brutalist.
2. **Vùng bảo toàn**:
   - Mở `INF0983` (`.clay-pb-scope`) và `/admin`: xác nhận bấm nút hoàn toàn không kích hoạt canvas VFX hay đổi style.
3. **Reduced Motion**:
   - Emulate `prefers-reduced-motion: reduce`: xác nhận không vẽ tia/hạt canvas và không chớp đảo màu, nhưng mọi nút/progress vẫn hoạt động bình thường.
