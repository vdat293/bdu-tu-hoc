import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { completeDiscordOAuth, readBduToken } from '../../api/reminders.js';

// Trang public Discord redirect về sau khi user bấm Authorize:
//   /discord-callback?code=...&state=...
// Tự đọc bdu_token (cùng origin nên đọc được localStorage), gọi API link,
// báo cho tab mở popup qua postMessage rồi tự đóng.
export default function DiscordCallbackPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState('working');
  const [message, setMessage] = useState('Đang kết nối Discord...');
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const error = params.get('error');
    if (error) {
      setStatus('error');
      setMessage('Bạn đã hủy Authorize. Đóng tab này và bấm Kết nối lại khi sẵn sàng.');
      window.opener?.postMessage({ type: 'bdu:discord-linked', ok: false }, window.location.origin);
      return;
    }
    const code = params.get('code') || '';
    const state = params.get('state') || '';
    const token = readBduToken();
    if (!code || !state) {
      setStatus('error');
      setMessage('Thiếu mã xác thực từ Discord. Đóng tab này và bấm Kết nối lại.');
      window.opener?.postMessage({ type: 'bdu:discord-linked', ok: false }, window.location.origin);
      return;
    }
    if (!token) {
      setStatus('error');
      setMessage('Phiên đăng nhập web đã hết. Đăng nhập lại rồi bấm Kết nối lại.');
      window.opener?.postMessage({ type: 'bdu:discord-linked', ok: false }, window.location.origin);
      return;
    }
    completeDiscordOAuth(token, { state, code })
      .then((data) => {
        setStatus('done');
        setMessage(`Đã kết nối Discord (${data?.discord_username || 'thành công'})! Bot sẽ DM chào bạn 1 tin. Tab này tự đóng sau 2 giây...`);
        window.opener?.postMessage({ type: 'bdu:discord-linked', ok: true }, window.location.origin);
        window.setTimeout(() => window.close(), 2000);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err?.message || 'Kết nối thất bại. Đóng tab này và thử lại.');
        window.opener?.postMessage({ type: 'bdu:discord-linked', ok: false }, window.location.origin);
      });
  }, [params]);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <section className="glass-panel" style={{ maxWidth: 440, padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 40, margin: '0 0 8px' }}>{status === 'error' ? '❌' : status === 'done' ? '✅' : '⏳'}</p>
        <p style={{ fontSize: 15 }}>{message}</p>
        {status === 'error' && <Link to="/gpa">Về trang chủ</Link>}
      </section>
    </main>
  );
}
