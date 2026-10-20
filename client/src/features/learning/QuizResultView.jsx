function sameOptionText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = a.trim().toLocaleLowerCase('vi-VN');
  const right = b.trim().toLocaleLowerCase('vi-VN');
  return left !== '' && left === right;
}

export default function QuizResultView({ quiz, progress, review, onRestart, onBack }) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const total = Number(progress?.total_count || quiz?.question_count || questions.length || 0);
  const correct = Number(progress?.correct_count || 0);
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const bestCorrect = progress?.best_correct;
  const bestTotal = progress?.best_total;
  const attempts = Number(progress?.attempts || 0);

  const responsesById = new Map();
  for (const entry of Array.isArray(progress?.responses) ? progress.responses : []) {
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

  return (
    <div className="quiz-result">
      <section className="quiz-result-summary" aria-label="Kết quả bài làm">
        <div className="quiz-result-score-line">
          <strong className="quiz-result-score">{`${correct}/${total}`}</strong>
          <span className="quiz-result-percent">{percent}%</span>
        </div>
        <div className="quiz-result-meta">
          {bestCorrect != null && bestTotal != null && (
            <span className="quiz-summary-chip">Cao nhất {`${bestCorrect}/${bestTotal}`}</span>
          )}
          {attempts > 0 && (
            <span className="quiz-summary-chip">{attempts} lượt làm</span>
          )}
        </div>
      </section>

      <section className="quiz-result-review" aria-label="Xem lại từng câu">
        <h2 className="quiz-result-review-title">Xem lại từng câu</h2>
        <ol className="quiz-result-list">
          {questions.map((question, index) => {
            const userText = responsesById.get(question.id) || '';
            const reviewEntry = reviewById.get(question.id) || null;
            const correctText = typeof reviewEntry?.correct === 'string'
              ? reviewEntry.correct
              : '';
            const explanation = typeof reviewEntry?.explanation === 'string' ? reviewEntry.explanation : '';
            const answered = Boolean(userText);
            const isCorrect = answered && correctText !== '' && sameOptionText(userText, correctText);
            return (
              <li
                key={question.id || index}
                className={`quiz-result-item ${answered ? (isCorrect ? 'is-correct' : 'is-wrong') : 'is-missing'}`}
              >
                <p className="quiz-result-question">
                  <span className="quiz-result-qnum">Câu {index + 1}. </span>
                  {question.question}
                </p>
                {answered ? (
                  <p className="quiz-result-user-answer">
                    Bạn chọn: {userText}
                  </p>
                ) : (
                  <p className="quiz-result-user-answer is-missing">Chưa trả lời</p>
                )}
                {correctText && (
                  <p className="quiz-result-correct-answer">
                    Đáp án đúng: {correctText}
                  </p>
                )}
                {explanation && (
                  <p className="quiz-result-explanation">{explanation}</p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="quiz-result-actions">
        <button type="button" className="btn btn-primary" onClick={onRestart}>
          Làm lại
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Về không gian môn
        </button>
      </div>
    </div>
  );
}
