import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normText(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase();
}

const POS_META = {
  noun: { label: 'N', tone: 'is-noun' },
  'proper noun': { label: 'N', tone: 'is-noun' },
  verb: { label: 'V', tone: 'is-verb' },
  'phrasal verb': { label: 'V', tone: 'is-verb' },
  adjective: { label: 'Adj', tone: 'is-adj' },
  adverb: { label: 'Adv', tone: 'is-adv' },
  preposition: { label: 'Pre', tone: 'is-other' },
  conjunction: { label: 'Conj', tone: 'is-other' },
  pronoun: { label: 'Pro', tone: 'is-other' },
  phrase: { label: 'Phr', tone: 'is-other' },
  idiom: { label: 'Idm', tone: 'is-other' },
  determiner: { label: 'Det', tone: 'is-other' },
  interjection: { label: 'Int', tone: 'is-other' },
  'modal verb': { label: 'MV', tone: 'is-other' },
  'auxiliary verb': { label: 'Aux', tone: 'is-other' },
  number: { label: 'Num', tone: 'is-other' },
  'noun phrase': { label: 'N Phr', tone: 'is-noun' },
  'verb phrase': { label: 'V Phr', tone: 'is-verb' },
  'adjective phrase': { label: 'Adj Phr', tone: 'is-adj' },
  'adverb phrase': { label: 'Adv Phr', tone: 'is-adv' },
  structure: { label: 'Str', tone: 'is-other' },
  collocation: { label: 'Coll', tone: 'is-other' }
};

export function PosBadge({ pos }) {
  // pos có thể là multi-nhãn ("noun, verb") — badge lấy nhãn chính đầu tiên.
  const key = String(pos || '').trim().toLowerCase().split(',')[0].trim();
  if (!key) return null;
  const meta = POS_META[key] || { label: key.slice(0, 3).toUpperCase(), tone: 'is-other' };
  return <span className={`vg-pos ${meta.tone}`} title={pos}>{meta.label}</span>;
}

