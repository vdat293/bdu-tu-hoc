import QuizRunner from './QuizRunner.jsx';

/**
 * Review mode never has a timer and cannot finish before every question in the
 * part has an answer: the service rejects incomplete review completion, so the
 * runner must not offer an early-finish path either.
 *
 * Ôn tập chấm ngay khi chọn (không có nút "Kiểm tra đáp án"): bấm 1 đáp án
 * hoặc phím 1-4 để xem đúng/sai + giải thích, Enter để sang câu tiếp.
 */
export default function QuizReviewRunner({
  questions,
  initialProgress,
  onCheckAnswer,
  onSaveProgress,
  onComplete,
  onExit,
  onFinishingChange
}) {
  return (
    <QuizRunner
      questions={questions}
      initialProgress={initialProgress}
      remainingSeconds={null}
      allowEarlyFinish={false}
      checkOnSelect
      onCheckAnswer={onCheckAnswer}
      onSaveProgress={onSaveProgress}
      onComplete={onComplete}
      onExit={onExit}
      onFinishingChange={onFinishingChange}
    />
  );
}
