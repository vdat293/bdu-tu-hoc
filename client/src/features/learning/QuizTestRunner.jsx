import { useCallback, useEffect, useRef, useState } from 'react';
import { shuffleArray } from './QuizRunner.jsx';
import './quiz.css';

const AUTOSAVE_DELAY_MS = 500;

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

// Stored test responses carry no correctness flag before completion, so the
// runner keeps a plain id -> option-text map and re-canonicalizes resumed
// values against the current question snapshot (matching by id, not position).
function normalizeInitialAnswers(initialProgress, questions) {
  const entries = Array.isArray(initialProgress?.responses) ? initialProgress.responses : [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answers = {};
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.response !== 'string') continue;
    if (!byId.has(entry.id) || answers[entry.id] !== undefined) continue;
    const canonical = canonicalOptionText(byId.get(entry.id)?.options, entry.response);
    if (canonical === null) continue;
    answers[entry.id] = canonical;
  }
  return answers;
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

/**
 * Timed test runner for a quiz-set part.
 *
 * - Shuffles questions/options once per mount (same helper as review mode).
 * - One question at a time; the selection can be changed freely before submit.
 * - Never renders feedback, the correct answer, or an explanation: the server
 *   is the only grader and only reveals the key after completion.
 * - Autosaves the latest full answer set via `onSubmit({responses, completed:false})`
 *   (debounced after each selection, flushed on navigation/exit) without
 *   blocking the UI.
 * - The countdown runs from the server-provided `remainingSeconds`. On expiry
 *   the runner submits exactly `{responses: [], completed: true}`: answers
 *   chosen after the deadline must never reach the server.
 *
 * Props:
 * - `questions`: `[{id, question, options}]` (no correct/explanation keys).
 * - `initialProgress`: `{responses: [{id, response}]}` resumed by id, or null.
 * - `remainingSeconds`: server-authoritative countdown start, or null.
 * - `onSubmit({responses, completed})`: persists progress, resolves saved progress.
 * - `onComplete(savedProgress)`: called once the attempt is finalized.
 * - `onExit()`: leaves the runner (progress already flushed).
 */
