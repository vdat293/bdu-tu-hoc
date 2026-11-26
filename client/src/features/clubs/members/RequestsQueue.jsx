import { ClubAvatar, ClubEmptyState } from '../components/ClubPrimitives.jsx';
import { formatRelativeTime } from '../lib/format.js';

export default function RequestsQueue({
  requests,
  isLoading,
  isError,
  error,
  onRetry,
  actionPending,
  onApprove,
  onReject
}) {
  if (isLoading) return <div className="clb-empty" role="status"><h2>Đang tải yêu cầu…</h2></div>;
  if (isError) {
    return (
      <div className="clb-empty" role="alert">
        <h2>Chưa thể tải yêu cầu</h2>
        <p>{error?.message || 'Vui lòng thử lại.'}</p>
        <button type="button" className="clb-btn clb-btn--secondary" onClick={onRetry}>Thử lại</button>
      </div>
    );
  }
  if (!requests?.length) {
    return <ClubEmptyState title="Không có yêu cầu chờ duyệt" hint="Các yêu cầu tham gia mới sẽ xuất hiện tại đây." />;
  }

  return (
    <div className="clb-list">
      {requests.map((request) => (
        <article className="clb-row" key={request.id}>
          <div className="clb-row__id">
            <ClubAvatar src={request.avatar_url} name={request.full_name || request.mssv} size="sm" />
            <div className="clb-row__copy">
              <strong>{request.full_name || request.mssv}</strong>
              <span>{request.mssv} · {formatRelativeTime(request.created_at)}</span>
              {request.message && <span>Lời nhắn: {request.message}</span>}
              {request.quiz_score !== null && request.quiz_score !== undefined && (
                <span>
                  Quiz: {request.quiz_score}/{request.quiz_total} · {request.quiz_passed ? 'Đạt ngưỡng' : 'Chờ xét duyệt'}
                </span>
              )}
            </div>
          </div>

          <div className="clb-row__actions">
            <button
              type="button"
              className="clb-btn clb-btn--primary clb-btn--sm"
              disabled={actionPending}
              onClick={() => onApprove?.(request)}
            >
              Duyệt
            </button>
            <button
              type="button"
              className="clb-btn clb-btn--secondary clb-btn--sm"
              disabled={actionPending}
              onClick={() => onReject?.(request)}
            >
              Từ chối
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
