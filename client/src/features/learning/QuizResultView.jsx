function letterToIndex(letter) {
  if (typeof letter !== 'string' || letter.length !== 1) return -1;
  const code = letter.toUpperCase().charCodeAt(0) - 65;
  return code >= 0 && code < 6 ? code : -1;
}

function optionText(question, letter) {
  const index = letterToIndex(letter);
  const options = Array.isArray(question?.options) ? question.options : [];
  return index >= 0 && index < options.length ? String(options[index]) : '';
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
      responsesById.set(entry.id, typeof entry.response === 'string' ? entry.response.toUpperCase() : '');
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
            const userLetter = responsesById.get(question.id) || '';
            const reviewEntry = reviewById.get(question.id) || null;
            const correctLetter = typeof reviewEntry?.correct === 'string'
              ? reviewEntry.correct.toUpperCase()
              : '';
            const explanation = typeof reviewEntry?.explanation === 'string' ? reviewEntry.explanation : '';
            const answered = Boolean(userLetter);
            const isCorrect = answered && correctLetter && userLetter === correctLetter;
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
                    Bạn chọn: {userLetter}
                    {optionText(question, userLetter) ? `. ${optionText(question, userLetter)}` : ''}
                  </p>
                ) : (
                  <p className="quiz-result-user-answer is-missing">Chưa trả lời</p>
                )}
                {correctLetter && (
                  <p className="quiz-result-correct-answer">
                    Đáp án đúng: {correctLetter}
                    {optionText(question, correctLetter) ? `. ${optionText(question, correctLetter)}` : ''}
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
