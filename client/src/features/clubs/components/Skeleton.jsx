export function ClubCardSkeleton() {
  return (
    <div className="club-card club-skeleton-card" aria-label="Đang tải CLB">
      <div className="club-shimmer club-shimmer--avatar" />
      <div className="club-shimmer club-shimmer--line club-shimmer--heading" />
      <div className="club-shimmer club-shimmer--line club-shimmer--wide" />
      <div className="club-shimmer club-shimmer--line club-shimmer--short" />
    </div>
  );
}

export function PostSkeleton() {
  return (
    <div className="club-post club-skeleton-card" aria-label="Đang tải bài viết">
      <div className="club-shimmer club-shimmer--line club-shimmer--wide" />
      <div className="club-shimmer club-shimmer--line" />
      <div className="club-shimmer club-shimmer--line club-shimmer--short" />
    </div>
  );
}

export function DocSkeleton() {
  return (
    <div className="club-doc club-skeleton-card" aria-label="Đang tải tài liệu">
      <div className="club-shimmer club-shimmer--line club-shimmer--wide" />
      <div className="club-shimmer club-shimmer--line club-shimmer--short" />
    </div>
  );
}
