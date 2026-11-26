export function TtcdsEmptyState({ title, hint, action }) {
  return (
    <div className="club-empty">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function TtcdsCardSkeleton({ label = 'Đang tải' } = {}) {
  return (
    <div className="club-card club-skeleton-card" aria-label={label}>
      <div className="club-shimmer club-shimmer--avatar" />
      <div className="club-shimmer club-shimmer--line club-shimmer--heading" />
      <div className="club-shimmer club-shimmer--line club-shimmer--wide" />
      <div className="club-shimmer club-shimmer--line club-shimmer--short" />
    </div>
  );
}
