import { useEffect, useRef } from 'react';
import styles from './GuideSidebar.module.css';

const WHERE_LABELS = {
  local: 'Máy local',
  cloudshell: 'AWS CloudShell',
  browser: 'Trình duyệt'
};

export function whereLabel(step) {
  if (step?.whereLabel) return String(step.whereLabel);
  return WHERE_LABELS[step?.where] || 'Máy local';
}

export function countDone(steps, doneMap) {
  return (steps || []).filter((step) => {
    const entry = doneMap?.[step.id];
    if (!entry) return false;
    return typeof entry === 'object' ? entry.done === true : entry === true;
  }).length;
}

export default function GuideSidebar({ lesson, steps, doneMap, activeStep, onSelect }) {
  const rootRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let frame = null;
    const updateHeight = () => {
      frame = null;
      const top = Math.max(12, root.getBoundingClientRect().top);
      const available = Math.max(0, Math.floor(window.innerHeight - top - 12));
      root.style.setProperty('--guide-toc-available-height', `${available}px`);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateHeight);
    };
    // Measure the actual space below the component, including the app header
    // and nested scrolling containers, without depending on legacy CSS sizes.
    const observer = window.ResizeObserver ? new window.ResizeObserver(scheduleUpdate) : null;
    if (root.parentElement) observer?.observe(root.parentElement);
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    updateHeight();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, []);
  const list = Array.isArray(steps) ? steps : [];
  const done = countDone(list, doneMap);
  const total = list.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <aside ref={rootRef} className={styles.root} aria-label="Mục lục hướng dẫn">
      <div className={styles.progress}>
        <p className={styles.progressText}>Đã xong {done}/{total}</p>
        <div className={styles.progressTrack} role="progressbar" aria-label={`Tiến độ ${lesson?.title || 'hướng dẫn'}`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
          <span className={styles.progressFill} style={{ width: `${percent}%` }} />
        </div>
      </div>
      {lesson?.title && (
        <p className={styles.lesson}>{lesson.title}</p>
      )}
      <nav className={styles.nav} aria-label="Các chặng">
        <p className={styles.sectionTitle}>Mục lục hướng dẫn</p>
        <ol className={styles.steps}>
          {list.map((step, index) => {
            const entry = doneMap?.[step.id];
            const isDone = typeof entry === 'object' ? entry?.done === true : entry === true;
            const isActive = step.id === activeStep;
            return (
              <li key={step.id} className={`${styles.step}${isDone ? ` ${styles.done}` : ''}`}>
                <button
                  type="button"
                  className={styles.stepButton}
                  onClick={() => onSelect?.(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className={styles.number} aria-hidden="true">{isDone ? '✓' : index + 1}</span>
                  <span className={styles.stepText}>
                    <span className={styles.title}>{step.title}</span>
                    <span className={styles.location}>{whereLabel(step)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
