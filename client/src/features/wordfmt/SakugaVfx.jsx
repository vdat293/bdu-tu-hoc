import { useEffect, useRef, useState } from 'react';

const SAKUGA_SCRIPTS = [
  { key: 'progress', src: '/assets/vendor/sakuga-vfx/progress.js', tag: 'sakuga-progress' },
  { key: 'button', src: '/assets/vendor/sakuga-vfx/button.js', tag: 'sakuga-button' }
];

let loadRequested = false;

/**
 * Lazily injects the vendored Sakuga VFX classic scripts into document.head.
 * Sakuga components require classic <script> tags (not type="module") so they
 * share the global window.SakugaFX animation clock & canvas singleton.
 */
export function ensureSakugaLoaded() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.customElements === 'undefined') {
    return;
  }
  if (loadRequested) return;
  loadRequested = true;

  for (const item of SAKUGA_SCRIPTS) {
    if (window.customElements.get(item.tag)) continue;
    if (document.querySelector(`script[data-sakuga="${item.key}"]`)) continue;
    const script = document.createElement('script');
    script.src = item.src;
    script.async = true;
    script.dataset.sakuga = item.key;
    script.onerror = () => {
      // Non-fatal: fallback native React controls remain interactive.
    };
    document.head.appendChild(script);
  }
}

function useSakugaElementReady(tagName) {
  const [ready, setReady] = useState(() => (
    typeof window !== 'undefined' && Boolean(window.customElements?.get(tagName))
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.customElements === 'undefined') {
      return undefined;
    }
    if (window.customElements.get(tagName)) {
      setReady(true);
      return undefined;
    }
    let active = true;
    ensureSakugaLoaded();
    window.customElements.whenDefined(tagName).then(() => {
      if (active) setReady(true);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [tagName]);

  return ready;
}

/**
 * Interactive impact button powered by `<sakuga-button>`, falling back cleanly
 * to a native `<button>` while the classic script loads or under test runtimes.
 */
export function SakugaButton({
  id,
  variant = 'primary',
  type = 'button',
  disabled = false,
  className = '',
  onClick,
  doneTrigger = 0,
  ariaLabel,
  title,
  children
}) {
  const ready = useSakugaElementReady('sakuga-button');
  const elRef = useRef(null);
  const onClickRef = useRef(onClick);
  const lastDoneRef = useRef(0);

  onClickRef.current = onClick;

  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el) return;
    el.disabled = Boolean(disabled);
  }, [ready, disabled]);

  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el) return undefined;
    const handleClick = (event) => {
      if (disabled || el.disabled) {
        event.preventDefault();
        return;
      }
      // button.js natively handles `closest('form')?.requestSubmit()` for type="submit",
      // so we only forward `onClick` for button actions (or optional submit listeners).
      onClickRef.current?.(event);
    };
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [ready, disabled]);

  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el || !doneTrigger || doneTrigger === lastDoneRef.current) return;
    lastDoneRef.current = doneTrigger;
    el.done?.(1800);
  }, [ready, doneTrigger]);

  if (!ready) {
    return (
      <button
        id={id}
        type={type}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className={`wf-sakuga-fallback-btn wf-sakuga-fallback-btn--${variant}${className ? ` ${className}` : ''}`}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  return (
    <sakuga-button
      ref={elRef}
      id={id}
      variant={variant}
      type={type}
      aria-label={ariaLabel}
      title={title}
      className={`wf-sakuga-btn wf-sakuga-btn--${variant}${className ? ` ${className}` : ''}`}
    >
      {children}
    </sakuga-button>
  );
}

/**
 * Progress bar powered by `<sakuga-progress>` (storm-cloud surging load + 100% impact burst),
 * falling back cleanly to an accessible HTML progress bar while loading or under tests.
 */
export function SakugaProgress({
  progress = 0,
  label = 'Đang chuẩn hóa...',
  doneLabel = 'Hoàn tất 100% ✓',
  isComplete = false
}) {
  const ready = useSakugaElementReady('sakuga-progress');
  const elRef = useRef(null);
  const clamped = Math.min(100, Math.max(0, Math.round(Number.isFinite(progress) ? progress : 0)));

  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el || typeof el.set !== 'function') return;
    if (isComplete) {
      if ((el.p ?? 0) < 0.05) {
        // Kick near completion so newly mounted success screens still play the 100% burst cleanly.
        el.set(0.92, true);
      }
      el.set(1);
    } else {
      el.set(Math.min(0.96, clamped / 100));
    }
  }, [ready, clamped, isComplete]);

  if (!ready) {
    const shownPct = isComplete ? 100 : clamped;
    return (
      <div
        className={`wf-sakuga-fallback-progress${isComplete ? ' is-complete' : ''}`}
        role="progressbar"
        aria-label={label || 'Tiến độ chuẩn hóa'}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={shownPct}
      >
        <div className="wf-sakuga-fallback-track">
          <span className="wf-sakuga-fallback-fill" style={{ width: `${shownPct}%` }} />
        </div>
        <div className="wf-sakuga-fallback-meta">
          <strong className="wf-sakuga-fallback-pct">
            {isComplete ? doneLabel : `${shownPct}%`}
          </strong>
        </div>
      </div>
    );
  }

  return (
    <sakuga-progress
      ref={elRef}
      label={label}
      done-label={doneLabel}
      className={`wf-sakuga-progress-el${isComplete ? ' is-complete' : ''}`}
    />
  );
}
