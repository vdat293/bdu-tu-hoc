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
  const list = Array.isArray(steps) ? steps : [];
  const done = countDone(list, doneMap);
  const total = list.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <aside className="guide-sidebar" aria-label="Mục lục hướng dẫn">
      <div className="guide-sidebar-progress">
        <p className="guide-sidebar-progress-text">Đã xong {done}/{total}</p>
        <div className="guide-sidebar-progress-track" role="progressbar" aria-label={`Tiến độ ${lesson?.title || 'hướng dẫn'}`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
          <span className="guide-sidebar-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {lesson?.title && (
        <div className="guide-sidebar-lesson">
          <p className="guide-sidebar-section-title">Không gian thực hành</p>
          <p className="guide-sidebar-lesson-title">{lesson.title}</p>
        </div>
      )}
      <nav className="guide-sidebar-nav" aria-label="Các chặng">
        <p className="guide-sidebar-section-title">Mục lục hướng dẫn</p>
        <ol className="guide-sidebar-steps">
          {list.map((step, index) => {
            const entry = doneMap?.[step.id];
            const isDone = typeof entry === 'object' ? entry?.done === true : entry === true;
            const isActive = step.id === activeStep;
            return (
              <li key={step.id} className={`guide-sidebar-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}>
                <button
                  type="button"
                  className="guide-sidebar-step-btn"
                  onClick={() => onSelect?.(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className="guide-sidebar-step-num" aria-hidden="true">{isDone ? '✓' : index + 1}</span>
                  <span className="guide-sidebar-step-text">
                    <span className="guide-sidebar-step-title">{step.title}</span>
                    <span className="guide-where-badge">{whereLabel(step)}</span>
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
