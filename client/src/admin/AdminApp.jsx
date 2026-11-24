import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasAdminCredentials,
  readAdminAuth,
  setUnauthorizedHandler
} from './api/adminApi.js';
import { Icons } from './components/Icons.jsx';
import { ToastRegion } from './components/StateBlocks.jsx';
import AuthGateModal from './components/AuthGateModal.jsx';
import StudentJourneyDrawer from './components/StudentJourneyDrawer.jsx';
import LogDetailModal from './components/LogDetailModal.jsx';
import PurgeModal from './components/PurgeModal.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import LiveInteractionsPage from './pages/LiveInteractionsPage.jsx';
import AutomationToolsPage from './pages/AutomationToolsPage.jsx';
import FlowsInsightsPage from './pages/FlowsInsightsPage.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import LogsQualityPage from './pages/LogsQualityPage.jsx';
import VpsMonitorPage from './pages/VpsMonitorPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';

const NAV_GROUPS = [
  {
    title: 'PHÂN TÍCH & TƯƠNG TÁC',
    items: [
      { id: 'overview', label: 'Tổng Quan', Icon: Icons.overview, subtitle: 'Bức tranh toàn cảnh lưu lượng & tương tác thực tế' },
      { id: 'live', label: 'Tương Tác Trực Tiếp', Icon: Icons.activity, subtitle: 'Ai đang online, xem trang nào và bấm nút gì nhiều nhất' },
      { id: 'tools', label: 'Công Cụ Tự Động', Icon: Icons.wrench, subtitle: 'Phân biệt rõ người dùng thật sự chạy công cụ hay chỉ bấm vào xem' },
      { id: 'flows', label: 'Hành Trình & Xu Hướng', Icon: Icons.route, subtitle: 'Luồng di chuyển trên web, khung giờ cao điểm & thiết bị' },
      { id: 'students', label: 'Sinh Viên', Icon: Icons.users, subtitle: 'Danh sách sinh viên và chi tiết hành trình từng người' }
    ]
  },
  {
    title: 'VẬN HÀNH & KỸ THUẬT',
    items: [
      { id: 'logs', label: 'Nhật Ký & Hiệu Năng', Icon: Icons.list, subtitle: 'Độ trễ p95 theo tính năng và nhật ký HTTP đã dịch nghĩa' },
      { id: 'vps', label: 'VPS & Tài Nguyên', Icon: Icons.cpu, subtitle: 'Giám sát RAM, Swap, CPU, ổ đĩa, Docker containers, V8 Heap và PostgreSQL' },
      { id: 'operations', label: 'Hệ Thống & Vận Hành', Icon: Icons.server, subtitle: 'Khóa bảo trì, đồng bộ BXH, ODP và TTCDS phân quyền' }
    ]
  }
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items);
const TIME_RANGES = ['1h', '6h', '24h', '7d', '30d', 'all'];
const DEFAULT_THEME = 'light';

