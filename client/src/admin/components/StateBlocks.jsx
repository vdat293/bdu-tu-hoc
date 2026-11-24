import { Icons } from './Icons.jsx';
import { formatPercent } from '../utils/format.js';

export function SkeletonBlock({ rows = 3 }) {
  const safeRows = Math.max(1, Math.min(8, Number(rows) || 3));
  return (
    <div className="state-block stack-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Đang tải dữ liệu...</span>
      {Array.from({ length: safeRows }, (_, idx) => (
        <div className="skeleton-row" key={idx}>
          <span className="skeleton-bar" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title = 'Không có dữ liệu', message = 'Chưa có dữ liệu trong khoảng thời gian này.', hint = '' }) {
  return (
    <div className="state-block state-empty">
      <span className="state-icon" aria-hidden="true">
        <Icons.emptyBox size={24} />
      </span>
      <p className="state-title">{title}</p>
      <p className="state-message">{message}</p>
      {hint ? <p className="state-hint">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ title = 'Không tải được dữ liệu', message = 'Đã xảy ra lỗi khi tải dữ liệu.', onRetry }) {
  return (
    <div className="state-block state-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        <Icons.alert size={24} />
      </span>
      <p className="state-title">{title}</p>
      <p className="state-message">{message}</p>
      {typeof onRetry === 'function' ? (
        <button type="button" className="btn-retry" onClick={onRetry}>
          <Icons.refresh size={15} />
          <span>Thử lại</span>
        </button>
      ) : null}
    </div>
  );
}

export function TrendPill({ value, zeroLabel = '■ 0%', emptyLabel = '—' }) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return <span className="trend-pill trend-neutral">{emptyLabel}</span>;
  }
  const num = Number(value);
  if (num > 0) {
    return <span className="trend-pill trend-up">▲ +{formatPercent(num)}</span>;
  }
  if (num < 0) {
    return <span className="trend-pill trend-down">▼ {formatPercent(num)}</span>;
  }
  return <span className="trend-pill trend-neutral">{zeroLabel}</span>;
}

export function ToastRegion({ toasts }) {
  return (
    <div className="admin-toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`admin-toast admin-toast--${toast.type || 'info'}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
