import { SkeletonBlock } from '../../components/feedback/Loading.jsx';

export function ForumPostSkeletonList({ count = 3 }) {
  return Array.from({ length: count }, (_, index) => (
    <article className="forum-post-card glass-panel skeleton-forum-post" key={index} aria-hidden="true">
      <div className="forum-post-header">
        <SkeletonBlock className="skeleton-avatar" />
        <div className="skeleton-copy">
          <SkeletonBlock className="skeleton-line heading" />
          <SkeletonBlock className="skeleton-line short" />
        </div>
      </div>
      <div className="skeleton-copy skeleton-forum-post-copy">
        <SkeletonBlock className="skeleton-line wide" />
        <SkeletonBlock className="skeleton-line wide" />
        <SkeletonBlock className="skeleton-line medium" />
      </div>
    </article>
  ));
}

/**
 * Bản dựng đúng bố cục trang Confession để lần tải đầu không hiện một khung
 * hình nửa vời (hero trống, sidebar chưa có danh hiệu, feed skeleton lẻ loi).
 * Chỉ dùng khi chưa có dữ liệu nguồn; đổi filter/refetch sau đó giữ nguyên nội
 * dung đang có.
 */
export default function ConfessionPageSkeleton({ label = 'Đang tải BDU Confession…' }) {
  return (
    <section id="tab-confession" className="tab-pane active" aria-busy="true">
      <span className="fbc-sr-only" role="status" aria-live="polite">{label}</span>

      <div className="forum-hero-banner glass-panel confession-skeleton-hero" aria-hidden="true">
        <div className="confession-skeleton-hero-content">
          <SkeletonBlock className="confession-skeleton-avatar" />
          <SkeletonBlock className="skeleton-line title" />
          <SkeletonBlock className="skeleton-line heading" />
          <SkeletonBlock className="skeleton-line medium" />
        </div>
      </div>

      <div className="forum-two-column-layout" aria-hidden="true">
        <div className="forum-main-column">
          <div className="forum-quick-composer glass-panel confession-skeleton-composer">
            <div className="skeleton-copy skeleton-forum-post-copy">
              <SkeletonBlock className="skeleton-line wide" />
              <SkeletonBlock className="skeleton-line medium" />
            </div>
            <div className="confession-skeleton-pills">
              <SkeletonBlock className="confession-skeleton-pill" />
              <SkeletonBlock className="confession-skeleton-pill" />
              <SkeletonBlock className="confession-skeleton-pill" />
            </div>
          </div>

          <div className="forum-filter-bar glass-panel confession-skeleton-filter">
            <div className="confession-skeleton-pills">
              <SkeletonBlock className="confession-skeleton-filter-pill" />
              <SkeletonBlock className="confession-skeleton-filter-pill" />
              <SkeletonBlock className="confession-skeleton-filter-pill" />
            </div>
            <SkeletonBlock className="confession-skeleton-filter-pill" />
          </div>

          <div className="forum-posts-stream">
            <ForumPostSkeletonList />
          </div>
        </div>

        <div className="forum-sidebar-column">
          <div className="forum-widget glass-panel confession-skeleton-widget">
            <div className="confession-skeleton-widget-head">
              <SkeletonBlock className="confession-skeleton-avatar small" />
              <div className="skeleton-copy">
                <SkeletonBlock className="skeleton-line heading" />
                <SkeletonBlock className="skeleton-line short" />
              </div>
            </div>
            <div className="confession-skeleton-pills">
              <SkeletonBlock className="confession-skeleton-pill" />
              <SkeletonBlock className="confession-skeleton-pill" />
            </div>
            <SkeletonBlock className="confession-skeleton-button" />
            <SkeletonBlock className="confession-skeleton-button" />
          </div>

          <div className="forum-widget glass-panel confession-skeleton-widget">
            <SkeletonBlock className="skeleton-line heading" />
            <SkeletonBlock className="confession-skeleton-button" />
            <SkeletonBlock className="confession-skeleton-button" />
            <SkeletonBlock className="confession-skeleton-button" />
          </div>
        </div>
      </div>
    </section>
  );
}
