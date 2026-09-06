import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { navigation, findRouteMeta } from '../app/navigation.js';
import { useAuth } from '../app/providers.jsx';

const navGroups = [
  { title: 'CỔNG SINH VIÊN', items: navigation.slice(0, 4) },
  { title: 'BỘ CÔNG CỤ TỰ ĐỘNG', items: navigation.slice(4, 8) },
  { title: 'GÓC TỰ HỌC SỐ', items: navigation.slice(8) }
];

const badges = {
  '/wordfmt': ['Pro', 'badge-pill-emerald'],
  '/survey': ['Bot', 'badge-pill-purple'],
  '/english': ['Moodle', 'badge-pill-emerald'],
  '/enrollment': ['Soon', 'badge-pill-amber'],
  '/clans': ['Guild', 'badge-pill-emerald'],
  '/confession': ['CFS', 'badge-pill-purple']
};

function getInitials(name) {
  const parts = String(name || 'SV').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function CommandPalette({ open, onClose }) {
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

  const items = navigation.filter((item) =>
    `${item.label} ${item.keywords}`.toLocaleLowerCase('vi-VN').includes(query.toLocaleLowerCase('vi-VN'))
  );

  const go = (path) => {
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
              <button type="button" key={item.path} onClick={() => go(item.path)}>
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
  render() {
    if (this.state.error) {
      return (
        <div className="card glass-panel" style={{ padding: '30px', margin: '30px auto', maxWidth: '600px', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--color-rose)', marginBottom: '10px' }}>Trang gặp lỗi</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{this.state.error.message || 'Có lỗi không xác định.'}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
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
  const mainRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('bdu_theme') || 'light');
  const meta = useMemo(() => findRouteMeta(location.pathname), [location.pathname]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('bdu_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${meta.title} · BDU Tự Học`;
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setSidebarOpen(false);
  }, [location.key, meta.title]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  const displayName = auth.user?.name || 'Sinh viên';
  const shortName = displayName.split(/\s+/).slice(-2).join(' ');

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
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
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
              {getInitials(displayName)}
            </div>
            <div className="user-details">
              <span id="nav-user-name" className="user-fullname">{displayName}</span>
              <span id="nav-user-mssv" className="user-mssv-text">MSSV: {auth.user?.mssv || '---'}</span>
            </div>
          </div>
          <button
            id="btn-logout"
            className="btn-logout"
            onClick={() => auth.logout({ message: 'Đã đăng xuất tài khoản.' })}
            title="Đăng xuất"
            aria-label="Đăng xuất"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
          </button>
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
              onClick={() => setSidebarOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

            <button type="button" className="topbar-search-trigger" onClick={() => setPaletteOpen(true)} title="Tìm kiếm nhanh">
              <span>Tìm nhanh...</span>
              <kbd>Ctrl K</kbd>
            </button>

            <button
              type="button"
              className="btn btn-primary topbar-user-btn"
              onClick={() => navigate('/info')}
              title="Xem thông tin sinh viên"
            >
              Xin chào, {shortName}!
            </button>

            <button
              id="btn-theme-toggle"
              className="btn-icon"
              onClick={toggleTheme}
              title="Chuyển đổi giao diện Sáng / Tối"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" /><path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" /><path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main id="main-content" ref={mainRef} tabIndex={-1} className="dashboard-body">
          <AppErrorBoundary>
            <Outlet />
          </AppErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
