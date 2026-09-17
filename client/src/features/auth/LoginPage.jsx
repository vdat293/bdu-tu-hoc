import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { goToReturnTo, isInternalReturnTo } from './session.js';

export default function LoginPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const usernameInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const queryReturnTo = new URLSearchParams(location.search).get('returnTo');
  const returnTo = isInternalReturnTo(location.state?.returnTo)
    ? location.state.returnTo
    : isInternalReturnTo(queryReturnTo) ? queryReturnTo : '/gpa';

  const handleReturnTo = useCallback((target) => goToReturnTo(target, navigate), [navigate]);

  useEffect(() => {
    if (auth.status === 'authenticated') handleReturnTo(returnTo);
  }, [auth.status, handleReturnTo, returnTo]);

  async function submit(event) {
    event.preventDefault();
    const trimmedUsername = username.trim();
    setLoginError('');
    if (!trimmedUsername || !password) {
      const message = !trimmedUsername && !password
        ? 'Vui lòng nhập MSSV và mật khẩu để đăng nhập.'
        : !trimmedUsername ? 'Vui lòng nhập mã số sinh viên (MSSV).' : 'Vui lòng nhập mật khẩu.';
      setLoginError(message);
      window.requestAnimationFrame(() => (trimmedUsername ? passwordInputRef : usernameInputRef).current?.focus());
      return;
    }
    setBusy(true);
    try {
      await auth.login(trimmedUsername, password, remember);
      handleReturnTo(returnTo);
    } catch (error) {
      const message = loginErrorMessage(error);
      setLoginError(message);
      notify(message, 'error');
      window.requestAnimationFrame(() => passwordInputRef.current?.focus());
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
        <p className="login-subtitle">Đăng nhập bằng tài khoản BDU để tiếp tục.</p>
      </div>

      <form id="login-form" className="login-form" onSubmit={submit} autoComplete="on" noValidate>
        <div className="form-group">
          <label htmlFor="username" className="form-label">
            <span className="label-text">Mã Số Sinh Viên (MSSV)</span>
          </label>
          <div className={`login-input-box${username ? ' has-value' : ''}${loginError ? ' has-error' : ''}`}>
            <span className="login-input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <input
              ref={usernameInputRef}
              id="username"
              name="username"
              className="login-input"
              placeholder="Nhập MSSV của bạn"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                if (loginError) setLoginError('');
              }}
              autoComplete="username"
              autoCapitalize="none"
              inputMode="numeric"
              spellCheck="false"
              aria-describedby={loginError ? 'login-error' : undefined}
              aria-invalid={Boolean(loginError)}
              required
              autoFocus
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="password" className="form-label">
            <span className="label-text">Mật Khẩu</span>
          </label>
          <div className={`login-input-box${password ? ' has-value' : ''}${loginError ? ' has-error' : ''}`}>
            <span className="login-input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <input
              ref={passwordInputRef}
              id="password"
              name="password"
              className="login-input"
              placeholder="Mật khẩu của bạn"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (loginError) setLoginError('');
              }}
              onFocus={() => document.body.classList.add('password-focused')}
              onBlur={() => document.body.classList.remove('password-focused')}
              autoComplete="current-password"
              aria-describedby={loginError ? 'login-error' : undefined}
              aria-invalid={Boolean(loginError)}
              required
            />
          </div>
        </div>

        {loginError && <div id="login-error" className="login-error" role="alert">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <div><strong>Chưa thể đăng nhập</strong><p>{loginError}</p></div>
        </div>}

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
          {busy && <span className="btn-spinner" aria-hidden="true" />}
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

function loginErrorMessage(error) {
  if (error?.status === 401 || /mật khẩu|tài khoản|đăng nhập không thành công|không đúng|sai/i.test(error?.message || '')) {
    return 'MSSV hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra và thử lại.';
  }
  if (error?.status >= 500) return 'Hệ thống BDU đang gặp sự cố. Vui lòng thử lại sau ít phút.';
  if (!error?.status) return 'Không thể kết nối đến hệ thống BDU. Hãy kiểm tra mạng rồi thử lại.';
  return error?.message || 'Đăng nhập không thành công. Vui lòng thử lại.';
}
