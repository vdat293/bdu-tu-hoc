import { useRef } from 'react';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';

export default function CloudShellHelpDialog({ onConfirm, onClose, pending }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  useViewportDialog(true, onClose, dialogRef, cancelRef);
  return (
    <ViewportModal title="Bạn không mở được CloudShell?" dialogRef={dialogRef} onClose={onClose} className="guide-cloudshell-dialog">
      <h2>Bạn không mở được CloudShell?</h2>
      <p>Nếu bạn nhấn vào biểu tượng CloudShell và gặp lỗi như hình, hãy nhấn “Xác nhận”.</p>
      <a href="/guides/inf1003/cloudshell-account-verification-error.png" target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh lỗi CloudShell đầy đủ">
        <img src="/guides/inf1003/cloudshell-account-verification-error.png" alt="CloudShell báo Unable to create the environment. Your account verification is in progress." />
      </a>
      <p className="guide-cloudshell-error-caption">Unable to create the environment. Your account verification is in progress.</p>
      <p>Hướng dẫn sẽ chuyển sang AWS CLI trên máy của bạn và vẫn gồm 7 bước. Các bước từ bước 2 cần xác nhận lại; thư mục đã lưu được giữ nguyên.</p>
      <div className="guide-platform-options">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={onConfirm}>{pending ? 'Đang chuyển…' : 'Xác nhận'}</button>
        <button ref={cancelRef} type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>Hủy bỏ</button>
      </div>
    </ViewportModal>
  );
}
