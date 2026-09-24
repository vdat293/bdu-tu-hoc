import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getGrammarLesson, saveGrammarProgress } from '../../api/grammar.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import GrammarRunner from './GrammarRunner.jsx';
import { buildItems } from './grammar-lib.js';
import './grammar.css';

function accuracyOf(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export default function GrammarLessonPage() {
  const { lessonId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [phase, setPhase] = useState('theory');
  const [roundKey, setRoundKey] = useState(0);
  const [start, setStart] = useState({ index: 0, correct: 0 });

  const query = useQuery({
    queryKey: ['grammar-lesson', lessonId, auth.user?.mssv],
    queryFn: ({ signal }) => getGrammarLesson(auth.token, lessonId, { signal }),
    enabled: Boolean(auth.token && lessonId)
  });

  const payload = query.data || null;
  const items = useMemo(() => buildItems(payload), [payload]);
  const progress = payload?.progress || null;
  const pathId = payload?.lesson?.path_id;

  const saveMutation = useMutation({
    mutationFn: (value) => saveGrammarProgress(auth.token, lessonId, value),
    onError: (error) => notify(error?.message || 'Không thể lưu tiến độ.', 'error'),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['grammar-path'] });
      client.invalidateQueries({ queryKey: ['grammar-groups'] });
      client.invalidateQueries({ queryKey: ['grammar-lesson', lessonId] });
    }
  });

  const backToPath = () => {
    if (pathId) {
      navigate(`/grammar/path/${encodeURIComponent(pathId)}`);
      return;
    }
    if (location.key === 'default') navigate('/grammar', { replace: true });
    else navigate(-1);
  };

  const startQuiz = (resume) => {
    const canResume = Boolean(progress && !progress.completed_at && progress.answered > 0 && progress.answered < items.length);
    setStart(resume && canResume ? { index: progress.answered, correct: progress.correct_count || 0 } : { index: 0, correct: 0 });
    setRoundKey((k) => k + 1);
    setPhase('quiz');
  };

  if (query.isLoading) {
    return (
      <section className="tab-pane active">
        <div className="glass-panel" style={{ padding: '24px' }} aria-busy="true">
          <SkeletonBlock className="skeleton-line heading" />
          <SkeletonBlock className="skeleton-line wide" />
          <SkeletonBlock className="skeleton-line short" />
        </div>
      </section>
    );
  }

  if (query.isError || !payload) {
    const notFound = query.error?.status === 404;
    return (
      <section className="tab-pane active">
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/grammar')} style={{ marginBottom: '12px' }}>
          ← Tất cả lộ trình
        </button>
        <div className="glass-panel" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <h3>{notFound ? 'Không tìm thấy bài học' : 'Không thể tải bài học'}</h3>
          <p>{notFound ? 'Bài học không tồn tại hoặc đã bị gỡ.' : (query.error?.message || 'Vui lòng thử lại sau.')}</p>
          <button className="btn btn-primary" type="button" onClick={() => query.refetch()}>Thử lại</button>
        </div>
      </section>
    );
  }

  const { lesson, rules } = payload;
  const canResume = Boolean(progress && !progress.completed_at && progress.answered > 0 && progress.answered < items.length);
  const bestAccuracy = progress?.best_total ? accuracyOf(progress.best_correct, progress.best_total) : null;

  if (phase === 'quiz') {
    return (
      <section className="tab-pane active">
        <p className="gr-crumb">
          <button type="button" className="gr-crumb-link" onClick={backToPath}>{lesson.path_name}</button>
          {' · '}<span>{lesson.name}</span>
        </p>
        <GrammarRunner
          key={roundKey}
          items={items}
          initialIndex={start.index}
          initialCorrect={start.correct}
          onQuizSave={(value) => saveMutation.mutateAsync(value).catch(() => {})}
          onBackToTheory={() => setPhase('theory')}
          onExitToPath={backToPath}
        />
      </section>
    );
  }

  return (
    <section className="tab-pane active">
      <button className="btn btn-secondary" type="button" onClick={backToPath} style={{ marginBottom: '12px' }}>
        ← {lesson.path_name || 'Về lộ trình'}
      </button>

      <div className="gr-theory glass-panel">
        <div className="gr-theory-head">
          <div>
            <h2 className="gr-theory-title">{lesson.name}: Lý thuyết</h2>
            <p className="gr-theory-sub">{lesson.description || `${rules.length} phần lý thuyết · ${items.length} câu hỏi`}</p>
          </div>
          <button className="btn-ghost" type="button" onClick={() => window.print()}>🖨 In / PDF</button>
        </div>

        <div className="gr-theory-stats">
          <span className="gr-theme-badge is-sky">📖 {rules.length} lý thuyết</span>
          <span className="gr-theme-badge is-mint">📝 {items.length} câu hỏi</span>
          {progress?.completed_at ? (
            <span className="gr-theme-badge is-violet">
              ✓ Đã học{bestAccuracy != null ? ` · Chính xác ${bestAccuracy}%` : ''} · {progress.attempts} lần
            </span>
          ) : null}
        </div>

        {items.length ? (
          <div className="gr-theory-actions">
            <button className="gr-start-btn" type="button" onClick={() => startQuiz(true)}>
              {canResume ? `▶ Tiếp tục từ câu ${progress.answered + 1}/${items.length}` : '▶ Làm bài tập'}
            </button>
            {canResume ? (
              <button className="btn-ghost" type="button" onClick={() => startQuiz(false)}>↻ Làm lại từ đầu</button>
            ) : null}
          </div>
        ) : (
          <p className="gr-theory-empty">Bài học đang được cập nhật nội dung.</p>
        )}

        {rules.length === 0 ? (
          <p className="gr-theory-empty">Bài học chưa có phần lý thuyết.</p>
        ) : (
          <div className="gr-rules">
            {rules.map((rule, i) => (
              <article className="gr-rule" key={rule.id}>
                <h3 className="gr-rule-title">{rule.title || `Phần ${i + 1}`}</h3>
                <div className="gr-rule-content" dangerouslySetInnerHTML={{ __html: rule.content }} />
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
