import { useEffect, useRef, useState } from 'react';
import { ViewportModal, useViewportDialog } from '../../components/ViewportModal.jsx';

export default function ClanJoinQuizModal({ open, clanName, quiz, isLoading, isPending, result, onClose, onSubmit, onViewClan }) {
  const [answers, setAnswers] = useState({});
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  useViewportDialog(open, onClose, dialogRef, closeRef, openerRef);

  useEffect(() => {
    if (open) setAnswers({});
  }, [open, quiz?.total]);

  if (!open) return null;
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const hasQuiz = Boolean(quiz?.enabled && questions.length);
  const answered = questions.filter((question) => answers[question.id] !== undefined).length;
  const resultDetails = result?.quiz_result?.results || [];

  return (
    <ViewportModal id="modal-clan-join-quiz" title={`Xin tham gia ${clanName || 'CLB'}`} onClose={onClose} dialogRef={dialogRef} className="clan-join-quiz-dialog">
      <div className="modal-header">
        <div>
          <h3 id="clan-join-quiz-title" className="modal-title">Xin tham gia {clanName || 'CLB'}</h3>
          <p className="modal-subtitle">{hasQuiz ? 'Hoàn thành quiz xác minh trước khi gửi yêu cầu.' : 'CLB chưa bật quiz xác minh. Bạn có thể gửi yêu cầu ngay.'}</p>
        </div>
        <button ref={closeRef} type="button" className="modal-close-btn" onClick={onClose} aria-label="Đóng hộp thoại xin tham gia">✕</button>
      </div>
      <div className="modal-body clan-join-quiz-body">
        {isLoading ? <p role="status">Đang tải cấu hình gia nhập...</p> : hasQuiz ? (
          <>
            <div className="quiz-progress" aria-live="polite">Đã trả lời {answered}/{questions.length} câu · Cần đúng ít nhất {quiz.min_correct}/{questions.length} câu</div>
            {questions.map((question, index) => (
              <fieldset className="quiz-question" key={question.id}>
                <legend>{index + 1}. {question.prompt}</legend>
                {question.options.map((option, optionIndex) => (
                  <label className="quiz-option" key={`${question.id}-${optionIndex}`}>
                    <input
                      type="radio"
                      name={`clan-quiz-${question.id}`}
                      checked={answers[question.id] === optionIndex}
                      onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </>
        ) : null}
        {result?.status && (
          <div className="quiz-result" role="status">
            <strong>{result.status === 'approved' ? 'Đã được tự động duyệt!' : 'Đã gửi yêu cầu chờ duyệt.'}</strong>
            {result.quiz_result && <p>Bạn đúng {result.quiz_result.score}/{result.quiz_result.total} câu.</p>}
            {resultDetails.length > 0 && <div className="quiz-result-details">
              {resultDetails.map((item, index) => (
                <div key={item.question_id} className={item.correct ? 'quiz-result-correct' : 'quiz-result-wrong'}>
                  Câu {index + 1}: {item.correct ? 'Đúng' : `Sai · Đáp án đúng: ${questions.find((question) => String(question.id) === String(item.question_id))?.options?.[item.correct_index] || item.correct_index}`}
                  {item.explanation && <small> — {item.explanation}</small>}
                </div>
              ))}
            </div>}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button>
        {result?.status === 'approved' ? <button type="button" className="btn btn-primary" onClick={onViewClan}>Vào CLB</button> : !result?.status && <button type="button" className="btn btn-primary" onClick={() => onSubmit(hasQuiz ? questions.map((question) => ({ questionId: question.id, selectedIndex: answers[question.id] })) : undefined)} disabled={isLoading || isPending || (hasQuiz && answered !== questions.length)}>
          {isLoading ? 'Đang tải…' : isPending ? 'Đang gửi...' : hasQuiz ? 'Nộp quiz & xin tham gia' : 'Gửi yêu cầu'}
        </button>}
      </div>
    </ViewportModal>
  );
}
