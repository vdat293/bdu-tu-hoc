import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GRAMMAR_TIMER_SECONDS,
  arrangePromptText,
  decodeHtmlEntities,
  formatCorrectAnswer,
  friendlyErrorMessage,
  hasHtml,
  isAnswerCorrect,
  optionColumns,
  parseArrangeWords,
  plainText
} from './grammar-lib.js';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function RichText({ value, className }) {
  const html = String(value ?? '');
  if (hasHtml(html)) {
    return <p className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <p className={className}>{decodeHtmlEntities(html)}</p>;
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function useCountdown(seconds, resetKey, active, onExpire) {
  const [left, setLeft] = useState(seconds);
  const key = `${seconds}|${resetKey}`;
  const [lastKey, setLastKey] = useState(key);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const expiredKeyRef = useRef(null);

  // Reset đồng bộ ngay trong render khi đổi câu/lượt. Nếu chỉ reset trong
  // useEffect, commit chuyển câu vẫn còn left = 0 của câu trước và effect
  // expire sẽ chấm "Hết giờ" oan cho câu mới.
  if (lastKey !== key) {
    setLastKey(key);
    setLeft(seconds);
    expiredKeyRef.current = null;
  }

  useEffect(() => {
    if (!active) return undefined;
    if (left <= 0) {
      // Chỉ expire một lần cho mỗi câu/lượt.
      if (expiredKeyRef.current !== resetKey) {
        expiredKeyRef.current = resetKey;
        expireRef.current?.();
      }
      return undefined;
    }
    const id = setTimeout(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left, active, resetKey]);

  return left;
}

function accuracyOf(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function answersFromSavedResponses(items, responses) {
  const byId = new Map((Array.isArray(responses) ? responses : []).map((entry) => [String(entry?.id ?? ''), entry]));
  return items.map((savedItem) => {
    const entry = byId.get(String(savedItem?.key ?? ''));
    if (!entry) return undefined;
    const response = entry.response ?? null;
    return {
      correct: entry.correct === true,
      response,
      timedOut: response == null
    };
  });
}

export default function GrammarRunner({
  items,
  initialIndex = 0,
  initialCorrect = 0,
  initialResponses = [],
  answeredBefore = 0,
  correctBefore = 0,
  timerSeconds = GRAMMAR_TIMER_SECONDS,
  onQuizSave,
  onCheckAnswer,
  onBackToTheory,
  onExitToPath,
  isExtra = false
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, Math.max(items.length - 1, 0))));
  const restoredAnswers = useMemo(() => answersFromSavedResponses(items, initialResponses), [items, initialResponses]);
  const restoredCorrectCount = restoredAnswers.filter((entry) => entry?.correct).length;
  const [answers, setAnswers] = useState(() => restoredAnswers);
  const [reveal, setReveal] = useState(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [arranged, setArranged] = useState([]);
  const [fillValue, setFillValue] = useState('');
  // Điểm đúng của các câu đã làm trước đó: tổng cũ trừ phần đã khôi phục được
  // (responses cũ có thể thiếu câu trả lời nên không khôi phục hết).
  const [baseCorrect, setBaseCorrect] = useState(Math.max(0, Math.max(0, initialCorrect) - restoredCorrectCount));
  const [round, setRound] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reviewAnswers, setReviewAnswers] = useState({});
  const checkingRef = useRef(false);
  const lastResponseRef = useRef(null);
  // Giữ callback mới nhất trong ref: callback từ trang cha đổi identity mỗi
  // lần render (mutation đổi trạng thái), nếu để trong deps sẽ làm effect
  // autosave hẹn lại liên tục và gửi request lặp vô hạn.
  const onQuizSaveRef = useRef(onQuizSave);
  onQuizSaveRef.current = onQuizSave;
  const lastAutosaveRef = useRef('');
  // Focus màn hình kết quả để screen reader đọc.
  const resultRef = useRef(null);

  // Chặn 2 lần "Câu tiếp"/Enter trong cùng một frame làm nhảy 2 câu; reset khi
  // đã sang câu mới (index đổi) hoặc khi làm lại.
  const advancingRef = useRef(false);
  // Chặn timeout/click ghi đè lẫn nhau sau khi câu đã được trả lời.
  const revealRef = useRef(null);
  // Ô nhập fill_blank tự focus khi vào câu để gõ tiếp không cần chuột.
  const fillRef = useRef(null);
  // Vùng phản hồi đúng/sai được focus để screen reader đọc kết quả.
  const feedbackRef = useRef(null);

  const total = items.length;
  const item = items[index] || null;
  const options = useMemo(() => optionColumns(item), [item]);
  const words = useMemo(
    () => (item?.type === 'arrange_words' ? shuffle(parseArrangeWords(item.question, item.option_a)) : []),
    [item]
  );
  const correctCount = baseCorrect + answers.filter((entry) => entry?.correct).length;
  const answeredCount = index + (reveal ? 1 : 0);

  // Gửi kèm câu trả lời để server chấm lại (không tin số correct do client khai).
  const buildResponses = useCallback(() => answers
    .map((entry, i) => (entry ? { id: items[i]?.key ?? null, response: entry.response ?? null } : null))
    .filter((entry) => entry?.id), [answers, items]);

  const resetRoundState = useCallback(() => {
    revealRef.current = null;
    setReveal(null);
    setHintOpen(false);
    setArranged([]);
    setFillValue('');
  }, []);

  // Lưu tiến độ: chỉ báo hoàn thành/thoát khi server đã nhận, tránh hiện
  // "Hoàn thành" oan khi mạng lỗi.
  const persist = useCallback(async (payload) => {
    setSaving(true);
    try {
      await onQuizSaveRef.current?.(payload);
      setSaveError(null);
      return true;
    } catch (error) {
      setSaveError(friendlyErrorMessage(error, 'Không thể lưu tiến độ. Kiểm tra kết nối rồi thử lại.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const finish = useCallback(async (correct) => {
    const ok = await persist({
      answered: total,
      correct,
      total,
      completed: true,
      responses: buildResponses(),
      answeredBefore,
      correctBefore
    });
    if (ok) setFinished(true);
    // Lưu lỗi thì mở lại nút "Hoàn thành" để bấm thử lại (advancingRef đang
    // bị giữ true vì index không đổi ở câu cuối).
    else advancingRef.current = false;
  }, [persist, total, buildResponses, answeredBefore, correctBefore]);

  const goNext = useCallback(() => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (index + 1 >= total) {
      const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
      finish(correct);
      return;
    }
    setIndex((i) => i + 1);
    resetRoundState();
  }, [index, total, baseCorrect, answers, finish, resetRoundState]);

  useEffect(() => {
    advancingRef.current = false;
  }, [index]);

  // Vào câu điền từ (mới/làm lại) thì đặt con trỏ sẵn vào ô nhập.
  useEffect(() => {
    if (item?.type === 'fill_blank' && !reveal) {
      fillRef.current?.focus({ preventScroll: true });
    }
  }, [item?.key, item?.type, round, reveal]);

  // Hiện kết quả thì đưa focus vào vùng phản hồi (Enter vẫn đi tiếp được).
  useEffect(() => {
    if (reveal) feedbackRef.current?.focus({ preventScroll: true });
  }, [reveal]);

  // Màn hình kết quả được focus để screen reader đọc ngay.
  useEffect(() => {
    if (finished) resultRef.current?.focus({ preventScroll: true });
  }, [finished]);

  // Câu trả lời cũ chỉ khôi phục được cờ đúng/sai (server không lưu đáp án
  // trong tiến độ) — hỏi server đáp án cho các câu làm sai để màn hình kết
  // quả vẫn hiện đáp án đúng + giải thích.
  useEffect(() => {
    if (!finished || !onCheckAnswer) return undefined;
    const missing = answers
      .map((entry, i) => ({ entry, question: items[i] }))
      .filter(({ entry, question }) => entry && !entry.correct && !entry.correctAnswer && entry.response != null && question?.key);
    if (!missing.length) return undefined;
    let cancelled = false;
    Promise.all(missing.map(({ entry, question }) => onCheckAnswer(question.key, entry.response)
      .then((result) => ({ key: question.key, result }))
      .catch(() => null))).then((rows) => {
      if (cancelled) return;
      const next = {};
      for (const row of rows) {
        if (row?.result?.correct_answer) next[row.key] = row.result;
      }
      if (Object.keys(next).length) setReviewAnswers((prev) => ({ ...prev, ...next }));
    });
    return () => { cancelled = true; };
  }, [finished, answers, items, onCheckAnswer]);

  const recordAnswer = useCallback((correct, response, timedOut = false, correctAnswer = '', explanation = '') => {
    if (revealRef.current) return;
    revealRef.current = { correct, response, timedOut, correctAnswer, explanation };
    setReveal({ correct, response, timedOut, correctAnswer, explanation });
    setCheckError(null);
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { correct, response, timedOut, correctAnswer, explanation };
      return next;
    });
  }, [index]);

  // Hết giờ: không hỏi server đáp án (tránh biến API chấm thành chỗ tra đáp án
  // khi chưa trả lời), chỉ ghi nhận câu bị bỏ trống.
  const handleTimeout = useCallback(() => {
    recordAnswer(false, null, true);
  }, [recordAnswer]);

  const left = useCountdown(timerSeconds, `${round}:${index}`, Boolean(item) && !reveal && !finished && !checking, handleTimeout);
  const timerPct = Math.max(0, Math.min(100, (left / timerSeconds) * 100));

  // Hết giờ: hiện đáp án rồi tự chuyển câu sau 4s để kịp đọc giải thích.
  useEffect(() => {
    if (!reveal?.timedOut || finished) return undefined;
    const id = setTimeout(() => goNext(), 4000);
    return () => clearTimeout(id);
  }, [reveal, finished, goNext]);

  // Tự lưu tiến độ dở dang sau mỗi câu (debounce) để refresh/đóng tab không
  // mất các câu đã làm. Câu cuối do finish()/exitQuiz() lưu để không cộng
  // nhầm số lượt làm bài. Chỉ lưu khi nội dung thực sự đổi (so signature
  // trong timeout) để không gửi lặp khi trang cha refetch sau mỗi lần lưu.
  useEffect(() => {
    if (finished) return undefined;
    const answeredNow = index + (reveal ? 1 : 0);
    if (answeredNow <= 0 || answeredNow >= total) return undefined;
    const responses = buildResponses();
    const signature = `${answeredNow}|${responses.map((entry) => `${entry.id}:${Array.isArray(entry.response) ? entry.response.join(' ') : entry.response ?? ''}`).join(',')}`;
    const timer = setTimeout(() => {
      if (signature === lastAutosaveRef.current) return;
      lastAutosaveRef.current = signature;
      const correctNow = baseCorrect + answers.filter((entry) => entry?.correct).length;
      onQuizSaveRef.current?.({
        answered: answeredNow,
        correct: correctNow,
        total,
        completed: false,
        responses,
        answeredBefore,
        correctBefore,
        silent: true
      })?.catch?.(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [index, reveal, finished, total, baseCorrect, answers, buildResponses, answeredBefore, correctBefore]);

  const submit = useCallback((response) => {
    if (!item || reveal || checkingRef.current) return;
    lastResponseRef.current = response;
    setCheckError(null);
    if (!onCheckAnswer) {
      setCheckError('Không thể kiểm tra đáp án lúc này. Vui lòng thử lại.');
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    onCheckAnswer(item.key, response)
      .then((result) => {
        recordAnswer(
          Boolean(result?.correct),
          response,
          false,
          String(result?.correct_answer ?? ''),
          String(result?.explanation ?? '')
        );
      })
      .catch((error) => {
        setCheckError(friendlyErrorMessage(error, 'Không thể kiểm tra đáp án. Kiểm tra kết nối rồi thử lại.'));
      })
      .finally(() => {
        checkingRef.current = false;
        setChecking(false);
      });
  }, [item, reveal, onCheckAnswer, recordAnswer]);

  useEffect(() => {
    const onKey = (event) => {
      if (finished || !item) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault();
        setHintOpen((v) => !v);
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Đang gõ trong ô nhập thì để form/input tự xử lý Enter, không cướp phím.
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (reveal && event.key === 'Enter') {
        // Nút/link đang focus tự xử lý Enter (vd nút Gợi ý, Thoát) — không nhảy câu.
        if (target?.closest('button, a, [role="button"]')) return;
        event.preventDefault();
        goNext();
        return;
      }
      if (!reveal && item.type === 'arrange_words') {
        if (event.key === 'Enter' && arranged.length === words.length && arranged.length > 0) {
          event.preventDefault();
          submit(arranged.map((wordIndex) => words[wordIndex]));
          return;
        }
        if (event.key === 'Backspace' && arranged.length) {
          event.preventDefault();
          setArranged((prev) => prev.slice(0, -1));
          return;
        }
      }
      if (!reveal && item.type === 'multiple_choice' && ['1', '2', '3', '4'].includes(event.key)) {
        const option = options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          submit(option);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, item, reveal, options, goNext, submit, arranged, words]);

  const retry = () => {
    setAnswers([]);
    setBaseCorrect(0);
    setIndex(0);
    setFinished(false);
    setRound((r) => r + 1);
    advancingRef.current = false;
    resetRoundState();
    setCheckError(null);
    setSaveError(null);
  };

  const exitQuiz = async () => {
    // Chưa làm câu nào thì không ghi đè tiến độ cũ (tránh mất chỗ "Tiếp tục").
    if (answeredCount > 0) {
      const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
      const ok = await persist({
        answered: answeredCount,
        correct,
        total,
        completed: answeredCount >= total,
        responses: buildResponses(),
        answeredBefore,
        correctBefore
      });
      if (!ok) return;
    }
    onExitToPath?.();
  };

  const backToTheory = async () => {
    if (answeredCount > 0) {
      const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
      const ok = await persist({
        answered: answeredCount,
        correct,
        total,
        completed: answeredCount >= total,
        responses: buildResponses(),
        answeredBefore,
        correctBefore
      });
      if (!ok) return;
    }
    onBackToTheory?.();
  };

  if (!item) {
    return (
      <div className="gr-card glass-panel" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <h3>Bài học chưa có câu hỏi</h3>
        <p>Nội dung đang được cập nhật.</p>
        <button className="btn btn-secondary" type="button" onClick={onExitToPath}>← Về lộ trình</button>
      </div>
    );
  }

  if (finished) {
    const wrong = answers
      .map((entry, i) => ({ entry, item: items[i] }))
      .filter(({ entry }) => entry && !entry.correct);
    const accuracy = accuracyOf(correctCount, total);
    return (
      <div className="gr-wrap">
        <div className="gr-card glass-panel gr-result" role="status" tabIndex={-1} ref={resultRef}>
          <span className="gr-result-emoji" aria-hidden="true">{accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚'}</span>
          <h3>{isExtra ? 'Hoàn thành luyện thêm!' : 'Hoàn thành bài học!'}</h3>
          <p className="gr-result-score">{correctCount}/{total} câu đúng · {accuracy}%</p>
          <div className="gr-result-bar" aria-hidden="true"><i style={{ width: `${accuracy}%` }} /></div>
          <div className="gr-result-actions">
            <button className="btn btn-primary" type="button" onClick={retry}>↻ Làm lại</button>
            {onBackToTheory ? (
              <button className="btn-ghost" type="button" onClick={onBackToTheory}>Xem lý thuyết</button>
            ) : null}
            <button className="btn-ghost" type="button" onClick={onExitToPath}>← Về lộ trình</button>
          </div>
        </div>

        {wrong.length ? (
          <div className="gr-card glass-panel">
            <h3 className="gr-review-title">Câu làm sai ({wrong.length})</h3>
            <ol className="gr-review-list">
              {wrong.map(({ entry, item: question }) => {
                const answerText = entry.correctAnswer || reviewAnswers[question.key]?.correct_answer || '';
                const explainText = entry.explanation || reviewAnswers[question.key]?.explanation || '';
                return (
                  <li key={question.key}>
                    <p className="gr-review-q">
                      {question.kind === 'reading' ? `${question.reading_title} · ` : ''}{plainText(question.question)}
                    </p>
                    <p className="gr-review-a">
                      Đáp án đúng: <strong>{answerText ? formatCorrectAnswer(answerText) : '—'}</strong>
                      {entry.response
                        ? <> · Bạn chọn: <em>{Array.isArray(entry.response) ? entry.response.join(' ') : entry.response}</em></>
                        : ' · Hết giờ'}
                    </p>
                    {explainText ? <p className="gr-review-explain">{plainText(explainText)}</p> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>
    );
  }

  const isReading = item.kind === 'reading';
  const showOptions = item.type === 'multiple_choice';
  const showFill = item.type === 'fill_blank';
  const showArrange = item.type === 'arrange_words';
  const arrangedSet = new Set(arranged);

  return (
    <div className="gr-wrap">
      <header className="gr-topbar glass-panel">
        <div className="gr-topbar-row">
          <span className="gr-counter">Câu {index + 1}/{total}</span>
          <div className="gr-topbar-actions">
            {onBackToTheory ? (
              <button className="gr-action" type="button" onClick={backToTheory} disabled={saving}>Lý thuyết</button>
            ) : null}
            <button className="gr-action is-exit" type="button" onClick={exitQuiz} disabled={saving}>← Thoát</button>
          </div>
        </div>
        <div className="gr-progress" role="progressbar" aria-label={`Tiến độ ${answeredCount}/${total} câu`} aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={total}>
          <i style={{ width: `${(answeredCount / total) * 100}%` }} />
        </div>
        <div className="gr-status-row">
          <span className={`gr-timer ${left <= 10 ? 'is-danger' : ''}`} role="timer" aria-label={`Còn ${left} giây`}>
            <span className="gr-timer-num">{left}s</span>
            <span className="gr-timer-bar" aria-hidden="true"><i style={{ width: `${timerPct}%` }} /></span>
          </span>
          <span className="gr-accuracy">Đúng {correctCount}/{answeredCount} · {accuracyOf(correctCount, answeredCount)}%</span>
        </div>
      </header>

      {saveError ? (
        <div className="gr-save-error" role="alert">
          <span>{saveError}</span>
          <span className="gr-save-error-hint">Bấm lại nút vừa rồi để thử lưu tiếp.</span>
        </div>
      ) : null}

      {checkError ? (
        <div className="gr-check-error" role="alert">
          <span>{checkError}</span>
          <button className="btn-ghost" type="button" onClick={() => submit(lastResponseRef.current)} disabled={checking}>Thử lại</button>
        </div>
      ) : null}

      <div className="gr-card glass-panel">
        {isReading && item.passage ? (
          <section className="gr-passage" aria-label="Đoạn văn">
            {item.reading_title ? <h4 className="gr-passage-title">{item.reading_title}</h4> : null}
            <p className="gr-passage-body">{item.passage}</p>
          </section>
        ) : null}

        <RichText value={showArrange ? arrangePromptText(item.question) : item.question} className="gr-question" />

        {showOptions ? (
          <div className="gr-options">
            {options.map((option, i) => {
              const isCorrect = reveal ? isAnswerCorrect(item.type, option, reveal.correctAnswer || '') : false;
              const isChosen = reveal?.response === option;
              const classes = ['gr-option'];
              let statusLabel = '';
              if (reveal) {
                if (isCorrect) { classes.push('is-correct'); statusLabel = ' — đáp án đúng'; }
                else if (isChosen) { classes.push('is-wrong'); statusLabel = ' — bạn chọn, chưa đúng'; }
                else classes.push('is-dim');
              }
              return (
                <button
                  key={`${item.key}-${OPTION_LETTERS[i]}`}
                  type="button"
                  className={classes.join(' ')}
                  disabled={Boolean(reveal) || checking}
                  onClick={() => submit(option)}
                  aria-label={reveal ? `${OPTION_LETTERS[i]}. ${option}${statusLabel}` : undefined}
                >
                  <span className="gr-option-letter">{OPTION_LETTERS[i]}</span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {showFill ? (
          <form
            className="gr-fill"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reveal && fillValue.trim()) submit(fillValue.trim());
            }}
          >
            <input
              ref={fillRef}
              type="text"
              value={fillValue}
              disabled={Boolean(reveal) || checking}
              onChange={(event) => setFillValue(event.target.value)}
              placeholder="Nhập đáp án..."
              aria-label="Đáp án"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="done"
            />
            <button className="btn btn-primary" type="submit" disabled={Boolean(reveal) || checking || !fillValue.trim()}>Trả lời</button>
          </form>
        ) : null}

        {showArrange ? (
          <div className="gr-arrange">
            <div
              className={`gr-arrange-answer ${reveal ? (reveal.correct ? 'is-correct' : 'is-wrong') : ''}`}
              role="group"
              aria-label="Câu trả lời đã xếp"
            >
              {arranged.length ? arranged.map((wordIndex) => (
                <button
                  key={`picked-${wordIndex}`}
                  type="button"
                  className="gr-chip is-picked"
                  disabled={Boolean(reveal) || checking}
                  onClick={() => setArranged((prev) => prev.filter((idx) => idx !== wordIndex))}
                  aria-label={`Bỏ từ ${words[wordIndex]}`}
                >
                  {words[wordIndex]}
                </button>
              )) : <span className="gr-arrange-empty">Bấm các từ bên dưới để xếp câu…</span>}
            </div>
            <div className="gr-words" role="group" aria-label="Các từ cho sẵn">
              {words.map((word, wordIndex) => (
                <button
                  key={`word-${wordIndex}-${word}`}
                  type="button"
                  className={`gr-chip ${arrangedSet.has(wordIndex) ? 'is-used' : ''}`}
                  disabled={Boolean(reveal) || checking || arrangedSet.has(wordIndex)}
                  onClick={() => setArranged((prev) => [...prev, wordIndex])}
                >
                  {word}
                </button>
              ))}
            </div>
            {!reveal ? (
              <div className="gr-arrange-actions">
                <div className="gr-arrange-tools">
                  <button
                    className="btn-ghost"
                    type="button"
                    disabled={!arranged.length}
                    onClick={() => setArranged((prev) => prev.slice(0, -1))}
                  >
                    ↶ Hoàn tác
                  </button>
                  <button className="btn-ghost" type="button" disabled={!arranged.length} onClick={() => setArranged([])}>Xóa hết</button>
                </div>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!arranged.length || arranged.length < words.length || checking}
                  onClick={() => submit(arranged.map((wordIndex) => words[wordIndex]))}
                >
                  Kiểm tra
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {item.hint ? (
          <div className="gr-hint-row">
            <button
              type="button"
              className="gr-hint-btn"
              onClick={() => setHintOpen((v) => !v)}
              aria-expanded={hintOpen}
              aria-controls="gr-hint-text"
            >
              💡 {hintOpen ? 'Ẩn gợi ý' : 'Gợi ý'}
            </button>
            {hintOpen ? <p className="gr-hint-text" id="gr-hint-text">{decodeHtmlEntities(item.hint)}</p> : null}
          </div>
        ) : null}

        {checking ? (
          <p className="gr-checking" role="status">Đang kiểm tra đáp án…</p>
        ) : null}

        {reveal ? (
          <div
            className={`gr-feedback ${reveal.correct ? 'is-ok' : 'is-bad'}`}
            ref={feedbackRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
          >
            <strong>
              {reveal.correct ? '✓ Chính xác!' : reveal.timedOut ? '⏰ Hết giờ!' : '✗ Chưa đúng'}
            </strong>
            {!reveal.correct && reveal.correctAnswer ? <span> Đáp án đúng: <b>{formatCorrectAnswer(reveal.correctAnswer)}</b></span> : null}
            {reveal.explanation ? <RichText value={reveal.explanation} className="gr-feedback-explain" /> : null}
            <div className="gr-feedback-actions">
              <button className="btn btn-primary" type="button" onClick={goNext} disabled={saving}>
                {saving ? 'Đang lưu…' : (index + 1 >= total ? 'Hoàn thành' : 'Câu tiếp →')}
              </button>
              <span className="gr-kbd-hint">Enter</span>
            </div>
          </div>
        ) : null}

        {!reveal ? (
          <p className="gr-kbd-hint gr-kbd-foot">
            {showOptions
              ? 'Phím tắt: 1–4 chọn đáp án · Ctrl + Space gợi ý'
              : showArrange
                ? 'Phím tắt: Enter kiểm tra khi đủ từ · Backspace bỏ từ cuối · Ctrl + Space gợi ý'
                : 'Phím tắt: nhập đáp án rồi nhấn Enter · Ctrl + Space gợi ý'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
