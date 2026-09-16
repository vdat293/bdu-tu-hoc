import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useToasts } from '../../app/providers.jsx';
import {
  fetchDashboardOverview,
  fetchDashboardTimeline,
  fetchDashboardEndpoints,
  fetchDashboardUsers,
  fetchDashboardDevices,
  fetchDashboardLogs,
  fetchDashboardSystem,
  purgeDashboardLogs
} from '../../api/admin-dashboard.js';
import TrafficOverviewCards from './TrafficOverviewCards.jsx';
import TrafficCharts from './TrafficCharts.jsx';
import TopUsersPanel from './TopUsersPanel.jsx';
import DetailedLogsTable from './DetailedLogsTable.jsx';
import SystemHealthCard from './SystemHealthCard.jsx';
import './admin-dashboard.css';

export default function AdminDashboardPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const queryClient = useQueryClient();

  const [timeRange, setTimeRange] = useState('24h');
  const [autoRefreshMs, setAutoRefreshMs] = useState(15000);
  const [adminKey, setAdminKey] = useState(() => {
    return typeof window !== 'undefined' ? window.sessionStorage?.getItem('bdu_admin_key') || '' : '';
  });
  const [keyInput, setKeyInput] = useState('');
  const [isPurging, setIsPurging] = useState(false);

  // Filters for detailed access logs
  const [logFilters, setLogFilters] = useState({
    page: 1,
    limit: 50,
    search: '',
    status: 'all',
    method: 'all',
    mssv: '',
    ip: ''
  });

  const token = auth?.token;

  // Query options
  const queryConfig = {
    refetchInterval: autoRefreshMs > 0 ? autoRefreshMs : false,
    retry: 1
  };

  // 1. Overview Stats
  const {
    data: overview,
    isLoading: isOverviewLoading,
    error: overviewError,
    refetch: refetchOverview
  } = useQuery({
    queryKey: ['admin-overview', timeRange, adminKey],
    queryFn: ({ signal }) => fetchDashboardOverview({ token, adminKey, timeRange, signal }),
    ...queryConfig
  });

  // 2. Timeline
  const {
    data: timeline,
    isLoading: isTimelineLoading,
    refetch: refetchTimeline
  } = useQuery({
    queryKey: ['admin-timeline', timeRange, adminKey],
    queryFn: ({ signal }) => fetchDashboardTimeline({ token, adminKey, timeRange, signal }),
    ...queryConfig
  });

  // 3. Top Endpoints
  const {
    data: endpoints,
    isLoading: isEndpointsLoading,
    refetch: refetchEndpoints
  } = useQuery({
    queryKey: ['admin-endpoints', timeRange, adminKey],
    queryFn: ({ signal }) => fetchDashboardEndpoints({ token, adminKey, timeRange, limit: 10, signal }),
    ...queryConfig
  });

  // 4. Top Users
  const {
    data: users,
    isLoading: isUsersLoading,
    refetch: refetchUsers
  } = useQuery({
    queryKey: ['admin-users', timeRange, adminKey],
    queryFn: ({ signal }) => fetchDashboardUsers({ token, adminKey, timeRange, limit: 10, signal }),
    ...queryConfig
  });

  // 5. Devices
  const {
    data: devices,
    refetch: refetchDevices
  } = useQuery({
    queryKey: ['admin-devices', timeRange, adminKey],
    queryFn: ({ signal }) => fetchDashboardDevices({ token, adminKey, timeRange, signal }),
    ...queryConfig
  });

  // 6. Detailed Logs
  const {
    data: logsData,
    isLoading: isLogsLoading,
    refetch: refetchLogs
  } = useQuery({
    queryKey: ['admin-logs', timeRange, logFilters, adminKey],
    queryFn: ({ signal }) => fetchDashboardLogs({
      token,
      adminKey,
      timeRange,
      ...logFilters,
      signal
    }),
    ...queryConfig
  });

  // 7. System Health
  const {
    data: system,
    refetch: refetchSystem
  } = useQuery({
    queryKey: ['admin-system', adminKey],
    queryFn: ({ signal }) => fetchDashboardSystem({ token, adminKey, signal }),
    refetchInterval: autoRefreshMs > 0 ? Math.max(autoRefreshMs, 10000) : false
  });

  const handleRefreshAll = () => {
    refetchOverview();
    refetchTimeline();
    refetchEndpoints();
    refetchUsers();
    refetchDevices();
    refetchLogs();
    refetchSystem();
    notify('Đã cập nhật dữ liệu mới nhất!', 'info');
  };

  const handleLogFilterChange = useCallback((updatedFilters) => {
    setLogFilters((prev) => ({ ...prev, ...updatedFilters }));
  }, []);

  const handleSelectUser = useCallback((mssv) => {
    setLogFilters((prev) => ({ ...prev, mssv, page: 1 }));
    const el = document.getElementById('detailed-logs-section');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    notify(`Đang lọc nhật ký của MSSV ${mssv}`, 'info');
  }, [notify]);

  const handlePurge = async (olderThanDays) => {
    try {
      setIsPurging(true);
      const res = await purgeDashboardLogs({ token, adminKey, olderThanDays });
      queryClient.invalidateQueries({ queryKey: ['admin-system'] });
      queryClient.invalidateQueries({ queryKey: ['admin-logs'] });
      notify(res.message || 'Dọn dẹp log thành công.', 'success');
      return res;
    } catch (err) {
      notify(err.message || 'Lỗi khi dọn dẹp log.', 'error');
      throw err;
    } finally {
      setIsPurging(false);
    }
  };

  const handleSaveAdminKey = (e) => {
    e.preventDefault();
    const clean = keyInput.trim();
    if (!clean) return;
    window.sessionStorage?.setItem('bdu_admin_key', clean);
    setAdminKey(clean);
    notify('Đã lưu mã khóa Admin Dashboard.', 'success');
  };

  // If unauthorized, prompt for Admin Key
  const isUnauthorized = overviewError && (overviewError.status === 401 || overviewError.status === 403);
  if (isUnauthorized && !adminKey) {
    return (
      <div className="admin-dashboard-page">
        <div className="admin-key-prompt-card">
          <div className="key-prompt-icon">🔐</div>
          <h2 className="key-prompt-title">Khu Vực Quản Trị Hệ Thống</h2>
          <p className="key-prompt-desc">
            Trang Dashboard này yêu cầu tài khoản Quản trị viên (Owner / Admin) hoặc mã truy cập bảo mật được cấu hình trên AWS VPS.
          </p>
          <form className="key-input-form" onSubmit={handleSaveAdminKey}>
            <input
              type="password"
              className="admin-key-input"
              placeholder="Nhập ADMIN_DASHBOARD_KEY..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-submit-key">
              Xác Thực & Truy Cập Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard-page">
      {/* Top Header & Controls */}
      <div className="admin-dashboard-header">
        <div className="dashboard-title-group">
          <h1>Admin Dashboard • Quản Trị Lưu Lượng & Giám Sát VPS</h1>
          <p className="dashboard-subtitle">
            <span className="live-indicator-dot" />
            Giám sát thời gian thực máy chủ BDU Tự Học trên AWS VPS
          </p>
        </div>

        <div className="dashboard-controls">
          {/* Time Range Selector */}
          <div className="control-group">
            {[
              { id: '1h', label: '1 Giờ' },
              { id: '24h', label: '24h' },
              { id: '7d', label: '7 Ngày' },
              { id: '30d', label: '30 Ngày' },
              { id: 'all', label: 'Tất cả' }
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                className={`range-btn ${timeRange === r.id ? 'active' : ''}`}
                onClick={() => setTimeRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Auto-refresh interval */}
          <div className="refresh-select-wrapper">
            <span>Tự làm mới:</span>
            <select
              className="admin-select"
              value={autoRefreshMs}
              onChange={(e) => setAutoRefreshMs(Number(e.target.value))}
            >
              <option value="0">Tắt</option>
              <option value="5000">5 giây</option>
              <option value="15000">15 giây</option>
              <option value="30000">30 giây</option>
              <option value="60000">1 phút</option>
            </select>
          </div>

          {/* Manual Refresh Button */}
          <button
            type="button"
            className="btn-manual-refresh"
            onClick={handleRefreshAll}
            title="Làm mới tất cả số liệu ngay lập tức"
          >
            ↻ Làm Mới
          </button>
        </div>
      </div>

      {/* 1. KPI Cards */}
      <TrafficOverviewCards
        overview={overview}
        isLoading={isOverviewLoading}
      />

      {/* 2. System Health & AWS VPS Metrics */}
      <SystemHealthCard
        system={system}
        onPurgeLogs={handlePurge}
        isPurging={isPurging}
      />

      {/* 3. Interactive Traffic Charts */}
      <TrafficCharts
        timeline={timeline}
        endpoints={endpoints}
        devices={devices}
        isLoading={isTimelineLoading || isEndpointsLoading}
      />

      {/* 4. Top Active Students */}
      <TopUsersPanel
        users={users}
        onSelectUser={handleSelectUser}
        isLoading={isUsersLoading}
      />

      {/* 5. Detailed Access Logs Table */}
      <DetailedLogsTable
        logsData={logsData}
        filters={logFilters}
        onFilterChange={handleLogFilterChange}
        isLoading={isLogsLoading}
      />
    </div>
  );
}
