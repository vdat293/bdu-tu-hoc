import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { navigation, findRouteMeta, filterNavigation } from '../app/navigation.js';
import { useAppearance } from '../app/appearance.jsx';
import { useAuth } from '../app/providers.jsx';
import { getMyIdentityPresentation } from '../api/identity.js';
import { useTtcdsCapabilities } from '../features/ttcds/useTtcdsCapabilities.jsx';
import MaintenanceGate from '../app/MaintenanceGate.jsx';
import NotificationBell from '../components/notifications/NotificationBell.jsx';
import UserMenuPopover from '../components/layout/UserMenuPopover.jsx';
import UiOnboardingTour from '../components/layout/UiOnboardingTour.jsx';
import { AvatarContent } from '../components/identity/Identity.jsx';
import { loadConfessionPage, prefetchConfession } from '../app/confession-preload.js';
import { isChunkLoadError, reloadForStaleChunk } from '../app/chunk-recovery.js';
import { trackAction } from '../services/telemetry.js';

const navGroupsFor = (items) => [
  { title: 'CỔNG SINH VIÊN', items: items.filter((i) => i.section !== 'ttcds').slice(0, 4) },
  { title: 'BỘ CÔNG CỤ TỰ ĐỘNG', items: items.filter((i) => i.section !== 'ttcds').slice(4, 9) },
  { title: 'GÓC TỰ HỌC SỐ', items: items.filter((i) => i.section !== 'ttcds').slice(9) },
  { title: 'TRUNG TÂM CHUYỂN ĐỔI SỐ', items: items.filter((i) => i.section === 'ttcds' && !i.hideInSidebar) }
];

const badges = {
  '/wordfmt': ['Pro', 'badge-pill-emerald'],
  '/survey': ['Bot', 'badge-pill-purple'],
  '/training-score': ['RL', 'badge-pill-amber'],
  '/english': ['Moodle', 'badge-pill-emerald'],
  '/enrollment': ['Auto', 'badge-pill-purple'],
  '/clans': ['Guild', 'badge-pill-emerald'],
  '/confession': ['CFS', 'badge-pill-purple'],
  '/killer-sudoku': ['Game', 'badge-pill-emerald'],
  '/mystudent': ['TTCDS', 'badge-pill-emerald']
};

const EXTRA_PALETTE_ITEMS = [
  { path: '/setting', label: 'Cài đặt', icon: '⚙', keywords: 'cài đặt setting giao diện claymorphism neo-brutalism avatar khung danh hiệu vfx' }
];

function CommandPalette({ open, onClose, itemsProp }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const allItems = [...(itemsProp || navigation), ...EXTRA_PALETTE_ITEMS];
  const items = allItems.filter((item) =>
    `${item.label} ${item.keywords}`.toLocaleLowerCase('vi-VN').includes(query.toLocaleLowerCase('vi-VN'))
  );

  const go = (path, label) => {
    trackAction('command_palette_navigate', {
      label: label ? `Tìm nhanh: ${label}` : `Mở nhanh ${path}`,
      metadata: { to: path }
    });
    navigate(path);
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Tìm trang" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm trang hoặc chức năng…"
          aria-label="Tìm trang"
        />
        <div className="palette-results">
          {items.length ? (
            items.map((item) => (
              <button type="button" key={item.path} onClick={() => go(item.path, item.label)}>
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-text">{item.label}</span>
                <kbd>Enter</kbd>
              </button>
            ))
          ) : (
            <p>Không tìm thấy trang phù hợp.</p>
          )}
        </div>
        <small>Esc để đóng · Ctrl/Cmd + K để mở</small>
      </section>
    </div>
  );
}

class AppErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (isChunkLoadError(error)) {
      reloadForStaleChunk();
    }
  }
  render() {
    if (this.state.error) {
      const stale = isChunkLoadError(this.state.error);
      return (
        <div className="card glass-panel" style={{ padding: '30px', margin: '30px auto', maxWidth: '600px', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--color-rose)', marginBottom: '10px' }}>
            {stale ? 'Ứng dụng vừa được cập nhật' : 'Trang gặp lỗi'}
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            {stale
              ? 'Tab đang dùng phiên bản cũ. Hãy tải lại trang để nhận bản giao diện và tính năng mới nhất.'
              : (this.state.error.message || 'Có lỗi không xác định.')}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mainRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsClickTick, setSettingsClickTick] = useState(0);
  const { theme, toggleTheme: toggleAppearanceTheme } = useAppearance();
  const meta = useMemo(() => findRouteMeta(location.pathname), [location.pathname]);
  const capsQuery = useTtcdsCapabilities();
  const presentationQuery = useQuery({
    queryKey: ['identity-presentation', auth.user?.mssv],
    queryFn: ({ signal }) => getMyIdentityPresentation(auth.token, { signal }),
    enabled: auth.status === 'authenticated' && Boolean(auth.token),
    staleTime: 5 * 60 * 1000
  });
  const visibleNavigation = useMemo(() => filterNavigation(navigation, capsQuery.data), [capsQuery.data]);
  const navGroups = useMemo(() => navGroupsFor(visibleNavigation), [visibleNavigation]);

  // Chỉ nạp dữ liệu khi có ý định mở trang (hover/focus/chạm). Người không dùng
  // Confession không phát sinh request feed; ai sắp mở thì vào là có nội dung.
  const preloadConfession = useCallback(() => {
    if (auth.status !== 'authenticated' || !auth.token) return;
    prefetchConfession(queryClient, {
      token: auth.token,
      mssv: auth.user?.mssv,
      idsv: auth.user?.idsv,
      photoUrl: auth.user?.photoUrl || auth.user?.photo_url || auth.user?.avatar_url || auth.user?.student_image || auth.user?.image
    });
  }, [auth.status, auth.token, auth.user?.idsv, auth.user?.mssv, auth.user?.photoUrl, auth.user?.photo_url, auth.user?.avatar_url, auth.user?.student_image, auth.user?.image, queryClient]);

  // Chunk JS nhẹ nên nạp lúc rảnh để lần điều hướng đầu tiên không phải chờ tải.
  useEffect(() => {
    if (auth.status !== 'authenticated') return undefined;
    const preload = () => { loadConfessionPage().catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timer);
  }, [auth.status]);

  useEffect(() => {
    document.title = `${meta.title} · BDU Tự Học`;
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, behavior: 'auto' });
    setSidebarOpen(false);
  }, [location.key, meta.title]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    return () => {
      document.body.classList.remove('sidebar-open');
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    trackAction('theme_toggle', { label: next === 'dark' ? 'Bật giao diện tối' : 'Bật giao diện sáng' });
    toggleAppearanceTheme();
  };

  const displayName = auth.user?.name || 'Sinh viên';

  return (
    <div className="app-layout">
      {/* Background Glow FX */}
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>
      <div className="bg-glow bg-glow-3"></div>

      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar Navigation */}
      <aside className={`sidebar glass-panel ${sidebarOpen ? 'open' : ''}`} aria-label="Điều hướng chính">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-logo">
              <img src="/assets/images/logo-hao-quang-transparent.png" alt="Logo Đại học Bình Dương" />
            </div>
            <div className="brand-meta">
              <span className="brand-title">Bình Dương University</span>
              <span className="brand-subtitle">Student Academic Portal</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon sidebar-close-btn mobile-only"
            onClick={() => setSidebarOpen(false)}
            title="Đóng menu"
            aria-label="Đóng menu điều hướng"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav id="primary-navigation" className="sidebar-nav">
          <button
            type="button"
            className="sidebar-mobile-search mobile-only"
            onClick={() => {
              setSidebarOpen(false);
              setPaletteOpen(true);
            }}
            aria-label="Tìm nhanh trang hoặc chức năng"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Tìm nhanh trang…</span>
          </button>
          {navGroups.filter((group) => group.items.length > 0).map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item, index) => {
                const badge = badges[item.path];
                const itemNumber = String(
                  navGroups.slice(0, navGroups.indexOf(group)).reduce((sum, g) => sum + g.items.length, 0) + index + 1
                ).padStart(2, '0');

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onMouseEnter={item.path === '/confession' ? preloadConfession : undefined}
                    onFocus={item.path === '/confession' ? preloadConfession : undefined}
                    onTouchStart={item.path === '/confession' ? preloadConfession : undefined}
                    className={({ isActive }) =>
                      `nav-item ${isActive || (item.path !== '/gpa' && location.pathname.startsWith(`${item.path}/`)) ? 'active' : ''}`
                    }
                  >
                    <span className="nav-icon">{itemNumber}</span>
                    <span className="nav-text">{item.label}</span>
                    {badge && <span className={`badge-mini ${badge[1]}`}>{badge[0]}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile-pill" onClick={() => navigate('/info')} style={{ cursor: 'pointer' }}>
            <div id="user-avatar" className="avatar-circle">
              <AvatarContent user={auth.user} presentation={presentationQuery.data} />
            </div>
            <div className="user-details">
              <span id="nav-user-name" className="user-fullname">{displayName}</span>
              <span id="nav-user-mssv" className="user-mssv-text">MSSV: {auth.user?.mssv || '---'}</span>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button
              type="button"
              id="btn-sidebar-settings"
              className="btn-icon btn-sidebar-settings"
              onClick={() => navigate('/setting')}
              title="Cài đặt"
              aria-label="Cài đặt"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>
            <button
              id="btn-logout"
              className="btn-logout"
              onClick={() => {
                trackAction('auth_logout', { label: 'Đăng xuất tài khoản', featureId: 'portal' });
                auth.logout({ message: 'Đã đăng xuất tài khoản.' });
              }}
              title="Đăng xuất"
              aria-label="Đăng xuất"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main App Content */}
      <div className="main-content-wrapper">
        {/* Topbar Header */}
        <header className="topbar glass-panel">
          <div className="topbar-left">
            <button
              id="btn-toggle-sidebar"
              className="btn-icon mobile-only"
              title="Menu"
              aria-label="Mở menu điều hướng"
              aria-controls="primary-navigation"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            </button>
            <img className="topbar-wordmark" src="/assets/images/logo-bdu-eng.png" alt="Binh Duong University" />
            <div className="page-title-group">
              <h2 id="topbar-page-title" className="topbar-title">{meta.title}</h2>
              <span className="topbar-badge">Academic services · Binh Duong University</span>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="system-status-pill">
              <span className="status-dot-green"></span> HỆ THỐNG SẴN SÀNG
            </span>

            <button type="button" className="topbar-search-trigger" onClick={() => setPaletteOpen(true)} title="Tìm kiếm nhanh" aria-label="Tìm kiếm nhanh">
              <span>Tìm nhanh...</span>
              <kbd>Ctrl K</kbd>
            </button>

            {auth.status === 'authenticated' && <NotificationBell />}

            {auth.status === 'authenticated' && (
              <UserMenuPopover
                onOpenPalette={() => setPaletteOpen(true)}
                open={userMenuOpen}
                onOpenChange={setUserMenuOpen}
                onSettingsNavigate={() => setSettingsClickTick((n) => n + 1)}
              />
            )}

            <button
              id="btn-theme-toggle"
              className="btn-icon"
              onClick={toggleTheme}
              title="Chuyển đổi giao diện Sáng / Tối"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" /><path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" /><path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main id="main-content" ref={mainRef} tabIndex={-1} className={`dashboard-body${location.pathname === '/survey' ? ' dashboard-body-survey' : ''}`}>
          <AppErrorBoundary>
            {/* Màn bảo trì bọc quanh <Outlet/> (không phải quanh cả App) nên khi nhóm
                của trang đang bị khoá thì chỉ vùng nội dung bị thay: sidebar và
                topbar vẫn sống để người dùng chuyển sang nhóm khác, và màn hình lỗi
                của trang vẫn được bắt bởi AppErrorBoundary. */}
            <MaintenanceGate>
              <Outlet />
            </MaintenanceGate>
          </AppErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} itemsProp={visibleNavigation} />
      {auth.status === 'authenticated' && (
        <UiOnboardingTour
          menuOpen={userMenuOpen}
          onSetMenuOpen={setUserMenuOpen}
          settingsClickTick={settingsClickTick}
        />
      )}
    </div>
  );
}
