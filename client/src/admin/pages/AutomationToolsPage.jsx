import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  labelForTimeRange,
  safeNumber
} from '../utils/format.js';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

const STATUS_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'used', label: 'Đã sử dụng thật' },
  { id: 'tried', label: 'Mới chuẩn bị / thử' },
  { id: 'viewed_only', label: 'Chỉ vào xem' }
];

function badgeClassForStatus(status) {
  if (status === 'used') return 'tool-status-badge tool-status-badge--used';
  if (status === 'tried') return 'tool-status-badge tool-status-badge--tried';
  return 'tool-status-badge tool-status-badge--viewed';
}

export default function AutomationToolsPage({
  timeRange,
  refreshMs,
  initialToolId = 'all',
  onClearInitialTool,
  onOpenJourney
}) {
  const [toolId, setToolId] = useState(initialToolId || 'all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (initialToolId) setToolId(initialToolId);
  }, [initialToolId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const pollMs = refreshMs > 0 ? refreshMs : false;

  const toolsQuery = useQuery({
    queryKey: ['admin-automation-tools', timeRange, toolId, status, debouncedSearch],
    queryFn: ({ signal }) => AdminApi.getAutomationTools({
      timeRange,
      toolId,
      status,
      search: debouncedSearch,
      limit: 80
    }, signal),
    refetchInterval: pollMs
  });

  const data = toolsQuery.data;
  const totals = data?.totals || {
    visitedUsers: 0,
    usedUsers: 0,
    triedUsers: 0,
    viewedOnlyUsers: 0,
    conversionRate: 0,
    totalExecutions: 0
  };
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  const users = Array.isArray(data?.users) ? data.users : [];

  const handleSelectTool = (nextId) => {
    const resolved = toolId === nextId ? 'all' : nextId;
    setToolId(resolved);
    if (resolved === 'all') onClearInitialTool?.();
  };

  return (
    <div className="admin-page-stack">
      {/* 1. Suite KPI Row */}
      <section className="kpi-grid" aria-label="Tổng quan bộ công cụ tự động">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Người mở bộ công cụ</span>
            <span className="kpi-icon icon-blue"><Icons.users size={18} /></span>
          </div>
          <div className="kpi-value">
            {toolsQuery.isLoading ? '…' : formatNumber(totals.visitedUsers)}
          </div>
          <div className="kpi-footer-note">
            {formatNumber(totals.totalExecutions)} lượt chạy công cụ thật
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Đã sử dụng thật</span>
            <span className="kpi-icon icon-green"><Icons.checkCircle size={18} /></span>
          </div>
          <div className="kpi-value">
            {toolsQuery.isLoading ? '…' : formatNumber(totals.usedUsers)}
          </div>
          <div className="kpi-footer-note">
            Tỷ lệ chuyển đổi {formatPercent(totals.conversionRate)}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Mới chuẩn bị / thử</span>
            <span className="kpi-icon icon-amber"><Icons.wrench size={18} /></span>
          </div>
          <div className="kpi-value">
            {toolsQuery.isLoading ? '…' : formatNumber(totals.triedUsers)}
          </div>
          <div className="kpi-footer-note">
            Upload xem trước, đăng nhập hoặc lưu ưu tiên
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Chỉ bấm vào xem</span>
            <span className="kpi-icon icon-purple"><Icons.eye size={18} /></span>
          </div>
          <div className="kpi-value">
            {toolsQuery.isLoading ? '…' : formatNumber(totals.viewedOnlyUsers)}
          </div>
          <div className="kpi-footer-note">
            Chỉ mở xem giao diện rồi thoát, chưa chạy
          </div>
        </div>
      </section>

      {/* 2. Per-tool Adoption Cards */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Mức Độ Sử Dụng Từng Công Cụ Tự Động</h2>
            <p className="card-subtitle">
              Bấm vào từng thẻ công cụ để lọc chi tiết ai dùng thật và ai chỉ vào xem ({labelForTimeRange(timeRange).toLowerCase()}).
            </p>
          </div>
          {toolId !== 'all' ? (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setToolId('all');
                onClearInitialTool?.();
              }}
            >
              Xem tất cả 5 công cụ
            </button>
          ) : null}
        </div>

        {toolsQuery.isLoading ? (
          <SkeletonBlock rows={4} />
        ) : toolsQuery.isError ? (
          <ErrorState message={toolsQuery.error?.message} onRetry={() => toolsQuery.refetch()} />
        ) : (
          <div className="tools-adoption-grid">
            {tools.map((tool) => {
              const visited = Math.max(0, safeNumber(tool.visitedUsers));
              const usedPct = visited > 0 ? Math.round((safeNumber(tool.usedUsers) / visited) * 100) : 0;
              const triedPct = visited > 0 ? Math.round((safeNumber(tool.triedUsers) / visited) * 100) : 0;
              const viewedPct = visited > 0 ? Math.max(0, 100 - usedPct - triedPct) : 0;
              const isSelected = toolId === tool.id;

              return (
                <button
                  key={tool.id}
                  type="button"
                  className={`tool-adoption-card${isSelected ? ' active' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectTool(tool.id)}
                >
                  <div className="tool-adoption-head">
                    <div className="table-cell-stack">
                      <strong className="tool-adoption-title">{tool.label}</strong>
                      <span className="route-code">{tool.pagePath}</span>
                    </div>
                    <span className="tool-conversion-pill text-mono">
                      {formatPercent(tool.conversionRate)} dùng thật
                    </span>
                  </div>

                  <div className="tool-adoption-summary">
                    <strong>{formatNumber(tool.usedUsers)} dùng thật</strong>
                    <span> / {formatNumber(visited)} người đã vào</span>
                  </div>

                  <div className="adoption-stack-bar" aria-hidden="true">
                    {usedPct > 0 ? (
                      <div className="adoption-seg adoption-seg--used" style={{ width: `${usedPct}%` }} />
                    ) : null}
                    {triedPct > 0 ? (
                      <div className="adoption-seg adoption-seg--tried" style={{ width: `${triedPct}%` }} />
                    ) : null}
                    {viewedPct > 0 ? (
                      <div className="adoption-seg adoption-seg--viewed" style={{ width: `${viewedPct}%` }} />
                    ) : null}
                  </div>

                  <div className="adoption-legend">
                    <span>
                      <i className="legend-dot legend-dot--used" />
                      Dùng thật: <strong>{formatNumber(tool.usedUsers)}</strong>
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--tried" />
                      Chuẩn bị: <strong>{formatNumber(tool.triedUsers)}</strong>
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--viewed" />
                      Chỉ xem: <strong>{formatNumber(tool.viewedOnlyUsers)}</strong>
                    </span>
                  </div>

                  <div className="tool-adoption-meta text-mono">
                    <span>{formatNumber(tool.executionCount)} lượt chạy thật</span>
                    <span>TB {formatDurationMs(tool.avgDwellMs) || '—'}</span>
                  </div>
                  <p className="tool-adoption-criteria">Tính là dùng thật: {tool.usedDesc}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Per-user Conversion Table */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Chi Tiết Ai Đã Dùng Thật vs Chỉ Vào Xem</h2>
            <p className="card-subtitle">
              Tổng hợp cả thao tác trên giao diện và API thực thi để phân biệt rõ giữa thử bấm xem và sử dụng thật.
            </p>
          </div>
          <div className="search-box">
            <span className="search-icon"><Icons.search size={15} /></span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo MSSV, tên sinh viên..."
              aria-label="Tìm sinh viên sử dụng bộ công cụ"
            />
          </div>
        </div>

        <div className="logs-filter-toolbar">
          <div className="filter-group">
            <select
              className="admin-select"
              value={toolId}
              onChange={(e) => {
                setToolId(e.target.value);
                if (e.target.value === 'all') onClearInitialTool?.();
              }}
              aria-label="Lọc theo công cụ"
            >
              <option value="all">Tất cả 5 công cụ</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>

            <div className="filter-group" role="group" aria-label="Lọc theo mức độ sử dụng">
              {STATUS_FILTERS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`chip${status === opt.id ? ' active' : ''}`}
                  aria-pressed={status === opt.id}
                  onClick={() => setStatus(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {toolsQuery.isLoading ? (
          <SkeletonBlock rows={5} />
        ) : toolsQuery.isError ? (
          <ErrorState message={toolsQuery.error?.message} onRetry={() => toolsQuery.refetch()} />
        ) : users.length === 0 ? (
          <EmptyState
            title="Chưa có dữ liệu khớp bộ lọc"
            message="Thử chọn mốc thời gian rộng hơn (7D / 30D) hoặc bỏ lọc trạng thái."
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th scope="col">Sinh viên</th>
                  <th scope="col">Công cụ</th>
                  <th scope="col">Mức sử dụng</th>
                  <th scope="col">Chạy thật / Mở trang</th>
                  <th scope="col">Thời gian ở lại</th>
                  <th scope="col">Thao tác nổi bật</th>
                  <th scope="col">Hành trình</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row, idx) => (
                  <tr key={`${row.userKey}-${row.toolId}-${idx}`}>
                    <td>
                      {row.mssv ? (
                        <button
                          type="button"
                          className="student-link-btn"
                          onClick={() => onOpenJourney?.(row.mssv)}
                        >
                          <strong>{row.fullName}</strong>
                          <span className="mssv-tag">{row.mssv}</span>
                        </button>
                      ) : (
                        <span className="guest-label">{row.fullName || 'Khách ẩn danh'}</span>
                      )}
                    </td>
                    <td>
                      <div className="table-cell-stack">
                        <strong>{row.toolLabel}</strong>
                        <span className="route-code">{row.pagePath}</span>
                      </div>
                    </td>
                    <td>
                      <span className={badgeClassForStatus(row.status)}>
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="text-mono">
                      {formatNumber(row.executionCount)} lượt chạy · {formatNumber(row.viewCount)} lần mở
                    </td>
                    <td className="text-mono">
                      {formatDurationMs(row.totalDwellMs) || '—'}
                    </td>
                    <td>
                      <div className="table-cell-stack">
                        <span>{row.lastActionLabel}</span>
                        <small className="text-muted-inline">{formatRelativeTime(row.lastSeenAt)}</small>
                      </div>
                    </td>
                    <td>
                      {row.mssv ? (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => onOpenJourney?.(row.mssv)}
                        >
                          Xem hành trình
                        </button>
                      ) : (
                        <span className="text-muted-inline">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
