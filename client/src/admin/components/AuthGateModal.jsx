import { useEffect, useRef, useState } from 'react';
import { loginAdmin, readAdminAuth } from '../api/adminApi.js';
import { Icons } from './Icons.jsx';

export default function AuthGateModal({ open, dismissible = false, onClose, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const userInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const stored = readAdminAuth();
    setUsername((prev) => prev || stored.mssv || '');
    setPassword('');
    setKey('');
    setError('');
    const focusTimer = setTimeout(() => {
      userInputRef.current?.focus();
    }, 30);
    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanUser = username.trim();
    const cleanKey = key.trim();
    if (!cleanKey && (!cleanUser || !password)) {
      setError('Nhập MSSV + mật khẩu BDU, hoặc mã khóa kỹ thuật.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const payload = cleanKey ? { key: cleanKey } : { username: cleanUser, password };
      const res = await loginAdmin(payload);
      onSuccess?.(res);
    } catch (err) {
      setError(err.message || 'Đăng nhập quản trị thất bại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" id="modal-auth-gate">
      <div
        className="modal-card modal-card-auth"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-auth-title"
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="modal-auth-title">
              <Icons.key size={20} />
              <span>Xác Thực Quản Trị Viên</span>
            </h3>
            <span className="modal-sub">Truy cập Admin Dashboard · BDU Tự Học</span>
          </div>
          {dismissible ? (
            <button
              type="button"
              className="btn-close-modal"
              id="btn-close-auth-modal"
              onClick={onClose}
              aria-label="Đóng cửa sổ xác thực"
            >
              <Icons.close size={18} />
            </button>
          ) : null}
        </div>

        <div className="modal-body">
          <p className="auth-desc">
            Đăng nhập bằng tài khoản BDU có quyền quản trị, hoặc bằng mã khóa kỹ thuật do quản trị hệ thống cấu hình trên server.
          </p>
          <form id="form-admin-auth" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="input-admin-user">MSSV quản trị viên:</label>
              <input
                ref={userInputRef}
                type="text"
                id="input-admin-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="MSSV của bạn"
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="input-admin-pass">Mật khẩu tài khoản BDU:</label>
              <input
                type="password"
                id="input-admin-pass"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu BDU"
                autoComplete="current-password"
              />
            </div>
            <details className="auth-key-details">
              <summary>Hoặc dùng mã khóa kỹ thuật</summary>
              <div className="form-group">
                <label htmlFor="input-admin-key">Mã khóa admin (ADMIN_DASHBOARD_KEY):</label>
                <input
                  type="password"
                  id="input-admin-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Mã khóa kỹ thuật"
                  autoComplete="off"
                />
              </div>
            </details>
            {error ? (
              <div id="auth-error-msg" className="auth-error" role="alert">
                {error}
              </div>
            ) : null}
            <button type="submit" className="btn-auth-submit" disabled={busy}>
              {busy ? 'Đang xác thực...' : 'Đăng Nhập Quản Trị'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
