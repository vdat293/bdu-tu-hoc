import { useRef } from 'react';
import { ViewportModal, useViewportDialog } from '../ViewportModal.jsx';
import { AvatarContent } from './Identity.jsx';

/**
 * Popup quản lý ảnh đại diện: xem ảnh hiện tại, tải ảnh mới từ máy hoặc gỡ
 * ảnh đang dùng. Dùng chung cho Confession và trang GPA.
 *
 * Khi bấm "Tải ảnh từ máy", trang gọi callback để mở hộp chọn file; file được
 * chọn sẽ đi tiếp vào popup căn chỉnh/cắt (AvatarCropDialog) trước khi upload.
 */
export default function AvatarManagerDialog({
  open,
  user,
  presentation,
  pending = false,
  removePending = false,
  onClose,
  onPickFile,
  onRemove
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  useViewportDialog(open, onClose, dialogRef, closeButtonRef, null);

  if (!open) return null;

  const hasOverride = presentation?.avatar_source === 'override';
  const sourceLabel = hasOverride
    ? 'Đang dùng ảnh bạn tự tải lên'
    : presentation?.avatar_source === 'bdu'
      ? 'Đang dùng ảnh từ cổng BDU'
      : 'Chưa có ảnh, đang hiển thị chữ cái đầu tên';

  return (
    <ViewportModal
      id="modal-avatar-manager"
      title="Ảnh đại diện"
      onClose={onClose}
      dialogRef={dialogRef}
      className="avatar-manager-dialog"
    >
      <div className="avatar-manager-header">
        <h3 className="avatar-manager-title">Ảnh đại diện</h3>
        <button
          ref={closeButtonRef}
          type="button"
          className="avatar-manager-close"
          onClick={onClose}
          aria-label="Đóng hộp thoại ảnh đại diện"
        >
          ✕
        </button>
      </div>

      <div className="avatar-manager-body">
        <div className="avatar-manager-preview">
          <AvatarContent user={user} presentation={presentation} alt="Ảnh đại diện hiện tại" />
        </div>
        <p className="avatar-manager-source">{sourceLabel}</p>

        <div className="avatar-manager-actions">
          <button
            type="button"
            className="btn btn-primary avatar-manager-upload"
            onClick={onPickFile}
            disabled={pending}
          >
            Tải ảnh từ máy
          </button>
          {hasOverride && (
            <button
              type="button"
              className="btn btn-secondary avatar-manager-remove"
              onClick={onRemove}
              disabled={removePending}
            >
              Gỡ ảnh hiện tại
            </button>
          )}
        </div>

        <p className="avatar-manager-hint">
          Hỗ trợ JPG, PNG, WebP tối đa 3MB. Sau khi chọn ảnh, bạn có thể căn chỉnh và cắt vuông.
        </p>
      </div>
    </ViewportModal>
  );
}
