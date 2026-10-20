import { useEffect, useRef, useState } from 'react';
import { parseQuizJson, quizTemplateJson } from '../../../../src/utils/quiz-data.js';
import './quiz.css';

export default function QuizComposerPanel({ text, onChangeText, onValidQuiz, onInvalid, disabled }) {
  const [errors, setErrors] = useState([]);
  const [quiz, setQuiz] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const wasValidRef = useRef(false);
  const notifiedInvalidRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const result = parseQuizJson(text || '');
      if (!text || !String(text).trim()) {
        setErrors([]);
        setQuiz(null);
        if (wasValidRef.current) {
          wasValidRef.current = false;
          if (!notifiedInvalidRef.current) {
            notifiedInvalidRef.current = true;
            onInvalid?.();
          }
        }
        return;
      }
      if (result.ok) {
        setErrors([]);
        setQuiz(result.quiz);
        wasValidRef.current = true;
        notifiedInvalidRef.current = false;
        onValidQuiz?.(result.quiz);
      } else {
        setErrors(result.errors || []);
        setQuiz(null);
        wasValidRef.current = false;
        if (!notifiedInvalidRef.current) {
          notifiedInvalidRef.current = true;
          onInvalid?.();
        }
      }
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const next = e.target.value;
    if (wasValidRef.current) {
      wasValidRef.current = false;
      if (!notifiedInvalidRef.current) {
        notifiedInvalidRef.current = true;
        onInvalid?.();
      }
    }
    onChangeText?.(next);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 262144) {
      setErrors([{ path: '$', message: 'File vượt quá 256 KB.' }]);
      setQuiz(null);
      wasValidRef.current = false;
      if (!notifiedInvalidRef.current) {
        notifiedInvalidRef.current = true;
        onInvalid?.();
      }
      e.target.value = '';
      return;
    }
    try {
      let content;
      if (typeof file.text === 'function') {
        content = await file.text();
      } else {
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
      }
      onChangeText?.(content);
    } catch {
      setErrors([{ path: '$', message: 'Không thể đọc file.' }]);
      setQuiz(null);
      wasValidRef.current = false;
      if (!notifiedInvalidRef.current) {
        notifiedInvalidRef.current = true;
        onInvalid?.();
      }
    }
    e.target.value = '';
  };

  const handleTemplate = () => {
    const blob = new Blob([quizTemplateJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bdu-quiz-mau.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const previewQuestions = quiz ? (expanded ? quiz.questions : quiz.questions.slice(0, 3)) : [];
  const timeLabel = quiz
    ? quiz.timeLimitSeconds
      ? `${Math.round(quiz.timeLimitSeconds / 60)} phút`
      : 'Không giới hạn'
    : '';

  return (
    <div className="quiz-composer">
      <div className="quiz-composer-actions">
        <label className="quiz-file-btn">
          Chọn file .json
          <input type="file" accept=".json,application/json" onChange={handleFile} disabled={disabled} hidden />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleTemplate} disabled={disabled}>
          Tải file mẫu
        </button>
      </div>

      <textarea
        aria-label="Dán JSON"
        className="quiz-textarea"
        value={text || ''}
        onChange={handleChange}
        disabled={disabled}
        spellCheck={false}
        placeholder="Dán JSON vào đây..."
        style={{ fontFamily: 'monospace' }}
      />

      {quiz && (
        <div className="quiz-valid-badge">
          ✓ {quiz.questions.length} câu · {timeLabel}
        </div>
      )}

      {errors.length > 0 && (
        <div className="quiz-errors">
          {errors.map((err, idx) => (
            <div key={idx} className="quiz-error-item">
              <span className="quiz-error-path">{err.path}</span>
              <span className="quiz-error-msg"> {err.message}</span>
            </div>
          ))}
        </div>
      )}

      {quiz && (
        <div className="quiz-preview">
          <div className="quiz-preview-title">Xem trước</div>
          {previewQuestions.map((q, qi) => (
            <div key={q.id || qi} className="quiz-preview-question">
              <div className="quiz-preview-q">
                <span className="quiz-preview-index">{qi + 1}.</span>{' '}
                <span className="quiz-preview-text">{q.question}</span>
              </div>
              <ul className="quiz-preview-options">
                {q.options.map((opt, oi) => {
                  const letter = String.fromCharCode(65 + oi);
                  const isCorrect = letter === q.correct;
                  return (
                    <li key={oi} className={isCorrect ? 'quiz-option-correct' : ''}>
                      <span className="quiz-option-letter">{letter}.</span>{' '}
                      <span className="quiz-option-text">{opt}</span>
                    </li>
                  );
                })}
              </ul>
              {q.explanation && <div className="quiz-preview-explanation">{q.explanation}</div>}
            </div>
          ))}
          {quiz.questions.length > 3 && !expanded && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(true)}>
              Xem tất cả
            </button>
          )}
        </div>
      )}
    </div>
  );
}
