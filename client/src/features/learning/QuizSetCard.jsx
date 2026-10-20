import { useNavigate } from 'react-router-dom';
import { AvatarContent, TitleBadges, getIdentityName } from '../../components/identity/Identity.jsx';
import './quiz.css';

function progressEntry(progress, partIndex) {
  if (!Array.isArray(progress)) return null;
  return progress.find((entry) => Number(entry?.part_index) === Number(partIndex)) || null;
}

function reviewState(entry, partSize) {
  const review = entry?.review || null;
  const answered = Number(review?.answered || 0);
  const total = Number(review?.total_count || partSize || 0);
  if (review?.completed_at) return { label: `Đã làm ${total}/${partSize}`, cta: 'Ôn tập lại' };
  if (answered > 0) return { label: `Đã làm ${answered}/${partSize}`, cta: 'Làm tiếp' };
  return { label: `Ôn tập · ${partSize} câu`, cta: 'Ôn tập' };
}

function testState(entry) {
  const test = entry?.test || null;
  const attempts = Number(test?.attempts || 0);
  if (test?.best_correct != null && test?.best_total != null) {
    return { label: `Cao nhất ${test.best_correct}/${test.best_total} · ${attempts} lượt`, cta: 'Kiểm tra' };
  }
  if (attempts > 0) return { label: `${attempts} lượt làm`, cta: 'Kiểm tra' };
  return { label: 'Kiểm tra · tính giờ', cta: 'Kiểm tra' };
}

export default function QuizSetCard({ courseCode, set, onDelete, deleting = false }) {
  const navigate = useNavigate();
  if (!set) return null;

  const partSizes = Array.isArray(set.part_sizes) ? set.part_sizes.map(Number) : [];
  const partCount = Number(set.part_count || partSizes.length || 0);
  const indexes = Array.from({ length: partCount }, (_, i) => i);
  const authorName = set.author?.name || set.author?.mssv || 'Tác giả bộ đề';
  const authorTitles = Array.isArray(set.author?.titles) ? set.author.titles : [];

  const openPart = (partIndex, mode) => {
    navigate(`/learning/${encodeURIComponent(courseCode)}/quiz-sets/${encodeURIComponent(set.id)}/parts/${partIndex}/${mode}`);
  };

  return (
    <article className="quiz-set-card glass-panel" aria-label={`Bộ đề ${set.title}`}>
      <header className="quiz-set-card-head">
        <h3 className="quiz-set-card-title">{set.title}</h3>
        {set.description ? <p className="quiz-set-card-description">{set.description}</p> : null}
        <p className="quiz-set-card-meta">
          {`${Number(set.question_count || 0)} câu · ${partCount} phần · ${Number(set.minutes_per_part || 0)} phút/phần`}
        </p>
      </header>

      <div className="quiz-set-parts">
        {indexes.map((partIndex) => {
          const size = Number(partSizes[partIndex] || 0);
          const entry = progressEntry(set.progress, partIndex);
          const review = reviewState(entry, size);
          const test = testState(entry);
          return (
            <div key={partIndex} className="quiz-set-part-row">
              <div className="quiz-set-part-info">
                <strong>{`Phần ${partIndex + 1}`}</strong>
                <span>{`${size} câu`}</span>
              </div>
              <div className="quiz-set-part-modes">
                <div className="quiz-set-mode">
                  <span className="quiz-set-progress-text">{review.label}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openPart(partIndex, 'review')}
                  >
                    {review.cta}
                  </button>
                </div>
                <div className="quiz-set-mode">
                  <span className="quiz-set-progress-text">{test.label}</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => openPart(partIndex, 'test')}
                  >
                    {test.cta}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="quiz-set-card-footer">
        <div className="quiz-set-author">
          <span className="quiz-set-author-avatar">
            <AvatarContent user={set.author} alt={`Ảnh đại diện của ${getIdentityName(set.author, null) || authorName}`} />
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
