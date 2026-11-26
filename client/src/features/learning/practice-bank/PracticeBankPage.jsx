import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  answerPracticeQuestion,
  getPracticeBankQuestions,
  getPracticeBankSummary,
  resetPracticeProgress,
  startPracticeMockExam,
  submitPracticeMockExam,
  togglePracticeBookmark
} from '../../../api/practice-bank.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { useConfirm } from '../../../components/feedback/ConfirmDialog.jsx';
import PracticeChapterGrid from './PracticeChapterGrid.jsx';
import PracticeExamSummary from './PracticeExamSummary.jsx';
import PracticeRunner from './PracticeRunner.jsx';
import './practice-bank.css';

export default function PracticeBankPage() {
  const { courseCode } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();

  const initialChapterParam = searchParams.get('chapter');
  const initialModeParam = searchParams.get('mode');

  const [view, setView] = useState(() => (initialChapterParam ? 'practice' : 'hub'));
  const [practiceScope, setPracticeScope] = useState(() => ({
    chapter: initialChapterParam || 'all',
    filter: 'all',
    search: '',
    title: initialChapterParam ? `Chương ${initialChapterParam}` : 'Ôn tập trắc nghiệm'
  }));
  const [checkingKey, setCheckingKey] = useState(null);
  const [resettingTarget, setResettingTarget] = useState(null);
  const [examSession, setExamSession] = useState(null);
  const [examSummary, setExamSummary] = useState(null);

  const summaryQuery = useQuery({
    queryKey: ['practice-bank-summary', courseCode, auth.user?.mssv],
    queryFn: ({ signal }) => getPracticeBankSummary(auth.token, courseCode, { signal }),
    enabled: Boolean(auth.token && courseCode),
    retry: false
  });

  // Đồng bộ tiêu đề chương thật khi summary tải xong nếu mở qua query ?chapter=N
  useEffect(() => {
    if (!initialChapterParam || !summaryQuery.data?.chapters) return;
    const match = summaryQuery.data.chapters.find(
      (ch) => String(ch.chapter_index) === String(initialChapterParam)
    );
    if (match) {
      setPracticeScope((prev) => (
        prev.chapter === initialChapterParam && prev.title !== match.chapter_title
          ? { ...prev, title: match.chapter_title }
          : prev
      ));
    }
  }, [initialChapterParam, summaryQuery.data]);

  const questionsQuery = useQuery({
    queryKey: [
      'practice-bank-questions',
      courseCode,
      auth.user?.mssv,
      practiceScope.chapter,
      practiceScope.filter,
      practiceScope.search
    ],
    queryFn: ({ signal }) => getPracticeBankQuestions(auth.token, courseCode, {
      chapter: practiceScope.chapter,
      filter: practiceScope.filter,
      search: practiceScope.search,
      signal
    }),
    enabled: Boolean(auth.token && courseCode && view === 'practice')
  });

  const answerMutation = useMutation({
    mutationFn: ({ questionId, selectedAnswer }) => answerPracticeQuestion(
      auth.token,
      courseCode,
      questionId,
      selectedAnswer
    ),
    onSuccess: (res, { questionId }) => {
      client.setQueriesData(
        { queryKey: ['practice-bank-questions', courseCode, auth.user?.mssv] },
        (old) => {
          if (!old?.questions) return old;
          return {
            ...old,
            questions: old.questions.map((q) => (
              String(q.id) === String(questionId)
                ? {
                    ...q,
                    correct_answer: res.correct_answer,
                    explanation: res.explanation,
                    progress: {
                      ...q.progress,
                      selected_answer: res.selected_answer,
                      is_correct: res.is_correct,
                      attempts: res.attempts,
                      wrong_count: res.wrong_count,
                      is_bookmarked: res.is_bookmarked
                    }
                  }
                : q
            ))
          };
        }
      );
      client.invalidateQueries({ queryKey: ['practice-bank-summary', courseCode] });
    },
    onError: (err) => {
      notify(err?.message || 'Không thể lưu câu trả lời.', 'error');
    },
    onSettled: () => setCheckingKey(null)
  });

  const bookmarkMutation = useMutation({
    mutationFn: ({ questionId, bookmarked }) => togglePracticeBookmark(
      auth.token,
      courseCode,
      questionId,
      bookmarked
    ),
    onSuccess: (res, { questionId }) => {
      client.setQueriesData(
        { queryKey: ['practice-bank-questions', courseCode, auth.user?.mssv] },
        (old) => {
          if (!old?.questions) return old;
          return {
            ...old,
            questions: old.questions.map((q) => (
              String(q.id) === String(questionId)
                ? { ...q, progress: { ...q.progress, is_bookmarked: res.is_bookmarked } }
                : q
            ))
          };
        }
      );
      client.invalidateQueries({ queryKey: ['practice-bank-summary', courseCode] });
    },
    onError: (err) => notify(err?.message || 'Không thể cập nhật đánh dấu.', 'error')
  });

  const startExamMutation = useMutation({
    mutationFn: ({ count, chapters }) => startPracticeMockExam(auth.token, courseCode, { count, chapters }),
    onSuccess: (data) => {
      setExamSession(data);
      setExamSummary(null);
      setView('exam');
    },
    onError: (err) => notify(err?.message || 'Không thể khởi tạo bài thi thử.', 'error')
  });

  const submitExamMutation = useMutation({
    mutationFn: ({ answers, durationSeconds }) => submitPracticeMockExam(auth.token, courseCode, {
      answers,
      durationSeconds,
      chapterIndex: examSession?.chapter_index ?? null
    }),
    onSuccess: (data) => {
      setExamSummary(data);
      setView('exam-summary');
      client.invalidateQueries({ queryKey: ['practice-bank-summary', courseCode] });
      client.invalidateQueries({ queryKey: ['practice-bank-questions', courseCode] });
    },
    onError: (err) => notify(err?.message || 'Không thể nộp bài thi thử.', 'error')
  });

  const resetMutation = useMutation({
    mutationFn: ({ chapter }) => resetPracticeProgress(auth.token, courseCode, { chapter, keepBookmarks: true }),
    onSuccess: (_data, { label }) => {
      client.invalidateQueries({ queryKey: ['practice-bank-summary', courseCode] });
      client.invalidateQueries({ queryKey: ['practice-bank-questions', courseCode] });
      notify(`Đã đặt lại tiến độ ${label} (giữ lại câu đánh dấu).`, 'success');
    },
    onError: (err) => notify(err?.message || 'Không thể đặt lại tiến độ.', 'error'),
    onSettled: () => setResettingTarget(null)
  });

  const handleStartPractice = useCallback(({ chapter = 'all', filter = 'all', title = 'Ôn tập trắc nghiệm' }) => {
    setPracticeScope({ chapter, filter, search: '', title });
    setView('practice');
  }, []);

  const handleResetChapter = useCallback(async (chapter, label) => {
    const ok = await askConfirm({
      title: 'Làm lại từ đầu?',
      message: `Tiến độ đã trả lời của ${label} sẽ được đặt lại về 0 (các câu bạn đã gắn sao đánh dấu vẫn được giữ lại).`,
      confirmText: 'Làm lại',
      danger: true
    });
    if (!ok) return;
    setResettingTarget(chapter === null ? 'all' : chapter);
    resetMutation.mutate({ chapter, label });
  }, [askConfirm, resetMutation]);

  const handleAnswer = useCallback(async (questionId, selectedAnswer) => {
    setCheckingKey(`${questionId}:${selectedAnswer}`);
    try {
      return await answerMutation.mutateAsync({ questionId, selectedAnswer });
    } catch {
      return null;
    }
  }, [answerMutation]);

  const handleExitToHub = useCallback(() => {
    setView('hub');
    if (searchParams.has('chapter') || searchParams.has('mode')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const courseUrl = `/learning/${encodeURIComponent(courseCode || '')}`;

  const breadcrumb = (
    <nav className="clay-pb-breadcrumb" aria-label="Đường dẫn phòng ôn tập">
      <Link className="clay-pb-breadcrumb-link" to="/learning">Kho Tài Liệu</Link>
      <span aria-hidden="true">/</span>
      <Link className="clay-pb-breadcrumb-link" to={courseUrl}>{courseCode}</Link>
      <span aria-hidden="true">/</span>
      <span>Phòng Ôn Tập Trắc Nghiệm</span>
    </nav>
  );

  if (summaryQuery.isLoading && !summaryQuery.data) {
    return (
      <section className="clay-pb-scope clay-pb-page">
        {breadcrumb}
        <div className="clay-pb-state-card">
          <div className="spinner" />
          <p>Đang tải phòng ôn tập trắc nghiệm...</p>
        </div>
      </section>
    );
  }

  if (summaryQuery.isError) {
    return (
      <section className="clay-pb-scope clay-pb-page">
        {breadcrumb}
        <div className="clay-pb-state-card" role="alert">
          <h2>Không thể mở phòng ôn tập</h2>
          <p>{summaryQuery.error?.message || 'Bạn không có quyền truy cập học phần này hoặc dữ liệu chưa sẵn sàng.'}</p>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-secondary"
            onClick={() => navigate(courseUrl)}
          >
            ← Về không gian môn {courseCode}
          </button>
        </div>
      </section>
    );
  }

  if (!summaryQuery.data?.enabled) {
    return (
      <section className="clay-pb-scope clay-pb-page">
        {breadcrumb}
        <div className="clay-pb-state-card">
          <h2>Môn học chưa có phòng ôn tập riêng</h2>
          <p>Học phần {courseCode} hiện chưa được cấu hình ngân hàng ôn tập trắc nghiệm.</p>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-primary"
            onClick={() => navigate(courseUrl)}
          >
            ← Quay lại môn {courseCode}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="clay-pb-scope clay-pb-page" aria-label="Phòng ôn tập trắc nghiệm">
      {breadcrumb}

      {view === 'hub' && (
        <PracticeChapterGrid
          summary={summaryQuery.data}
          initialExamMode={initialModeParam === 'exam'}
          startingExam={startExamMutation.isPending}
          resettingChapter={resettingTarget}
          onStartPractice={handleStartPractice}
          onStartExam={({ count, chapters }) => startExamMutation.mutate({ count, chapters })}
          onResetChapter={handleResetChapter}
        />
      )}

      {view === 'practice' && (
        <PracticeRunner
          mode="practice"
          title={practiceScope.title}
          questions={questionsQuery.data?.questions || []}
          loading={questionsQuery.isLoading}
          error={questionsQuery.error}
          filter={practiceScope.filter}
          search={practiceScope.search}
          checkingQuestionId={checkingKey}
          onFilterChange={(nextFilter) => setPracticeScope((prev) => ({ ...prev, filter: nextFilter }))}
          onSearchChange={(nextSearch) => setPracticeScope((prev) => ({ ...prev, search: nextSearch }))}
          onAnswerQuestion={handleAnswer}
          onToggleBookmark={(questionId, bookmarked) => bookmarkMutation.mutate({ questionId, bookmarked })}
          onExit={handleExitToHub}
        />
      )}

      {view === 'exam' && examSession && (
        <PracticeRunner
          mode="exam"
          title={`Thi thử tổng hợp (${examSession.total_questions} câu)`}
          questions={examSession.questions || []}
          timeLimitSeconds={examSession.time_limit_seconds}
          submittingExam={submitExamMutation.isPending}
          onSubmitExam={(payload) => submitExamMutation.mutate(payload)}
          onAskConfirm={askConfirm}
          onExit={handleExitToHub}
        />
      )}

      {view === 'exam-summary' && examSummary && (
        <PracticeExamSummary
          result={examSummary}
          onReviewWrong={() => handleStartPractice({ chapter: 'all', filter: 'wrong', title: 'Ôn lại câu làm sai' })}
          onRetakeExam={() => startExamMutation.mutate({ count: examSummary.total_questions })}
          onBackToHub={handleExitToHub}
        />
      )}

      {confirmUI}
    </section>
  );
}
