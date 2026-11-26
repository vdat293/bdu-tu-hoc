import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImpactButton, ImpactProgress, BduVfxBridge } from '../../client/src/lib/bdu-vfx/index.js';
import { ButtonSpinner, InlineSpinner, PageSpinner } from '../../client/src/components/feedback/Loading.jsx';
import { useConfirm } from '../../client/src/components/feedback/ConfirmDialog.jsx';
import { resetStageForTests } from '../../client/src/lib/bdu-vfx/stage.js';

describe('ImpactButton & ImpactProgress', () => {
  afterEach(() => {
    cleanup();
    resetStageForTests();
    vi.useRealTimers();
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
    expect(btn).toHaveAttribute('data-tone', 'primary');

    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.className).toContain('bdu-impact-btn--invert');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(btn.className).not.toContain('bdu-impact-btn--invert');

    rerender(
      <ImpactButton ref={ref} id="btn-test" tone="primary" onClick={onClick} doneTrigger={1}>
        Xác nhận
      </ImpactButton>
    );
    expect(btn.className).toContain('is-done');

    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(btn.className).not.toContain('is-done');
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
    const { rerender } = render(
      <ImpactProgress ref={ref} id="prog-test" label="Đang tải" doneLabel="100% ✓" onComplete={onComplete} />
    );
    const bar = screen.getByRole('progressbar', { name: 'Đang tải' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    act(() => {
      ref.current.set(0.995, true);
    });
    expect(ref.current.value).toBeCloseTo(0.995, 3);
    expect(bar).toHaveAttribute('aria-valuenow', '99');
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      ref.current.set(1, true);
    });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100% ✓')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);

    act(() => {
      ref.current.reset();
    });
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    rerender(
      <ImpactProgress
        ref={ref}
        id="prog-test"
        progress={64}
        isComplete={false}
        label="Đang tải"
        doneLabel="100% ✓"
        onComplete={onComplete}
      />
    );
    expect(bar).toHaveAttribute('aria-valuenow', '64');

    rerender(
      <ImpactProgress
        ref={ref}
        id="prog-test"
        progress={100}
        isComplete
        label="Đang tải"
        doneLabel="100% ✓"
        onComplete={onComplete}
      />
    );
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('responds dynamically to prefers-reduced-motion change events on mounted ImpactProgress and BduVfxBridge', () => {
    let changeHandler = null;
    let reduced = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_ev, fn) => {
        changeHandler = fn;
      },
      removeEventListener: vi.fn()
    }));
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn()
    }));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    const ref = createRef();
    render(
      <div>
        <BduVfxBridge />
        <ImpactProgress ref={ref} id="prog-dyn" label="Dynamic" />
        <button type="button" className="btn">Thường</button>
      </div>
    );

    const regularBtn = screen.getByRole('button', { name: 'Thường' });
    vi.spyOn(regularBtn, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 80, bottom: 36, width: 80, height: 36
    });

    act(() => {
      ref.current.set(0.8);
    });
    expect(typeof changeHandler).toBe('function');

    // Enable reduced motion dynamically while ImpactProgress is mounted mid-progress
    act(() => {
      reduced = true;
      changeHandler({ matches: true });
    });

    const bar = screen.getByRole('progressbar', { name: 'Dynamic' });
    expect(bar).toHaveAttribute('aria-valuenow', '80');

    // Bridge suppresses micro-pop while reduced motion is active
    fireEvent.click(regularBtn);
    expect(regularBtn.className).not.toContain('bdu-vfx-micro-pop');
  });
});

