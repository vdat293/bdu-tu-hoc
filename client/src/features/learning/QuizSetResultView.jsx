import { useEffect, useRef } from 'react';

function sameOptionText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = a.trim().toLocaleLowerCase('vi-VN');
  const right = b.trim().toLocaleLowerCase('vi-VN');
  return left !== '' && left === right;
}

/**
 * Result view for a quiz-set part. Review mode shows the completion summary
 * plus each stored answer's correct/wrong status (the server does not expose
 * the review answer key after completion); test mode adds the score, best and
 * attempts summary and the completed-test answer review.
 */
export default function QuizSetResultView({
  mode = 'review',
  part = null,
  questions = [],
  progress = null,
  review = null,
  onRestart,
  onBack,
  restarting = false
}) {
  const isReview = mode === 'review';
  const headingRef = useRef(null);
  const list = Array.isArray(questions) ? questions : [];
  const responses = Array.isArray(progress?.responses) ? progress.responses : [];
  const total = Number(progress?.total_count || part?.question_count || list.length || 0);
  const answered = Number(progress?.answered ?? responses.length);
  const correctFromResponses = responses.filter((entry) => entry?.correct === true).length;
  const correct = isReview
    ? correctFromResponses
    : Number(progress?.correct_count ?? correctFromResponses);
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const bestCorrect = progress?.best_correct;
  const bestTotal = progress?.best_total;
  const attempts = Number(progress?.attempts || 0);

  const responsesById = new Map();
  for (const entry of responses) {
    if (entry && typeof entry.id === 'string' && !responsesById.has(entry.id)) {
      responsesById.set(entry.id, typeof entry.response === 'string' ? entry.response : '');
    }
  }
  const reviewById = new Map();
  for (const entry of Array.isArray(review) ? review : []) {
    if (entry && typeof entry.id === 'string' && !reviewById.has(entry.id)) {
      reviewById.set(entry.id, entry);
    }
  }

  // On completion, move keyboard focus (and the viewport) to the result heading
  // so screen-reader users hear the outcome instead of the now-removed runner.
  useEffect(() => {
    if (!isReview) return;
    headingRef.current?.focus?.();
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [isReview]);

  return (
    <div className="quiz-result">
      <section className="quiz-result-summary" aria-label="Kết quả bài làm">
        {isReview ? (
          <h2 className="quiz-result-complete-title" ref={headingRef} tabIndex={-1}>
            {`Đã hoàn thành ôn tập ${answered}/${total}`}
          </h2>
        ) : (
          <div className="quiz-result-score-line">
            <strong className="quiz-result-score">{`${correct}/${total}`}</strong>
            <span className="quiz-result-percent">{percent}%</span>
          </div>
        )}
        <div className="quiz-result-meta">
          <span className="quiz-summary-chip">{`${correct}/${total} câu đúng`}</span>
          {!isReview && bestCorrect != null && bestTotal != null && (
            <span className="quiz-summary-chip">Cao nhất {`${bestCorrect}/${bestTotal}`}</span>
          )}
          {!isReview && attempts > 0 && (
            <span className="quiz-summary-chip">{attempts} lượt làm</span>
          )}
        </div>
      </section>

      {list.length > 0 && (
        <section className="quiz-result-review" aria-label="Xem lại từng câu">
          <h2 className="quiz-result-review-title">Xem lại từng câu</h2>
          <ol className="quiz-result-list">
            {list.map((question, index) => {
              const userText = responsesById.get(question.id) || '';
              const reviewEntry = reviewById.get(question.id) || null;
              const correctText = typeof reviewEntry?.correct === 'string' ? reviewEntry.correct : '';
              const explanation = typeof reviewEntry?.explanation === 'string' ? reviewEntry.explanation : '';
              const responseEntry = responses.find((entry) => entry?.id === question.id);
              const answeredQuestion = Boolean(userText);
              const isCorrect = answeredQuestion && (
                typeof responseEntry?.correct === 'boolean'
                  ? responseEntry.correct
                  : correctText !== '' && sameOptionText(userText, correctText)
              );
              const classes = ['quiz-result-item'];
              if (!answeredQuestion) classes.push('is-missing');
              else classes.push(isCorrect ? 'is-correct' : 'is-wrong');
              return (
                <li key={question.id || index} className={classes.join(' ')}>
                  <p className="quiz-result-question">
                    <span className="quiz-result-qnum">Câu {index + 1}. </span>
                    {question.question}
                  </p>
                  {answeredQuestion ? (
                    <p className="quiz-result-user-answer">Bạn chọn: {userText}</p>
                  ) : (
                    <p className="quiz-result-user-answer is-missing">Chưa trả lời</p>
                  )}
                  {answeredQuestion && (
                    <p className="quiz-result-verdict">
                      {isCorrect ? 'Đúng' : 'Chưa đúng'}
                    </p>
                  )}
                  {correctText && (
                    <p className="quiz-result-correct-answer">Đáp án đúng: {correctText}</p>
                  )}
                  {explanation && (
                    <p className="quiz-result-explanation">{explanation}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="quiz-result-actions">
        <button type="button" className="btn btn-primary" onClick={onRestart} disabled={restarting}>
          {restarting ? 'Đang bắt đầu...' : (isReview ? 'Ôn tập lại' : 'Làm lại')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Về môn
        </button>
      </div>
    </div>
  );
}
