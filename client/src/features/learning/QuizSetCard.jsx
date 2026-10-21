import { useNavigate } from 'react-router-dom';
import { AvatarContent, TitleBadges, getIdentityName } from '../../components/identity/Identity.jsx';
import { reviewProgressSummary } from './quiz-set-parts.js';
import './quiz.css';

export default function QuizSetCard({ courseCode, set, onDelete, deleting = false }) {
  const navigate = useNavigate();
  if (!set) return null;

  const partCount = Number(set.part_count || (Array.isArray(set.part_sizes) ? set.part_sizes.length : 0) || 0);
  const authorName = set.author?.name || set.author?.mssv || 'Tác giả bộ đề';
  const authorTitles = Array.isArray(set.author?.titles) ? set.author.titles : [];
  const reviewProgress = reviewProgressSummary(set);
  const cardPercent = reviewProgress.total > 0
    ? Math.min(100, Math.round((reviewProgress.answered / reviewProgress.total) * 100))
    : 0;

  // "Xem" sang trang chi tiết bộ đề: danh sách phần nằm ở trang riêng nên
  // card không bao giờ phải chứa hết các phần (bộ đề nhiều phần không làm
  // card tràn ra ngoài trang).
  const openSet = () => {
    navigate(`/learning/${encodeURIComponent(courseCode)}/quiz-sets/${encodeURIComponent(set.id)}`);
  };

  return (
    <article className="quiz-set-card glass-panel" aria-label={`Bộ đề ${set.title}`}>
      <header className="quiz-set-card-head">
        <h3 className="quiz-set-card-title">{set.title}</h3>
        {set.description ? <p className="quiz-set-card-description">{set.description}</p> : null}
      </header>

      <div className="quiz-set-card-bar">
        {/* Meta + CTA luôn nằm chung một hàng: trước đây là 3 flex item
            (meta, thanh tiến độ, nút) nên khi meta dài ("… · Đã làm 17/34")
            nút bị đẩy xuống dòng và lệch trái, card này lệch card kia. */}
        <div className="quiz-set-card-meta-row">
          <p className="quiz-set-card-meta quiz-summary-chip-nums">
            {[
              `${Number(set.question_count || 0)} câu`,
              `${partCount} phần`,
              `${Number(set.minutes_per_part || 0)} phút/phần`,
              reviewProgress.answered > 0 ? `Đã làm ${reviewProgress.answered}/${reviewProgress.total}` : null
            ].filter(Boolean).join(' · ')}
          </p>
          <button type="button" className="quiz-set-toggle" onClick={openSet}>
            Xem {partCount} phần
            <span className="quiz-set-toggle-caret" aria-hidden="true">→</span>
          </button>
        </div>

        {/* Thanh tiến độ chỉ hiện khi đã làm bài: track là flex item nên phải
            có width 100%, nếu không nó co về 0px và không thấy thanh nào. */}
        {reviewProgress.answered > 0 && (
          <div
            className="qz-card-progress"
            role="progressbar"
            aria-label={`Tiến độ ôn tập ${set.title}`}
            aria-valuemin={0}
            aria-valuemax={reviewProgress.total}
            aria-valuenow={reviewProgress.answered}
          >
            <span className="qz-card-progress-fill" style={{ width: `${cardPercent}%` }} />
          </div>
        )}
      </div>

      <footer className="quiz-set-card-footer">
        <div className="quiz-set-author">
          <span className="quiz-set-author-avatar">
            <AvatarContent
              user={set.author}
              alt={`Ảnh đại diện của ${getIdentityName(set.author, null) || authorName}`}
            />
          </span>
          <span className="quiz-set-author-name">{authorName}</span>
          {authorTitles.length > 0 && <TitleBadges titles={authorTitles} className="learning-inline-titles" />}
        </div>
        {Boolean(set.is_mine) && typeof onDelete === 'function' && (
          <button
            type="button"
            className="learning-post-delete-btn"
            onClick={() => onDelete(set)}
            disabled={deleting}
            title="Xóa bộ đề của bạn"
            aria-label={`Xóa bộ đề ${set.title}`}
          >
            Xóa
          </button>
        )}
      </footer>
    </article>
  );
}
