import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteQuizSet, getQuizSets } from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import { AvatarContent, TitleBadges, getIdentityName } from '../../components/identity/Identity.jsx';
import QuizPartActionDialog from './QuizPartActionDialog.jsx';
import { partActions, partSummary, progressEntry, reviewProgressSummary } from './quiz-set-parts.js';
import './quiz.css';

/**
 * Trang chi tiết bộ đề: header (tiêu đề + mô tả + meta) và danh sách các
 * phần. Card trên trang môn học chỉ dẫn tới đây bằng nút "Xem", nên bộ đề
 * nhiều phần không làm card trên feed bị tràn.
 *
 * Dữ liệu lấy từ chính API danh sách bộ đề (đã có sẵn và dùng chung cache
 * với trang môn học), nên không cần endpoint riêng cho 1 bộ đề.
 */
export default function QuizSetPage() {
  const { courseCode, setId } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();
  // Phần đang mở popup chọn hành động (null = đóng).
  const [activePart, setActivePart] = useState(null);
  // Thu gọn danh hiệu tác giả còn tối đa 2 badge + nút "+N".
  const [titlesExpanded, setTitlesExpanded] = useState(false);

  const setsQuery = useQuery({
    queryKey: ['quiz-sets', courseCode, user?.mssv],
    queryFn: ({ signal }) => getQuizSets(token, courseCode, { signal }),
    enabled: Boolean(token && courseCode)
  });

  const set = useMemo(
    () => (setsQuery.data?.sets || []).find((item) => String(item.id) === String(setId)) || null,
    [setsQuery.data, setId]
  );

  const removeMutation = useMutation({
    mutationFn: (id) => deleteQuizSet(token, courseCode, id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
      notify('Đã xóa bộ đề trắc nghiệm.', 'success');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}`);
    },
    onError: (error) => notify(error?.message || 'Không thể xóa bộ đề.', 'error')
  });

  const handleDelete = useCallback(async (set) => {
    const ok = await askConfirm({
      title: 'Xóa bộ đề?',
      message: `Bộ đề “${set.title}” và toàn bộ tiến độ làm bài sẽ bị xóa vĩnh viễn.`,
      confirmText: 'Xóa bộ đề',
      danger: true
    });
    if (ok) removeMutation.mutate(set.id);
  }, [askConfirm, removeMutation]);

  const goBack = useCallback(() => {
    navigate(`/learning/${encodeURIComponent(courseCode || '')}`);
  }, [navigate, courseCode]);

  const breadcrumb = (
    <nav className="quiz-page-breadcrumb" aria-label="Đường dẫn">
      <button type="button" className="quiz-breadcrumb-link" onClick={goBack}>
        Kho Tài Liệu
      </button>
      <span aria-hidden="true"> / </span>
      <span>{courseCode}</span>
      {set && (
        <>
          <span aria-hidden="true"> / </span>
          <span>{set.title}</span>
        </>
      )}
    </nav>
  );

  if (setsQuery.isLoading && !setsQuery.data) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <p className="quiz-page-loading">Đang tải bộ đề trắc nghiệm...</p>
      </div>
    );
  }

  if (setsQuery.isError && !setsQuery.data) {
    const notFound = [400, 404].includes(setsQuery.error?.status);
    return (
      <div className="quiz-page">
        {breadcrumb}
        <section className="quiz-page-error" role="alert">
          <p>{notFound ? 'Không tìm thấy bộ đề này.' : (setsQuery.error?.message || 'Không thể tải bộ đề.')}</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </section>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <section className="quiz-page-error" role="alert">
          <p>Không tìm thấy bộ đề này.</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </section>
      </div>
    );
  }

  const partSizes = Array.isArray(set.part_sizes) ? set.part_sizes.map(Number) : [];
  const partCount = Number(set.part_count || partSizes.length || 0);
  const authorName = getIdentityName(set.author, null) || set.author?.name || 'Tác giả bộ đề';
  const authorTitles = Array.isArray(set.author?.titles) ? set.author.titles : [];
  const MAX_VISIBLE_TITLES = 2;
  const visibleTitles = titlesExpanded ? authorTitles : authorTitles.slice(0, MAX_VISIBLE_TITLES);
  const hiddenTitleCount = Math.max(0, authorTitles.length - MAX_VISIBLE_TITLES);
  const reviewSummary = reviewProgressSummary(set);
  const reviewPercent = reviewSummary.total > 0
    ? Math.min(100, Math.round((reviewSummary.answered / reviewSummary.total) * 100))
    : 0;

  const openPart = (partIndex, mode) => {
    navigate(`/learning/${encodeURIComponent(courseCode || '')}/quiz-sets/${encodeURIComponent(set.id)}/parts/${partIndex}/${mode}`);
  };

  return (
    <div className="quiz-page quiz-page--set">
      {breadcrumb}
      <header className="quiz-part-head">
        <div className="quiz-part-title-row">
          <h1 className="quiz-page-title">{set.title}</h1>
          {Boolean(set.is_mine) && (
            <button
              type="button"
              className="learning-post-delete-btn quiz-set-delete-btn"
              onClick={() => handleDelete(set)}
              disabled={removeMutation.isPending}
              title="Xóa bộ đề của bạn"
              aria-label={`Xóa bộ đề ${set.title}`}
            >
              Xóa
            </button>
          )}
        </div>
        {set.description ? <p className="quiz-page-description">{set.description}</p> : null}
        <div className="quiz-part-author">
          <span className="quiz-part-author-avatar">
            <AvatarContent user={set.author} alt={`Ảnh đại diện của ${authorName}`} />
          </span>
          <span className="quiz-part-author-name">{authorName}</span>
          {authorTitles.length > 0 && (
            <ul className="quiz-part-title-list" aria-label="Danh hiệu">
              {visibleTitles.map((title, index) => (
                <li key={title?.id || `${title?.label || 'title'}-${index}`}>
                  <TitleBadges titles={[title]} />
                </li>
              ))}
            </ul>
          )}
          {hiddenTitleCount > 0 && (
            <button
              type="button"
              className="quiz-title-more"
              aria-expanded={titlesExpanded}
              aria-label={titlesExpanded ? 'Thu gọn danh hiệu' : `Xem thêm ${hiddenTitleCount} danh hiệu`}
              onClick={() => setTitlesExpanded((value) => !value)}
            >
              {titlesExpanded ? 'Thu gọn' : `+${hiddenTitleCount}`}
            </button>
          )}
        </div>
        <section className="qz-hero" aria-label={`Tiến độ ${set.title}`}>
          <div className="qz-hero-top">
            <p className="qz-hero-label">Tiến độ ôn tập</p>
            <p className="qz-hero-numbers">{`Đã làm ${reviewSummary.answered}/${reviewSummary.total}`}</p>
          </div>
          <div
            className="qz-hero-bar"
            role="progressbar"
            aria-label={`Tiến độ ôn tập ${set.title}`}
            aria-valuemin={0}
            aria-valuemax={reviewSummary.total}
            aria-valuenow={reviewSummary.answered}
          >
            <span className="qz-hero-fill" style={{ width: `${reviewPercent}%` }} />
          </div>
          <p className="qz-hero-modes">
            <span>{`${Number(set.question_count || 0)} câu`}</span>
            <span>{`${partCount} phần`}</span>
            <span>{`${Number(set.minutes_per_part || 0)} phút/phần`}</span>
          </p>
        </section>
      </header>

      <section className="quiz-set-parts quiz-set-parts-page" aria-label={`Các phần của ${set.title}`}>
        {Array.from({ length: partCount }, (_, partIndex) => {
          const size = Number(partSizes[partIndex] || 0);
          const entry = progressEntry(set.progress, partIndex);
          const review = entry?.review || null;
          const test = entry?.test || null;
          const isDone = Boolean(review?.completed_at);
          const isDoing = !isDone && (
            Number(review?.answered || 0) > 0
            || (Number(test?.answered || 0) > 0 && !test?.completed_at)
          );
          const status = isDone ? 'done' : isDoing ? 'doing' : 'todo';
          const reviewPct = size > 0 ? Math.min(100, (Number(review?.answered || 0) / size) * 100) : 0;
          const testBest = test?.best_correct != null && test?.best_total > 0
            ? Math.min(100, (Number(test.best_correct) / Number(test.best_total)) * 100)
            : 0;
          const duoLabel = `Phần ${partIndex + 1}: ôn tập ${Number(review?.answered || 0)}/${size}`
            + (test?.best_correct != null && test?.best_total != null
              ? `, kiểm tra cao nhất ${test.best_correct}/${test.best_total}`
              : ', chưa kiểm tra');
          return (
            <button
              key={partIndex}
              type="button"
              className="quiz-set-part-row"
              data-status={status}
              aria-haspopup="dialog"
              onClick={() => setActivePart(partIndex)}
            >
              <span className="quiz-set-part-info">
                <strong>{`Phần ${partIndex + 1}`}</strong>
                <span>{`${size} câu`}</span>
              </span>
              <span className="quiz-set-part-summary">{partSummary(entry, size)}</span>
              <span className="qz-duo" role="img" aria-label={duoLabel}>
                <span className="qz-duo-review" style={{ width: `${reviewPct}%` }} />
                <span className="qz-duo-test" style={{ width: `${testBest}%` }} />
              </span>
            </button>
          );
        })}
      </section>
      {activePart !== null && (
        <QuizPartActionDialog
          title={`Phần ${activePart + 1} · ${Number(partSizes[activePart] || 0)} câu`}
          actions={partActions(progressEntry(set.progress, activePart), Number(partSizes[activePart] || 0))}
          onClose={() => setActivePart(null)}
          onPick={(action) => openPart(activePart, action.mode)}
        />
      )}
      {confirmUI}
    </div>
  );
}
