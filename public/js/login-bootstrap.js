/** Lightweight login shell. The dashboard bundle is fetched only after a session exists. */
(() => {
  const bundleVersion = '20260905-perf-v22';
  const form = document.getElementById('login-form');
  if (!form) return;
  const button = document.getElementById('btn-login');
  const password = document.getElementById('password');
  const status = document.createElement('p');
  status.className = 'login-bootstrap-status';
  status.setAttribute('role', 'status');
  form.insertAdjacentElement('afterend', status);
  const setLoading = loading => {
    if (!button) return;
    button.disabled = loading;
    button.querySelector('.btn-text')?.classList.toggle('hidden', loading);
    button.querySelector('.btn-loader')?.classList.toggle('hidden', !loading);
  };
  const setStatus = (message, error = false) => { status.textContent = message || ''; status.classList.toggle('is-error', error); };
  const expiresAt = (token, seconds) => {
    if (seconds && Number.isFinite(Number(seconds))) return Date.now() + Number(seconds) * 1000;
    try { const payload = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.exp) return payload.exp * 1000; } catch { /* opaque token */ }
    return Date.now() + 24 * 60 * 60 * 1000;
  };
  const load = src => new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-bdu-bundle="${src}"]`)) return resolve();
    const script = document.createElement('script'); script.src = src; script.dataset.bduBundle = src;
    script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error(`Không thể tải thành phần giao diện: ${src}`)); };
    document.body.appendChild(script);
  });
  let applicationPromise = null;
  const loadApplication = () => {
    if (applicationPromise) return applicationPromise;
    applicationPromise = (async () => {
      await load(`js/api.js?v=${bundleVersion}`);
      await load(`js/app.js?v=${bundleVersion}`);
      await load(`js/interactions.js?v=${bundleVersion}`);
      window.BDUAppBoot?.();
    })().catch(error => { applicationPromise = null; throw error; });
    return applicationPromise;
  };
  const saveSession = (response, remember) => {
    const user = { name: response.name, mssv: response.mssv, email: response.email, roles: response.roles, idsv: response.idsv || '' };
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('bdu_token', response.token); storage.setItem('bdu_user', JSON.stringify(user));
    storage.setItem('bdu_token_expires_at', expiresAt(response.token, response.expires_in).toString());
  };
  const bootSavedSession = () => {
    const token = localStorage.getItem('bdu_token') || sessionStorage.getItem('bdu_token');
    const expiry = localStorage.getItem('bdu_token_expires_at') || sessionStorage.getItem('bdu_token_expires_at');
    if (!token || (expiry && Date.now() >= Number(expiry))) return;
    loadApplication().catch(error => setStatus(error.message, true));
  };
  const handleSubmit = async event => {
    event.preventDefault(); setStatus('Đang kết nối cổng BDU...'); setLoading(true);
    try {
      const result = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('username')?.value.trim(), password: password?.value || '' }) });
      const response = await result.json().catch(() => ({}));
      if (!result.ok || !response.result) throw new Error(response.message || 'Đăng nhập không thành công.');
      saveSession(response, document.getElementById('remember-me')?.checked !== false);
      setStatus('Đã xác thực. Đang mở bảng điều khiển...'); await loadApplication();
      form.removeEventListener('submit', handleSubmit);
    } catch (error) { setStatus(error.message || 'Đăng nhập không thành công.', true); } finally { setLoading(false); }
  };
  form.addEventListener('submit', handleSubmit);
  document.getElementById('toggle-password')?.addEventListener('click', () => {
    const hidden = password.type === 'password'; password.type = hidden ? 'text' : 'password';
    document.querySelector('.password-show')?.classList.toggle('hidden', hidden); document.querySelector('.password-hide')?.classList.toggle('hidden', !hidden);
  });
  bootSavedSession();
})();
