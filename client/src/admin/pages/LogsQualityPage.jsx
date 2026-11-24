import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatClock,
  formatLatencyMs,
  formatNumber,
  formatPercent,
  safeNumber
} from '../utils/format.js';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

function latencyClass(ms) {
  if (ms < 300) return 'lat-fast';
  return ms < 800 ? 'lat-med' : 'lat-slow';
}

function statusClass(code) {
  if (code >= 500) return 'stat-5xx';
  if (code >= 400) return 'stat-4xx';
  if (code >= 300) return 'stat-3xx';
  return 'stat-2xx';
}

export default function LogsQualityPage({
  timeRange,
  refreshMs,
  initialMssvFilter = '',
  onClearMssvFilter,
  onOpenJourney,
  onInspectLog
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [route, setRoute] = useState('');
  const [mssv, setMssv] = useState(initialMssvFilter || '');
  const [hideNoise, setHideNoise] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    if (initialMssvFilter) {
      setMssv(initialMssvFilter);
      setPage(1);
    }
  }, [initialMssvFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const pollMs = refreshMs > 0 ? refreshMs : false;

  const qualityQuery = useQuery({
    queryKey: ['admin-insights-quality', timeRange],
    queryFn: ({ signal }) => AdminApi.getInsightsQuality(timeRange, signal),
    refetchInterval: pollMs
  });

  const routesQuery = useQuery({
    queryKey: ['admin-routes', timeRange],
    queryFn: ({ signal }) => AdminApi.getRoutes(timeRange, signal)
  });

  const logsQuery = useQuery({
    queryKey: ['admin-logs', timeRange, page, limit, status, method, route, mssv, debouncedSearch, hideNoise],
    queryFn: ({ signal }) => AdminApi.getLogs({
      timeRange,
      page,
      limit,
      status,
      method,
      route,
      mssv,
      search: debouncedSearch,
      hideNoise: hideNoise ? 'true' : 'false'
    }, signal),
    refetchInterval: pollMs
  });

  const quality = qualityQuery.data;
  const qualityItems = Array.isArray(quality?.items) ? quality.items : [];
  const overall = quality?.overall || {};

  const logsData = logsQuery.data || {};
  const logs = Array.isArray(logsData.logs) ? logsData.logs : [];
  const pagination = logsData.pagination || { total: 0, page: 1, limit: 50, totalPages: 1 };
  const routes = Array.isArray(routesQuery.data) ? routesQuery.data : [];

  return (
    <div className="admin-page-stack" id="pane-logs">
      {/* 1. Quality / Latency by Feature */}
      <section className="panel-card" id="quality-table">
        <div className="card-header">
          <div>
            <h2 className="card-title">Hiệu Năng & Tỷ Lệ Lỗi Theo Tính Năng</h2>
            <p className="card-subtitle">
              Độ trễ p95 = 95% yêu cầu nhanh hơn con số này. Ngưỡng màu: dưới 300 ms nhanh, 300–800 ms ổn, trên 800 ms chậm.
            </p>
          </div>
        </div>

        {qualityQuery.isLoading ? (
          <SkeletonBlock rows={4} />
        ) : qualityQuery.isError ? (
          <ErrorState message={qualityQuery.error?.message} onRetry={() => qualityQuery.refetch()} />
        ) : safeNumber(overall.requests) <= 0 ? (
          <EmptyState message="Chưa có lượt yêu cầu API nào để đo độ trễ." />
        ) : (
          <>
            <div className="quality-summary">
              <div className="quality-stat">
                <span className="quality-stat-label">Tổng yêu cầu</span>
                <span className="quality-stat-value">{formatNumber(overall.requests)}</span>
              </div>
              <div className="quality-stat">
                <span className="quality-stat-label">Tỷ lệ lỗi</span>
                <span className="quality-stat-value">{formatPercent(safeNumber(overall.errorRate) * 100)}</span>
              </div>
              <div className="quality-stat">
                <span className="quality-stat-label">Trung bình</span>
                <span className="quality-stat-value">{formatLatencyMs(overall.avgMs)}</span>
              </div>
              <div className="quality-stat">
                <span className="quality-stat-label">p95 toàn hệ thống</span>
                <span className="quality-stat-value">{formatLatencyMs(overall.p95Ms)}</span>
              </div>
            </div>

            {qualityItems.length > 0 ? (
              <div className="table-scroll">
                <table className="admin-data-table">
                  <caption className="sr-only">Độ trễ và tỷ lệ lỗi theo tính năng</caption>
                  <thead>
                    <tr>
                      <th scope="col">Tính năng</th>
                      <th scope="col">Lượt</th>
                      <th scope="col">Tỷ lệ lỗi</th>
                      <th scope="col">Trung bình</th>
                      <th scope="col">p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityItems.map((item) => {
                      const p95 = safeNumber(item.p95Ms);
                      return (
                        <tr key={item.id}>
                          <td className="rank-label">{item.label || item.id}</td>
                          <td className="text-mono">{formatNumber(item.requests)}</td>
                          <td className="text-mono">{formatPercent(safeNumber(item.errorRate) * 100)}</td>
                          <td className="text-mono">{formatLatencyMs(item.avgMs)}</td>
                          <td className="text-mono">
                            <span className={`latency-badge ${latencyClass(p95)}`}>{formatLatencyMs(p95)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 2. HTTP Access Logs */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Nhật Ký Yêu Cầu HTTP Chi Tiết</h2>
            <p className="card-subtitle">Đã dịch sẵn sang tên hành động dễ hiểu; mặc định ẩn các request polling nền.</p>
          </div>
          <span className="count-badge" id="logs-total-count">{formatNumber(pagination.total)} bản ghi</span>
        </div>

        <div className="logs-filter-toolbar">
          <div className="search-box">
            <span className="search-icon"><Icons.search size={16} /></span>
            <input
              type="text"
              id="input-log-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Tìm trong nhật ký theo đường dẫn, MSSV, IP hoặc thông báo lỗi"
              placeholder="Tìm đường dẫn, MSSV, IP hoặc lỗi..."
            />
            {search ? (
              <button
                type="button"
                id="btn-clear-search"
                className="btn-clear"
                aria-label="Xóa từ khóa tìm kiếm"
                onClick={() => setSearch('')}
              >
                <Icons.close size={14} />
              </button>
            ) : null}
          </div>

          <div className="filter-group" role="group" aria-label="Lọc theo mã HTTP">
            <span className="filter-label">Mã HTTP:</span>
            {['all', '2xx', '3xx', '4xx', '5xx'].map((s) => (
              <button
                key={s}
                type="button"
                className={`chip filter-btn ${status === s ? 'active' : ''}`}
                aria-pressed={status === s}
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
              >
                {s === 'all' ? 'Tất cả' : s}
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Lọc theo method">
            <span className="filter-label">Method:</span>
            {['all', 'GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <button
                key={m}
                type="button"
                className={`chip filter-btn ${method === m ? 'active' : ''}`}
                aria-pressed={method === m}
                onClick={() => {
                  setMethod(m);
                  setPage(1);
                }}
              >
                {m === 'all' ? 'Tất cả' : m}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <label htmlFor="select-log-route" className="filter-label">API:</label>
            <select
              id="select-log-route"
              className="admin-select"
              style={{ maxWidth: '250px' }}
              value={route}
              onChange={(e) => {
                setRoute(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả API</option>
              {routes.map((row) => (
                <option key={`${row.method}-${row.route}`} value={row.route}>
                  {row.method} {row.route} ({safeNumber(row.count)})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={`chip ${hideNoise ? 'active' : ''}`}
            aria-pressed={hideNoise}
            onClick={() => {
              setHideNoise((v) => !v);
              setPage(1);
            }}
            title="Ẩn các endpoint kiểm tra phiên bản, trạng thái nền, đếm thông báo"
          >
            {hideNoise ? '✓ Đang ẩn polling nền' : 'Đang hiện cả polling nền'}
          </button>
        </div>

        {mssv ? (
          <div className="active-tag-row" id="active-mssv-tag-row">
            <span className="tag-pill">
              Đang lọc sinh viên: <strong id="active-filter-mssv">{mssv}</strong>
              <button
                type="button"
                id="btn-remove-mssv-filter"
                onClick={() => {
                  setMssv('');
                  setPage(1);
                  onClearMssvFilter?.();
                }}
              >
                ✕ Bỏ lọc
              </button>
            </span>
          </div>
        ) : null}

        {logsQuery.isLoading ? (
          <SkeletonBlock rows={6} />
        ) : logsQuery.isError ? (
          <ErrorState message={logsQuery.error?.message} onRetry={() => logsQuery.refetch()} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="admin-data-table">
                <caption className="sr-only">Nhật ký yêu cầu HTTP, mới nhất ở trên cùng</caption>
                <thead>
                  <tr>
                    <th scope="col">Thời Gian</th>
                    <th scope="col">Hành Động</th>
                    <th scope="col">Method & API</th>
                    <th scope="col">Mã</th>
                    <th scope="col">Độ Trễ</th>
                    <th scope="col">Sinh Viên</th>
                    <th scope="col">IP / Thiết Bị</th>
                    <th scope="col" style={{ textAlign: 'center' }}>Chi Tiết</th>
                  </tr>
                </thead>
                <tbody id="logs-table-body">
                  {logs.length === 0 ? (
                    <tr><td colSpan={8} className="text-center-muted">Không tìm thấy bản ghi log nào phù hợp.</td></tr>
                  ) : (
                    logs.map((log) => {
                      const code = safeNumber(log.statusCode);
                      const ms = safeNumber(log.responseTimeMs);
                      const hasError = code >= 400;
                      const d = new Date(log.createdAt);
                      const dateStr = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
                      return (
                        <tr
                          key={log.id}
                          className={`clickable-row${hasError ? ' has-error' : ''}`}
                          onClick={() => onInspectLog?.(log)}
                        >
                          <td>
                            <span className="log-clock">{formatClock(log.createdAt)}</span>
                            <span className="log-date">{dateStr}</span>
                          </td>
                          <td>
                            <div className="path-wrap">
                              <strong>{log.actionLabel || log.route || log.path}</strong>
                              {log.errorMessage ? (
                                <span className="path-err" title={log.errorMessage}>
                                  <Icons.alert size={13} />
                                  <span className="path-err-text">{log.errorMessage}</span>
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <div className="path-wrap">
                              <span className="route-line">
                                <span className={`method-tag method-${String(log.method).toLowerCase()}`}>{log.method}</span>
                                <span className="route-code" title={log.path}>{log.route || log.path}</span>
                              </span>
                            </div>
                          </td>
                          <td><span className={`status-badge ${statusClass(code)}`}>{code}</span></td>
                          <td><span className={`latency-badge ${latencyClass(ms)}`}>{ms} ms</span></td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {log.mssv ? (
                              <button
                                type="button"
                                className="student-link-btn"
                                onClick={() => onOpenJourney?.(log.mssv)}
                                title={log.fullName || log.mssv}
                              >
                                <span className="mssv-tag">{log.mssv}</span>
                              </button>
                            ) : (
                              <span className="muted-cell">Khách</span>
                            )}
                          </td>
                          <td>
                            <span className="client-ip-text">{log.ipAddress || '127.0.0.1'}</span>
                            <span className="client-dev-text">{[log.os, log.browser].filter(Boolean).join(' · ')}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn-inspect"
                              aria-label="Xem chi tiết yêu cầu này"
                              onClick={(e) => {
                                e.stopPropagation();
                                onInspectLog?.(log);
                              }}
                            >
                              <Icons.eye size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination-footer">
              <div className="page-info" id="pagination-info">
                Trang {pagination.page} / {pagination.totalPages} (Tổng {formatNumber(pagination.total)})
              </div>
              <div className="page-buttons">
                <button
                  type="button"
                  className="btn-page"
                  id="btn-page-prev"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ◀ Trước
                </button>
                <button
                  type="button"
                  className="btn-page"
                  id="btn-page-next"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau ▶
                </button>
                <select
                  id="select-log-limit"
                  className="admin-select"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={25}>25 dòng</option>
                  <option value={50}>50 dòng</option>
                  <option value={100}>100 dòng</option>
                </select>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
