import { ViewportModal } from '../../components/ViewportModal.jsx';

/**
 * Modal xác thực BDU trước khi chạy auto đăng ký.
 *
 * Controlled component: không tự giữ mật khẩu, không ghi storage. Page sở hữu
 * state và xoá nó ngay sau khi gửi request.
 */
export default function CredentialsModal({ open, mssv, password, error, busy, onPasswordChange, onClose, onSubmit, dialogRef, passwordRef }) {
  if (!open) return null;
  return (
    <ViewportModal
      id="enroll-credential-modal"
      title="Xác thực tài khoản BDU"
      labelledBy="enroll-credential-title"
      onClose={onClose}
      dialogRef={dialogRef}
      className="enroll-modal"
    >
      <div id="enroll-credential-title" className="enroll-modal-title">Xác thực tài khoản BDU</div>
      <p className="enroll-modal-text">
        Tool cần mật khẩu để đăng nhập lại trước giờ mở cổng. Mật khẩu chỉ giữ trong RAM của server và tự xoá khi lượt chạy kết thúc.
      </p>
      <label className="enroll-credential-field">
        <span>MSSV</span>
        <input value={mssv} readOnly autoComplete="username" />
      </label>
      <label className="enroll-credential-field">
        <span>Mật khẩu BDU</span>
        <input
          ref={passwordRef}
          type="password"
          value={password}
          autoComplete="off"
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </label>
      {error ? <p className="enroll-error" role="alert">{error}</p> : null}
      <div className="enroll-modal-actions">
        <button type="button" className="enroll-ghost" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="button" className="enroll-primary" onClick={onSubmit} disabled={busy || !password}>
          {busy ? 'Đang kích hoạt…' : 'Kích hoạt'}
        </button>
      </div>
    </ViewportModal>
  );
}
