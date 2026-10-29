import { useRef } from 'react';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';

export default function GuidePlatformDialog({ onSelect, onClose }) {
  const dialogRef = useRef(null);
  useViewportDialog(true, onClose, dialogRef);
  return (
    <ViewportModal title="Bạn đang sử dụng hệ điều hành nào?" dialogRef={dialogRef} onClose={onClose} className="guide-platform-dialog">
      <h2>Bạn đang sử dụng hệ điều hành nào?</h2>
      <p>Chọn để xem hướng dẫn và lệnh phù hợp với máy của bạn.</p>
      <div className="guide-platform-options">
        <button type="button" className="btn btn-primary" onClick={() => onSelect('windows')}>Windows · CMD</button>
        <button type="button" className="btn btn-primary" onClick={() => onSelect('macos')}>macOS · Terminal</button>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button>
    </ViewportModal>
  );
}