export default function QuizTestRunner({
  questions: incomingQuestions = [],
  initialProgress = null,
  remainingSeconds = null,
  onSubmit,
  onComplete,
  onExit
}) {
  // Shuffle once per mount (each start/restart remounts via key): both the
  // question order and the options of every question. Answers store the
  // option text, so resume and autosave never depend on the display order.
  const [shuffledQuestions] = useState(() => buildShuffledQuestions(incomingQuestions));
  const questions = shuffledQuestions;
  const [initialAnswers] = useState(() => normalizeInitialAnswers(initialProgress, questions));
  const [answers, setAnswers] = useState(initialAnswers);
  const [index, setIndex] = useState(() => {
    const answered = new Set(Object.keys(initialAnswers));
    const firstUnanswered = questions.findIndex((question) => !answered.has(question.id));
    return firstUnanswered === -1 ? 0 : firstUnanswered;
  });
  const [remaining, setRemaining] = useState(() => normalizeRemaining(remainingSeconds));
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [timeUp, setTimeUp] = useState(false);

  const answersRef = useRef(initialAnswers);
  const dirtyRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const timeUpRef = useRef(false);
  const finishedRef = useRef(false);
  const finishAttemptRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);
  const onCompleteRef = useRef(onComplete);
  const questionHeadingRef = useRef(null);
  const confirmDialogRef = useRef(null);
  const confirmTriggerRef = useRef(null);
  const restoreConfirmFocusRef = useRef(false);

  onSubmitRef.current = onSubmit;
  onCompleteRef.current = onComplete;

  const total = questions.length;
  const current = index >= 0 && index < total ? questions[index] : null;
  const answeredIds = new Set(Object.keys(answers));
  const answeredCount = questions.reduce((count, question) => count + (answeredIds.has(question.id) ? 1 : 0), 0);
  const unansweredCount = Math.max(0, total - answeredCount);
  const showConfirm = confirmSubmit && unansweredCount > 0;
  const progressPercent = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const selected = current && typeof answers[current.id] === 'string' ? answers[current.id] : null;
  const locked = timeUp || finishing || showConfirm;
  const timerLabel = remaining === null ? 'Không giới hạn thời gian' : `Thời gian còn lại ${toClock(remaining)}`;

  const clearAutosaveTimer = () => {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  useEffect(() => clearAutosaveTimer, []);

  const toPayload = useCallback(() => {
    const snapshot = answersRef.current || {};
    const payload = [];
    for (const question of questions) {
      if (typeof snapshot[question.id] === 'string' && snapshot[question.id] !== '') {
        payload.push({ id: question.id, response: snapshot[question.id] });
      }
    }
    return payload;
  }, [questions]);

  // Fire-and-forget: autosave must never block answering or navigation. The
  // payload is always rebuilt from the ref so concurrent edits send the
  // latest selections (latest-answer-wins server-side).
  const doAutosave = useCallback(() => {
    if (timeUpRef.current || finishedRef.current) return;
    dirtyRef.current = false;
    const payload = toPayload();
    let promise = null;
    try {
      promise = onSubmitRef.current?.({ responses: payload, completed: false });
    } catch {
      if (!timeUpRef.current && !finishedRef.current) {
        setSaveError('Chưa lưu được tiến độ, sẽ thử lại.');
      }
      return;
    }
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        if (!timeUpRef.current && !finishedRef.current) {
          setSaveError('Chưa lưu được tiến độ, sẽ thử lại.');
        }
      });
    }
  }, [toPayload]);

  const scheduleAutosave = useCallback(() => {
    if (timeUpRef.current || finishedRef.current) return;
    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(doAutosave, AUTOSAVE_DELAY_MS);
  }, [doAutosave]);

  const flushAutosave = useCallback(() => {
    if (!dirtyRef.current) return;
    clearAutosaveTimer();
    doAutosave();
  }, [doAutosave]);

  const finishExpired = useCallback(async () => {
    if (finishedRef.current || finishAttemptRef.current) return;
    finishAttemptRef.current = true;
    setFinishing(true);
    setFinishError('');
    let progress;
    try {
      // Timeout finalizes only the responses already stored server-side:
      // the payload is exactly empty so no post-deadline answer can leak in.
      progress = await onSubmitRef.current?.({ responses: [], completed: true });
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
    clearAutosaveTimer();
    setTimeUp(true);
    setConfirmSubmit(false);
    finishExpired();
  }, [finishExpired]);

  // Timer runs from the server-provided remaining seconds; expiry submits an
  // empty payload and locks the UI until the result is stored.
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
    if (!timeUp) questionHeadingRef.current?.focus();
  }, [index, timeUp]);

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

  const goTo = (target) => {
    if (target < 0 || target >= total || target === index) return;
    flushAutosave();
    setConfirmSubmit(false);
    setIndex(target);
  };

  const handleSelect = (optionText) => {
    if (locked || !current) return;
    setConfirmSubmit(false);
    setSaveError('');
    const next = { ...(answersRef.current || {}), [current.id]: optionText };
    answersRef.current = next;
    dirtyRef.current = true;
    setAnswers(next);
    scheduleAutosave();
  };

  const finalize = async () => {
    if (finishedRef.current || finishing || timeUpRef.current) return;
    finishedRef.current = true;
    setConfirmSubmit(false);
    setFinishing(true);
    setFinishError('');
    clearAutosaveTimer();
    dirtyRef.current = false;
    const payload = toPayload();
    let progress;
    try {
      progress = await onSubmitRef.current?.({ responses: payload, completed: true });
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

  const requestSubmit = () => {
    if (finishing || showConfirm || timeUpRef.current) return;
    // Empty submits stay disabled (the button guards this too); a partial
    // attempt asks for confirmation since unanswered questions score zero.
    if (answeredCount === 0) return;
    if (unansweredCount > 0) {
      confirmTriggerRef.current = document.activeElement;
      setConfirmSubmit(true);
      return;
    }
    finalize();
  };

  const cancelConfirm = () => {
    restoreConfirmFocusRef.current = true;
    setConfirmSubmit(false);
  };

  const handleExit = () => {
    flushAutosave();
    setConfirmSubmit(false);
    onExit?.();
  };

  if (total === 0) {
    return (
      <div className="quiz-test">
        <p className="quiz-test-muted">Phần này chưa có câu hỏi.</p>
        <div className="quiz-test-actions">
          <button type="button" className="btn btn-secondary" onClick={handleExit}>
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-test">
      <header className="quiz-test-head">
        <div className="quiz-test-head-info">
          <strong className="quiz-test-count">{`Câu ${index + 1}/${total}`}</strong>
          <div
            className="quiz-test-progress"
            role="progressbar"
            aria-label="Tiến độ bài làm"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span className="quiz-test-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        {remaining !== null && (
          <span
            className={`quiz-test-timer${remaining <= 60 ? ' is-low' : ''}`}
            role="timer"
            aria-label={timerLabel}
          >
            {toClock(remaining)}
          </span>
        )}
      </header>

      {timeUp ? (
        <section className="quiz-test-timeup" role="status" aria-live="polite">
          <strong>Đã hết thời gian làm bài.</strong>
          {finishing && <p className="quiz-test-muted">Đang lưu kết quả...</p>}
          {finishError && <p className="quiz-test-error" role="alert">{finishError}</p>}
          <div className="quiz-test-actions">
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
      ) : (
        <>
          <nav className="quiz-test-palette" aria-label="Danh sách câu hỏi">
            {questions.map((question, questionIndex) => {
              const isCurrent = questionIndex === index;
              const isAnswered = answeredIds.has(question.id);
              const classes = ['quiz-test-palette-btn'];
              if (isAnswered) classes.push('is-answered');
              if (isCurrent) classes.push('is-current');
              return (
                <button
                  key={question.id || questionIndex}
                  type="button"
                  className={classes.join(' ')}
                  aria-label={`Câu ${questionIndex + 1}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => goTo(questionIndex)}
                >
                  {questionIndex + 1}
                </button>
              );
            })}
          </nav>

          <section className="quiz-test-question" aria-labelledby="quiz-test-question-heading">
            <h2
              className="quiz-test-question-text"
              id="quiz-test-question-heading"
              ref={questionHeadingRef}
              tabIndex={-1}
            >
              {current.question}
            </h2>
            <div
              className="quiz-test-options"
              role="radiogroup"
              aria-labelledby="quiz-test-question-heading"
            >
              {current.options.map((option, optionIndex) => {
                const letter = String.fromCharCode(65 + optionIndex);
                const isSelected = typeof selected === 'string' && sameOptionText(selected, option);
                return (
                  <button
                    key={`${current.id}-${optionIndex}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={String(option)}
                    className={`quiz-test-option${isSelected ? ' is-selected' : ''}`}
                    onClick={() => handleSelect(option)}
                    disabled={locked}
                  >
                    <span className="quiz-test-option-letter" aria-hidden="true">{letter}</span>
                    <span className="quiz-test-option-text">{option}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {saveError && <p className="quiz-test-error" role="alert">{saveError}</p>}
          {!timeUp && finishError && <p className="quiz-test-error" role="alert">{finishError}</p>}

          {showConfirm && (
            <section
              className="quiz-test-confirm"
              role="alertdialog"
              aria-label="Nộp bài?"
              aria-describedby="quiz-test-confirm-count"
              ref={confirmDialogRef}
              tabIndex={-1}
            >
              <p id="quiz-test-confirm-count">
                Còn {unansweredCount} câu chưa làm, các câu đó sẽ tính sai. Nộp bài?
              </p>
              <div className="quiz-test-actions">
                <button type="button" className="btn btn-secondary" onClick={cancelConfirm}>
                  Tiếp tục làm
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={finalize}
                  disabled={finishing}
                >
                  Nộp bài
                </button>
              </div>
            </section>
          )}

          <div className="quiz-test-footer-spacer" aria-hidden="true" />
          <footer className="quiz-test-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goTo(index - 1)}
              disabled={index === 0 || showConfirm}
            >
              Câu trước
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goTo(index + 1)}
              disabled={index === total - 1 || showConfirm}
            >
              Câu tiếp
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={requestSubmit}
              disabled={answeredCount === 0 || finishing || showConfirm}
            >
              {finishing ? 'Đang nộp...' : 'Nộp bài'}
            </button>
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
