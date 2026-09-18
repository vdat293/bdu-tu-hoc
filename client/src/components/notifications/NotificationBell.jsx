import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth, useRealtimeStatus, useToasts } from '../../app/providers.jsx';
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead
} from '../../api/notifications.js';
import ReminderSettings from './ReminderSettings.jsx';
import './NotificationBell.css';

function getInitials(name) {
  const parts = String(name || 'SV').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Vừa xong';
  const past = new Date(dateStr);
  if (Number.isNaN(past.getTime())) return 'Vừa xong';
  const diffSec = Math.floor((Date.now() - past.getTime()) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return past.toLocaleDateString('vi-VN');
}

function notificationText(item) {
  const actor = item?.actor_name || (item?.actor_is_anonymous ? 'Người ẩn danh' : 'Ai đó');
  if (item?.type === 'reply') return { bold: actor, rest: ' đã trả lời bình luận của bạn' };
  return { bold: actor, rest: ' đã nhắc tới bạn trong confession' };
}

export default function NotificationBell() {
  const auth = useAuth();
  const token = auth?.token;
  const realtimeStatus = useRealtimeStatus();
  const { notify } = useToasts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const wrapRef = useRef(null);

  const wsFallbackInterval = realtimeStatus === 'ready' ? false : 60_000;

  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => getNotifications(token, { limit: 20, offset: 0, signal }),
    enabled: Boolean(token),
    refetchInterval: wsFallbackInterval,
    staleTime: 30_000
  });

  const unreadQuery = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: ({ signal }) => getUnreadCount(token, { signal }),
    enabled: Boolean(token),
    refetchInterval: wsFallbackInterval,
    staleTime: 30_000
  });

  const items = Array.isArray(listQuery.data) ? listQuery.data : [];
  const unread = Number(unreadQuery.data) || 0;

  useEffect(() => {
    const handle = (event) => {
      const message = event?.detail;
      if (message?.type !== 'notification.created') return;
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      const actor = message?.data?.actor_name;
      const isAnon = Boolean(message?.data?.actor_is_anonymous);
      const actorLabel = actor || (isAnon ? 'Người ẩn danh' : '');
      const kind = message?.data?.type;
      if (kind === 'reply') {
        notify(actorLabel ? `${actorLabel} đã trả lời bình luận của bạn` : 'Bạn có trả lời bình luận mới', 'info');
      } else {
        notify(actorLabel ? `${actorLabel} đã nhắc tới bạn trong confession` : 'Bạn được nhắc tới trong confession', 'info');
      }
    };
    window.addEventListener('bdu:realtime', handle);
    return () => window.removeEventListener('bdu:realtime', handle);
  }, [client, notify]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  const markReadMutation = useMutation({
    mutationFn: (id) => markNotificationRead(token, id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
    onError: (error) => notify(error?.message || 'Không thể đánh dấu đã đọc.', 'error')
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(token),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      notify('Đã đánh dấu tất cả là đã đọc.', 'success');
    },
    onError: (error) => notify(error?.message || 'Không thể đánh dấu đã đọc.', 'error')
  });

  const handleItemClick = (item) => {
    if (!item?.is_read && item?.id != null) {
      markReadMutation.mutate(item.id);
    }
    setOpen(false);
    if (item?.post_id != null) {
      const params = new URLSearchParams();
      params.set('postId', String(item.post_id));
      if (item?.comment_id != null) params.set('commentId', String(item.comment_id));
      navigate(`/confession?${params.toString()}`);
    }
  };

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn-icon notif-bell-btn"
        onClick={() => setOpen((current) => !current)}
        aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Thông báo"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="notif-bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <section className="notif-panel glass-panel" role="dialog" aria-label="Thông báo">
          <header className="notif-panel-header">
            <strong>Thông báo</strong>
            <button
              type="button"
              className="notif-mark-all"
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending || unread === 0}
            >
              {markAllMutation.isPending ? 'Đang lưu...' : 'Đánh dấu đã đọc'}
            </button>
          </header>
          <div className="notif-panel-list">
            {listQuery.isLoading ? (
              <p className="notif-empty">Đang tải thông báo...</p>
            ) : items.length === 0 ? (
              <p className="notif-empty">Chưa có thông báo nào.</p>
            ) : (
              items.map((item) => {
                const text = notificationText(item);
                const unreadItem = !item?.is_read;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`notif-item${unreadItem ? ' is-unread' : ''}`}
                    onClick={() => handleItemClick(item)}
                  >
                    <span className="notif-avatar" aria-hidden="true">
                      {item?.actor_is_anonymous ? '?' : getInitials(item?.actor_name)}
                    </span>
                    <span className="notif-copy">
                      <span className="notif-text">
                        <strong>{text.bold}</strong>
                        {text.rest}
                      </span>
                      {item?.post_title && <span className="notif-sub">{item.post_title}</span>}
                      <span className="notif-time">{formatRelativeTime(item?.created_at)}</span>
                    </span>
                    {unreadItem && <span className="notif-dot" aria-hidden="true" />}
                  </button>
                );
              })
            )}
          </div>
          <footer className="notif-panel-footer">
            <button
              type="button"
              className="notif-reminder-btn"
              onClick={() => {
                setOpen(false);
                setShowReminders(true);
              }}
            >
              🔔 Nhận thông báo lịch học
            </button>
          </footer>
        </section>
      )}
      {showReminders && createPortal(
        <ReminderSettings onClose={() => setShowReminders(false)} />,
        document.body
      )}
    </div>
  );
}