describe('BduVfxBridge & Kinetic Loading', () => {
  afterEach(() => {
    cleanup();
    resetStageForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies .bdu-vfx-micro-pop to regular portal buttons and removes it after ~190ms', () => {
    vi.useFakeTimers();
    render(
      <div>
        <BduVfxBridge />
        <button type="button" className="btn">Lọc</button>
      </div>
    );
    const btn = screen.getByRole('button', { name: 'Lọc' });
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 10, right: 90, bottom: 46, width: 80, height: 36
    });

    fireEvent.click(btn);
    expect(btn.className).toContain('bdu-vfx-micro-pop');

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(btn.className).not.toContain('bdu-vfx-micro-pop');
  });

  it('excludes protected surfaces, admin, disabled, tiny buttons, and Tier 1 ImpactButton', () => {
    render(
      <div>
        <BduVfxBridge />
        <div className="clay-pb-scope">
          <button type="button">ClayBtn</button>
        </div>
        <div className="wf-gdoc-page">
          <button type="button">PaperBtn</button>
        </div>
        <div className="admin-shell">
          <button type="button">AdminBtn</button>
        </div>
        <button type="button" data-vfx="off">OptOutBtn</button>
        <button type="button" disabled>DisabledBtn</button>
        <button type="button">TinyBtn</button>
        <ImpactButton>Tier1Btn</ImpactButton>
      </div>
    );

    const rectNormal = { left: 0, top: 0, right: 80, bottom: 36, width: 80, height: 36 };
    for (const label of ['ClayBtn', 'PaperBtn', 'AdminBtn', 'OptOutBtn', 'DisabledBtn', 'Tier1Btn']) {
      const el = screen.getByRole('button', { name: label });
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rectNormal);
      fireEvent.click(el);
      expect(el.className).not.toContain('bdu-vfx-micro-pop');
    }

    const tiny = screen.getByRole('button', { name: 'TinyBtn' });
    vi.spyOn(tiny, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 16, bottom: 16, width: 16, height: 16
    });
    fireEvent.click(tiny);
    expect(tiny.className).not.toContain('bdu-vfx-micro-pop');
  });

  it('renders 3-cube Neo-Brutalist kinetic loaders for PageSpinner, InlineSpinner, and ButtonSpinner', () => {
    const { container } = render(
      <div>
        <PageSpinner label="Đang tải bảng điểm…" />
        <InlineSpinner label="Đang đồng bộ…" />
        <ButtonSpinner />
      </div>
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveAttribute('aria-busy', 'true');
    expect(statuses[0]).toHaveTextContent('Đang tải bảng điểm…');
    expect(statuses[1]).toHaveAttribute('aria-busy', 'true');
    expect(statuses[1]).toHaveTextContent('Đang đồng bộ…');

    const loaders = container.querySelectorAll('.bdu-kinetic-loader');
    expect(loaders).toHaveLength(3);
    loaders.forEach((loader) => {
      expect(loader.querySelectorAll('.bdu-kinetic-cube')).toHaveLength(3);
    });
  });

  it('uses ImpactButton for ConfirmDialog confirmation action with matching danger/primary tone', async () => {
    let resolved = null;
    function ConfirmHost({ danger }) {
      const [dialog, ask] = useConfirm();
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              ask({ title: 'Xác nhận thao tác?', confirmText: 'Đồng ý', cancelText: 'Hủy', danger }).then((ok) => {
                resolved = ok;
              });
            }}
          >
            Mở hộp thoại
          </button>
          {dialog}
        </div>
      );
    }

    const { rerender } = render(<ConfirmHost danger />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở hộp thoại' }));

    const confirmBtn = screen.getByRole('button', { name: 'Đồng ý' });
    const cancelBtn = screen.getByRole('button', { name: 'Hủy' });
    expect(confirmBtn).toHaveAttribute('data-vfx', 'impact');
    expect(confirmBtn).toHaveAttribute('data-tone', 'danger');
    expect(cancelBtn).not.toHaveAttribute('data-vfx', 'impact');

    fireEvent.click(confirmBtn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBe(true);

    resolved = null;
    rerender(<ConfirmHost danger={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở hộp thoại' }));
    const confirmPrimary = screen.getByRole('button', { name: 'Đồng ý' });
    expect(confirmPrimary).toHaveAttribute('data-vfx', 'impact');
    expect(confirmPrimary).toHaveAttribute('data-tone', 'primary');
  });
});