export default function AdminApp() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState('24h');
  const [refreshMs, setRefreshMs] = useState(15000);
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return DEFAULT_THEME;
    return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [authModal, setAuthModal] = useState(() => ({
    open: !hasAdminCredentials(),
    dismissible: false
  }));
  const [authLabel, setAuthLabel] = useState(() => {
    const auth = readAdminAuth();
    return auth.adminKey || auth.token ? (auth.label || 'Quản trị viên') : 'Chưa xác thực';
  });

  const [journeyMssv, setJourneyMssv] = useState('');
  const [inspectedLog, setInspectedLog] = useState(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [liveFeatureFilter, setLiveFeatureFilter] = useState('all');
  const [toolsFilterId, setToolsFilterId] = useState('all');
  const [logsMssvFilter, setLogsMssvFilter] = useState('');
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((cur) => [...cur, { id, message, type }].slice(-4));
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme || DEFAULT_THEME);
  }, [theme]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthModal({ open: true, dismissible: false });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const currentTabMeta = ALL_TABS.find((t) => t.id === activeTab) || ALL_TABS[0];

  const handleManualRefresh = () => {
    queryClient.invalidateQueries();
    showToast('Đã làm mới dữ liệu!', 'info');
  };

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    setSidebarOpen(false);
  };

  const handleFilterLogsByStudent = (mssv) => {
    setLogsMssvFilter(mssv);
    setActiveTab('logs');
    showToast(`Đang lọc nhật ký của ${mssv}`, 'info');
  };

  const handleSelectFeatureFromOverview = (featureId) => {
    setLiveFeatureFilter(featureId || 'all');
    setActiveTab('live');
  };

  const handleOpenToolDetail = (toolId) => {
    setToolsFilterId(toolId || 'all');
    setActiveTab('tools');
  };

  return (
    <div id="admin-app" className="admin-layout">
      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Đóng menu điều hướng"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className={`admin-sidebar${sidebarOpen ? ' open' : ''}`} id="admin-sidebar">
        <div className="sidebar-brand">
          <div className="brand-badge">
            <Icons.zap size={22} />
          </div>
          <div className="brand-text">
            <span className="brand-title">BDU ADMIN</span>
            <span className="brand-sub">Product & Ops Monitor</span>
          </div>
        </div>

        <nav className="sidebar-menu" aria-label="Điều hướng bảng điều khiển">
          {NAV_GROUPS.map((group) => (
            <div className="menu-group" key={group.title}>
              <div className="menu-label">{group.title}</div>
              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-btn${isActive ? ' active' : ''}`}
                    data-tab={item.id}
                    onClick={() => handleSelectTab(item.id)}
                  >
                    <item.Icon size={18} className="nav-icon" />
                    <span className="nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="menu-group menu-group--links">
            <div className="menu-label">CÔNG CỤ KHÁC</div>
            <a href="/admin-tool" className="nav-btn nav-link-external">
              <Icons.crown size={18} className="nav-icon" />
              <span className="nav-label">Quản lý Khung & Danh hiệu</span>
              <Icons.external size={14} />
            </a>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="server-status-pill">
            <span className="status-dot" />
            <span className="status-text">VPS Online</span>
          </div>
          <div className="admin-auth-info">
            <span id="display-auth-status">
              {hasAdminCredentials() ? (
                <>
                  <Icons.crown size={14} />
                  <span>{authLabel}</span>
                </>
              ) : (
                'Chưa xác thực'
              )}
            </span>
            <button
              type="button"
              className="btn-change-key"
              id="btn-open-auth-modal"
              onClick={() => setAuthModal({ open: true, dismissible: true })}
            >
              Đổi khóa
            </button>
          </div>
        </div>
      </aside>

      <div className="admin-main-wrapper">
        <header className="admin-topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn btn-sidebar-toggle"
              id="btn-toggle-sidebar"
              aria-label="Mở menu điều hướng"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <Icons.menu size={20} />
            </button>
            <div className="topbar-title-block">
              <h1 className="page-title" id="page-title">{currentTabMeta.label}</h1>
              <p className="page-subtitle">{currentTabMeta.subtitle}</p>
            </div>
          </div>

          <div className="topbar-right">
            <div className="time-range-group" id="time-range-group" role="group" aria-label="Chọn mốc thời gian">
              {TIME_RANGES.map((range) => {
                const active = timeRange === range;
                return (
                  <button
                    key={range}
                    type="button"
                    className={`range-pill${active ? ' active' : ''}`}
                    data-range={range}
                    aria-pressed={active}
                    onClick={() => setTimeRange(range)}
                  >
                    {range.toUpperCase()}
                  </button>
                );
              })}
            </div>

            <div className="refresh-selector">
              <span className="refresh-label">Tự làm mới:</span>
              <select
                id="select-refresh-rate"
                className="admin-select"
                value={refreshMs}
                onChange={(e) => setRefreshMs(Number(e.target.value))}
                aria-label="Chu kỳ tự làm mới"
              >
                <option value={0}>Tắt</option>
                <option value={5000}>5 giây</option>
                <option value={15000}>15 giây</option>
                <option value={30000}>30 giây</option>
                <option value={60000}>1 phút</option>
              </select>
            </div>

            <button
              type="button"
              className="icon-btn btn-refresh"
              id="btn-manual-refresh"
              onClick={handleManualRefresh}
              title="Làm mới tức thì"
            >
              <Icons.refresh size={16} />
              <span>Làm Mới</span>
            </button>

            <button
              type="button"
              className="icon-btn btn-theme-toggle"
              id="btn-theme-toggle"
              onClick={() => setTheme((cur) => (cur === 'dark' ? 'light' : 'dark'))}
              title="Đổi giao diện Sáng/Tối"
              aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            >
              {theme === 'dark' ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
            </button>
          </div>
        </header>

        <main className="admin-content" id="admin-content">
          {activeTab === 'overview' ? (
            <OverviewPage
              timeRange={timeRange}
              refreshMs={refreshMs}
              theme={theme}
              onOpenJourney={setJourneyMssv}
              onNavigateTab={handleSelectTab}
              onSelectFeature={handleSelectFeatureFromOverview}
              onOpenToolDetail={handleOpenToolDetail}
            />
          ) : null}

          {activeTab === 'live' ? (
            <LiveInteractionsPage
              timeRange={timeRange}
              refreshMs={refreshMs}
              initialFeatureId={liveFeatureFilter}
              onClearInitialFeature={() => setLiveFeatureFilter('all')}
              onOpenJourney={setJourneyMssv}
            />
          ) : null}

          {activeTab === 'tools' ? (
            <AutomationToolsPage
              timeRange={timeRange}
              refreshMs={refreshMs}
              initialToolId={toolsFilterId}
              onClearInitialTool={() => setToolsFilterId('all')}
              onOpenJourney={setJourneyMssv}
            />
          ) : null}

          {activeTab === 'flows' ? (
            <FlowsInsightsPage
              timeRange={timeRange}
              refreshMs={refreshMs}
              theme={theme}
            />
          ) : null}

          {activeTab === 'students' ? (
            <StudentsPage
              refreshMs={refreshMs}
              onOpenJourney={setJourneyMssv}
              onFilterLogs={handleFilterLogsByStudent}
            />
          ) : null}

          {activeTab === 'logs' ? (
            <LogsQualityPage
              timeRange={timeRange}
              refreshMs={refreshMs}
              initialMssvFilter={logsMssvFilter}
              onClearMssvFilter={() => setLogsMssvFilter('')}
              onOpenJourney={setJourneyMssv}
              onInspectLog={setInspectedLog}
            />
          ) : null}

          {activeTab === 'vps' ? (
            <VpsMonitorPage
              refreshMs={refreshMs}
              theme={theme}
              onOpenPurge={() => setPurgeOpen(true)}
              showToast={showToast}
            />
          ) : null}

          {activeTab === 'operations' ? (
            <OperationsPage
              refreshMs={refreshMs}
              onOpenPurge={() => setPurgeOpen(true)}
              onOpenVpsTab={() => handleSelectTab('vps')}
              showToast={showToast}
            />
          ) : null}
        </main>
      </div>

      <StudentJourneyDrawer
        mssv={journeyMssv}
        timeRange={timeRange}
        onClose={() => setJourneyMssv('')}
        onFilterLogs={handleFilterLogsByStudent}
      />

      <LogDetailModal
        log={inspectedLog}
        onClose={() => setInspectedLog(null)}
        onInspectStudent={setJourneyMssv}
      />

      <PurgeModal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onPurged={() => queryClient.invalidateQueries()}
        showToast={showToast}
      />

      <AuthGateModal
        open={authModal.open}
        dismissible={authModal.dismissible}
        onClose={() => setAuthModal({ open: false, dismissible: false })}
        onSuccess={(res) => {
          const nextLabel = res?.name || res?.mssv || 'Quản trị viên';
          setAuthLabel(nextLabel);
          setAuthModal({ open: false, dismissible: false });
          queryClient.invalidateQueries();
          showToast(`Đã xác thực quản trị viên (${nextLabel}) thành công!`, 'success');
        }}
      />

      <ToastRegion toasts={toasts} />
    </div>
  );
}
