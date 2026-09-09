import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

export function useViewportDialog(isOpen, onClose, dialogRef, initialFocusRef, returnFocusRef) {
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreFocusRef.current = returnFocusRef.current || (typeof document.activeElement?.focus === 'function' ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      (initialFocusRef.current || focusableElements(dialogRef.current)[0] || dialogRef.current)?.focus();
    }, 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [dialogRef, initialFocusRef, isOpen, returnFocusRef]);
}

export function ViewportModal({ id, title, labelledBy, onClose, dialogRef, children, className = '' }) {
  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };
  return createPortal(
    <div id={id} className="modal-backdrop" onMouseDown={closeOnBackdrop}>
      <div
        ref={dialogRef}
        className={`modal-dialog glass-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
