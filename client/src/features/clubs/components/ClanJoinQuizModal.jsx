import { useEffect, useRef, useState } from 'react';
import { ViewportModal, useViewportDialog } from '../../../components/ViewportModal.jsx';
import { ClubIcon } from './ClubPrimitives.jsx';

export default function ClanJoinQuizModal({
  open,
  clanName,
  quiz,
  isLoading,
  isPending,
  result,
  onClose,
  onSubmit,
  onViewClan
}) {
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

  const handleSubmit = () => {
    const payload = hasQuiz
      ? questions.map((question) => ({ questionId: question.id, selectedIndex: answers[question.id] }))
      : undefined;
    onSubmit?.(payload);
  };

  return (
    <ViewportModal
      id="modal-clan-join-quiz"
      title={`Xin tham gia ${clanName || 'CLB'}`}
      onClose={onClose}
      dialogRef={dialogRef}
      className="clb-modal"
    >
      <div className="clb-modal__head">
        <div>
          <span className="clb-eyebrow">GIA NHẬP CLB</span>
          <h3 id="clan-join-quiz-title">Xin tham gia {clanName || 'CLB'}</h3>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="clb-icon-btn"
          onClick={onClose}
          aria-label="Đóng hộp thoại xin tham gia"
        >
          <ClubIcon name="close" size={18} />
        </button>
      </div>

      <p className="clb-modal__intro">
        {hasQuiz
          ? 'Hoàn thành quiz xác minh trước khi gửi yêu cầu.'
          : 'CLB chưa bật quiz xác minh. Bạn có thể gửi yêu cầu ngay.'}
      </p>

      <div className="clb-modal__body">
        {isLoading ? (
          <p className="clb-muted" role="status">Đang tải cấu hình gia nhập…</p>
        ) : hasQuiz ? (
          <>
            <div className="clb-quiz-progress" aria-live="polite">
              Đã trả lời {answered}/{questions.length} câu · Cần đúng ít nhất {quiz.min_correct}/{questions.length} câu
            </div>
            {questions.map((question, index) => (
              <fieldset className="clb-quiz-question" key={question.id}>
                <legend>{index + 1}. {question.prompt}</legend>
                {question.options.map((option, optionIndex) => (
                  <label className="clb-quiz-option" key={`${question.id}-${optionIndex}`}>
                    <input
                      type="radio"
                      name={`clan-quiz-${question.id}`}
                      checked={answers[question.id] === optionIndex}
                      onChange={() => setAnswers((cur) => ({ ...cur, [question.id]: optionIndex }))}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </>
        ) : null}

        {result?.status && (
          <div className="clb-quiz-result" role="status">
            <strong>{result.status === 'approved' ? 'Đã được tự động duyệt!' : 'Đã gửi yêu cầu chờ duyệt.'}</strong>
            {result.quiz_result && (
              <p className="clb-muted">Bạn đúng {result.quiz_result.score}/{result.quiz_result.total} câu.</p>
            )}
            {resultDetails.length > 0 && resultDetails.map((item, index) => {
              const matched = questions.find((q) => String(q.id) === String(item.question_id));
              return (
                <div key={item.question_id} className={item.correct ? 'clb-quiz-result__ok' : 'clb-quiz-result__bad'}>
                  Câu {index + 1}: {item.correct ? 'Đúng' : `Sai · Đáp án đúng: ${matched?.options?.[item.correct_index] || item.correct_index}`}
                  {item.explanation && <small> — {item.explanation}</small>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="clb-modal__foot">
        <button type="button" className="clb-btn clb-btn--secondary" onClick={onClose}>Đóng</button>
        {result?.status === 'approved' ? (
          <button type="button" className="clb-btn clb-btn--primary" onClick={onViewClan}>Vào CLB</button>
        ) : !result?.status && (
          <button
            type="button"
            className="clb-btn clb-btn--primary"
            onClick={handleSubmit}
            disabled={isLoading || isPending || (hasQuiz && answered !== questions.length)}
          >
            {isLoading ? 'Đang tải…' : isPending ? 'Đang gửi…' : hasQuiz ? 'Nộp quiz & xin tham gia' : 'Gửi yêu cầu'}
          </button>
        )}
      </div>
    </ViewportModal>
  );
}
