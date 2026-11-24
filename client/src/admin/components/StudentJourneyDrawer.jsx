import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatDateTime,
  formatDurationMs,
  formatLatencyMs,
  formatNumber,
  formatShortClock,
  getInitials,
  labelForTimeRange,
  safeNumber
} from '../utils/format.js';
import { Icons } from './Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from './StateBlocks.jsx';

const TIMELINE_EVENT_LIMIT = 250;

function eventIcon(ev) {
  if (ev.isError) return <Icons.alert size={15} />;
  switch (ev.eventType) {
    case 'page_view':
    case 'page_leave':
      return <Icons.eye size={15} />;
    case 'click':
      return <Icons.mouse size={15} />;
    case 'search':
      return <Icons.search size={15} />;
    case 'api':
      return <Icons.server size={15} />;
    default:
      return <Icons.zap size={15} />;
  }
}

function eventToneClass(ev) {
  if (ev.isError) return 'timeline-ev--error';
  if (ev.eventType === 'page_view' || ev.eventType === 'page_leave') return 'timeline-ev--page';
  if (ev.eventType === 'click') return 'timeline-ev--click';
  if (ev.eventType === 'api') return 'timeline-ev--api';
  return 'timeline-ev--action';
}

export default function StudentJourneyDrawer({
  mssv,
  timeRange,
  onClose,
  onFilterLogs
}) {
  const [subTab, setSubTab] = useState('journey');
  const [includeNoise, setIncludeNoise] = useState(false);

  const cleanMssv = String(mssv || '').trim().toUpperCase();

  useEffect(() => {
    if (!cleanMssv) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cleanMssv, onClose]);

  const timelineQuery = useQuery({
    queryKey: ['admin-user-timeline', cleanMssv, timeRange, includeNoise],
    queryFn: ({ signal }) => AdminApi.getUserUnifiedTimeline(
      cleanMssv,
      { timeRange, includeNoise: includeNoise ? 'true' : 'false', limit: TIMELINE_EVENT_LIMIT },
      signal
    ),
    enabled: Boolean(cleanMssv)
  });

  const activityQuery = useQuery({
    queryKey: ['admin-user-activity', cleanMssv, timeRange],
    queryFn: ({ signal }) => AdminApi.getUserActivity(cleanMssv, timeRange, signal),
    enabled: Boolean(cleanMssv) && subTab === 'api'
  });

  if (!cleanMssv) return null;

  const data = timelineQuery.data;
  const student = data?.student || null;
  const summary = data?.summary || {};
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const transitions = Array.isArray(data?.transitions) ? data.transitions : [];
  const toolUsage = Array.isArray(data?.toolUsage) ? data.toolUsage : [];
  const truncated = Boolean(data?.truncated);
  const displayName = student?.fullName || 'Sinh viên BDU';

  return (
    <div className="drawer-overlay" id="modal-journey" onMouseDown={onClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journey-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <div className="drawer-student-head">
            <div className="avatar-badge avatar-badge--lg" aria-hidden="true">
              {getInitials(displayName, cleanMssv.slice(0, 2))}
            </div>
            <div>
              <h3 className="drawer-title" id="journey-title">
                {displayName} · <span className="mssv-tag">{cleanMssv}</span>
              </h3>
              <p className="drawer-sub" id="journey-sub">
                {student
                  ? [
                    student.classCode ? `Lớp ${student.classCode}` : null,
                    student.facultyCode ? `Khoa ${student.facultyCode}` : null,
                    labelForTimeRange(timeRange)
                  ].filter(Boolean).join(' · ')
                  : `Không có hồ sơ trong bảng students — vẫn hiển thị dấu vết truy cập · ${labelForTimeRange(timeRange)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-close-modal"
            id="btn-close-journey"
            onClick={onClose}
            aria-label="Đóng cửa sổ hành trình sinh viên"
          >
            <Icons.close size={18} />
          </button>
        </header>

        <div className="drawer-tabs">
          <button
            type="button"
            className={`chip ${subTab === 'journey' ? 'active' : ''}`}
            aria-pressed={subTab === 'journey'}
            onClick={() => setSubTab('journey')}
          >
            <Icons.route size={15} />
            <span>Hành trình tương tác</span>
          </button>
          <button
            type="button"
            className={`chip ${subTab === 'api' ? 'active' : ''}`}
            aria-pressed={subTab === 'api'}
            onClick={() => setSubTab('api')}
          >
            <Icons.compass size={15} />
            <span>Dấu vết API & Thiết bị</span>
          </button>
        </div>

        <div className="drawer-body">
          {subTab === 'journey' ? (
            <>
              {timelineQuery.isLoading ? (
                <>
                  <SkeletonBlock rows={2} />
                  <SkeletonBlock rows={5} />
                </>
              ) : timelineQuery.isError ? (
                <ErrorState
                  title="Không tải được hành trình"
                  message={timelineQuery.error?.message || 'Lỗi tải dữ liệu hành trình sinh viên.'}
                  onRetry={() => timelineQuery.refetch()}
                />
              ) : (
                <>
                  <div className="journey-summary" id="journey-summary">
                    <div className="journey-stat">
                      <span className="journey-stat-label">Số phiên</span>
                      <span className="journey-stat-value">{formatNumber(summary.totalSessions)}</span>
                    </div>
                    <div className="journey-stat">
                      <span className="journey-stat-label">Trang đã xem</span>
                      <span className="journey-stat-value">{formatNumber(summary.pageViews)}</span>
                    </div>
                    <div className="journey-stat">
                      <span className="journey-stat-label">Bấm nút & Thao tác</span>
                      <span className="journey-stat-value">
                        {formatNumber(safeNumber(summary.clicks) + safeNumber(summary.actions))}
                      </span>
                    </div>
                    <div className="journey-stat">
                      <span className="journey-stat-label">Tổng thời gian xem</span>
                      <span className="journey-stat-value">{formatDurationMs(summary.totalDwellMs)}</span>
                    </div>
                  </div>

                  {toolUsage.length > 0 ? (
                    <div className="journey-tools-strip" aria-label="Mức sử dụng bộ công cụ tự động">
                      <span className="journey-tools-title">Bộ công cụ tự động:</span>
                      <div className="journey-tools-badges">
                        {toolUsage.map((item) => {
                          const tone = item.status === 'used'
                            ? 'tool-status-badge--used'
                            : item.status === 'tried'
                              ? 'tool-status-badge--tried'
                              : 'tool-status-badge--viewed';
                          const text = item.status === 'used'
                            ? `${item.toolLabel}: Đã dùng thật (${formatNumber(item.executionCount)} lượt)`
                            : item.status === 'tried'
                              ? `${item.toolLabel}: Mới chuẩn bị`
                              : `${item.toolLabel}: Chỉ vào xem`;
                          return (
                            <span key={item.toolId} className={`tool-status-badge ${tone}`} title={item.lastActionLabel}>
                              {text}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="drawer-toolbar">
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={includeNoise}
                        onChange={(e) => setIncludeNoise(e.target.checked)}
                      />
                      <span>Hiện thêm API kỹ thuật & polling</span>
                    </label>
                    {safeNumber(summary.errors) > 0 ? (
                      <span className="badge-error-inline">
                        <Icons.alert size={14} />
                        <span>{formatNumber(summary.errors)} lượt lỗi</span>
                      </span>
                    ) : null}
                  </div>

                  {truncated ? (
                    <p className="journey-notice" id="journey-notice">
                      Chuỗi truy cập dài hơn giới hạn: danh sách chỉ gồm {formatNumber(TIMELINE_EVENT_LIMIT)} sự kiện đầu tiên (cũ nhất) trong {labelForTimeRange(timeRange)}; các lượt mới hơn không được tải — hãy thu hẹp khoảng thời gian.
                    </p>
                  ) : null}

                  <section className="drawer-section">
                    <h4 className="journey-section-title">Dòng thời gian theo phiên</h4>
                    <p className="journey-section-hint">
                      Phiên được tách khi nghỉ quá 30 phút. Tương tác giao diện và thao tác nghiệp vụ được hợp nhất theo trình tự thời gian.
                    </p>
                    <div id="journey-timeline">
                      {sessions.length === 0 ? (
                        <EmptyState
                          title="Chưa có dấu vết truy cập"
                          message={`Sinh viên này chưa có tương tác nào trong ${labelForTimeRange(timeRange).toLowerCase()}.`}
                          hint="Thử chọn mốc thời gian rộng hơn (7D / 30D / ALL) ở thanh trên."
                        />
                      ) : (
                        <div className="journey-sessions-list">
                          {sessions.map((session, idx) => (
                            <article className="journey-session" key={`${session.startAt}-${idx}`}>
                              <header className="journey-session-head">
                                <span className="journey-session-title">
                                  Phiên {idx + 1} · {formatDateTime(session.startAt)} → {formatShortClock(session.endAt)} · {formatNumber(session.eventCount)} bước · {formatDurationMs(session.durationMs)}
                                </span>
                                {session.errorCount > 0 ? (
                                  <span className="journey-session-error">
                                    <Icons.alert size={14} />
                                    <span>{formatNumber(session.errorCount)} lỗi</span>
                                  </span>
                                ) : null}
                              </header>
                              {Array.isArray(session.features) && session.features.length > 0 ? (
                                <div className="journey-feature-chips">
                                  {session.features.map((f) => (
                                    <span className="journey-feature-chip" key={f.id}>
                                      {f.label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <ol className="journey-events">
                                {(session.events || []).map((ev) => (
                                  <li
                                    key={ev.id}
                                    className={`journey-event ${eventToneClass(ev)}${ev.isError ? ' journey-event--error' : ''}`}
                                  >
                                    <span className="journey-event-time">{formatShortClock(ev.at)}</span>
                                    <span className="journey-event-icon">{eventIcon(ev)}</span>
                                    <span className="journey-event-feature">{ev.featureLabel}</span>
                                    <span className="journey-event-label" title={ev.pagePath || ev.route || ''}>
                                      {ev.label}
                                      {ev.pagePath && ev.eventType === 'click' ? (
                                        <span className="journey-event-subpath"> · {ev.pageTitle || ev.pagePath}</span>
                                      ) : null}
                                    </span>
                                    {ev.isError ? (
                                      <span className="journey-event-flag">
                                        <Icons.alert size={13} />
                                        <span>Lỗi {ev.statusCode || ''}</span>
                                      </span>
                                    ) : null}
                                    {ev.source === 'api' && ev.statusCode ? (
                                      <span className="status-badge stat-neutral">{ev.statusCode}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ol>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="drawer-section">
                    <h4 className="journey-section-title">Luồng chuyển trang của sinh viên này</h4>
                    <div id="journey-transitions">
                      {transitions.length === 0 ? (
                        <EmptyState
                          title="Chưa có chuyển trang"
                          message="Chưa ghi nhận cặp trang nào được mở nối tiếp trong cùng một phiên."
                        />
                      ) : (
                        <ol className="journey-transitions">
                          {transitions.map((t, i) => (
                            <li className="journey-transition" key={`${t.from}-${t.to}-${i}`}>
                              <span className="journey-transition-path" title={t.from}>
                                {t.fromTitle || t.from}
                              </span>
                              <span className="journey-transition-arrow" aria-hidden="true">→</span>
                              <span className="journey-transition-path" title={t.to}>
                                {t.toTitle || t.to}
                              </span>
                              <span className="journey-transition-count">{formatNumber(t.count)} lượt</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <div className="drawer-api-tab">
              {activityQuery.isLoading ? (
                <SkeletonBlock rows={5} />
              ) : activityQuery.isError ? (
                <ErrorState
                  title="Không tải được dấu vết API"
                  message={activityQuery.error?.message || 'Lỗi tải dữ liệu API của sinh viên.'}
                  onRetry={() => activityQuery.refetch()}
                />
              ) : (
                <>
                  <div className="activity-summary-grid">
                    <div className="activity-stat">
                      <span className="label">Tổng HTTP Request</span>
                      <span className="value">{formatNumber(activityQuery.data?.summary?.totalRequests)}</span>
                    </div>
                    <div className="activity-stat">
                      <span className="label">Lỗi (4xx/5xx)</span>
                      <span className={`value ${safeNumber(activityQuery.data?.summary?.errorCount) > 0 ? 'text-error' : ''}`}>
                        {formatNumber(activityQuery.data?.summary?.errorCount)}
                      </span>
                    </div>
                    <div className="activity-stat">
                      <span className="label">Độ trễ TB</span>
                      <span className="value">{formatLatencyMs(activityQuery.data?.summary?.avgLatency)}</span>
                    </div>
                    <div className="activity-stat">
                      <span className="label">Hoạt động cuối</span>
                      <span className="value small">{formatDateTime(activityQuery.data?.summary?.lastSeen)}</span>
                    </div>
                  </div>

                  <h4 className="activity-section-title">API đã gọi</h4>
                  <div className="table-scroll">
                    <table className="admin-data-table">
                      <thead>
                        <tr>
                          <th scope="col">API (Route)</th>
                          <th scope="col">Method</th>
                          <th scope="col">Số lần</th>
                          <th scope="col">Lỗi</th>
                          <th scope="col">Lần cuối</th>
                          <th scope="col">TB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activityQuery.data?.routes || []).length === 0 ? (
                          <tr><td colSpan={6} className="text-center-muted">Chưa có request nào trong khoảng thời gian này.</td></tr>
                        ) : (
                          activityQuery.data.routes.map((row, idx) => (
                            <tr key={`${row.method}-${row.route}-${idx}`}>
                              <td><span className="route-code" title={row.route}>{row.route}</span></td>
                              <td><span className={`method-tag method-${String(row.method).toLowerCase()}`}>{row.method}</span></td>
                              <td className="text-mono">{formatNumber(row.count)}</td>
                              <td>{safeNumber(row.errorCount) > 0 ? <span className="status-badge stat-4xx">{row.errorCount}</span> : '0'}</td>
                              <td className="text-mono">{formatDateTime(row.lastCalled)}</td>
                              <td className="text-mono">{formatLatencyMs(row.avgLatency)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h4 className="activity-section-title" style={{ marginTop: '16px' }}>Thiết bị & Địa chỉ IP</h4>
                  <div className="activity-chip-row">
                    {(activityQuery.data?.devices || []).map((d) => (
                      <span className="activity-chip" key={`dev-${d.name}`}>
                        {d.name}: <strong>{formatNumber(d.count)}</strong>
                      </span>
                    ))}
                    {(activityQuery.data?.ips || []).map((ip) => (
                      <span className="activity-chip" key={`ip-${ip.ip}`}>
                        {ip.ip}: <strong>{formatNumber(ip.count)}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <footer className="drawer-footer">
          <button
            type="button"
            className="btn-action-outline"
            id="btn-journey-filter-logs"
            onClick={() => {
              onClose?.();
              onFilterLogs?.(cleanMssv);
            }}
          >
            <Icons.search size={16} />
            <span>Lọc HTTP Logs của {cleanMssv}</span>
          </button>
          <button type="button" className="btn-action-primary" onClick={onClose}>
            Đóng
          </button>
        </footer>
      </aside>
    </div>
  );
}
