import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  answerCourseQuiz,
  getCourseQuiz,
  saveCourseQuizProgress,
  startCourseQuiz
} from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import { AvatarContent, TitleBadges } from '../../components/identity/Identity.jsx';
import QuizRunner from './QuizRunner.jsx';
import QuizResultView from './QuizResultView.jsx';
import './quiz.css';

function memberTitle() {
  return {
    id: 'member:bdu',
    label: 'Sinh viên BDU',
    detail: 'Thành viên cộng đồng Đại học Bình Dương',
    tone: 'member'
  };
}

function authorTitles(post) {
  if (post?.author?.is_anonymous) return [];
  const titles = Array.isArray(post?.author?.titles) ? post.author.titles : [];
  if (titles.length) return titles;
  return [memberTitle()];
}

function formatTimeLimit(seconds) {
  const total = Number(seconds || 0);
  if (total <= 0) return 'Không giới hạn thời gian';
  return `${Math.round(total / 60)} phút`;
}

export default function CourseQuizPage() {
  const { courseCode, postId } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();

  const mssv = user?.mssv;
  const queryKey = ['course-quiz', courseCode, postId, mssv];

  const quizQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getCourseQuiz(token, courseCode, postId, { signal }),
    enabled: Boolean(token && courseCode && postId)
  });

  const [started, setStarted] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [startRemaining, setStartRemaining] = useState(null);
  const [finishing, setFinishing] = useState(false);

  const data = quizQuery.data;
  const course = data?.course;
  const post = data?.post;
  const quiz = data?.quiz;
  const progress = quiz?.progress || null;
  const isCompleted = Boolean(progress?.completed_at);
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const remainingSeconds = quiz?.remaining_seconds ?? startRemaining;
  const displayCode = course?.display_code || course?.code || courseCode;
  const authorName = post?.author?.is_anonymous ? 'Ẩn danh' : (post?.author?.name || 'Tác giả');
  const postTitles = authorTitles(post);
  const questionCount = Number(quiz?.question_count || questions.length || 0);
  const answered = Number(progress?.answered || 0);

  useEffect(() => {
    if (isCompleted) setFinishing(false);
  }, [isCompleted]);

  // Keep the runner timer in sync when the tab becomes visible again without
  // resetting the question in progress. If another tab already submitted, the
  // refetch below flips the page to the result view via `isCompleted`.
  const refetch = quizQuery.refetch;
  useEffect(() => {
    const onVisibility = () => { refetch(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refetch]);

  const startMutation = useMutation({
    mutationFn: ({ restart }) => startCourseQuiz(token, courseCode, postId, { restart }),
    onSuccess: async (startData) => {
      setStartRemaining(
        typeof startData?.remaining_seconds === 'number' ? startData.remaining_seconds : null
      );
      try {
        await refetch();
      } catch {
        // Mount the runner with the last known data; the timer still counts
        // down from the server-provided remaining seconds.
      }
      setRunKey((key) => key + 1);
      setStarted(true);
      setFinishing(false);
    },
    onError: (error) => notify(error?.message || 'Không thể bắt đầu làm bài trắc nghiệm.', 'error')
  });

  const finishMutation = useMutation({
    mutationFn: () => saveCourseQuizProgress(token, courseCode, postId, { responses: [], completed: true }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['course-quiz', courseCode, postId, mssv] });
    },
    onError: (error) => notify(error?.message || 'Không thể nộp bài trắc nghiệm.', 'error')
  });

  const handleStart = (restart) => startMutation.mutate({ restart: Boolean(restart) });

  const handleRestart = async () => {
    const ok = await askConfirm({
      title: 'Làm lại bài trắc nghiệm?',
      message: 'Tiến độ làm bài hiện tại sẽ bị xóa. Điểm cao nhất và số lượt làm được giữ nguyên.',
      confirmText: 'Làm lại',
      danger: true
    });
    if (!ok) return;
    handleStart(true);
  };

  const handleCheckAnswer = useCallback(
    (questionId, response) => answerCourseQuiz(token, courseCode, postId, { questionId, response }),
    [token, courseCode, postId]
  );

  const handleSaveProgress = useCallback(
    (payload) => saveCourseQuizProgress(token, courseCode, postId, payload),
    [token, courseCode, postId]
  );

  const handleComplete = useCallback(() => {
    setStarted(false);
    setFinishing(true);
    client.invalidateQueries({ queryKey: ['course-quiz', courseCode, postId, mssv] });
  }, [client, courseCode, postId, mssv]);

  const handleExitRunner = useCallback(() => {
    setStarted(false);
    refetch();
  }, [refetch]);

  const goBack = useCallback(() => {
    navigate(`/learning/${encodeURIComponent(courseCode)}`);
  }, [navigate, courseCode]);

  const breadcrumb = (
    <nav className="quiz-page-breadcrumb" aria-label="Đường dẫn">
      <button type="button" className="quiz-breadcrumb-link" onClick={goBack}>
        Kho Tài Liệu
      </button>
      <span aria-hidden="true"> / </span>
      <span>{displayCode}</span>
      <span aria-hidden="true"> / </span>
      <span>Trắc nghiệm</span>
    </nav>
  );

  if (quizQuery.isError && !data) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <section className="quiz-page-error" role="alert">
          <p>{quizQuery.error?.message || 'Không thể tải bài trắc nghiệm.'}</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về không gian môn
          </button>
        </section>
      </div>
    );
  }

  if (quizQuery.isLoading && !data) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <p className="quiz-page-loading">Đang tải bài trắc nghiệm...</p>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <section className="quiz-page-error" role="alert">
          <p>Không tìm thấy bài trắc nghiệm trong môn học này.</p>
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Về không gian môn
          </button>
        </section>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <h1 className="quiz-page-title">{post?.title}</h1>
        <QuizResultView
          quiz={quiz}
          progress={progress}
          review={quiz.review}
          onRestart={handleRestart}
          onBack={goBack}
        />
      </div>
    );
  }

  if (started) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <h1 className="quiz-page-title">{post?.title}</h1>
        <QuizRunner
          key={runKey}
          questions={questions}
          initialProgress={progress}
          remainingSeconds={remainingSeconds}
          onCheckAnswer={handleCheckAnswer}
          onSaveProgress={handleSaveProgress}
          onComplete={handleComplete}
          onExit={handleExitRunner}
        />
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="quiz-page">
        {breadcrumb}
        {confirmUI}
        <h1 className="quiz-page-title">{post?.title}</h1>
        <p className="quiz-page-loading">Đang tải kết quả...</p>
        <button type="button" className="btn btn-secondary" onClick={goBack}>
          Về không gian môn
        </button>
      </div>
    );
  }

  const isResuming = Boolean(progress && answered > 0);
  const isExpired = Boolean(quiz.expired);

  return (
    <div className="quiz-page">
      {breadcrumb}
      {confirmUI}
      <header className="quiz-page-head">
        <h1 className="quiz-page-title">{post?.title}</h1>
        {post?.content && <p className="quiz-page-description">{post.content}</p>}
        <div className="quiz-page-author">
          <AvatarContent user={post?.author} alt={authorName} />
          <strong>{authorName}</strong>
          {postTitles.length > 0 && <TitleBadges titles={postTitles} />}
        </div>
        <div className="quiz-summary-meta">
          <span className="quiz-summary-chip">📝 {questionCount} câu</span>
          <span className="quiz-summary-chip">⏱ {formatTimeLimit(quiz.time_limit_seconds)}</span>
          {progress?.best_correct != null && progress?.best_total != null && (
            <span className="quiz-summary-chip">
              Cao nhất {`${progress.best_correct}/${progress.best_total}`}
            </span>
          )}
          {Number(progress?.attempts || 0) > 0 && (
            <span className="quiz-summary-chip">{Number(progress.attempts)} lượt làm</span>
          )}
        </div>
      </header>

      {isExpired ? (
        <section className="quiz-page-card" role="status">
          <p><strong>Đã hết thời gian làm bài.</strong></p>
          <p className="quiz-page-muted">Bạn vẫn có thể xem kết quả dựa trên các câu đã lưu.</p>
          <div className="quiz-page-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => finishMutation.mutate()}
              disabled={finishMutation.isPending}
            >
              {finishMutation.isPending ? 'Đang nộp...' : 'Xem kết quả'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRestart}
              disabled={startMutation.isPending}
            >
              Làm lại từ đầu
            </button>
          </div>
        </section>
      ) : !progress ? (
        <section className="quiz-page-card">
          <h2 className="quiz-page-card-title">Cách làm bài</h2>
          <ul className="quiz-page-rules">
            <li>Làm từng câu, kiểm tra ngay để xem đáp án và giải thích.</li>
            <li>Tiến độ được lưu tự động, có thể làm tiếp khi quay lại.</li>
            {Number(quiz.time_limit_seconds || 0) > 0 && (
              <li>Bài làm tính giờ, hết giờ hệ thống sẽ tự nộp bài.</li>
            )}
          </ul>
          <div className="quiz-page-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleStart(false)}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? 'Đang bắt đầu...' : 'Bắt đầu làm bài'}
            </button>
          </div>
        </section>
      ) : (
        <section className="quiz-page-card">
          {isResuming && (
            <p className="quiz-page-progress">Đã làm {`${answered}/${questionCount}`}</p>
          )}
          <div className="quiz-page-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleStart(false)}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? 'Đang bắt đầu...' : 'Làm tiếp'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRestart}
              disabled={startMutation.isPending}
            >
              Làm lại từ đầu
            </button>
          </div>
        </section>
      )}

      <button type="button" className="btn btn-secondary" onClick={goBack}>
        Về không gian môn
      </button>
    </div>
  );
}
