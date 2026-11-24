import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatDurationMs,
  formatLatencyMs,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  getInitials,
  labelForTimeRange,
  safeNumber
} from '../utils/format.js';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock, TrendPill } from '../components/StateBlocks.jsx';

export default function OverviewPage({
  timeRange,
  refreshMs,
  theme,
  onOpenJourney,
  onNavigateTab,
  onSelectFeature,
  onOpenToolDetail
}) {
  const [chartView, setChartView] = useState('interactions');

  const pollMs = refreshMs > 0 ? refreshMs : false;
  const livePollMs = refreshMs > 0 ? Math.min(refreshMs, 10000) : false;

  const liveQuery = useQuery({
    queryKey: ['admin-live'],
    queryFn: ({ signal }) => AdminApi.getLive(signal),
    refetchInterval: livePollMs
  });

  const summaryQuery = useQuery({
    queryKey: ['admin-interactions-summary', timeRange],
    queryFn: ({ signal }) => AdminApi.getInteractionsSummary(timeRange, signal),
    refetchInterval: pollMs
  });

  const overviewQuery = useQuery({
    queryKey: ['admin-overview', timeRange],
    queryFn: ({ signal }) => AdminApi.getOverview(timeRange, signal),
    refetchInterval: pollMs
  });

  const timelineQuery = useQuery({
    queryKey: ['admin-timeline', timeRange],
    queryFn: ({ signal }) => AdminApi.getTimeline(timeRange, signal),
    enabled: chartView === 'http',
    refetchInterval: chartView === 'http' ? pollMs : false
  });

  const flowsQuery = useQuery({
    queryKey: ['admin-interactions-flows-preview', timeRange],
    queryFn: ({ signal }) => AdminApi.getInteractionsFlows({ timeRange, limit: 8 }, signal),
    refetchInterval: pollMs
  });

  const featuresFallbackQuery = useQuery({
    queryKey: ['admin-insights-features', timeRange],
    queryFn: ({ signal }) => AdminApi.getInsightsFeatures(timeRange, signal),
    refetchInterval: pollMs
  });

  const elementsQuery = useQuery({
    queryKey: ['admin-interactions-elements-preview', timeRange],
    queryFn: ({ signal }) => AdminApi.getInteractionsElements({ timeRange, limit: 8 }, signal),
    refetchInterval: pollMs
  });

  const qualityQuery = useQuery({
    queryKey: ['admin-insights-quality-overview', timeRange],
    queryFn: ({ signal }) => AdminApi.getInsightsQuality(timeRange, signal),
    refetchInterval: pollMs
  });

  const toolsQuery = useQuery({
    queryKey: ['admin-automation-tools-overview', timeRange],
    queryFn: ({ signal }) => AdminApi.getAutomationTools({ timeRange, limit: 1 }, signal),
    refetchInterval: pollMs
  });

  const live = liveQuery.data;
  const summary = summaryQuery.data;
  const overview = overviewQuery.data;

  const hasInteractionSignals = safeNumber(summary?.pageViews) + safeNumber(summary?.clicks) + safeNumber(summary?.actions) > 0;
  const activeStudents = hasInteractionSignals ? safeNumber(summary?.activeStudents) : safeNumber(overview?.uniqueMssv);
  const activeVisitors = hasInteractionSignals ? safeNumber(summary?.activeVisitors) : safeNumber(overview?.uniqueUsers);
  const totalInteractions = safeNumber(summary?.pageViews) + safeNumber(summary?.clicks) + safeNumber(summary?.actions) + safeNumber(summary?.searches);
  const errorRate = safeNumber(overview?.errorRate);
  const p95Ms = qualityQuery.data?.overall?.p95Ms ?? overview?.avgResponseTime ?? 0;

  // Chart config
  const isDark = theme === 'dark';
  const textColor = isDark ? '#94A3B8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';

  const interactionChartConfig = useMemo(() => {
    const rows = Array.isArray(summary?.timeline) ? summary.timeline : [];
    const labels = rows.map((item) => {
      const d = new Date(item.time);
      const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
      return rows.length > 24 ? `${d.getDate()}/${d.getMonth() + 1}` : `${hm}${rows.length > 12 ? ` (${d.getDate()}/${d.getMonth() + 1})` : ''}`;
    });
    return {
      hasData: rows.length > 0,
      data: {
        labels,
        datasets: [
          {
            label: 'Xem trang',
            data: rows.map((r) => safeNumber(r.pageViews)),
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: rows.length > 24 ? 2 : 3
          },
          {
            label: 'Bấm nút & Thao tác',
            data: rows.map((r) => safeNumber(r.clicks) + safeNumber(r.actions)),
            borderColor: '#15803D',
            backgroundColor: 'rgba(21, 128, 61, 0.08)',
            fill: true,
            tension: 0.35,
            pointRadius: rows.length > 24 ? 2 : 3
          },
          {
            label: 'Người dùng',
            data: rows.map((r) => safeNumber(r.activeUsers)),
            borderColor: '#D97706',
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            tension: 0.25,
            pointRadius: 2
          }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 12 } }
          }
        },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 12 }, grid: { color: gridColor } },
          y: { beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } }
        }
      }
    };
  }, [summary?.timeline, textColor, gridColor]);

  const httpChartConfig = useMemo(() => {
    const rows = Array.isArray(timelineQuery.data) ? timelineQuery.data : [];
    const labels = rows.map((item) => {
      const d = new Date(item.time);
      const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
      return hm + (rows.length > 24 ? ` (${d.getDate()}/${d.getMonth() + 1})` : '');
    });
    return {
      hasData: rows.length > 0,
      data: {
        labels,
        datasets: [
          {
            label: 'Tổng HTTP Request',
            data: rows.map((i) => safeNumber(i.total)),
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            fill: true,
            tension: 0.35,
            yAxisID: 'yReq',
            pointRadius: rows.length > 24 ? 2 : 3
          },
          {
            label: 'Lỗi (4xx/5xx)',
            data: rows.map((i) => safeNumber(i.error)),
            borderColor: '#DC2626',
            backgroundColor: 'rgba(220, 38, 38, 0.12)',
            fill: true,
            tension: 0.35,
            yAxisID: 'yReq',
            pointRadius: rows.length > 24 ? 2 : 3
          },
          {
            label: 'Độ trễ TB (ms)',
            data: rows.map((i) => safeNumber(i.avgLatency)),
            borderColor: '#15803D',
            borderDash: [3, 3],
            backgroundColor: 'transparent',
            tension: 0.2,
            yAxisID: 'yLat',
            pointRadius: 2
          }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 12 } }
          }
        },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 12 }, grid: { color: gridColor } },
          yReq: { position: 'left', beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } },
          yLat: { position: 'right', beginAtZero: true, ticks: { color: textColor, callback: (v) => `${v}ms` }, grid: { drawOnChartArea: false } }
        }
      }
    };
  }, [timelineQuery.data, textColor, gridColor]);

  // Top features: prefer interaction engagement if available, else fallback to HTTP insights/features
  const uiFeatures = Array.isArray(flowsQuery.data?.featureEngagement)
    ? flowsQuery.data.featureEngagement.filter((f) => f.featureId !== 'other').slice(0, 6)
    : [];
  const apiFeatures = Array.isArray(featuresFallbackQuery.data?.items)
    ? featuresFallbackQuery.data.items.slice(0, 6)
    : [];
  const usingUiFeatures = uiFeatures.length > 0;
  const featureRows = usingUiFeatures ? uiFeatures : apiFeatures;
  const maxFeatureCount = Math.max(
    ...featureRows.map((f) => safeNumber(usingUiFeatures ? f.interactions : f.requests)),
    1
  );

  const recentFeed = Array.isArray(live?.recentFeed) ? live.recentFeed.slice(0, 10) : [];
  const topElements = Array.isArray(elementsQuery.data?.items) ? elementsQuery.data.items.slice(0, 8) : [];
  const maxElementCount = Math.max(...topElements.map((e) => safeNumber(e.count)), 1);

  return (
    <div className="admin-page-stack">
      {/* Live Pulse Strip */}
      <section className="live-pulse-banner" aria-label="Trạng thái người dùng đang truy cập">
        <div className="live-pulse-left">
          <span className="live-pulse-badge">
            <span className="status-dot" />
            <span>Trực tiếp</span>
          </span>
          <div className="live-pulse-copy">
            <strong>{formatNumber(live?.onlineCount ?? 0)} người dùng đang hoạt động</strong>
            <span className="live-pulse-sub">Trong 3 phút gần nhất</span>
          </div>
        </div>
        <div className="live-pulse-pages">
          {(live?.pageDistribution || []).slice(0, 5).map((p) => (
            <button
              key={p.pagePath}
              type="button"
              className="live-page-pill"
              onClick={() => onNavigateTab('live')}
              title={`${p.pageTitle} (${p.pagePath})`}
            >
              <span>{p.pageTitle}</span>
              <strong className="text-mono">{formatNumber(p.count)}</strong>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-action-outline btn-sm"
          onClick={() => onNavigateTab('live')}
        >
          <span>Xem chi tiết trực tiếp</span>
          <Icons.arrowRight size={15} />
        </button>
      </section>

      {/* 4 KPI Cards */}
      <section className="kpi-grid" aria-label="Chỉ số tổng quan">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Sinh Viên Hoạt Động</span>
            <span className="kpi-icon icon-purple"><Icons.users size={18} /></span>
          </div>
          <div className="kpi-value" id="kpi-unique-mssv">{formatNumber(activeStudents)}</div>
          <div className="kpi-sub">
            <TrendPill value={summary?.growth?.studentsPct} emptyLabel="SV đăng nhập" />
            <span className="kpi-desc" id="kpi-unique-users">{formatNumber(activeVisitors)} người/thiết bị</span>
          </div>
          <div className="kpi-footer-note">Trong {labelForTimeRange(timeRange).toLowerCase()}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Phiên Truy Cập</span>
            <span className="kpi-icon icon-blue"><Icons.clock size={18} /></span>
          </div>
          <div className="kpi-value">{formatNumber(summary?.totalSessions ?? 0)}</div>
          <div className="kpi-sub">
            <TrendPill value={summary?.growth?.sessionsPct} />
            <span className="kpi-desc">TB {formatDurationMs(summary?.avgSessionDurationMs ?? 0)} / phiên</span>
          </div>
          <div className="kpi-footer-note">
            Trung bình {formatNumber(summary?.pagesPerSession ?? 0, 1)} trang mỗi phiên
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Tương Tác Giao Diện</span>
            <span className="kpi-icon icon-green"><Icons.mouse size={18} /></span>
          </div>
          <div className="kpi-value" id="kpi-total-requests">
            {formatNumber(hasInteractionSignals ? totalInteractions : safeNumber(overview?.totalRequests))}
          </div>
          <div className="kpi-sub">
            <TrendPill value={hasInteractionSignals ? summary?.growth?.interactionsPct : overview?.requestGrowth} />
            <span className="kpi-desc" id="kpi-growth">
              {hasInteractionSignals
                ? `${formatNumber(summary?.pageViews)} xem · ${formatNumber(safeNumber(summary?.clicks) + safeNumber(summary?.actions))} bấm`
                : 'Lượt HTTP API'}
            </span>
          </div>
          <div className="kpi-footer-note">
            Ở lại TB {formatDurationMs(summary?.avgDwellMs ?? 0)} mỗi trang
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Sức Khỏe Trải Nghiệm</span>
            <span className="kpi-icon icon-amber"><Icons.shield size={18} /></span>
          </div>
          <div className="kpi-value" id="kpi-error-rate">{formatPercent(errorRate)}</div>
          <div className="kpi-sub">
            <span className={`error-status-badge ${errorRate <= 2 ? 'trend-up' : errorRate <= 5 ? 'trend-warning' : 'trend-down'}`} id="kpi-error-status">
              {errorRate <= 2 ? 'Ổn định' : errorRate <= 5 ? 'Lỗi tăng' : 'Lỗi cao'}
            </span>
            <span className="kpi-desc" id="kpi-avg-latency">p95 {formatLatencyMs(p95Ms)}</span>
          </div>
          <div className="kpi-micro-badges">
            <span className="micro-badge badge-2xx" id="kpi-2xx">2xx: {formatNumber(overview?.statusBreakdown?.['2xx'])}</span>
            <span className="micro-badge badge-4xx" id="kpi-4xx">4xx: {formatNumber(overview?.statusBreakdown?.['4xx'])}</span>
            <span className="micro-badge badge-5xx" id="kpi-5xx">5xx: {formatNumber(overview?.statusBreakdown?.['5xx'])}</span>
          </div>
        </div>
      </section>

      {/* Main Chart + Feature Ranking */}
      <div className="two-col-row">
        <div className="panel-card">
          <div className="card-header card-header--wrap">
            <div>
              <h2 className="card-title">Xu Hướng Hoạt Động Theo Thời Gian</h2>
              <p className="card-subtitle">
                {chartView === 'interactions'
                  ? 'Số lượt xem trang, lượt bấm/thao tác thực tế và người dùng hoạt động'
                  : 'Tổng HTTP request, yêu cầu lỗi và độ trễ trung bình tại Express Gateway'}
              </p>
            </div>
            <div className="segmented-control" role="group" aria-label="Chế độ biểu đồ">
              <button
                type="button"
                className={`chip ${chartView === 'interactions' ? 'active' : ''}`}
                aria-pressed={chartView === 'interactions'}
                onClick={() => setChartView('interactions')}
              >
                Tương tác UI
              </button>
              <button
                type="button"
                className={`chip ${chartView === 'http' ? 'active' : ''}`}
                aria-pressed={chartView === 'http'}
                onClick={() => setChartView('http')}
              >
                Lưu lượng HTTP
              </button>
            </div>
          </div>

          {chartView === 'interactions' ? (
            summaryQuery.isLoading ? (
              <SkeletonBlock rows={5} />
            ) : summaryQuery.isError ? (
              <ErrorState message={summaryQuery.error?.message} onRetry={() => summaryQuery.refetch()} />
            ) : !interactionChartConfig.hasData ? (
              <EmptyState
                title="Chưa có dữ liệu tương tác giao diện"
                message={`Chưa ghi nhận tương tác UI nào trong ${labelForTimeRange(timeRange).toLowerCase()}.`}
                hint="Chuyển sang chế độ Lưu lượng HTTP hoặc chờ sinh viên truy cập."
              />
            ) : (
              <ChartCanvas
                type="line"
                data={interactionChartConfig.data}
                options={interactionChartConfig.options}
                ariaLabel="Biểu đồ xu hướng tương tác giao diện"
              />
            )
          ) : (
            timelineQuery.isLoading ? (
              <SkeletonBlock rows={5} />
            ) : timelineQuery.isError ? (
              <ErrorState message={timelineQuery.error?.message} onRetry={() => timelineQuery.refetch()} />
            ) : !httpChartConfig.hasData ? (
              <EmptyState message="Chưa có lưu lượng HTTP trong mốc thời gian đang chọn." />
            ) : (
              <ChartCanvas
                type="line"
                data={httpChartConfig.data}
                options={httpChartConfig.options}
                ariaLabel="Biểu đồ lưu lượng HTTP theo thời gian"
              />
            )
          )}
        </div>

        <div className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Tính Năng Được Dùng Nhiều Nhất</h2>
              <p className="card-subtitle">
                {usingUiFeatures
                  ? 'Bấm vào một tính năng để xem trang & nút bấm chi tiết'
                  : 'Đang hiển thị từ lưu lượng API trong khi chờ thêm tương tác UI'}
              </p>
            </div>
          </div>

          {flowsQuery.isLoading && featuresFallbackQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : featureRows.length === 0 ? (
            <EmptyState message="Chưa có dữ liệu sử dụng tính năng trong mốc thời gian này." />
          ) : (
            <ol className="feature-preview-list">
              {featureRows.map((item, idx) => {
                const fId = usingUiFeatures ? item.featureId : item.id;
                const label = usingUiFeatures ? item.featureLabel : item.label;
                const count = usingUiFeatures ? safeNumber(item.interactions) : safeNumber(item.requests);
                const users = safeNumber(item.uniqueUsers ?? item.users);
                const barPct = Math.min(100, Math.round((count / maxFeatureCount) * 100));
                return (
                  <li key={fId} className="feature-preview-item">
                    <button
                      type="button"
                      className="feature-preview-btn"
                      onClick={() => onSelectFeature?.(fId)}
                    >
                      <span className="feature-preview-rank">{idx + 1}</span>
                      <div className="feature-preview-main">
                        <div className="feature-preview-head">
                          <span className="feature-preview-name">{label}</span>
                          <span className="feature-preview-count text-mono">
                            {formatNumber(users)} SV · {formatNumber(count)} lượt
                          </span>
                        </div>
                        <div className="rank-bar">
                          <div className="rank-bar-fill" style={{ width: `${barPct}%` }} />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* Automation Tools Real Use vs View-only Overview */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Bộ Công Cụ Tự Động: Dùng Thật vs Chỉ Vào Xem</h2>
            <p className="card-subtitle">
              Theo dõi tỷ lệ sinh viên thực sự chạy công cụ so với những người chỉ bấm vào xem giao diện ({labelForTimeRange(timeRange).toLowerCase()}).
            </p>
          </div>
          <button
            type="button"
            className="btn-link"
            onClick={() => onOpenToolDetail?.('all')}
          >
            Xem chi tiết từng người →
          </button>
        </div>

        {toolsQuery.isLoading ? (
          <SkeletonBlock rows={3} />
        ) : toolsQuery.isError ? (
          <ErrorState message={toolsQuery.error?.message} onRetry={() => toolsQuery.refetch()} />
        ) : !Array.isArray(toolsQuery.data?.tools) || toolsQuery.data.tools.length === 0 ? (
          <EmptyState message="Chưa có dữ liệu truy cập bộ công cụ tự động trong mốc thời gian này." />
        ) : (
          <div className="tools-overview-list">
            {toolsQuery.data.tools.map((tool) => {
              const visited = Math.max(0, safeNumber(tool.visitedUsers));
              const usedPct = visited > 0 ? Math.round((safeNumber(tool.usedUsers) / visited) * 100) : 0;
              const triedPct = visited > 0 ? Math.round((safeNumber(tool.triedUsers) / visited) * 100) : 0;
              const viewedPct = visited > 0 ? Math.max(0, 100 - usedPct - triedPct) : 0;

              return (
                <button
                  key={tool.id}
                  type="button"
                  className="tools-overview-row"
                  onClick={() => onOpenToolDetail?.(tool.id)}
                >
                  <div className="tools-overview-info">
                    <strong>{tool.label}</strong>
                    <span className="route-code">{tool.pagePath}</span>
                  </div>
                  <div className="tools-overview-bar-col">
                    <div className="adoption-stack-bar" aria-hidden="true">
                      {usedPct > 0 ? <div className="adoption-seg adoption-seg--used" style={{ width: `${usedPct}%` }} /> : null}
                      {triedPct > 0 ? <div className="adoption-seg adoption-seg--tried" style={{ width: `${triedPct}%` }} /> : null}
                      {viewedPct > 0 ? <div className="adoption-seg adoption-seg--viewed" style={{ width: `${viewedPct}%` }} /> : null}
                    </div>
                  </div>
                  <div className="tools-overview-counts text-mono">
                    <span className="tool-mini-pill tool-mini-pill--used">{formatNumber(tool.usedUsers)} dùng thật</span>
                    {safeNumber(tool.triedUsers) > 0 ? (
                      <span className="tool-mini-pill tool-mini-pill--tried">{formatNumber(tool.triedUsers)} thử</span>
                    ) : null}
                    <span className="tool-mini-pill tool-mini-pill--viewed">{formatNumber(tool.viewedOnlyUsers)} chỉ xem</span>
                    <strong className="tool-overview-pct">{formatPercent(tool.conversionRate)}</strong>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom 2-Column: Live Feed + Top Clicked Elements */}
      <div className="two-col-row two-col-row--equal">
        <div className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Tương Tác Vừa Diễn Ra</h2>
              <p className="card-subtitle">Cập nhật trực tiếp các thao tác mới nhất của sinh viên</p>
            </div>
            <button type="button" className="btn-link" onClick={() => onNavigateTab('live')}>
              Tất cả →
            </button>
          </div>

          {liveQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : liveQuery.isError ? (
            <ErrorState message={liveQuery.error?.message} onRetry={() => liveQuery.refetch()} />
          ) : recentFeed.length === 0 ? (
            <EmptyState
              title="Chưa có sự kiện mới"
              message="Khi sinh viên mở trang hoặc bấm nút trên cổng thông tin, thao tác sẽ xuất hiện ngay tại đây."
            />
          ) : (
            <ul className="live-feed-list">
              {recentFeed.map((ev) => (
                <li className="live-feed-item" key={ev.id}>
                  <div className="live-feed-main">
                    <div className="live-feed-top">
                      {ev.mssv ? (
                        <button
                          type="button"
                          className="student-link-btn"
                          onClick={() => onOpenJourney?.(ev.mssv)}
                        >
                          <strong>{ev.fullName || ev.mssv}</strong>
                          <span className="mssv-tag">{ev.mssv}</span>
                        </button>
                      ) : (
                        <span className="guest-label">Khách ẩn danh</span>
                      )}
                      <span className="feature-chip-mini">{ev.featureLabel}</span>
                    </div>
                    <p className="live-feed-action">{ev.actionLabel}</p>
                  </div>
                  <span className="live-feed-time">{formatRelativeTime(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Nút & Thao Tác Được Bấm Nhiều Nhất</h2>
              <p className="card-subtitle">Chính xác những nút/chức năng sinh viên tương tác trên website</p>
            </div>
            <button type="button" className="btn-link" onClick={() => onNavigateTab('live')}>
              Chi tiết →
            </button>
          </div>

          {elementsQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : elementsQuery.isError ? (
            <ErrorState message={elementsQuery.error?.message} onRetry={() => elementsQuery.refetch()} />
          ) : topElements.length === 0 ? (
            <EmptyState
              title="Chưa ghi nhận lượt bấm nút"
              message="Số liệu thống kê các nút bấm sẽ hiển thị sau khi sinh viên tương tác trên giao diện."
            />
          ) : (
            <ul className="element-rank-list">
              {topElements.map((item, idx) => {
                const pct = Math.min(100, Math.round((safeNumber(item.count) / maxElementCount) * 100));
                return (
                  <li className="element-rank-item" key={`${item.eventName}-${item.label}-${item.pagePath}-${idx}`}>
                    <div className="element-rank-head">
                      <span className="element-rank-label" title={item.label}>
                        “{item.label}”
                      </span>
                      <span className="element-rank-page">{item.pageTitle}</span>
                    </div>
                    <div className="element-rank-bar-row">
                      <div className="rank-bar">
                        <div className="rank-bar-fill rank-bar-fill--accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="element-rank-stats text-mono">
                        {formatNumber(item.count)} lượt · {formatNumber(item.uniqueUsers)} SV
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