function useTimeouts() {
  const timers = useRef([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  return (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  };
}

function useCountdown(seconds, resetKey, onExpire) {
  const [left, setLeft] = useState(seconds);
  const firedRef = useRef(false);
  const cbRef = useRef(onExpire);
  cbRef.current = onExpire;
  useEffect(() => {
    setLeft(seconds);
    firedRef.current = false;
  }, [seconds, resetKey]);
  useEffect(() => {
    if (left <= 0) {
      if (!firedRef.current) {
        firedRef.current = true;
        cbRef.current?.();
      }
      return undefined;
    }
    const id = setTimeout(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return left;
}

export function GameShell({
  title,
  progressDone = 0,
  progressTotal = 0,
  score = 0,
  timer = null,
  timerTotal = 30,
  direction = null,
  onToggleDirection,
  onReplay,
  onExit,
  cardClassName = '',
  children
}) {
  const pct = progressTotal ? Math.min(100, (progressDone / progressTotal) * 100) : 0;
  const tPct = timer != null ? Math.max(0, Math.min(100, (timer / timerTotal) * 100)) : 0;
  return (
    <div className="vg-wrap">
      <header className="vg-topbar">
        <div className="vg-topbar-row">
          <div className="vg-topbar-left">{title}</div>
          <div className="vg-topbar-actions">
            {direction ? (
              <button type="button" className="vg-direction" onClick={onToggleDirection} aria-label={`Đổi chiều học, đang là ${direction}`}>
                <span className="vg-direction-label">{direction}</span>
                <span className="vg-direction-switch" aria-hidden="true"><i /></span>
              </button>
            ) : null}
            <button type="button" className="vg-action" onClick={onReplay}>
              <span aria-hidden="true">↻</span> Chơi lại
            </button>
            <button type="button" className="vg-action is-exit" onClick={onExit}>
              <span aria-hidden="true">✕</span> Thoát
            </button>
          </div>
        </div>
        <div className="vg-progress" role="progressbar" aria-valuenow={progressDone} aria-valuemin={0} aria-valuemax={progressTotal || 1}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="vg-topbar-sub">
          <span className="vg-coin" aria-label={`Điểm ${score}`}>🪙 ~{score} GAME</span>
          {timer != null ? (
            <div className="vg-timer">
              <span className="vg-timer-num" aria-live="off">{timer}s</span>
              <span className="vg-timer-bar"><i style={{ width: `${tPct}%` }} /></span>
            </div>
          ) : null}
        </div>
      </header>
      <main className={`vg-card ${cardClassName}`}>{children}</main>
    </div>
  );
}

function GameSummary({ title, score, detail, onReplay, onExit }) {
  return (
    <GameShell title="Hoàn thành" score={score} progressDone={1} progressTotal={1} onReplay={onReplay} onExit={onExit}>
      <div className="vg-summary">
        <span className="vg-summary-emoji" aria-hidden="true">🎉</span>
        <h4>{title}</h4>
        {detail ? <p className="vg-summary-detail">{detail}</p> : null}
        <p className="vg-summary-score">{score} điểm</p>
        <div className="vg-summary-actions">
          <button type="button" className="vg-btn-ghost" onClick={onReplay}>↻ Chơi lại</button>
          <button type="button" className="vg-btn-ghost" onClick={onExit}>← Về bộ từ</button>
        </div>
      </div>
    </GameShell>
  );
}

function EmptyPool({ onExit }) {
  return (
    <GameShell title="Trống" onReplay={onExit} onExit={onExit}>
      <div className="vg-summary">
        <h4>Không có từ nào cho cấu hình này</h4>
        <p className="vg-summary-detail">Hãy quay lại đổi trạng thái hoặc số lượng từ.</p>
        <div className="vg-summary-actions">
          <button type="button" className="vg-btn-ghost" onClick={onExit}>← Đổi cấu hình</button>
        </div>
      </div>
    </GameShell>
  );
}

/* ============================ FLASHCARD ============================ */

export function FlashcardGame({ words, onProgress, onReplay, onExit }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState('en-vi');
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [knownCount, setKnownCount] = useState(0);
  const total = words.length;
  const word = words[index];

  const go = useCallback((step) => {
    setFlipped(false);
    setGuess('');
    setFeedback(null);
    setIndex((i) => (i + step + total) % total);
  }, [total]);

  const mark = useCallback(async (known) => {
    if (!word || saving) return;
    setSaving(true);
    try { await onProgress?.(word.id, known ? 'known' : 'learning'); } catch { /* đã báo ở trang game */ }
    setSaving(false);
    if (known) setKnownCount((c) => c + 1);
    go(1);
  }, [word, saving, onProgress, go]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
      if (typing) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (k === 'x' || (e.ctrlKey && k === '1')) mark(false);
      else if (k === 'c' || (e.ctrlKey && k === '2')) mark(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, mark]);

  if (!word) return <EmptyPool onExit={onExit} />;

  const frontText = direction === 'en-vi' ? word.term : word.meaning;
  const backText = direction === 'en-vi' ? word.meaning : word.term;

  const submitGuess = async (e) => {
    e.preventDefault();
    const needle = normText(guess);
    if (!needle) return;
    const expected = normText(direction === 'en-vi' ? word.meaning : word.term);
    const ok = expected === needle || (needle.length >= 3 && expected.includes(needle));
    if (ok) {
      setFeedback('ok');
      setFlipped(true);
      setKnownCount((c) => c + 1);
      await onProgress?.(word.id, 'known').catch?.(() => {});
    } else {
      setFeedback('bad');
    }
  };

  return (
    <GameShell
      title={<span className="vg-counter">{index + 1} / {total}</span>}
      progressDone={index}
      progressTotal={total}
      score={knownCount * 5}
      direction={direction === 'en-vi' ? 'EN→VN' : 'VN→EN'}
      onToggleDirection={() => { setDirection((d) => (d === 'en-vi' ? 'vi-en' : 'en-vi')); setFlipped(false); setFeedback(null); }}
      onReplay={onReplay}
      onExit={onExit}
    >
      <div className="fc-stage">
        <div
          className={`fc-card ${flipped ? 'is-flipped' : ''}`}
          role="button" tabIndex={0}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
          }}
          aria-label={`Thẻ ${direction === 'en-vi' ? 'từ tiếng Anh' : 'nghĩa tiếng Việt'}: ${frontText}, nhấn để lật`}
        >
          <div className="fc-inner">
            <div className="fc-face fc-front">
              <span className="fc-eyebrow">{direction === 'en-vi' ? 'TỪ TIẾNG ANH' : 'NGHĨA TIẾNG VIỆT'}</span>
              <strong className="fc-word">{frontText}</strong>
              <span className="fc-meta">
                {direction === 'en-vi' ? <PosBadge pos={word.pos} /> : null}
                {direction === 'en-vi' && word.pronunciation ? <em className="fc-phonetic">{word.pronunciation}</em> : null}
              </span>
              <span className="fc-flip-hint">👆 Nhấn Space hoặc click để lật</span>
            </div>
            <div className="fc-face fc-back">
              <span className="fc-eyebrow">{direction === 'en-vi' ? 'NGHĨA TIẾNG VIỆT' : 'TỪ TIẾNG ANH'}</span>
              <strong className="fc-word">{backText}</strong>
              {direction === 'vi-en' && word.pronunciation ? <em className="fc-phonetic">{word.pronunciation}</em> : null}
              {word.example ? <span className="fc-example">{word.example}</span> : null}
            </div>
          </div>
        </div>

        <form className="fc-guess" onSubmit={submitGuess}>
          <input
            value={guess}
            onChange={(e) => { setGuess(e.target.value); if (feedback) setFeedback(null); }}
            placeholder={direction === 'en-vi' ? 'Gõ nghĩa (đánh dấu đã thuộc nếu đúng)...' : 'Gõ từ tiếng Anh...'}
            aria-label={direction === 'en-vi' ? 'Gõ nghĩa tiếng Việt' : 'Gõ từ tiếng Anh'}
          />
          <button type="submit" className="vg-btn-check" disabled={saving}>Check</button>
        </form>
        {feedback === 'ok' ? <p className="fc-feedback is-ok" aria-live="polite">Chính xác! Đã đánh dấu thuộc.</p> : null}
        {feedback === 'bad' ? <p className="fc-feedback is-bad" aria-live="polite">Chưa đúng — nhấn Space để xem đáp án.</p> : null}

        <div className="fc-controls">
          <button type="button" className="fc-nav" onClick={() => go(-1)}>
            <span className="fc-nav-main">‹ Trước</span><span className="fc-key">Ctrl + ← khi nhập</span>
          </button>
          <button type="button" className="fc-act is-forget" onClick={() => mark(false)} disabled={saving}>
            <span className="fc-act-main">✕ Quên</span><span className="fc-key">Ctrl + X</span>
          </button>
          <button type="button" className="fc-act is-remember" onClick={() => mark(true)} disabled={saving}>
            <span className="fc-act-main">✓ Thuộc</span><span className="fc-key">Ctrl + C</span>
          </button>
          <button type="button" className="fc-nav" onClick={() => go(1)}>
            <span className="fc-nav-main">Tiếp ›</span><span className="fc-key">Ctrl + → khi nhập</span>
          </button>
        </div>
      </div>
    </GameShell>
  );
}

/* ============================== QUIZ ============================== */

export const QUIZ_MODE_META = {
  'word-meaning': { label: 'TỪ TIẾNG ANH — chọn nghĩa đúng', toggle: 'EN→VN' },
  'meaning-word': { label: 'NGHĨA TIẾNG VIỆT — chọn từ đúng', toggle: 'VN→EN' },
  context: { label: 'NGỮ CẢNH — chọn từ phù hợp với câu', toggle: null }
};

export function QuizGame({ words, quizMode = 'word-meaning', onProgress, onReplay, onExit }) {
  const later = useTimeouts();
  const [localMode, setLocalMode] = useState(quizMode);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const total = words.length;
  const word = words[index];
  const usesTerms = localMode === 'meaning-word' || localMode === 'context';

  const advance = useCallback(() => {
    setPicked(null);
    setRevealed(false);
    setIndex((i) => i + 1);
  }, []);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const prompt = useMemo(() => {
    if (!word) return null;
    if (localMode === 'meaning-word') return { label: QUIZ_MODE_META['meaning-word'].label, text: word.meaning, showMeta: false, sentence: false };
    if (localMode === 'context' && word.example) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mask = (source, raw) => source.replace(new RegExp(`${esc(raw)}\\w*`, 'ig'), '______');
      let text = mask(word.example, word.term);
      if (text === word.example) {
        // Cụm động từ có thể bị chia tách trong ví dụ ("turn the music down"):
        // che từ dài nhất của cụm để câu vẫn có chỗ trống để chọn.
        const parts = word.term.split(/[\s-]+/).filter((part) => part.length >= 3).sort((a, b) => b.length - a.length);
        for (const part of parts) {
          const next = mask(text, part);
          if (next !== text) { text = next; break; }
        }
      }
      if (text !== word.example) {
        return { label: QUIZ_MODE_META.context.label, text, showMeta: false, sentence: true };
      }
      // Không che được từ nào trong ví dụ -> hỏi theo nghĩa để câu hỏi vẫn trả lời được.
      return { label: QUIZ_MODE_META.context.label, text: word.meaning, showMeta: false, sentence: false };
    }
    return { label: QUIZ_MODE_META['word-meaning'].label, text: word.term, showMeta: true, sentence: false };
  }, [word, localMode]);

  const options = useMemo(() => {
    if (!word) return [];
    const answer = usesTerms ? word.term : word.meaning;
    const others = shuffle(
      words.filter((w) => w.id !== word.id && (usesTerms ? w.term !== word.term : w.meaning !== word.meaning))
    ).slice(0, 3).map((w) => (usesTerms ? w.term : w.meaning));
    return shuffle([answer, ...others].map((label, i) => ({ key: `${i}-${label}`, label, correct: label === answer })));
  }, [word, words, usesTerms]);

  const timer = useCountdown(30, `${localMode}-${index}`, () => {
    if (!word || revealed) return;
    setRevealed(true);
    later(() => advanceRef.current(), 1500);
  });

  const choose = (opt) => {
    if (picked || revealed || !opt) return;
    setPicked(opt.key);
    setRevealed(true);
    if (opt.correct) {
      setScore((s) => s + 10);
      setCorrectCount((c) => c + 1);
      onProgress?.(word.id, 'known')?.catch?.(() => {});
    }
    later(advance, 850);
  };

  useEffect(() => {
    const onKey = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && options[n - 1]) choose(options[n - 1]);
      else if (e.key === 'Enter' && revealed) advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!word) {
    if (index >= total && total > 0) {
      return (
        <GameSummary
          title="Hoàn thành Quiz!"
          score={score}
          detail={`Trả lời đúng ${correctCount}/${total} câu`}
          onReplay={onReplay}
          onExit={onExit}
        />
      );
    }
    return <EmptyPool onExit={onExit} />;
  }

  const meta = QUIZ_MODE_META[localMode] || QUIZ_MODE_META['word-meaning'];

  return (
    <GameShell
      title={<span className="vg-counter">Câu {index + 1} / {total}</span>}
      progressDone={index}
      progressTotal={total}
      score={score}
      timer={timer}
      timerTotal={30}
      direction={meta.toggle}
      onToggleDirection={meta.toggle ? () => {
        setLocalMode((m) => (m === 'word-meaning' ? 'meaning-word' : 'word-meaning'));
        setIndex(0); setScore(0); setCorrectCount(0); setPicked(null); setRevealed(false);
      } : undefined}
      onReplay={onReplay}
      onExit={onExit}
    >
      <div className="qz-stage">
        <span className="qz-eyebrow">{prompt.label}</span>
        <strong className={`qz-word ${prompt.sentence ? 'is-sentence' : ''}`}>{prompt.text}</strong>
        {prompt.showMeta ? (
          <span className="qz-meta">
            <PosBadge pos={word.pos} />
            {word.pronunciation ? <em className="qz-phonetic">{word.pronunciation}</em> : null}
          </span>
        ) : <PosBadge pos={word.pos} />}
        <div className="qz-options">
          {options.map((opt, i) => {
            const state = revealed
              ? opt.correct ? 'is-correct' : opt.key === picked ? 'is-wrong' : 'is-dim'
              : '';
            return (
              <button
                key={opt.key} type="button"
                className={`qz-option ${state}`}
                onClick={() => choose(opt)}
                disabled={revealed}
              >
                <span className="qz-num">{i + 1}</span>
                <span className="qz-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
        <p className="qz-hint">Sử dụng phím số 1~4 để chọn nhanh đáp án</p>
      </div>
    </GameShell>
  );
}

/* ============================= TYPING ============================= */

export function TypingGame({ words, onProgress, onReplay, onExit }) {
  const later = useTimeouts();
  const [direction, setDirection] = useState('vi-en');
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [showExample, setShowExample] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const total = words.length;
  const word = words[index];

  const advance = useCallback(() => {
    setResult(null);
    setValue('');
    setShowExample(false);
    setHintLevel(0);
    setWrongCount(0);
    setIndex((i) => i + 1);
  }, []);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const timer = useCountdown(30, index, () => {
    if (!word) return;
    setResult(`Hết giờ — đáp án: ${direction === 'vi-en' ? word.term : word.meaning}`);
    later(() => advanceRef.current(), 1400);
  });

  if (!word) {
    if (index >= total && total > 0) {
      return (
        <GameSummary
          title="Hoàn thành Typing!"
          score={score}
          detail={`Đã gõ đúng ${score / 10}/${total} câu`}
          onReplay={onReplay}
          onExit={onExit}
        />
      );
    }
    return <EmptyPool onExit={onExit} />;
  }

  const promptText = direction === 'vi-en' ? word.meaning : word.term;
  const expected = direction === 'vi-en' ? word.term : word.meaning;
  const hintReveal = hintLevel > 0 ? expected.slice(0, hintLevel) : '';
  const hintRest = Math.max(0, expected.length - hintLevel);

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || result) return;
    const ok = normText(value) === normText(expected);
    if (ok) {
      setScore((s) => s + 10);
      setResult('correct');
      onProgress?.(word.id, 'known')?.catch?.(() => {});
      later(advanceRef.current, 900);
    } else {
      const nextWrong = wrongCount + 1;
      setWrongCount(nextWrong);
      if (nextWrong >= 2) {
        setResult(`Sai — đáp án: ${expected}`);
        later(advanceRef.current, 1200);
      } else {
        setResult('Sai rồi, thử lại hoặc dùng gợi ý!');
      }
    }
  };

  return (
    <GameShell
      title={<span className="vg-counter">Câu {index + 1} / {total}</span>}
      progressDone={index}
      progressTotal={total}
      score={score}
      timer={timer}
      timerTotal={30}
      direction={direction === 'vi-en' ? 'VN→EN' : 'EN→VN'}
      onToggleDirection={() => { setDirection((d) => (d === 'vi-en' ? 'en-vi' : 'vi-en')); setValue(''); setResult(null); setHintLevel(0); }}
      onReplay={onReplay}
      onExit={onExit}
    >
      <div className="ty-stage">
        <strong className="ty-prompt">{promptText}</strong>
        <PosBadge pos={word.pos} />
        <p className="ty-hint-text">
          {hintLevel > 0
            ? <span className="ty-hint-chars">{hintReveal}<i>{' _'.repeat(hintRest)}</i></span>
            : 'Chưa có gợi ý'}
        </p>
        <form className="ty-form" onSubmit={submit}>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); if (result) setResult(null); }}
            placeholder={direction === 'vi-en' ? 'Gõ từ tiếng Anh...' : 'Gõ nghĩa tiếng Việt...'}
            aria-label={direction === 'vi-en' ? 'Gõ từ tiếng Anh' : 'Gõ nghĩa tiếng Việt'}
            autoComplete="off"
          />
        </form>
        {result && result !== 'correct' ? <p className="ty-result is-bad" aria-live="polite">{result}</p> : null}
        {result === 'correct' ? <p className="ty-result is-ok" aria-live="polite">Chính xác! +10</p> : null}
        {showExample && word.example ? <p className="ty-example">{word.example}</p> : null}
        <div className="ty-actions">
          <button type="button" className="ty-btn" onClick={() => setShowExample((s) => !s)}>
            ✏️ {showExample ? 'Ẩn ví dụ' : 'Xem ví dụ'}<span>Ctrl + E</span>
          </button>
          <button type="button" className="ty-btn" onClick={() => setHintLevel((l) => Math.min(Math.max(l + 1, 3), expected.length))} disabled={hintLevel >= expected.length}>
            <span className="ty-btn-label">💡 Gợi ý <b>({Math.max(0, 3 - hintLevel) === 0 ? '∞' : Math.max(0, 3 - hintLevel)})</b></span><span>Ctrl + Space</span>
          </button>
          <button type="button" className="ty-btn is-primary" onClick={submit}>
            Kiểm tra<span>Enter</span>
          </button>
        </div>
      </div>
    </GameShell>
  );
}

/* ============================== MATCH ============================== */

const ROUND_SIZE = 8;
const MATCH_HEARTS = 5;

export function MatchGame({ words, onProgress, onReplay, onExit }) {
  const later = useTimeouts();
  const rounds = useMemo(() => {
    const pool = shuffle(words);
    const chunks = [];
    for (let i = 0; i < pool.length; i += ROUND_SIZE) {
      const chunk = pool.slice(i, i + ROUND_SIZE);
      if (chunk.length >= 2) chunks.push(chunk);
    }
    return chunks;
  }, [words]);

  const [roundIdx, setRoundIdx] = useState(0);
  const [done, setDone] = useState([]);
  const [first, setFirst] = useState(null);
  const [wrong, setWrong] = useState(null);
  const [hearts, setHearts] = useState(MATCH_HEARTS);
  const [score, setScore] = useState(0);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [finished, setFinished] = useState(false);
  const roundWords = useMemo(() => rounds[roundIdx] || [], [rounds, roundIdx]);
  const terms = useMemo(() => shuffle(roundWords), [roundWords]);
  const meanings = useMemo(() => shuffle(roundWords), [roundWords]);

  const goNextRound = useCallback(() => {
    setDone([]);
    setFirst(null);
    setHearts(MATCH_HEARTS);
    setRoundIdx((i) => {
      if (i + 1 >= rounds.length) {
        setFinished(true);
        return i;
      }
      return i + 1;
    });
  }, [rounds.length]);
  const goNextRef = useRef(goNextRound);
  goNextRef.current = goNextRound;

  const timer = useCountdown(60, roundIdx, () => {
    if (finished) return;
    later(() => goNextRef.current(), 300);
  });

  if (rounds.length === 0) return <EmptyPool onExit={onExit} />;

  if (finished) {
    return (
      <GameSummary
        title="Hoàn thành Ghép cặp!"
        score={score}
        detail={`Đã ghép ${matchedTotal}/${words.length} cặp`}
        onReplay={onReplay}
        onExit={onExit}
      />
    );
  }

  const pickTerm = (w) => setFirst((f) => (f?.id === w.id ? null : w));
  const pickMeaning = (w) => {
    if (!first || done.includes(w.id)) return;
    if (w.id === first.id) {
      const nextDone = [...done, w.id];
      setDone(nextDone);
      setScore((s) => s + 10);
      setMatchedTotal((m) => m + 1);
      setFirst(null);
      onProgress?.(w.id, 'known')?.catch?.(() => {});
      if (nextDone.length >= roundWords.length) later(() => goNextRef.current(), 700);
    } else {
      setWrong(w.id);
      setHearts((h) => Math.max(0, h - 1));
      later(() => setWrong(null), 600);
    }
  };

  return (
    <GameShell
      title={(
        <span className="vg-match-title">
          <span className="vg-round">VÒNG {roundIdx + 1}/{rounds.length}</span>
          Đã ghép <strong>{done.length} / {roundWords.length}</strong> · tổng {matchedTotal}/{words.length}
        </span>
      )}
      progressDone={matchedTotal}
      progressTotal={words.length}
      score={score}
      timer={timer}
      timerTotal={60}
      onReplay={onReplay}
      onExit={onExit}
      cardClassName="is-match"
    >
      <div className="mt-stage">
        <div className="mt-status">
          <span className="mt-hearts" aria-label={`Còn ${hearts} tim`}>
            {'❤'.repeat(hearts)}<i>{'❤'.repeat(Math.max(0, MATCH_HEARTS - hearts))}</i>
          </span>
          <span className="mt-badge">{timer}s</span>
        </div>
        <div className="mt-head">
          <span>Tiếng Anh</span>
          <span>Tiếng Việt</span>
        </div>
        <div className="mt-grid">
          <div className="mt-col">
            {terms.map((w) => (
              <button
                key={`t-${w.id}`} type="button"
                className={`mt-chip ${first?.id === w.id ? 'is-active' : ''} ${done.includes(w.id) ? 'is-done' : ''}`}
                disabled={done.includes(w.id)}
                aria-pressed={first?.id === w.id}
                onClick={() => pickTerm(w)}
              >
                {w.term}
              </button>
            ))}
          </div>
          <div className="mt-col">
            {meanings.map((w) => (
              <button
                key={`m-${w.id}`} type="button"
                className={`mt-chip ${wrong === w.id ? 'is-wrong' : ''} ${done.includes(w.id) ? 'is-done' : ''}`}
                disabled={done.includes(w.id)}
                onClick={() => pickMeaning(w)}
              >
                {w.meaning}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-foot">Đã ghép: <strong>{done.length} / {roundWords.length}</strong></p>
      </div>
    </GameShell>
  );
}
