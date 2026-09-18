import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConfirmDialog.css';

// Popup xác nhận trong app, thay window.confirm/alert của trình duyệt.
// Cách dùng:
//   const [confirmUI, askConfirm] = useConfirm();
//   // ... trong JSX: {confirmUI}
//   const ok = await askConfirm({ title: 'Xóa bài viết?', message: '...', confirmText: 'Xóa', danger: true });
//   if (ok) { ... }
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const ask = useCallback((options = {}) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setRequest({
      title: options.title || 'Xác nhận',
      message: options.message || '',
      confirmText: options.confirmText || 'Xác nhận',
      cancelText: options.cancelText || 'Hủy',
      danger: Boolean(options.danger)
    });
  }), []);

  const close = useCallback((value) => {
    setRequest(null);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, close]);

  const dialog = request ? createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}
    >
      <section className="confirm-panel glass-panel" role="alertdialog" aria-modal="true" aria-label={request.title}>
        <strong className="confirm-title">{request.title}</strong>
        {request.message && <p className="confirm-message">{request.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
            {request.cancelText}
          </button>
          <button
            type="button"
            className={request.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {request.confirmText}
          </button>
        </div>
      </section>
    </div>,
    document.body
  ) : null;

  return [dialog, ask];
}
