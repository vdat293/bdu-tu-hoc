export function Spinner({ label = 'Đang tải…', className = '' }) {
  return <span className={`spinner ${className}`} aria-hidden="true" />;
}

export function RouteSpinner() {
  return <div className="route-loading" role="status" aria-live="polite" aria-busy="true"><Spinner /> <span>Đang mở trang…</span></div>;
}

export function PageSpinner({ label = 'Đang tải dữ liệu…' }) {
  return <div className="page-loading" role="status" aria-live="polite" aria-busy="true"><Spinner /><span>{label}</span></div>;
}

export function InlineSpinner({ label = 'Đang tải…' }) {
  return <span className="inline-loading" role="status" aria-live="polite" aria-busy="true"><Spinner />{label}</span>;
}

export function ButtonSpinner() { return <Spinner className="button-spinner" label="Đang xử lý…" />; }

export function AsyncState({ query, empty = 'Chưa có dữ liệu.', children }) {
  if (query.isPending) return <PageSpinner />;
  if (query.isError) return <div className="state-card error-state" role="alert"><strong>Không thể tải dữ liệu</strong><p>{query.error.message}</p><button className="button secondary" onClick={() => query.refetch()}>Thử lại</button></div>;
  if (!children) return <div className="state-card empty-state">{empty}</div>;
  return children;
}
