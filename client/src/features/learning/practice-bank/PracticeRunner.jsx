import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OPTION_KEYS, chapterTone, formatDuration } from './practice-bank.utils.js';

const FILTER_OPTIONS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unanswered', label: 'Chưa làm' },
  { id: 'wrong', label: 'Làm sai' },
  { id: 'bookmarked', label: 'Đã đánh dấu' }
];

function shuffleQuestions(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function PracticeRunner({
  mode = 'practice',
  title = 'Ôn tập trắc nghiệm',
  questions = [],
  loading = false,
  error = null,
  filter = 'all',
  search = '',
  timeLimitSeconds = 0,
  submittingExam = false,
  checkingQuestionId = null,
  onFilterChange,
  onSearchChange,
  onAnswerQuestion,
  onToggleBookmark,
  onSubmitExam,
  onAskConfirm,
  onExit
}) {
  const [shuffled, setShuffled] = useState(false);
  const [orderIds, setOrderIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [examSelections, setExamSelections] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(timeLimitSeconds);
  const examSubmittedRef = useRef(false);
  const pendingAnswerRef = useRef(false);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    startedAtRef.current = Date.now();
    examSubmittedRef.current = false;
    setExamSelections({});
    setRemainingSeconds(timeLimitSeconds);
  }, [mode, timeLimitSeconds]);

  const questionIdsKey = useMemo(() => questions.map((q) => String(q.id)).join(','), [questions]);

  useEffect(() => {
    const baseIds = questionIdsKey ? questionIdsKey.split(',') : [];
    setOrderIds(shuffled ? shuffleQuestions(baseIds) : baseIds);
    setCurrentIndex(0);
  }, [questionIdsKey, shuffled]);

  const orderedQuestions = useMemo(() => {
    const map = new Map(questions.map((q) => [String(q.id), q]));
    const mapped = orderIds.map((id) => map.get(String(id))).filter(Boolean);
    return mapped.length === questions.length ? mapped : questions;
  }, [questions, orderIds]);

  const currentQuestion = orderedQuestions[currentIndex] || null;
  const isPracticeAnswered = mode === 'practice' && Boolean(currentQuestion?.progress?.selected_answer);

  const triggerExamSubmit = useCallback((force = false) => {
    if (examSubmittedRef.current || submittingExam) return;
    const execute = () => {
      if (examSubmittedRef.current) return;
      examSubmittedRef.current = true;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const answers = orderedQuestions.map((q) => ({
        questionId: q.id,
        selectedAnswer: examSelections[q.id] || null
      }));
      onSubmitExam({ answers, durationSeconds: elapsedSeconds });
    };

    if (force) {
      execute();
      return;
    }

    const unansweredCount = orderedQuestions.filter((q) => !examSelections[q.id]).length;
    if (unansweredCount > 0 && onAskConfirm) {
      onAskConfirm({
        title: 'Nộp bài thi thử?',
        message: `Bạn còn ${unansweredCount} câu chưa chọn đáp án. Bạn có chắc muốn nộp bài ngay không?`,
        confirmText: 'Nộp bài'
      }).then((ok) => {
        if (ok) execute();
      });
      return;
    }
    execute();
  }, [orderedQuestions, examSelections, submittingExam, onSubmitExam, onAskConfirm]);

  useEffect(() => {
    if (mode !== 'exam' || timeLimitSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          triggerExamSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, timeLimitSeconds, triggerExamSubmit]);

  const handleSelectOption = useCallback(async (letter) => {
    if (!currentQuestion || !currentQuestion.options?.[letter]) return;
    if (mode === 'exam') {
      if (submittingExam || examSubmittedRef.current) return;
      setExamSelections((prev) => ({ ...prev, [currentQuestion.id]: letter }));
      return;
    }
    if (isPracticeAnswered || checkingQuestionId || pendingAnswerRef.current) return;
    pendingAnswerRef.current = true;
    try {
      const res = await onAnswerQuestion(currentQuestion.id, letter);
      if (res) {
        setStreak((prev) => (res.is_correct ? prev + 1 : 0));
      }
    } finally {
      pendingAnswerRef.current = false;
    }
  }, [currentQuestion, mode, submittingExam, isPracticeAnswered, checkingQuestionId, onAnswerQuestion]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (!currentQuestion) return;

      const key = event.key;
      const lower = key.toLowerCase();
      if (['1', '2', '3', '4'].includes(key)) {
        if (isPracticeAnswered) return;
        event.preventDefault();
        handleSelectOption(OPTION_KEYS[Number(key) - 1]);
      } else if (['a', 'b', 'c', 'd'].includes(lower) && mode === 'practice') {
        if (isPracticeAnswered) return;
        event.preventDefault();
        handleSelectOption(lower.toUpperCase());
      } else if (lower === 's' && mode === 'practice') {
        event.preventDefault();
        onToggleBookmark?.(currentQuestion.id, !currentQuestion.progress?.is_bookmarked);
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((idx) => Math.max(0, idx - 1));
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((idx) => Math.min(orderedQuestions.length - 1, idx + 1));
      } else if (key === 'Enter' && isPracticeAnswered) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'BUTTON' || activeTag === 'A') return;
        event.preventDefault();
        setCurrentIndex((idx) => Math.min(orderedQuestions.length - 1, idx + 1));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentQuestion, mode, isPracticeAnswered, orderedQuestions.length, handleSelectOption, onToggleBookmark]);

  const examAnsweredCount = useMemo(
    () => orderedQuestions.filter((q) => Boolean(examSelections[q.id])).length,
    [orderedQuestions, examSelections]
  );

  return (
    <>
      {/* Thanh điều khiển phía trên */}
      <div className="clay-pb-runner-bar">
        <div className="clay-pb-runner-bar-left">
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm"
            onClick={onExit}
          >
            ← Tổng quan
          </button>
          <h1 className="clay-pb-runner-title">{title}</h1>
        </div>

        <div className="clay-pb-runner-bar-right">
          {mode === 'practice' ? (
            <>
              {streak >= 2 && (
                <span className="clay-pb-pill-badge is-streak" aria-label={`Chuỗi đúng ${streak} câu`}>
                  🔥 Chuỗi {streak}
                </span>
              )}
              <button
                type="button"
                className={`clay-pb-btn clay-pb-btn-sm ${shuffled ? 'clay-pb-btn-primary' : 'clay-pb-btn-secondary'}`}
                onClick={() => setShuffled((v) => !v)}
              >
                {shuffled ? '🔀 Đang trộn' : '🔀 Trộn câu'}
              </button>
            </>
          ) : (
            <>
              <span
                className={`clay-pb-pill-badge is-timer ${remainingSeconds <= 120 ? 'is-timer-urgent' : ''}`}
                aria-label="Thời gian còn lại"
              >
                ⏱️ {formatDuration(remainingSeconds)}
              </span>
              <span className="clay-pb-pill-badge">
                Đã chọn {examAnsweredCount}/{orderedQuestions.length}
              </span>
              <button
                type="button"
                className="clay-pb-btn clay-pb-btn-mint clay-pb-btn-sm"
                disabled={submittingExam || orderedQuestions.length === 0}
                onClick={() => triggerExamSubmit(false)}
              >
                {submittingExam ? 'Đang chấm...' : 'Nộp bài thi'}
              </button>
            </>
          )}

          {orderedQuestions.length > 0 && (
            <button
              type="button"
              className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm clay-pb-palette-toggle"
              onClick={() => setPaletteOpen((v) => !v)}
              aria-expanded={paletteOpen}
            >
              Bảng câu ({currentIndex + 1}/{orderedQuestions.length})
            </button>
          )}
        </div>
      </div>

      {/* Bộ lọc & tìm kiếm (chỉ trong chế độ ôn tập) */}
      {mode === 'practice' && (
        <div className="clay-pb-filter-bar">
          <div className="clay-pb-filter-tabs" role="tablist" aria-label="Lọc câu hỏi ôn tập">
            {FILTER_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`clay-pb-filter-tab ${filter === item.id ? 'is-active' : ''}`}
                onClick={() => onFilterChange?.(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            className="clay-pb-search-input"
            placeholder="Tìm câu hỏi hoặc từ khóa..."
            aria-label="Tìm câu hỏi ôn tập"
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
          />
        </div>
      )}

      {/* Nội dung chính */}
      {loading ? (
        <div className="clay-pb-state-card">
          <div className="spinner" />
          <p>Đang tải câu hỏi ôn tập...</p>
        </div>
      ) : error ? (
        <div className="clay-pb-state-card" role="alert">
          <h2>Không tải được câu hỏi</h2>
          <p>{error.message || 'Đã có lỗi xảy ra khi tải danh sách câu hỏi.'}</p>
          <button type="button" className="clay-pb-btn clay-pb-btn-secondary" onClick={onExit}>
            Quay lại tổng quan
          </button>
        </div>
      ) : !currentQuestion ? (
        <div className="clay-pb-state-card">
          <h2>Không có câu hỏi nào khớp bộ lọc</h2>
          <p>Hãy chuyển sang bộ lọc "Tất cả" hoặc xóa từ khóa tìm kiếm để tiếp tục ôn tập.</p>
          {mode === 'practice' && (
            <button
              type="button"
              className="clay-pb-btn clay-pb-btn-primary"
              onClick={() => {
                onFilterChange?.('all');
                onSearchChange?.('');
              }}
            >
              Xem tất cả câu hỏi
            </button>
          )}
        </div>
      ) : (
        <div className="clay-pb-runner-grid">
          {/* Thẻ câu hỏi Claymorphism */}
          <article className="clay-pb-question-card" data-tone={chapterTone(currentQuestion.chapter_index)}>
            <div className="clay-pb-question-head">
              <div className="clay-pb-question-meta">
                <span className="clay-pb-chapter-badge">Chương {currentQuestion.chapter_index}</span>
                <span className="clay-pb-qnum-pill">
                  Câu {currentIndex + 1}/{orderedQuestions.length} · Mã #{currentQuestion.external_id}
                </span>
              </div>

              {mode === 'practice' && (
                <button
                  type="button"
                  className={`clay-pb-bookmark-btn ${currentQuestion.progress?.is_bookmarked ? 'is-active' : ''}`}
                  onClick={() => onToggleBookmark?.(currentQuestion.id, !currentQuestion.progress?.is_bookmarked)}
                  aria-pressed={Boolean(currentQuestion.progress?.is_bookmarked)}
                >
                  {currentQuestion.progress?.is_bookmarked ? '★ Đã đánh dấu' : '☆ Đánh dấu'}
                </button>
              )}
            </div>

            <p className="clay-pb-question-text">{currentQuestion.question_text}</p>

            <div className="clay-pb-options-list" role="radiogroup" aria-label="Các phương án trả lời">
              {OPTION_KEYS.map((letter) => {
                const optionText = currentQuestion.options?.[letter];
                if (!optionText) return null;

                const isPractice = mode === 'practice';
                const selectedAnswer = isPractice
                  ? currentQuestion.progress?.selected_answer
                  : examSelections[currentQuestion.id];
                const correctAnswer = isPractice ? currentQuestion.correct_answer : null;
                const isSelected = selectedAnswer === letter;
                const hasResult = isPractice && Boolean(selectedAnswer && correctAnswer);

                let stateClass = '';
                if (hasResult) {
                  if (letter === correctAnswer) stateClass = 'is-correct';
                  else if (isSelected) stateClass = 'is-wrong';
                } else if (isSelected) {
                  stateClass = 'is-selected';
                }

                const isChecking = isPractice && checkingQuestionId === `${currentQuestion.id}:${letter}`;

                return (
                  <button
                    key={letter}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={Boolean(checkingQuestionId) || isPracticeAnswered || (mode === 'exam' && submittingExam)}
                    className={`clay-pb-option ${stateClass} ${isChecking ? 'is-checking' : ''}`}
                    onClick={() => handleSelectOption(letter)}
                  >
                    <span className="clay-pb-option-key">{letter}</span>
                    <span>{optionText}</span>
                  </button>
                );
              })}
            </div>

            {/* Giải thích chi tiết ngay sau khi trả lời (chế độ ôn tập) */}
            {mode === 'practice' && currentQuestion.progress?.selected_answer && (
              <div
                className={`clay-pb-explanation ${currentQuestion.progress.is_correct ? 'is-correct' : 'is-wrong'}`}
                role="status"
              >
                <div className="clay-pb-explanation-head">
                  {currentQuestion.progress.is_correct ? (
                    <span>✅ Chính xác! Đáp án đúng là {currentQuestion.correct_answer}.</span>
                  ) : (
                    <span>
                      ❌ Bạn chọn {currentQuestion.progress.selected_answer} — Đáp án đúng là {currentQuestion.correct_answer}.
                    </span>
                  )}
                </div>
                {currentQuestion.explanation && (
                  <p className="clay-pb-explanation-body">{currentQuestion.explanation}</p>
                )}
              </div>
            )}

            <div className="clay-pb-question-footer">
              <button
                type="button"
                className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
              >
                ← Câu trước
              </button>

              <span className="clay-pb-kbd-hint">
                Phím tắt: 1–4 chọn · ← / → chuyển câu{mode === 'practice' ? ' · S đánh dấu' : ''}
              </span>

              {currentIndex < orderedQuestions.length - 1 ? (
                <button
                  type="button"
                  className="clay-pb-btn clay-pb-btn-primary clay-pb-btn-sm"
                  onClick={() => setCurrentIndex((idx) => Math.min(orderedQuestions.length - 1, idx + 1))}
                >
                  Câu tiếp →
                </button>
              ) : mode === 'exam' ? (
                <button
                  type="button"
                  className="clay-pb-btn clay-pb-btn-mint clay-pb-btn-sm"
                  disabled={submittingExam}
                  onClick={() => triggerExamSubmit(false)}
                >
                  Nộp bài thi →
                </button>
              ) : (
                <button
                  type="button"
                  className="clay-pb-btn clay-pb-btn-mint clay-pb-btn-sm"
                  onClick={onExit}
                >
                  Hoàn tất phiên ôn ✓
                </button>
              )}
            </div>
          </article>

          {/* Bảng chọn câu hỏi (Question Palette) */}
          <aside className={`clay-pb-palette-card ${paletteOpen ? 'is-open' : ''}`} aria-label="Bảng điều hướng câu hỏi">
            <div className="clay-pb-palette-head">
              <h3>Danh sách câu hỏi</h3>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--pb-muted)' }}>
                {orderedQuestions.length} câu
              </span>
            </div>

            <div className="clay-pb-palette-grid">
              {orderedQuestions.map((q, idx) => {
                let statusClass = '';
                if (mode === 'practice') {
                  if (q.progress?.selected_answer) {
                    statusClass = q.progress.is_correct ? 'is-correct' : 'is-wrong';
                  }
                  if (q.progress?.is_bookmarked) statusClass += ' is-bookmarked';
                } else if (examSelections[q.id]) {
                  statusClass = 'is-selected';
                }
                if (idx === currentIndex) statusClass += ' is-current';

                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`clay-pb-palette-dot ${statusClass}`}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setPaletteOpen(false);
                    }}
                    aria-label={`Câu ${idx + 1}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="clay-pb-palette-legend">
              {mode === 'practice' ? (
                <>
                  <span>🟢 Đúng</span>
                  <span>🔴 Sai</span>
                  <span>🟡 Đánh dấu</span>
                </>
              ) : (
                <>
                  <span>🔵 Đã chọn</span>
                  <span>⚪ Chưa chọn</span>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
