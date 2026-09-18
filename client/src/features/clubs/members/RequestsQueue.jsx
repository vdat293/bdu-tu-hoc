import { formatRelativeTime, initials } from '../lib/format.js';
import EmptyState from '../components/EmptyState.jsx';

export default function RequestsQueue({ requests, isLoading, isError, error, onRetry, actionPending, onApprove, onReject }) {
  if (isLoading) return <div className="club-empty" role="status"><h2>Đang tải yêu cầu…</h2></div>;
  if (isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải yêu cầu</h2>
        <p>{error?.message || 'Vui lòng thử lại.'}</p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Thử lại</button>
      </div>
    );
  }
  if (!requests?.length) return <EmptyState title="Không có yêu cầu chờ duyệt" hint="Các yêu cầu mới sẽ xuất hiện tại đây." />;

  return (
    <div className="club-request-list">
      {requests.map((request) => (
        <article className="club-request" key={request.id}>
          <div className="club-request__identity">
            <span className="club-avatar club-avatar--sm" aria-hidden="true">
              {request.avatar_url ? <img src={request.avatar_url} alt="" /> : initials(request.full_name || request.mssv)}
            </span>
            <div className="club-request__copy">
              <strong>{request.full_name || request.mssv}</strong>
              <span>{request.mssv} · {formatRelativeTime(request.created_at)}</span>
              {request.message && <span>Lời nhắn: {request.message}</span>}
              {request.quiz_score !== null && request.quiz_score !== undefined && (
                <span>Quiz: {request.quiz_score}/{request.quiz_total} · {request.quiz_passed ? 'Đạt ngưỡng' : 'Chờ xét duyệt'}</span>
              )}
            </div>
          </div>
          <div className="club-request__actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={actionPending} onClick={() => onApprove?.(request)}>Duyệt</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={actionPending} onClick={() => onReject?.(request)}>Từ chối</button>
          </div>
        </article>
      ))}
    </div>
  );
}
