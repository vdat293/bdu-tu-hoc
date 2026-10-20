import { useCallback, useEffect, useRef, useState } from 'react';
import './quiz.css';

export function shuffleArray(items) {
  const array = Array.isArray(items) ? [...items] : [];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sameOptionText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = a.trim().toLocaleLowerCase('vi-VN');
  const right = b.trim().toLocaleLowerCase('vi-VN');
  return left !== '' && left === right;
}

function canonicalOptionText(options, value) {
  if (!Array.isArray(options) || typeof value !== 'string') return null;
  const wanted = value.trim().toLocaleLowerCase('vi-VN');
  if (wanted === '') return null;
  for (const option of options) {
    if (typeof option !== 'string') continue;
    if (option.trim().toLocaleLowerCase('vi-VN') === wanted) return option;
  }
  return null;
}

function buildShuffledQuestions(questions) {
  return shuffleArray(questions).map((question) => ({
    ...question,
    options: shuffleArray(question?.options)
  }));
}

function normalizeInitialResponses(initialProgress, questions) {
  const entries = Array.isArray(initialProgress?.responses) ? initialProgress.responses : [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set();
  const responses = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.response !== 'string') continue;
    if (!byId.has(entry.id) || seen.has(entry.id)) continue;
    const canonical = canonicalOptionText(byId.get(entry.id)?.options, entry.response);
    if (canonical === null) continue;
    seen.add(entry.id);
    responses.push({ id: entry.id, response: canonical });
  }
  return responses;
}

function toClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalizeRemaining(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export default function QuizRunner({
  questions: incomingQuestions = [],
  initialProgress = null,
  remainingSeconds = null,
  allowEarlyFinish = true,
  onCheckAnswer,
  onSaveProgress,
  onComplete,
  onExit
}) {
  // Shuffle once per mount (each start/restart remounts via key): both the
  // question order and the options of every question. Responses store the
  // option text, so resume and autosave never depend on the display order.
  const [shuffledQuestions] = useState(() => buildShuffledQuestions(incomingQuestions));
  const questions = shuffledQuestions;
  const initialResponses = normalizeInitialResponses(initialProgress, questions);
  const [responses, setResponses] = useState(initialResponses);
  const [index, setIndex] = useState(() => {
    const answered = new Set(initialResponses.map((entry) => entry.id));
    const firstUnanswered = questions.findIndex((question) => !answered.has(question.id));
    return firstUnanswered === -1 ? questions.length : firstUnanswered;
  });
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [timeUp, setTimeUp] = useState(false);
  const [remaining, setRemaining] = useState(() => normalizeRemaining(remainingSeconds));

  const sessionResponsesRef = useRef([]);
  const timeUpRef = useRef(false);
  const finishedRef = useRef(false);
  const finishAttemptRef = useRef(false);
  const onSaveProgressRef = useRef(onSaveProgress);
  const onCompleteRef = useRef(onComplete);
  const feedbackRef = useRef(null);
  const questionHeadingRef = useRef(null);
  const confirmDialogRef = useRef(null);
  const confirmTriggerRef = useRef(null);
  const restoreConfirmFocusRef = useRef(false);

  onSaveProgressRef.current = onSaveProgress;
  onCompleteRef.current = onComplete;

  const total = questions.length;
  const current = index >= 0 && index < total ? questions[index] : null;
  const answeredIds = new Set(responses.map((entry) => entry.id));
  const answeredCount = questions.reduce((count, question) => count + (answeredIds.has(question.id) ? 1 : 0), 0);
  const unansweredCount = Math.max(0, total - answeredCount);
  const showConfirm = confirmSubmit && unansweredCount > 0;
  const progressPercent = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const locked = Boolean(feedback) || checking || timeUp || finishing || showConfirm;
  const timerLabel = remaining === null ? 'Không giới hạn thời gian' : `Thời gian còn lại ${toClock(remaining)}`;

  const finishExpired = useCallback(async () => {
    if (finishedRef.current || finishAttemptRef.current) return;
    finishAttemptRef.current = true;
    setFinishing(true);
    setFinishError('');
    let progress;
    try {
      progress = await onSaveProgressRef.current?.({ responses: [], completed: true });
    } catch {
      finishAttemptRef.current = false;
      setFinishing(false);
      setFinishError('Chưa lưu được kết quả. Vui lòng thử lại.');
      return;
    }
    finishedRef.current = true;
    finishAttemptRef.current = false;
    try {
      onCompleteRef.current?.(progress);
    } catch {
      // The attempt is already finalized server-side; never offer an inert retry.
    } finally {
      setFinishing(false);
    }
  }, []);

  const handleTimeUp = useCallback(() => {
    if (timeUpRef.current) {
      if (!finishedRef.current && !finishAttemptRef.current) finishExpired();
      return;
    }
    timeUpRef.current = true;
    setTimeUp(true);
    setSelected(null);
    setFeedback(null);
    setConfirmSubmit(false);
    finishExpired();
  }, [finishExpired]);

  // Timer runs from the server-provided remaining seconds; the page shell keeps
  // it in sync on visibilitychange without remounting the runner.
  const hasTimer = remaining !== null;
  useEffect(() => {
    if (!hasTimer || timeUp) return undefined;
    const timerId = setInterval(() => {
      setRemaining((previous) => (previous === null ? previous : Math.max(0, previous - 1)));
    }, 1000);
    return () => clearInterval(timerId);
  }, [hasTimer, timeUp]);

  useEffect(() => {
    if (remaining === 0 && !timeUp) handleTimeUp();
  }, [remaining, timeUp, handleTimeUp]);

  useEffect(() => {
    setRemaining(normalizeRemaining(remainingSeconds));
  }, [remainingSeconds]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  useEffect(() => {
    if (!feedback && !timeUp) questionHeadingRef.current?.focus();
  }, [index, feedback, timeUp]);

  useEffect(() => {
    if (showConfirm) {
      confirmDialogRef.current?.focus();
      return;
    }
    if (restoreConfirmFocusRef.current) {
      restoreConfirmFocusRef.current = false;
      confirmTriggerRef.current?.focus?.();
    }
  }, [showConfirm]);

  useEffect(() => {
    if (confirmSubmit && unansweredCount === 0) setConfirmSubmit(false);
  }, [confirmSubmit, unansweredCount]);

  const handleExit = () => {
    setConfirmSubmit(false);
    onExit?.();
  };

  const cancelConfirm = () => {
    restoreConfirmFocusRef.current = true;
    setConfirmSubmit(false);
  };

  const handleSelect = (optionText) => {
    setConfirmSubmit(false);
    if (locked) return;
    setSelected(optionText);
  };

  const handleCheck = async () => {
    setConfirmSubmit(false);
    if (!current || !selected || locked || timeUpRef.current) return;
    const questionId = current.id;
    const response = selected;
    setChecking(true);
    setCheckError('');
    setSaveError('');
    try {
      const result = await onCheckAnswer?.(questionId, response);
      // The deadline may pass while the answer is in flight: never persist a
      // response or reveal feedback after the server-side deadline.
      if (timeUpRef.current) return;
      setFeedback({
        correct: Boolean(result?.correct),
        correct_answer: typeof result?.correct_answer === 'string' ? result.correct_answer : '',
        explanation: result?.explanation || ''
      });
      const entry = { id: questionId, response };
      setResponses((previous) => (
        previous.some((item) => item.id === questionId) ? previous : [...previous, entry]
      ));
      if (!sessionResponsesRef.current.some((item) => item.id === questionId)) {
        sessionResponsesRef.current.push(entry);
      }
      if (typeof result?.remaining_seconds === 'number') {
        setRemaining(normalizeRemaining(result.remaining_seconds));
      }
      const payload = sessionResponsesRef.current.map((item) => ({ id: item.id, response: item.response }));
      const handleSaveFailure = (error) => {
        if (timeUpRef.current) return;
        if (error?.code === 'QUIZ_TIME_UP') {
          handleTimeUp();
          return;
        }
        setSaveError('Chưa lưu được tiến độ, sẽ thử lại.');
      };
      try {
        const savePromise = onSaveProgressRef.current?.({ responses: payload, completed: false });
        if (savePromise && typeof savePromise.catch === 'function') {
          savePromise.catch(handleSaveFailure);
        }
      } catch (error) {
        handleSaveFailure(error);
      }
    } catch (error) {
      if (timeUpRef.current) return;
      if (error?.code === 'QUIZ_TIME_UP') {
        handleTimeUp();
        return;
      }
      setCheckError('Không kiểm tra được đáp án. Vui lòng thử lại.');
    } finally {
      setChecking(false);
    }
  };

  const handleNext = () => {
    setConfirmSubmit(false);
    const nextIndex = questions.findIndex((question, questionIndex) => (
      questionIndex > index && !answeredIds.has(question.id)
    ));
    const fallbackIndex = questions.findIndex((question) => !answeredIds.has(question.id));
    const target = nextIndex === -1 ? fallbackIndex : nextIndex;
    setSelected(null);
    setFeedback(null);
    setCheckError('');
    setIndex(target === -1 ? total : target);
  };

  const finalize = async () => {
    if (finishedRef.current || checking || timeUpRef.current) return;
    // Defense in depth: review cannot be completed before every question has
    // an answer even if a future UI path calls finalize directly.
    if (!allowEarlyFinish && responses.length < total) return;
    finishedRef.current = true;
    setConfirmSubmit(false);
    setFinishing(true);
    setFinishError('');
    const payload = responses.map((entry) => ({ id: entry.id, response: entry.response }));
    let progress;
    try {
      progress = await onSaveProgressRef.current?.({ responses: payload, completed: true });
    } catch (error) {
      finishedRef.current = false;
      if (error?.code === 'QUIZ_TIME_UP') {
        // The local timer was stale: let the time-up path finalize only the
        // responses already stored server-side, with an empty payload.
        handleTimeUp();
        return;
      }
      setFinishError('Chưa nộp được bài. Vui lòng thử lại.');
      setFinishing(false);
      return;
    }
    try {
      onCompleteRef.current?.(progress);
    } catch {
      // The attempt is already finalized server-side; never offer an inert retry.
    } finally {
      setFinishing(false);
    }
  };

  const requestFinish = () => {
    if (finishing || checking || showConfirm || timeUpRef.current) return;
    if (unansweredCount > 0) {
      // Review completion is rejected server-side until every question has an
      // answer, so this mode must not ask for confirmation or finalize early.
      if (!allowEarlyFinish) return;
      confirmTriggerRef.current = document.activeElement;
      setConfirmSubmit(true);
      return;
    }
    finalize();
  };

  return (
    <div className="quiz-runner">
      <header className="quiz-runner-head">
        <div className="quiz-runner-head-info">
          <strong className="quiz-runner-count">
            {current ? `Câu ${index + 1}/${total}` : `Đã trả lời ${answeredCount}/${total}`}
          </strong>
          <div
            className="quiz-runner-progress"
            role="progressbar"
            aria-label="Tiến độ bài làm"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span className="quiz-runner-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        {remaining !== null && (
          <span className="quiz-runner-timer" role="timer" aria-label={timerLabel}>
            {toClock(remaining)}
          </span>
        )}
      </header>

      {timeUp ? (
        <section className="quiz-runner-timeup" role="status" aria-live="polite">
          <strong>Đã hết thời gian làm bài.</strong>
          {finishing && <p className="quiz-runner-muted">Đang lưu kết quả...</p>}
          {finishError && <p className="quiz-runner-error" role="alert">{finishError}</p>}
          <div className="quiz-runner-actions">
            {finishError && !finishing && (
              <button type="button" className="btn btn-primary" onClick={finishExpired}>
                Thử lưu kết quả lại
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={handleExit}>
              Quay lại
            </button>
          </div>
        </section>
      ) : !current ? (
        <section className="quiz-runner-finish">
          <p>Bạn đã trả lời tất cả câu hỏi.</p>
          {finishError && <p className="quiz-runner-error" role="alert">{finishError}</p>}
          <div className="quiz-runner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={requestFinish}
              disabled={finishing}
            >
              {finishing ? 'Đang nộp...' : 'Hoàn tất bài làm'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleExit}>
              Quay lại
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="quiz-runner-question" aria-labelledby="quiz-runner-question-heading">
            <h2
              className="quiz-runner-question-text"
              id="quiz-runner-question-heading"
              ref={questionHeadingRef}
              tabIndex={-1}
            >
              {current.question}
            </h2>
            <div
              className="quiz-runner-options"
              role="radiogroup"
              aria-labelledby="quiz-runner-question-heading"
            >
              {current.options.map((option, optionIndex) => {
                const letter = String.fromCharCode(65 + optionIndex);
                const isSelected = typeof selected === 'string' && sameOptionText(selected, option);
                const isCorrect = Boolean(feedback) && sameOptionText(option, feedback.correct_answer);
                const isWrong = Boolean(feedback) && isSelected && !feedback.correct;
                const classes = ['quiz-runner-option'];
                if (isSelected) classes.push('is-selected');
                if (isCorrect) classes.push('is-correct');
                if (isWrong) classes.push('is-wrong');
                return (
                  <button
                    key={`${current.id}-${optionIndex}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={String(option)}
                    className={classes.join(' ')}
                    onClick={() => handleSelect(option)}
                    disabled={locked}
                  >
                    <span className="quiz-runner-option-letter" aria-hidden="true">{letter}</span>
                    <span className="quiz-runner-option-text">{option}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {feedback && (
            <div
              className={`quiz-runner-feedback ${feedback.correct ? 'is-correct' : 'is-wrong'}`}
              role="status"
              aria-live="polite"
              tabIndex={-1}
              ref={feedbackRef}
            >
              <strong>{feedback.correct ? 'Chính xác!' : 'Chưa chính xác.'}</strong>
              {!feedback.correct && feedback.correct_answer && (
                <p className="quiz-runner-correct-answer">
                  Đáp án đúng: {feedback.correct_answer}
                </p>
              )}
              {feedback.explanation && (
                <p className="quiz-runner-explanation">{feedback.explanation}</p>
              )}
            </div>
          )}

          {checkError && <p className="quiz-runner-error" role="alert">{checkError}</p>}
          {saveError && <p className="quiz-runner-error" role="alert">{saveError}</p>}
          {!timeUp && finishError && <p className="quiz-runner-error" role="alert">{finishError}</p>}

          {showConfirm && (
            <section
              className="quiz-runner-confirm"
              role="alertdialog"
              aria-label="Nộp bài?"
              aria-describedby="quiz-runner-confirm-count"
              ref={confirmDialogRef}
              tabIndex={-1}
            >
              <p id="quiz-runner-confirm-count">
                Còn {unansweredCount} câu chưa làm, các câu đó sẽ tính sai. Nộp bài?
              </p>
              <div className="quiz-runner-actions">
                <button type="button" className="btn btn-secondary" onClick={cancelConfirm}>
                  Tiếp tục làm
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={finalize}
                  disabled={finishing || checking}
                >
                  Nộp bài
                </button>
              </div>
            </section>
          )}

          <div className="quiz-runner-footer-spacer" aria-hidden="true" />
          <footer className="quiz-runner-actions">
            {feedback ? (
              unansweredCount === 0 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={requestFinish}
                  disabled={finishing || showConfirm}
                >
                  {finishing ? 'Đang nộp...' : 'Xem kết quả'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleNext}
                  disabled={showConfirm}
                >
                  Câu tiếp
                </button>
              )
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCheck}
                disabled={!selected || checking || timeUp || showConfirm}
              >
                {checking ? 'Đang kiểm tra...' : 'Kiểm tra đáp án'}
              </button>
            )}

            {allowEarlyFinish && answeredCount > 0 && unansweredCount > 0 && !timeUp && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={requestFinish}
                disabled={finishing || checking || showConfirm}
              >
                Xem kết quả
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExit}
              disabled={showConfirm}
            >
              Quay lại
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
