import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { isInternalReturnTo } from './session.js';

export default function LoginPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryReturnTo = new URLSearchParams(location.search).get('returnTo');
  const returnTo = isInternalReturnTo(location.state?.returnTo)
    ? location.state.returnTo
    : isInternalReturnTo(queryReturnTo) ? queryReturnTo : '/gpa';

  useEffect(() => {
    if (auth.status === 'authenticated') navigate(returnTo, { replace: true });
  }, [auth.status, navigate, returnTo]);

  useEffect(() => {
    document.body.classList.toggle('password-active', showPassword);
    return () => document.body.classList.remove('password-active');
  }, [showPassword]);

  async function submit(event) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      await auth.login(username.trim(), password, remember);
      navigate(returnTo, { replace: true });
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card glass-panel" aria-labelledby="login-title">
      <div className="login-header">
        <div className="university-badge">
          <img className="university-wordmark" src="/assets/images/logo-bdu-eng.png" alt="Binh Duong University" />
          <span className="badge-tag">BINH DUONG UNIVERSITY</span>
        </div>
        <h1 id="login-title" className="login-title">Chào mừng trở lại</h1>
        <p className="login-subtitle">Nhập thông tin tài khoản để tiếp tục.</p>
      </div>

      <form id="login-form" className="login-form" onSubmit={submit} autoComplete="on">
        <div className="form-group">
          <label htmlFor="username" className="form-label">
            <span className="label-text">Mã Số Sinh Viên (MSSV)</span>
          </label>
          <div className="input-wrapper">
            <input
              id="username"
              name="username"
              className="form-input"
              placeholder="Nhập mã số sinh viên (MSSV)"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="password" className="form-label">
            <span className="label-text">Mật Khẩu</span>
          </label>
          <div className="input-wrapper">
            <input
              id="password"
              name="password"
              className="form-input"
              placeholder="Mật khẩu của bạn"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={() => document.body.classList.add('password-focused')}
              onBlur={() => document.body.classList.remove('password-focused')}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              id="toggle-password"
              className="input-btn"
              onClick={() => setShowPassword((value) => !value)}
              title="Hiện/Ẩn mật khẩu"
              tabIndex={-1}
            >
              <span className={`password-show ${showPassword ? 'hidden' : ''}`}>Hiện</span>
              <span className={`password-hide ${!showPassword ? 'hidden' : ''}`}>Ẩn</span>
            </button>
          </div>
        </div>

        <div className="form-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              id="remember-me"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span className="checkbox-custom"></span>
            <span className="checkbox-text">Ghi nhớ phiên đăng nhập</span>
          </label>
        </div>

        <button type="submit" id="btn-login" className="btn btn-primary btn-block" disabled={busy}>
          <span className="btn-text">{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
        </button>
      </form>

      <div className="login-footer">
        <p className="login-note">
          Kết nối trực tiếp với hệ thống BDU. Mật khẩu không được lưu trữ.
        </p>
      </div>
    </div>
  );
}
