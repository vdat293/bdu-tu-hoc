import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../feedback/ConfirmDialog.jsx';
import {
  consentReminders,
  createDiscordLinkCode,
  getReminderPrefs,
  revokeReminders,
  sendDiscordTest,
  unlinkDiscordLink
} from '../../api/reminders.js';

export default function ReminderSettings({ onClose }) {
  const auth = useAuth();
  const token = auth?.token;
  const { notify } = useToasts();
  const client = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [linkCode, setLinkCode] = useState(null);
  const [confirmUI, askConfirm] = useConfirm();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const prefsQuery = useQuery({
    queryKey: ['reminders-prefs'],
    queryFn: ({ signal }) => getReminderPrefs(token, { signal }),
    enabled: Boolean(token)
  });
  const prefs = prefsQuery.data || {};
  const consented = Boolean(prefs.consented);
  const discordLinked = Boolean(prefs.discord_linked);

  const consentMutation = useMutation({
    mutationFn: () => consentReminders(token, { xac_nhan: true }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['reminders-prefs'] });
      notify('Đã bật nhận thông báo lịch học.', 'success');
    },
    onError: (error) => notify(error?.message || 'Không thể bật nhắc lịch.', 'error')
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeReminders(token),
    onSuccess: () => {
      setLinkCode(null);
      setAgreed(false);
      client.invalidateQueries({ queryKey: ['reminders-prefs'] });
      notify('Đã tắt và xóa token nhắc lịch.', 'success');
    },
    onError: (error) => notify(error?.message || 'Không thể tắt nhắc lịch.', 'error')
  });

  const unlinkMutation = useMutation({
    mutationFn: () => unlinkDiscordLink(token),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['reminders-prefs'] });
      notify('Đã gỡ liên kết Discord. Vào server + nhắn mã mới để link nick khác.', 'success');
    },
    onError: (error) => notify(error?.message || 'Không thể gỡ liên kết Discord.', 'error')
  });

  const testMutation = useMutation({
    mutationFn: () => sendDiscordTest(token),
    onSuccess: () => {
      notify('Đã gửi tin thử! Mở DM của bot kiểm tra trong 30 giây nhé.', 'success');
      window.setTimeout(() => client.invalidateQueries({ queryKey: ['reminders-prefs'] }), 30000);
    },
    onError: (error) => notify(error?.message || 'Không thể gửi tin thử.', 'error')
  });

  const codeMutation = useMutation({
    mutationFn: () => createDiscordLinkCode(token),
    onSuccess: (data) => setLinkCode(data),
    onError: (error) => notify(error?.message || 'Không thể tạo mã.', 'error')
  });

  // Có consent mà chưa link: tự sinh mã để user chỉ việc vào server + nhắn mã.
  useEffect(() => {
    if (consented && !discordLinked && !linkCode && token && !codeMutation.isPending) {
      codeMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented, discordLinked, token]);

  const copyCode = async () => {
    const code = linkCode?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      notify('Đã copy mã.', 'success');
    } catch {
      notify(`Mã của bạn: ${code}`, 'info');
    }
  };

  return (
    <div className="reminder-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section className="reminder-modal glass-panel" role="dialog" aria-modal="true" aria-label="Nhận thông báo lịch học">
        <header className="reminder-modal-header">
          <strong>🔔 Nhận thông báo lịch học</strong>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Đóng">✕</button>
        </header>

        <div className="reminder-modal-body">
          {!consented ? (
            <>
              <p className="reminder-desc">
                Đăng kí để <strong>bot Discord nhắc lịch học</strong> cho bạn mỗi ngày,
                và <strong>báo ngay khi có người nhắc tới bạn</strong> trong Confession.
              </p>
              <p className="reminder-desc">
                Bấm xác nhận rồi làm tiếp 2 bước dưới là nhận tin luôn.
              </p>
              <label className="reminder-agree">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>Tôi đồng ý nhận thông báo qua Discord (có thể tắt bất cứ lúc nào).</span>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={!agreed || consentMutation.isPending}
                onClick={() => consentMutation.mutate()}
              >
                {consentMutation.isPending ? 'Đang bật...' : 'Xác nhận'}
              </button>
            </>
          ) : !discordLinked ? (
            <>
              <p className="reminder-desc">
                Đang <strong>BẬT</strong>. Còn 2 bước nữa là xong:
              </p>
              <div className="reminder-block">
                <strong className="reminder-block-title">Bước 1 — Vào server Discord</strong>
                {prefs.discord_invite_url ? (
                  <a
                    className="btn btn-primary btn-block"
                    href={prefs.discord_invite_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Vào server nhận tin
                  </a>
                ) : (
                  <p className="reminder-desc">Server nhận tin chưa sẵn sàng, quay lại sau giúp mình nhé.</p>
                )}
              </div>
              <div className="reminder-block">
                <strong className="reminder-block-title">Bước 2 — Nhắn mã cho bot</strong>
                <p className="reminder-desc">
                  Vào server xong bot sẽ tự nhắn chào bạn. Bạn nhắn lại mã này là link xong:
                </p>
                <div className="reminder-code-row">
                  {linkCode?.code ? (
                    <button type="button" className="reminder-code" onClick={copyCode} title="Bấm để copy">
                      {linkCode.code} ⧉
                    </button>
                  ) : (
                    <span className="reminder-desc">Đang lấy mã...</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={codeMutation.isPending}
                    onClick={() => codeMutation.mutate()}
                  >
                    Mã mới
                  </button>
                </div>
                <p className="reminder-desc">Không thấy bot nhắn? Vào server, tìm bot rồi nhắn mã cho bot trước cũng được.</p>
              </div>
            </>
          ) : (
            <>
              {prefs.discord_dm_blocked && (
                <div className="reminder-block reminder-block-warn">
                  <strong className="reminder-block-title">⚠️ Bot chưa nhắn được cho bạn</strong>
                  <p className="reminder-desc">
                    Discord đang chặn tin từ bot (2 bên chưa mở kênh với nhau).
                    {prefs.discord_invite_url
                      ? ' Bấm nút dưới để vào server nhận tin (1 click), rồi bấm Thử lại:'
                      : ' Mở Discord, tìm bot rồi nhắn `/trang-thai` 1 lần để mở kênh, rồi bấm Thử lại:'}
                  </p>
                  <div className="reminder-code-row">
                    {prefs.discord_invite_url && (
                      <a
                        className="btn btn-primary"
                        href={prefs.discord_invite_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Vào server nhận tin
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={testMutation.isPending}
                      onClick={() => testMutation.mutate()}
                    >
                      {testMutation.isPending ? 'Đang gửi...' : 'Thử lại'}
                    </button>
                  </div>
                </div>
              )}
              <div className="reminder-status-card">
                <span className="reminder-status-avatar" aria-hidden="true">✓</span>
                <div className="reminder-status-copy">
                  <strong>Đã kết nối Discord{prefs.discord_username ? ` · ${prefs.discord_username}` : ''}</strong>
                  <span>Bot đã sẵn sàng để gửi thông báo 🎉</span>
                </div>
              </div>
              <p className="reminder-desc">
                Sáng bot gửi lịch hôm nay, trưa nhắc buổi chiều, tối nhắc ngủ sớm nếu mai có học.
                Ai nhắc tới bạn trong Confession là báo về đây ngay.
              </p>
              <div className="reminder-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={unlinkMutation.isPending}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: 'Đổi tài khoản Discord?',
                      message: 'Gỡ liên kết hiện tại để link nick khác. Lịch đã lưu giữ nguyên.',
                      confirmText: 'Gỡ liên kết'
                    });
                    if (ok) unlinkMutation.mutate();
                  }}
                >
                  {unlinkMutation.isPending ? 'Đang gỡ...' : 'Đổi tài khoản'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={revokeMutation.isPending}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: 'Tắt nhận thông báo?',
                      message: 'Bot sẽ ngừng nhắc lịch và xóa lịch đã lưu của bạn.',
                      confirmText: 'Tắt thông báo',
                      danger: true
                    });
                    if (ok) revokeMutation.mutate();
                  }}
                >
                  {revokeMutation.isPending ? 'Đang tắt...' : 'Tắt thông báo'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
      {confirmUI}
    </div>
  );
}
