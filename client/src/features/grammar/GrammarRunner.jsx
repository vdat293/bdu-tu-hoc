import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GRAMMAR_TIMER_SECONDS, formatCorrectAnswer, hasHtml, isAnswerCorrect, optionColumns, parseArrangeWords, plainText } from './grammar-lib.js';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function RichText({ value, className }) {
  const html = String(value ?? '');
  if (hasHtml(html)) {
    return <p className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <p className={className}>{html}</p>;
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
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    setLeft(seconds);
  }, [seconds, resetKey]);

  useEffect(() => {
    if (!active) return undefined;
    if (left <= 0) {
      expireRef.current?.();
      return undefined;
    }
    const id = setTimeout(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left, active]);

  return left;
}

function accuracyOf(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export default function GrammarRunner({
  items,
  initialIndex = 0,
  initialCorrect = 0,
  timerSeconds = GRAMMAR_TIMER_SECONDS,
  onQuizSave,
  onBackToTheory,
  onExitToPath
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, Math.max(items.length - 1, 0))));
  const [answers, setAnswers] = useState([]);
  const [reveal, setReveal] = useState(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [arranged, setArranged] = useState([]);
  const [fillValue, setFillValue] = useState('');
  const [baseCorrect, setBaseCorrect] = useState(Math.max(0, initialCorrect));

  const total = items.length;
  const item = items[index] || null;
  const options = useMemo(() => optionColumns(item), [item]);
  const words = useMemo(
    () => (item?.type === 'arrange_words' ? shuffle(parseArrangeWords(item.question, item.option_a)) : []),
    [item]
  );
  const correctCount = baseCorrect + answers.filter((entry) => entry?.correct).length;
  const answeredCount = index + (reveal ? 1 : 0);

  const resetRoundState = useCallback(() => {
    setReveal(null);
    setHintOpen(false);
    setArranged([]);
    setFillValue('');
  }, []);

  const finish = useCallback(async (correct) => {
    setFinished(true);
    await onQuizSave?.({ answered: total, correct, total, completed: true });
  }, [onQuizSave, total]);

  const goNext = useCallback(() => {
    if (index + 1 >= total) {
      const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
      finish(correct);
      return;
    }
    setIndex((i) => i + 1);
    resetRoundState();
  }, [index, total, baseCorrect, answers, finish, resetRoundState]);

  const recordAnswer = useCallback((correct, response, timedOut = false) => {
    setReveal({ correct, response, timedOut });
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { correct, response, timedOut };
      return next;
    });
  }, [index]);

  const handleTimeout = useCallback(() => {
    recordAnswer(false, null, true);
  }, [recordAnswer]);

  const left = useCountdown(timerSeconds, index, Boolean(item) && !reveal && !finished, handleTimeout);
  const timerPct = Math.max(0, Math.min(100, (left / timerSeconds) * 100));

  // Hết giờ: hiện đáp án rồi tự chuyển câu sau 2.5s (giống trang gốc).
  useEffect(() => {
    if (!reveal?.timedOut || finished) return undefined;
    const id = setTimeout(() => goNext(), 2500);
    return () => clearTimeout(id);
  }, [reveal, finished, goNext]);

  const submit = useCallback((response) => {
    if (!item || reveal) return;
    recordAnswer(isAnswerCorrect(item.type, response, item.correct_answer), response);
  }, [item, reveal, recordAnswer]);

  useEffect(() => {
    const onKey = (event) => {
      if (finished || !item) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault();
        setHintOpen((v) => !v);
        return;
      }
      if (reveal && event.key === 'Enter') {
        event.preventDefault();
        goNext();
        return;
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
  }, [finished, item, reveal, options, goNext, submit]);

  const retry = () => {
    setAnswers([]);
    setBaseCorrect(0);
    setIndex(0);
    setFinished(false);
    resetRoundState();
  };

  const exitQuiz = async () => {
    const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
    await onQuizSave?.({ answered: answeredCount, correct, total, completed: false });
    onExitToPath?.();
  };

  const backToTheory = async () => {
    const correct = baseCorrect + answers.filter((entry) => entry?.correct).length;
    await onQuizSave?.({ answered: answeredCount, correct, total, completed: false });
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
        <div className="gr-card glass-panel gr-result">
          <span className="gr-result-emoji" aria-hidden="true">{accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚'}</span>
          <h3>Hoàn thành bài học!</h3>
          <p className="gr-result-score">{correctCount}/{total} câu đúng · {accuracy}%</p>
          <div className="gr-result-bar" aria-hidden="true"><i style={{ width: `${accuracy}%` }} /></div>
          <div className="gr-result-actions">
            <button className="btn btn-primary" type="button" onClick={retry}>↻ Làm lại</button>
            {onBackToTheory ? (
              <button className="vg-btn-ghost" type="button" onClick={onBackToTheory}>Xem lý thuyết</button>
            ) : null}
            <button className="vg-btn-ghost" type="button" onClick={onExitToPath}>← Về lộ trình</button>
          </div>
        </div>

        {wrong.length ? (
          <div className="gr-card glass-panel">
            <h3 className="gr-review-title">Câu làm sai ({wrong.length})</h3>
            <ol className="gr-review-list">
              {wrong.map(({ entry, item: question }) => (
                <li key={question.key}>
                  <p className="gr-review-q">
                    {question.kind === 'reading' ? `${question.reading_title} · ` : ''}{plainText(question.question)}
                  </p>
                  <p className="gr-review-a">
                    Đáp án đúng: <strong>{formatCorrectAnswer(question.correct_answer)}</strong>
                    {entry.response
                      ? <> · Bạn chọn: <em>{Array.isArray(entry.response) ? entry.response.join(' ') : entry.response}</em></>
                      : ' · Hết giờ'}
                  </p>
                  {question.explanation ? <p className="gr-review-explain">{plainText(question.explanation)}</p> : null}
                </li>
              ))}
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
              <button className="gr-action" type="button" onClick={backToTheory}>Lý thuyết</button>
            ) : null}
            <button className="gr-action is-exit" type="button" onClick={exitQuiz}>← Thoát</button>
          </div>
        </div>
        <div className="gr-progress" role="progressbar" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={total}>
          <i style={{ width: `${(answeredCount / total) * 100}%` }} />
        </div>
        <div className="gr-status-row">
          <span className={`gr-timer ${left <= 10 ? 'is-danger' : ''}`}>
            <span className="gr-timer-num">{left}s</span>
            <span className="gr-timer-bar" aria-hidden="true"><i style={{ width: `${timerPct}%` }} /></span>
          </span>
          <span className="gr-accuracy">Đúng {correctCount}/{answeredCount} · {accuracyOf(correctCount, answeredCount)}%</span>
        </div>
      </header>

      <div className="gr-card glass-panel">
        {isReading && item.passage ? (
          <section className="gr-passage" aria-label="Đoạn văn">
            {item.reading_title ? <h4 className="gr-passage-title">{item.reading_title}</h4> : null}
            <p className="gr-passage-body">{item.passage}</p>
          </section>
        ) : null}

        <RichText value={item.question} className="gr-question" />

        {showOptions ? (
          <div className="gr-options">
            {options.map((option, i) => {
              const isCorrect = isAnswerCorrect(item.type, option, item.correct_answer);
              const isChosen = reveal?.response === option;
              const classes = ['gr-option'];
              if (reveal) {
                if (isCorrect) classes.push('is-correct');
                else if (isChosen) classes.push('is-wrong');
                else classes.push('is-dim');
              }
              return (
                <button
                  key={`${item.key}-${OPTION_LETTERS[i]}`}
                  type="button"
                  className={classes.join(' ')}
                  disabled={Boolean(reveal)}
                  onClick={() => submit(option)}
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
              type="text"
              value={fillValue}
              disabled={Boolean(reveal)}
              onChange={(event) => setFillValue(event.target.value)}
              placeholder="Nhập đáp án..."
              aria-label="Đáp án"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button className="btn btn-primary" type="submit" disabled={Boolean(reveal) || !fillValue.trim()}>Trả lời</button>
          </form>
        ) : null}

        {showArrange ? (
          <div className="gr-arrange">
            <div className={`gr-arrange-answer ${reveal ? (reveal.correct ? 'is-correct' : 'is-wrong') : ''}`}>
              {arranged.length ? arranged.map((wordIndex) => (
                <button
                  key={`picked-${wordIndex}`}
                  type="button"
                  className="gr-chip is-picked"
                  disabled={Boolean(reveal)}
                  onClick={() => setArranged((prev) => prev.filter((idx) => idx !== wordIndex))}
                >
                  {words[wordIndex]}
                </button>
              )) : <span className="gr-arrange-empty">Bấm các từ bên dưới để xếp câu…</span>}
            </div>
            <div className="gr-words">
              {words.map((word, wordIndex) => (
                <button
                  key={`word-${wordIndex}-${word}`}
                  type="button"
                  className={`gr-chip ${arrangedSet.has(wordIndex) ? 'is-used' : ''}`}
                  disabled={Boolean(reveal) || arrangedSet.has(wordIndex)}
                  onClick={() => setArranged((prev) => [...prev, wordIndex])}
                >
                  {word}
                </button>
              ))}
            </div>
            {!reveal ? (
              <div className="gr-arrange-actions">
                <button className="vg-btn-ghost" type="button" disabled={!arranged.length} onClick={() => setArranged([])}>Xóa hết</button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!arranged.length || arranged.length < words.length}
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
            <button type="button" className="gr-hint-btn" onClick={() => setHintOpen((v) => !v)}>
              💡 {hintOpen ? 'Ẩn gợi ý' : 'Gợi ý'}
            </button>
            {hintOpen ? <p className="gr-hint-text">{item.hint}</p> : null}
          </div>
        ) : null}

        {reveal ? (
          <div className={`gr-feedback ${reveal.correct ? 'is-ok' : 'is-bad'}`}>
            <strong>
              {reveal.correct ? '✓ Chính xác!' : reveal.timedOut ? '⏰ Hết giờ!' : '✗ Chưa đúng'}
            </strong>
            {!reveal.correct ? <span> Đáp án đúng: <b>{formatCorrectAnswer(item.correct_answer)}</b></span> : null}
            {item.explanation ? <RichText value={item.explanation} className="gr-feedback-explain" /> : null}
            <div className="gr-feedback-actions">
              <button className="btn btn-primary" type="button" onClick={goNext}>
                {index + 1 >= total ? 'Hoàn thành' : 'Câu tiếp →'}
              </button>
              <span className="gr-kbd-hint">Enter</span>
            </div>
          </div>
        ) : null}

        {!reveal ? (
          <p className="gr-kbd-hint gr-kbd-foot">
            {showOptions ? 'Phím tắt: 1–4 chọn đáp án · Ctrl + Space gợi ý' : 'Phím tắt: Ctrl + Space gợi ý'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
