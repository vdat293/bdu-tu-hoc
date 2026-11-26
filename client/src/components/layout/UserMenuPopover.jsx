import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { getMyIdentityPresentation } from '../../api/identity.js';
import { AvatarContent, getIdentityName } from '../identity/Identity.jsx';
import ReminderSettings from '../notifications/ReminderSettings.jsx';
import { trackAction } from '../../services/telemetry.js';
import './UserMenuPopover.css';

export default function UserMenuPopover({
  onOpenPalette,
  open: controlledOpen,
  onOpenChange,
  onSettingsNavigate
}) {
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const wrapRef = useRef(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const openRef = useRef(open);
  openRef.current = open;

  const setOpen = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(openRef.current) : updater;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);

  const presentationQuery = useQuery({
    queryKey: ['identity-presentation', auth.user?.mssv],
    queryFn: ({ signal }) => getMyIdentityPresentation(auth.token, { signal }),
    enabled: auth.status === 'authenticated' && Boolean(auth.token),
    staleTime: 5 * 60 * 1000
  });

  const presentation = presentationQuery.data;
  const displayName = getIdentityName(auth.user, presentation);
  const shortName = displayName.split(/\s+/).slice(-2).join(' ') || 'Sinh viên';
  const mssv = auth.user?.mssv || '---';

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, setOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (event.target?.closest?.('[data-ui-tour-root="true"]')) return;
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const goTo = (path, label) => {
    setOpen(false);
    trackAction('user_menu_navigate', { label, metadata: { to: path } });
    navigate(path);
  };

  const handleCopyMssv = async () => {
    if (!auth.user?.mssv) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(auth.user.mssv);
        notify('Đã sao chép MSSV.', 'success');
      } else {
        notify(`MSSV của bạn: ${auth.user.mssv}`, 'info');
      }
    } catch {
      notify(`MSSV của bạn: ${auth.user.mssv}`, 'info');
    }
  };

  const handleOpenReminders = () => {
    setOpen(false);
    setShowReminders(true);
  };

  const handleOpenSearch = () => {
    setOpen(false);
    onOpenPalette?.();
  };

  const handleTriggerClick = () => {
    setOpen((current) => !current);
  };

  const handleSettingsClick = () => {
    onSettingsNavigate?.();
    goTo('/setting', 'Mở trang Cài đặt');
  };

  const handleLogout = () => {
    setOpen(false);
    trackAction('auth_logout', { label: 'Đăng xuất tài khoản', featureId: 'portal' });
    auth.logout({ message: 'Đã đăng xuất tài khoản.' });
  };

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        data-tour="user-menu-trigger"
        className="btn btn-primary topbar-user-btn user-menu-trigger"
        onClick={handleTriggerClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Mở menu tài khoản, Xin chào ${shortName}`}
        title="Cài đặt & tiện ích nhanh"
      >
        <span className="topbar-user-avatar" aria-hidden="true">
          <AvatarContent user={auth.user} presentation={presentation} />
        </span>
        <span className="topbar-user-greeting">Xin chào, {shortName}!</span>
        <svg
          className={`topbar-user-chevron${open ? ' is-open' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <section className="user-menu-panel glass-panel" role="dialog" aria-label="Menu tài khoản">
          <header className="user-menu-header">
            <span className="user-menu-avatar-lg" aria-hidden="true">
              <AvatarContent user={auth.user} presentation={presentation} />
            </span>
            <div className="user-menu-identity">
              <strong className="user-menu-name">{displayName}</strong>
              <div className="user-menu-mssv-row">
                <span className="user-menu-mssv">MSSV: {mssv}</span>
                {auth.user?.mssv && (
                  <button
                    type="button"
                    className="user-menu-copy"
                    onClick={handleCopyMssv}
                    aria-label="Sao chép MSSV"
                  >
                    Sao chép
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="user-menu-section">
            <button
              type="button"
              data-tour="user-menu-settings"
              className="user-menu-item user-menu-item-primary"
              onClick={handleSettingsClick}
            >
              <span className="user-menu-item-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </span>
              <span className="user-menu-item-copy">
                <strong>Cài đặt</strong>
                <small>Giao diện, sáng tối, nhắc lịch học</small>
              </span>
            </button>
          </div>

          <div className="user-menu-section">
            <div className="user-menu-section-label">Tiện ích nhanh</div>
            <button type="button" className="user-menu-item" onClick={() => goTo('/info', 'Mở Lý lịch sinh viên')}>
              <span className="user-menu-item-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span className="user-menu-item-copy">
                <strong>Lý lịch sinh viên</strong>
              </span>
            </button>

            <button type="button" className="user-menu-item" onClick={() => goTo('/schedule', 'Mở Thời khóa biểu')}>
              <span className="user-menu-item-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className="user-menu-item-copy">
                <strong>Thời khóa biểu</strong>
              </span>
            </button>

            <button type="button" className="user-menu-item" onClick={handleOpenReminders}>
              <span className="user-menu-item-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </span>
              <span className="user-menu-item-copy">
                <strong>Nhắc lịch học</strong>
              </span>
            </button>

            <button type="button" className="user-menu-item" onClick={handleOpenSearch}>
              <span className="user-menu-item-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <span className="user-menu-item-copy">
                <strong>Tìm nhanh</strong>
              </span>
              <kbd className="user-menu-kbd">Ctrl K</kbd>
            </button>
          </div>

          <footer className="user-menu-footer">
            <button type="button" className="user-menu-logout" onClick={handleLogout}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              <span>Đăng xuất</span>
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
