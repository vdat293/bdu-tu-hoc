import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { checkGrammarAnswer, getGrammarLesson, saveGrammarExtraProgress, saveGrammarProgress } from '../../api/grammar.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import GrammarRunner from './GrammarRunner.jsx';
import { buildItems, friendlyErrorMessage } from './grammar-lib.js';
import './grammar.css';

function accuracyOf(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// Tiến độ đã lưu trước đó nhưng không nằm trong `responses` (dữ liệu cũ chưa
// lưu câu trả lời) để server cộng dồn khi "Làm tiếp" mà không bị mất.
function roundStartFrom(progress) {
  const responses = Array.isArray(progress?.responses) ? progress.responses : [];
  const answered = Math.max(0, Number(progress?.answered) || 0);
  const correct = Math.max(0, Number(progress?.correct_count) || 0);
  const restoredCorrect = responses.filter((entry) => entry?.correct === true).length;
  return {
    index: answered,
    correct,
    responses,
    answeredBefore: Math.max(0, answered - responses.length),
    correctBefore: Math.max(0, correct - restoredCorrect)
  };
}

const FRESH_ROUND = { index: 0, correct: 0, responses: [], answeredBefore: 0, correctBefore: 0 };

export default function GrammarLessonPage() {
  const { lessonId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [phase, setPhase] = useState('theory');
  const [roundKey, setRoundKey] = useState(0);
  const [start, setStart] = useState(FRESH_ROUND);
  const [extraStart, setExtraStart] = useState({ index: 0, correct: 0, responses: [] });
  const [resumePrompt, setResumePrompt] = useState(null); // null | 'quiz' | 'extra'
  const resumeDialogRef = useRef(null);
  const quizBtnRef = useRef(null);
  const extraBtnRef = useRef(null);
  const isExtraPrompt = resumePrompt === 'extra';

  useViewportDialog(
    Boolean(resumePrompt),
    () => setResumePrompt(null),
    resumeDialogRef,
    null,
    isExtraPrompt ? extraBtnRef : quizBtnRef
  );

  const query = useQuery({
    queryKey: ['grammar-lesson', lessonId, auth.user?.mssv],
    queryFn: ({ signal }) => getGrammarLesson(auth.token, lessonId, { signal }),
    enabled: Boolean(auth.token && lessonId)
  });

  const payload = query.data || null;
  const items = useMemo(() => buildItems(payload), [payload]);
  const extraItems = useMemo(
    () => buildItems({ exercises: payload?.extra_exercises || [], readings: [] }),
    [payload]
  );
  const progress = payload?.progress || null;
  const extraProgress = payload?.extra_progress || null;
  const pathId = payload?.lesson?.path_id;

  const saveMutation = useMutation({
    mutationFn: (value) => saveGrammarProgress(auth.token, lessonId, value),
    onError: (error, variables) => {
      if (variables?.silent) return; // autosave nền: chỉ báo khi thoát/hoàn thành
      notify(friendlyErrorMessage(error, 'Không thể lưu tiến độ.'), 'error');
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['grammar-path'] });
      client.invalidateQueries({ queryKey: ['grammar-groups'] });
      client.invalidateQueries({ queryKey: ['grammar-lesson', lessonId] });
    }
  });

  const saveExtraMutation = useMutation({
    mutationFn: (value) => saveGrammarExtraProgress(auth.token, lessonId, value),
    onError: (error, variables) => {
      if (variables?.silent) return; // autosave nền: chỉ báo khi thoát/hoàn thành
      notify(friendlyErrorMessage(error, 'Không thể lưu tiến độ luyện thêm.'), 'error');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['grammar-lesson', lessonId] })
  });

  const backToPath = () => {
    if (pathId) {
      navigate(`/grammar/path/${encodeURIComponent(pathId)}`);
      return;
    }
    if (location.key === 'default') navigate('/grammar', { replace: true });
    else navigate(-1);
  };

  const { mutateAsync: saveMainProgress } = saveMutation;
  const { mutateAsync: saveExtraProgress } = saveExtraMutation;
  const saveMainQuiz = useCallback((value) => saveMainProgress(value), [saveMainProgress]);
  const saveExtraQuiz = useCallback((value) => saveExtraProgress(value), [saveExtraProgress]);

  const startQuiz = (resume) => {
    const canResume = Boolean(progress && !progress.completed_at && progress.answered > 0 && progress.answered < items.length);
    setStart(resume && canResume ? roundStartFrom(progress) : FRESH_ROUND);
    setRoundKey((k) => k + 1);
    setPhase('quiz');
  };

  const startExtraQuiz = (resume) => {
    const canResume = Boolean(
      extraProgress && !extraProgress.completed_at && extraProgress.answered > 0 && extraProgress.answered < extraItems.length
    );
    setExtraStart(resume && canResume ? roundStartFrom(extraProgress) : FRESH_ROUND);
    setRoundKey((k) => k + 1);
    setPhase('extra-quiz');
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
  const canResumeExtra = Boolean(
    extraProgress && !extraProgress.completed_at && extraProgress.answered > 0 && extraProgress.answered < extraItems.length
  );
  const hasSavedExtraProgress = Boolean(extraItems.length && extraProgress?.answered > 0);
  const bestAccuracy = progress?.best_total ? accuracyOf(progress.best_correct, progress.best_total) : null;
  const promptAnswered = isExtraPrompt
    ? Math.min(extraProgress?.answered || 0, extraItems.length)
    : (progress?.answered || 0);
  const promptTotal = isExtraPrompt ? extraItems.length : items.length;

  const openQuizPrompt = () => {
    if (canResume) {
      setResumePrompt('quiz');
      return;
    }
    startQuiz(false);
  };

  const openExtraPrompt = () => {
    if (canResumeExtra) {
      setResumePrompt('extra');
      return;
    }
    startExtraQuiz(false);
  };

  const chooseResumeOption = (resume) => {
    const target = resumePrompt;
    setResumePrompt(null);
    if (target === 'extra') startExtraQuiz(resume);
    else startQuiz(resume);
  };

  if (phase === 'quiz' || phase === 'extra-quiz') {
    const isExtraPractice = phase === 'extra-quiz';
    return (
      <section className="tab-pane active">
        <p className="gr-crumb">
          <span>{lesson.path_name}</span>
          {' · '}<span>{lesson.name}{isExtraPractice ? ' · Luyện thêm' : ''}</span>
        </p>
        <GrammarRunner
          key={roundKey}
          items={isExtraPractice ? extraItems : items}
          initialIndex={isExtraPractice ? extraStart.index : start.index}
          initialCorrect={isExtraPractice ? extraStart.correct : start.correct}
          initialResponses={isExtraPractice ? extraStart.responses : start.responses}
          answeredBefore={isExtraPractice ? extraStart.answeredBefore : start.answeredBefore}
          correctBefore={isExtraPractice ? extraStart.correctBefore : start.correctBefore}
          isExtra={isExtraPractice}
          onCheckAnswer={(questionId, response) => checkGrammarAnswer(auth.token, lessonId, questionId, response)}
          onQuizSave={isExtraPractice ? saveExtraQuiz : saveMainQuiz}
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
          {extraItems.length ? (
            <span className="gr-theme-badge is-amber">🧩 Luyện thêm {extraItems.length} câu</span>
          ) : null}
          {progress?.completed_at ? (
            <span className="gr-theme-badge is-violet">
              ✓ Đã học{bestAccuracy != null ? ` · Chính xác ${bestAccuracy}%` : ''} · {progress.attempts} lần
            </span>
          ) : null}
          {hasSavedExtraProgress ? (
            <span className="gr-theme-badge">
              {extraProgress?.completed_at
                ? `✓ Luyện thêm hoàn thành${extraProgress.best_total
                  ? ` · Chính xác ${accuracyOf(extraProgress.best_correct, extraProgress.best_total)}%`
                  : ''} · ${extraProgress.attempts} lần`
                : `⏳ Đang luyện ${Math.min(extraProgress.answered, extraItems.length)}/${extraItems.length} câu`}
            </span>
          ) : null}
        </div>

        {items.length || extraItems.length ? (
          <div className="gr-theory-actions">
            {items.length ? (
              <button ref={quizBtnRef} className="gr-start-btn" type="button" onClick={openQuizPrompt}>
                {canResume ? `▶ Tiếp tục từ câu ${progress.answered + 1}/${items.length}` : '▶ Làm bài tập'}
              </button>
            ) : null}
            {extraItems.length ? (
              <button ref={extraBtnRef} className="gr-start-btn is-extra" type="button" onClick={openExtraPrompt}>
                {canResumeExtra
                  ? `▶ Tiếp tục luyện thêm từ câu ${Math.min(extraProgress.answered + 1, extraItems.length)}/${extraItems.length}`
                  : '▶ Bắt đầu luyện thêm'}
              </button>
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

      {resumePrompt ? (
        <ViewportModal
          id="gr-resume-modal"
          title={isExtraPrompt ? 'Luyện thêm' : 'Bài tập chính'}
          labelledBy="gr-resume-title"
          onClose={() => setResumePrompt(null)}
          dialogRef={resumeDialogRef}
          className="gr-resume-modal"
        >
          <h3 id="gr-resume-title" className="gr-resume-title">
            {isExtraPrompt ? '🧩 Luyện thêm' : '📝 Bài tập chính'}
          </h3>
          <p className="gr-resume-text">
            Bạn đã làm {promptAnswered}/{promptTotal} câu. Bạn muốn làm tiếp hay làm lại từ đầu?
          </p>
          <div className="gr-resume-actions">
            <button type="button" className="btn btn-primary" onClick={() => chooseResumeOption(true)}>
              ▶ Làm tiếp từ câu {promptAnswered + 1}/{promptTotal}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => chooseResumeOption(false)}>
              ↻ Làm lại từ đầu
            </button>
            <button type="button" className="btn-ghost" onClick={() => setResumePrompt(null)}>Hủy</button>
          </div>
        </ViewportModal>
      ) : null}
    </section>
  );
}
