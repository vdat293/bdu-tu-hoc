import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  answerQuizReview,
  getQuizPart,
  saveQuizPartProgress,
  startQuizPart
} from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import {
  AvatarContent,
  TitleBadges,
  getIdentityName
} from '../../components/identity/Identity.jsx';
import QuizReviewRunner from './QuizReviewRunner.jsx';
import QuizSetResultView from './QuizSetResultView.jsx';
import QuizTestRunner from './QuizTestRunner.jsx';
import './quiz.css';

const MODES = new Set(['review', 'test']);

function parsePartIndex(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function minutesOf(part, set) {
  const seconds = Number(part?.time_limit_seconds || 0);
  if (seconds > 0) return Math.round(seconds / 60);
  return Number(set?.minutes_per_part || 0);
}

export default function QuizSetPartPage() {
  const { courseCode, setId, partIndex, mode } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();

  const parsedPartIndex = parsePartIndex(partIndex);
  const validMode = MODES.has(mode);
  const routeValid = validMode && parsedPartIndex !== null;
  const isReview = mode === 'review';
  const mssv = user?.mssv;

  const partQuery = useQuery({
    queryKey: ['quiz-part', courseCode, setId, partIndex, mode, mssv],
    queryFn: ({ signal }) => getQuizPart(token, courseCode, setId, parsedPartIndex, { mode, signal }),
    enabled: Boolean(token && courseCode && setId && routeValid)
  });

  const [started, setStarted] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [runProgress, setRunProgress] = useState(null);
  const [resultProgress, setResultProgress] = useState(null);
  const [testStarted, setTestStarted] = useState(false);
  const [testRunKey, setTestRunKey] = useState(0);
  const [testRunProgress, setTestRunProgress] = useState(null);
  const [testRemaining, setTestRemaining] = useState(null);
  const [testResultReview, setTestResultReview] = useState(null);

  // The route element is reused when only params change: never keep a runner
  // or result from another part/mode on screen.
  useEffect(() => {
    setStarted(false);
    setRunProgress(null);
    setResultProgress(null);
    setTestStarted(false);
    setTestRunProgress(null);
    setTestRemaining(null);
    setTestResultReview(null);
  }, [courseCode, setId, partIndex, mode]);

  const goBack = useCallback(() => {
    navigate(`/learning/${encodeURIComponent(courseCode || '')}`);
  }, [navigate, courseCode]);

  const { refetch } = partQuery;

  const startMutation = useMutation({
    mutationFn: ({ restart }) => startQuizPart(
      token,
      courseCode,
      setId,
      parsedPartIndex,
      { mode, restart: Boolean(restart) }
    ),
    onSuccess: async (startData) => {
      let nextProgress = startData?.restarted ? null : partQuery.data?.progress || null;
      let refreshedData = null;
      try {
        const refreshed = await refetch();
        refreshedData = refreshed.data || null;
        nextProgress = refreshedData?.progress || nextProgress;
      } catch {
        // The runner can still open with the last known progress; review
        // autosave/resume will reconcile from the server on the next action.
      }
      setResultProgress(null);
      setTestResultReview(null);
      if (isReview) {
        setRunProgress(nextProgress);
        setRunKey((key) => key + 1);
        setStarted(true);
      } else {
        // The countdown is authoritative from start (DB NOW()); the detail
        // endpoint exposes no remaining seconds, so fall back to the part
        // time limit only when start omits it.
        const startRemaining = startData?.remaining_seconds;
        const limitSeconds = Number(
          refreshedData?.part?.time_limit_seconds ?? partQuery.data?.part?.time_limit_seconds ?? 0
        );
        setTestRunProgress(nextProgress);
        setTestRemaining(
          typeof startRemaining === 'number' && Number.isFinite(startRemaining)
            ? startRemaining
            : (limitSeconds > 0 ? limitSeconds : null)
        );
        setTestRunKey((key) => key + 1);
        setTestStarted(true);
      }
    },
    onError: (error) => {
      notify(error?.message || 'Không thể bắt đầu làm phần trắc nghiệm.', 'error');
    }
  });

  const handleCheckAnswer = useCallback(
    (questionId, response) => answerQuizReview(
      token,
      courseCode,
      setId,
      parsedPartIndex,
      { mode: 'review', questionId, response }
    ),
    [token, courseCode, setId, parsedPartIndex]
  );

  const handleSaveProgress = useCallback(
    (payload) => saveQuizPartProgress(
      token,
      courseCode,
      setId,
      parsedPartIndex,
      { mode: 'review', responses: payload?.responses, completed: payload?.completed }
    ),
    [token, courseCode, setId, parsedPartIndex]
  );

  const handleSaveTestProgress = useCallback(
    (payload) => saveQuizPartProgress(
      token,
      courseCode,
      setId,
      parsedPartIndex,
      { mode: 'test', responses: payload?.responses, completed: payload?.completed }
    ),
    [token, courseCode, setId, parsedPartIndex]
  );

  const handleComplete = useCallback((savedProgress) => {
    setStarted(false);
    setResultProgress(savedProgress || null);
    refetch();
    client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
  }, [refetch, client, courseCode]);

  // After the test attempt is finalized server-side, refetch the part so the
  // result shows the graded progress (score/best/attempts) plus the completed
  // test answer key (`review`); fall back to the save response on refetch failure.
  const handleTestComplete = useCallback(async (savedProgress) => {
    let nextProgress = savedProgress || null;
    let nextReview = null;
    try {
      const refreshed = await refetch();
      nextProgress = refreshed.data?.progress || nextProgress;
      nextReview = Array.isArray(refreshed.data?.review) ? refreshed.data.review : null;
    } catch {
      // Still show the result from the save response.
    }
    setTestStarted(false);
    setResultProgress(nextProgress);
    setTestResultReview(nextReview);
    client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
  }, [refetch, client, courseCode]);

  const handleExit = useCallback(async () => {
    // Refresh while the runner is still mounted so the landing opens with the
    // latest saved position instead of briefly showing stale resume state.
    try {
      await refetch();
    } catch {
      // Still return to the landing with the last known progress.
    }
    setStarted(false);
    setResultProgress(null);
    client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
  }, [refetch, client, courseCode]);

  // Leaving a test attempt flushes its latest selections first (inside the
  // runner); the landing then refetches so resume state is never stale.
  const handleTestExit = useCallback(async () => {
    try {
      await refetch();
    } catch {
      // Still return to the landing with the last known progress.
    }
    setTestStarted(false);
    setResultProgress(null);
    setTestResultReview(null);
    client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
  }, [refetch, client, courseCode]);

  const handleStart = (restart) => startMutation.mutate({ restart: Boolean(restart) });

  const breadcrumb = (
    <nav className="quiz-page-breadcrumb" aria-label="Đường dẫn">
      <button type="button" className="quiz-breadcrumb-link" onClick={goBack}>
        Kho Tài Liệu
      </button>
      <span aria-hidden="true"> / </span>
      <span>{courseCode}</span>
      {partQuery.data?.set && (
        <>
          <span aria-hidden="true"> / </span>
          <span>{partQuery.data.set.title}</span>
        </>
      )}
      {partQuery.data?.part && (
        <>
          <span aria-hidden="true"> / </span>
          <span>{`Phần ${Number(partQuery.data.part.index) + 1}`}</span>
        </>
      )}
    </nav>
  );

  if (!routeValid) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <section className="quiz-page-error" role="alert">
          <p>Không tìm thấy phần của bộ đề này.</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </section>
      </div>
    );
  }

  if (partQuery.isLoading && !partQuery.data) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <p className="quiz-page-loading">Đang tải phần của bộ đề...</p>
      </div>
    );
  }

  if (partQuery.isError && !partQuery.data) {
    const notFound = [400, 404].includes(partQuery.error?.status);
    return (
      <div className="quiz-page">
        {breadcrumb}
        <section className="quiz-page-error" role="alert">
          <p>{notFound ? 'Không tìm thấy phần của bộ đề này.' : (partQuery.error?.message || 'Không thể tải phần của bộ đề.')}</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </section>
      </div>
    );
  }

  const data = partQuery.data;
  const set = data?.set;
  const part = data?.part;
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  const progress = data?.progress || null;

  if (!set || !part) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <section className="quiz-page-error" role="alert">
          <p>Không tìm thấy phần của bộ đề này.</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </section>
      </div>
    );
  }

  const completed = Boolean(progress?.completed_at);
  // A previous completion still starts on the landing so the review can show
  // its progress and the "Ôn tập lại" action; the result screen is shown right
  // after the runner completes in this session.
  const resultData = resultProgress;

  if (isReview && started) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <h1 className="quiz-page-title">{set.title}</h1>
        <QuizReviewRunner
          key={runKey}
          questions={questions}
          initialProgress={runProgress}
          onCheckAnswer={handleCheckAnswer}
          onSaveProgress={handleSaveProgress}
          onComplete={handleComplete}
          onExit={handleExit}
        />
      </div>
    );
  }

  if (isReview && resultData) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <h1 className="quiz-page-title">{set.title}</h1>
        <QuizSetResultView
          mode="review"
          part={part}
          questions={questions}
          progress={resultData}
          onRestart={() => handleStart(true)}
          onBack={goBack}
          restarting={startMutation.isPending}
        />
      </div>
    );
  }

  if (!isReview && testStarted) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <h1 className="quiz-page-title">{set.title}</h1>
        <QuizTestRunner
          key={testRunKey}
          questions={questions}
          initialProgress={testRunProgress}
          remainingSeconds={testRemaining}
          onSubmit={handleSaveTestProgress}
          onComplete={handleTestComplete}
          onExit={handleTestExit}
        />
      </div>
    );
  }

  if (!isReview && resultData) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        <h1 className="quiz-page-title">{set.title}</h1>
        <QuizSetResultView
          mode="test"
          part={part}
          questions={questions}
          progress={resultData}
          review={testResultReview}
          onRestart={() => handleStart(true)}
          onBack={goBack}
          restarting={startMutation.isPending}
        />
      </div>
    );
  }

  const partNumber = Number(part.index) + 1;
  const authorName = getIdentityName(set.author, null);
  const authorTitles = Array.isArray(set.author?.titles) ? set.author.titles : [];
  const answered = Number(progress?.answered || 0);
  const questionCount = Number(part.question_count || questions.length || 0);
  // A test progress row only exists after start, so a non-null row means the
  // attempt (and its timer) is already running even with zero answers; start
  // then resumes without extending the deadline. Review keeps the answered>0
  // rule since its rows carry no timer.
  const resuming = isReview ? (answered > 0 && !completed) : (progress !== null && !completed);
  const timeMinutes = minutesOf(part, set);
  const bestCorrect = progress?.best_correct;
  const bestTotal = progress?.best_total;
  const attempts = Number(progress?.attempts || 0);

  let primaryLabel = isReview ? 'Bắt đầu ôn tập' : 'Bắt đầu kiểm tra';
  let primaryRestart = false;
  if (completed) {
    primaryLabel = isReview ? 'Ôn tập lại' : 'Làm lại';
    primaryRestart = true;
  } else if (resuming) {
    primaryLabel = 'Làm tiếp';
  }
  if (startMutation.isPending) primaryLabel = 'Đang bắt đầu...';

  return (
    <div className="quiz-page">
      {breadcrumb}
      <header className="quiz-part-head">
        <h1 className="quiz-page-title">{set.title}</h1>
        <p className="quiz-part-mode">{`Phần ${partNumber} · ${isReview ? 'Ôn tập' : 'Kiểm tra'}`}</p>
        <div className="quiz-part-author">
          <span className="quiz-part-author-avatar">
            <AvatarContent
              user={set.author}
              alt={`Ảnh đại diện của ${authorName}`}
            />
          </span>
          <span className="quiz-part-author-name">{authorName}</span>
          {authorTitles.length > 0 && (
            <TitleBadges titles={authorTitles} className="learning-inline-titles" />
          )}
        </div>
        {set.description ? <p className="quiz-page-description">{set.description}</p> : null}
        <div className="quiz-summary-meta">
          <span className="quiz-summary-chip">{`${questionCount} câu`}</span>
          {isReview ? (
            <span className="quiz-summary-chip">Không giới hạn thời gian</span>
          ) : (
            <span className="quiz-summary-chip">
              {timeMinutes > 0 ? `${timeMinutes} phút` : 'Không giới hạn thời gian'}
            </span>
          )}
          {isReview && answered > 0 && (
            <span className="quiz-summary-chip">{`Đã làm ${answered}/${questionCount}`}</span>
          )}
          {isReview && completed && (
            <span className="quiz-summary-chip">Đã hoàn thành</span>
          )}
          {!isReview && bestCorrect != null && bestTotal != null && (
            <span className="quiz-summary-chip">{`Cao nhất ${bestCorrect}/${bestTotal}`}</span>
          )}
          {!isReview && attempts > 0 && (
            <span className="quiz-summary-chip">{`${attempts} lượt`}</span>
          )}
        </div>
      </header>

      <section className="quiz-page-card">
        <h2 className="quiz-page-card-title">
          {isReview ? 'Cách ôn tập' : 'Cách làm bài kiểm tra'}
        </h2>
        <ul className="quiz-page-rules">
          {isReview ? (
            <>
              <li>Không giới hạn thời gian, làm từng câu và kiểm tra ngay.</li>
              <li>Mỗi câu hiện đáp án đúng và giải thích sau khi bạn chọn.</li>
              <li>Tiến độ được lưu tự động, có thể làm tiếp khi quay lại.</li>
            </>
          ) : (
            <>
              <li>Bài làm tính giờ, hết giờ hệ thống sẽ tự nộp bài.</li>
              <li>Không xem đáp án trong lúc làm; kết quả hiện sau khi nộp.</li>
              <li>Tiến độ được lưu tự động trong lượt làm hiện tại.</li>
            </>
          )}
        </ul>
        <div className="quiz-page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleStart(primaryRestart)}
            disabled={startMutation.isPending}
          >
            {primaryLabel}
          </button>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về môn
          </button>
        </div>
      </section>
    </div>
  );
}
