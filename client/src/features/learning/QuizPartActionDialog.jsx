import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewportDialog } from '../../components/ViewportModal.jsx';
import './quiz.css';

/**
 * Popup chọn hành động cho một phần của bộ đề: Ôn tập / Kiểm tra và
 * "Làm tiếp" khi phần đó đang làm dở.
 *
 * Dialog được portal ra document.body: dashboard dùng `perspective` nên
 * `position: fixed` bên trong nội dung sẽ bị cắt, phải ra khỏi cây DOM
 * mới phủ kín được viewport.
 */
export default function QuizPartActionDialog({ title, actions = [], onClose, onPick }) {
  const dialogRef = useRef(null);
  const firstActionRef = useRef(null);

  useViewportDialog(true, onClose, dialogRef, firstActionRef);

  return createPortal(
    <div
      className="quiz-part-action-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="quiz-part-action-panel glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="quiz-part-action-head">
          <h3 className="quiz-part-action-title">{title}</h3>
          <button
            type="button"
            className="composer-close-btn"
            onClick={onClose}
            title="Đóng"
            aria-label="Đóng"
          >
            ×
          </button>
        </header>

        <div className="quiz-part-action-list">
          {actions.map((action, index) => (
            <button
              key={action.key}
              ref={index === 0 ? firstActionRef : null}
              type="button"
              className="quiz-part-action-item"
              data-mode={action.mode}
              onClick={() => onPick(action)}
            >
              <strong>{action.title}</strong>
              {action.subtitle ? <span>{action.subtitle}</span> : null}
            </button>
          ))}
        </div>

        <div className="quiz-part-action-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Đóng
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
