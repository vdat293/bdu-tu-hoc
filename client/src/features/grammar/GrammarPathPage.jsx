import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getGrammarPath } from '../../api/grammar.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { difficultyColor } from './grammar-lib.js';
import './grammar.css';

export default function GrammarPathPage() {
  const { pathId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['grammar-path', pathId, auth.user?.mssv],
    queryFn: ({ signal }) => getGrammarPath(auth.token, pathId, { signal }),
    enabled: Boolean(auth.token && pathId)
  });

  const path = query.data?.path || null;
  const lessons = useMemo(() => (Array.isArray(query.data?.lessons) ? query.data.lessons : []), [query.data]);
  const summary = query.data?.summary || { lesson_count: 0, completed_lessons: 0, total_questions: 0 };
  const donePct = summary.lesson_count > 0 ? Math.round((summary.completed_lessons / summary.lesson_count) * 100) : 0;
  const color = difficultyColor(Number(path?.difficulty) || 1);

  if (query.isError) {
    const notFound = query.error?.status === 404;
    return (
      <section className="tab-pane active">
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/grammar')} style={{ marginBottom: '12px' }}>
          ← Tất cả lộ trình
        </button>
        <div className="glass-panel" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <h3>{notFound ? 'Không tìm thấy lộ trình' : 'Không thể tải lộ trình'}</h3>
          <p>{notFound ? 'Lộ trình không tồn tại hoặc đã bị gỡ.' : (query.error?.message || 'Vui lòng thử lại sau.')}</p>
          <button className="btn btn-primary" type="button" onClick={() => query.refetch()}>Thử lại</button>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-pane active">
      <button className="btn btn-secondary" type="button" onClick={() => navigate('/grammar')} style={{ marginBottom: '12px' }}>
        ← Tất cả lộ trình
      </button>

      <div className="gr-panel glass-panel gr-hero">
        <div className="gr-hero-head">
          <span className="gr-hero-icon" aria-hidden="true">📘</span>
          <div>
            <h2 className="gr-hero-title">{path?.name || 'Đang tải...'}</h2>
            {path?.group_name ? <p className="gr-hero-group">{path.group_name}</p> : null}
          </div>
          <div className="gr-hero-badges">
            <span className="gr-theme-badge is-sky">📚 {summary.lesson_count} bài học</span>
            <span className="gr-theme-badge is-amber">⏱ ~{path?.estimated_minutes || 0} phút</span>
            <span className="gr-theme-badge is-mint">✓ {summary.completed_lessons}/{summary.lesson_count} bài đã học</span>
          </div>
        </div>
        <div className="gr-hero-progress">
          <div className="gr-hero-progress-label">
            <span>Tiến độ học tập: <strong>{donePct}%</strong></span>
            <span className="gr-hero-difficulty" style={{ color }}>Độ khó {path?.difficulty || 1}/5</span>
          </div>
          <div
            className="gr-hero-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary.lesson_count || 1}
            aria-valuenow={summary.completed_lessons}
            aria-label={`Tiến độ ${summary.completed_lessons}/${summary.lesson_count} bài`}
          >
            <i style={{ width: `${donePct}%` }} />
          </div>
        </div>
      </div>

      <div className="gr-panel glass-panel">
        <div className="gr-panel-head">
          <h3>📋 Danh sách bài học</h3>
          <span className="gr-list-count">{lessons.length} bài</span>
        </div>

        {query.isLoading ? (
          <div className="gr-lessons" aria-busy="true">
            {[1, 2, 3, 4, 5].map((k) => (
              <div className="gr-lesson glass-panel" key={k} aria-hidden="true">
                <SkeletonBlock className="skeleton-line heading" />
                <SkeletonBlock className="skeleton-line wide" />
              </div>
            ))}
          </div>
        ) : lessons.length === 0 ? (
          <p>Lộ trình chưa có bài học.</p>
        ) : (
          <ol className="gr-lessons">
            {lessons.map((lesson, index) => {
              const target = `/grammar/lesson/${encodeURIComponent(lesson.id)}`;
              const classes = ['gr-lesson', 'glass-panel'];
              if (lesson.completed) classes.push('is-completed');
              else if (lesson.in_progress) classes.push('is-active');
              return (
                <li className={classes.join(' ')} key={lesson.id}>
                  <button
                    type="button"
                    className="gr-lesson-btn"
                    onClick={() => navigate(target)}
                    aria-label={`Mở bài ${lesson.name}`}
                  >
                    <span className={`gr-lesson-index ${lesson.completed ? 'is-done' : lesson.in_progress ? 'is-active' : ''}`}>
                      {lesson.completed ? '✓' : (lesson.order || index + 1)}
                    </span>
                    <span className="gr-lesson-main">
                      <strong className="gr-lesson-name">{lesson.name}</strong>
                      <span className="gr-lesson-badges">
                        {lesson.completed ? (
                          <span className="gr-badge is-mint">✓ Đã học</span>
                        ) : lesson.in_progress ? (
                          <span className="gr-badge is-amber">Đang học {lesson.progress_percent}%</span>
                        ) : (
                          <span className="gr-badge">📝 {lesson.question_count} câu hỏi</span>
                        )}
                        {lesson.answered > 0 || lesson.completed ? (
                          <span className="gr-badge is-sky">Độ chính xác: {lesson.accuracy}%</span>
                        ) : null}
                        {lesson.attempts > 1 ? <span className="gr-badge">↻ {lesson.attempts} lần</span> : null}
                      </span>
                    </span>
                    <span className="gr-lesson-arrow" aria-hidden="true">→</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
