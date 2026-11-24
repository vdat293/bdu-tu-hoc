import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_GROUPS } from '../../../../src/config/feature-groups.js';
import { AdminApi } from '../api/adminApi.js';
import {
  formatDurationMs,
  formatNumber,
  formatRelativeTime,
  getInitials,
  labelForTimeRange,
  safeNumber
} from '../utils/format.js';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

const EVENT_TYPE_OPTIONS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'page_view', label: 'Xem trang' },
  { id: 'click', label: 'Bấm nút' },
  { id: 'action', label: 'Hành động' },
  { id: 'search', label: 'Tìm kiếm' },
  { id: 'error', label: 'Lỗi UI' }
];

function deviceIcon(type) {
  if (type === 'mobile') return <Icons.smartphone size={15} />;
  if (type === 'tablet') return <Icons.tablet size={15} />;
  if (type === 'bot') return <Icons.bot size={15} />;
  return <Icons.monitor size={15} />;
}

export default function LiveInteractionsPage({
  timeRange,
  refreshMs,
  initialFeatureId = 'all',
  onClearInitialFeature,
  onOpenJourney
}) {
  const [featureId, setFeatureId] = useState(initialFeatureId || 'all');
  const [eventType, setEventType] = useState('all');
  const [selectedPage, setSelectedPage] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [streamPage, setStreamPage] = useState(1);

  useEffect(() => {
    if (initialFeatureId) setFeatureId(initialFeatureId);
  }, [initialFeatureId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setStreamPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const pollMs = refreshMs > 0 ? refreshMs : false;
  const livePollMs = refreshMs > 0 ? Math.min(refreshMs, 8000) : false;

  const liveQuery = useQuery({
    queryKey: ['admin-live'],
    queryFn: ({ signal }) => AdminApi.getLive(signal),
    refetchInterval: livePollMs
  });

  const pagesQuery = useQuery({
    queryKey: ['admin-interactions-pages', timeRange, featureId],
    queryFn: ({ signal }) => AdminApi.getInteractionsPages({
      timeRange,
      featureId: featureId === 'all' ? '' : featureId,
      limit: 20
    }, signal),
    refetchInterval: pollMs
  });

  const elementsQuery = useQuery({
    queryKey: ['admin-interactions-elements', timeRange, featureId, selectedPage, eventType],
    queryFn: ({ signal }) => AdminApi.getInteractionsElements({
      timeRange,
      featureId: featureId === 'all' ? '' : featureId,
      pagePath: selectedPage,
      eventType: eventType === 'click' || eventType === 'action' || eventType === 'search' ? eventType : '',
      limit: 25
    }, signal),
    refetchInterval: pollMs
  });

  const streamQuery = useQuery({
    queryKey: ['admin-interactions-stream', timeRange, eventType, featureId, debouncedSearch, streamPage],
    queryFn: ({ signal }) => AdminApi.getInteractionsStream({
      timeRange,
      eventType,
      featureId: featureId === 'all' ? '' : featureId,
      search: debouncedSearch,
      page: streamPage,
      limit: 30
    }, signal),
    refetchInterval: pollMs
  });

  const onlineUsers = Array.isArray(liveQuery.data?.onlineUsers) ? liveQuery.data.onlineUsers : [];
  const topPages = Array.isArray(pagesQuery.data?.items) ? pagesQuery.data.items : [];
  const topElements = Array.isArray(elementsQuery.data?.items) ? elementsQuery.data.items : [];
  const maxElCount = Math.max(...topElements.map((e) => safeNumber(e.count)), 1);
  const streamItems = Array.isArray(streamQuery.data?.items) ? streamQuery.data.items : [];
  const streamPagination = streamQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="admin-page-stack">
      {/* 1. Online Users Now */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">
              <span className="inline-live-dot" />
              Ai Đang Online Trên Website? ({formatNumber(onlineUsers.length)})
            </h2>
            <p className="card-subtitle">
              Hiển thị sinh viên có tương tác trong 3 phút gần nhất, kèm trang đang mở và thao tác vừa thực hiện.
            </p>
          </div>
          <button
            type="button"
            className="btn-refresh"
            onClick={() => liveQuery.refetch()}
          >
            <Icons.refresh size={15} />
            <span>Cập nhật ngay</span>
          </button>
        </div>

        {liveQuery.isLoading ? (
          <SkeletonBlock rows={3} />
        ) : liveQuery.isError ? (
          <ErrorState message={liveQuery.error?.message} onRetry={() => liveQuery.refetch()} />
        ) : onlineUsers.length === 0 ? (
          <EmptyState
            title="Hiện chưa có người dùng đang mở trang"
            message="Khi sinh viên mở website và chuyển trang hoặc bấm nút, thẻ trạng thái trực tiếp sẽ xuất hiện tại đây."
          />
        ) : (
          <div className="online-users-grid">
            {onlineUsers.map((user) => {
              const dwellMs = user.enteredPageAt
                ? Math.max(0, Date.now() - new Date(user.enteredPageAt).getTime())
                : 0;
              return (
                <article className="online-user-card" key={user.key}>
                  <div className="online-user-head">
                    <div className="avatar-badge" aria-hidden="true">
                      {getInitials(user.fullName, user.mssv ? user.mssv.slice(0, 2) : 'K')}
                    </div>
                    <div className="online-user-meta">
                      <div className="online-user-name-row">
                        <strong>{user.fullName}</strong>
                        {user.mssv ? <span className="mssv-tag">{user.mssv}</span> : null}
                      </div>
                      <span className="online-user-sub">
                        {deviceIcon(user.deviceType)}
                        <span>{[user.os, user.browser].filter(Boolean).join(' · ')}</span>
                        <span>· {formatRelativeTime(user.lastSeenAt)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="online-user-body">
                    <div className="online-page-row">
                      <span className="online-page-badge">{user.pageTitle}</span>
                      <span className="online-dwell text-mono">đang ở {formatDurationMs(dwellMs)}</span>
                    </div>
                    <p className="online-last-action" title={user.lastActionLabel}>
                      {user.lastActionLabel}
                    </p>
                  </div>

                  {user.mssv ? (
                    <div className="online-user-foot">
                      <button
                        type="button"
                        className="btn-filter-student"
                        onClick={() => onOpenJourney?.(user.mssv)}
                      >
                        <Icons.route size={14} />
                        <span>Xem hành trình</span>
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Filter Bar */}
      <section className="panel-card filter-bar-card">
        <div className="logs-filter-toolbar">
          <div className="filter-group">
            <label htmlFor="select-live-feature" className="filter-label">Tính năng:</label>
            <select
              id="select-live-feature"
              className="admin-select"
              value={featureId}
              onChange={(e) => {
                setFeatureId(e.target.value);
                setSelectedPage('');
                setStreamPage(1);
                onClearInitialFeature?.();
              }}
            >
              <option value="all">Tất cả tính năng</option>
              {FEATURE_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          <div className="filter-group" role="group" aria-label="Lọc theo loại tương tác">
            <span className="filter-label">Loại:</span>
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`chip ${eventType === opt.id ? 'active' : ''}`}
                aria-pressed={eventType === opt.id}
                onClick={() => {
                  setEventType(opt.id);
                  setStreamPage(1);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {selectedPage ? (
            <span className="tag-pill">
              Đang lọc nút trên trang: <strong>{selectedPage}</strong>
              <button type="button" onClick={() => setSelectedPage('')}>✕ Bỏ</button>
            </span>
          ) : null}
        </div>
      </section>

      {/* 2. Top Pages + Top Clicked Elements */}
      <div className="two-col-row two-col-row--equal">
        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Trang Được Xem Nhiều & Thời Gian Ở Lại</h2>
              <p className="card-subtitle">
                Bấm vào một trang để lọc danh sách nút bấm bên cạnh ({labelForTimeRange(timeRange).toLowerCase()}).
              </p>
            </div>
          </div>

          {pagesQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : pagesQuery.isError ? (
            <ErrorState message={pagesQuery.error?.message} onRetry={() => pagesQuery.refetch()} />
          ) : topPages.length === 0 ? (
            <EmptyState message="Chưa có lượt xem trang nào khớp bộ lọc." />
          ) : (
            <div className="table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">Trang</th>
                    <th scope="col">Lượt xem</th>
                    <th scope="col">Người dùng</th>
                    <th scope="col">Ở lại TB</th>
                    <th scope="col">Lượt bấm</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((p) => {
                    const isSelected = selectedPage === p.pagePath;
                    return (
                      <tr
                        key={p.pagePath}
                        className={`clickable-row ${isSelected ? 'row-selected' : ''}`}
                        onClick={() => setSelectedPage((cur) => (cur === p.pagePath ? '' : p.pagePath))}
                      >
                        <td>
                          <div className="page-cell">
                            <strong>{p.pageTitle}</strong>
                            <span className="route-code">{p.pagePath}</span>
                          </div>
                        </td>
                        <td className="text-mono"><strong>{formatNumber(p.views)}</strong></td>
                        <td className="text-mono">{formatNumber(p.uniqueUsers)}</td>
                        <td className="text-mono">{p.avgDurationMs > 0 ? formatDurationMs(p.avgDurationMs) : '--'}</td>
                        <td className="text-mono">{formatNumber(safeNumber(p.clicks) + safeNumber(p.actions))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Người Dùng Bấm Gì Nhiều Nhất?</h2>
              <p className="card-subtitle">
                Nhãn nút, tab và hành động nghiệp vụ thực tế trên giao diện
              </p>
            </div>
          </div>

          {elementsQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : elementsQuery.isError ? (
            <ErrorState message={elementsQuery.error?.message} onRetry={() => elementsQuery.refetch()} />
          ) : topElements.length === 0 ? (
            <EmptyState message="Chưa có dữ liệu nút bấm hoặc hành động khớp bộ lọc." />
          ) : (
            <ul className="element-rank-list">
              {topElements.map((el, idx) => {
                const pct = Math.min(100, Math.round((safeNumber(el.count) / maxElCount) * 100));
                return (
                  <li className="element-rank-item" key={`${el.eventType}-${el.label}-${el.pagePath}-${idx}`}>
                    <div className="element-rank-head">
                      <span className="element-rank-label" title={el.label}>
                        <span className={`event-pill event-pill--${el.eventType}`}>
                          {el.eventType === 'action' ? 'Hành động' : el.eventType === 'search' ? 'Tìm' : 'Bấm'}
                        </span>
                        <span>“{el.label}”</span>
                      </span>
                      <span className="element-rank-page">{el.pageTitle}</span>
                    </div>
                    <div className="element-rank-bar-row">
                      <div className="rank-bar">
                        <div className="rank-bar-fill rank-bar-fill--accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="element-rank-stats text-mono">
                        {formatNumber(el.count)} lượt · {formatNumber(el.uniqueUsers)} SV
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* 3. Full Interaction Stream */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Dòng Sự Kiện Tương Tác Chi Tiết</h2>
            <p className="card-subtitle">Tra cứu toàn bộ thao tác mở trang, rời trang, bấm nút và hành động người dùng</p>
          </div>
          <div className="search-input-wrapper">
            <span className="search-icon"><Icons.search size={16} /></span>
            <input
              type="text"
              className="admin-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên SV, MSSV, tên nút hoặc trang..."
              aria-label="Tìm trong dòng sự kiện tương tác"
            />
          </div>
        </div>

        {streamQuery.isLoading ? (
          <SkeletonBlock rows={6} />
        ) : streamQuery.isError ? (
          <ErrorState message={streamQuery.error?.message} onRetry={() => streamQuery.refetch()} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">Thời gian</th>
                    <th scope="col">Sinh viên</th>
                    <th scope="col">Tính năng</th>
                    <th scope="col">Tương tác</th>
                    <th scope="col">Trang</th>
                    <th scope="col">Thiết bị</th>
                  </tr>
                </thead>
                <tbody>
                  {streamItems.length === 0 ? (
                    <tr><td colSpan={6} className="text-center-muted">Chưa có sự kiện nào phù hợp bộ lọc.</td></tr>
                  ) : (
                    streamItems.map((item) => (
                      <tr key={item.id}>
                        <td className="text-mono">{formatRelativeTime(item.createdAt)}</td>
                        <td>
                          {item.mssv ? (
                            <button
                              type="button"
                              className="student-link-btn"
                              onClick={() => onOpenJourney?.(item.mssv)}
                            >
                              <strong>{item.fullName || 'Sinh viên'}</strong>
                              <span className="mssv-tag">{item.mssv}</span>
                            </button>
                          ) : (
                            <span className="guest-label">Khách ẩn danh</span>
                          )}
                        </td>
                        <td><span className="feature-chip-mini">{item.featureLabel}</span></td>
                        <td>
                          <span className={`event-pill event-pill--${item.eventType}`}>
                            {item.eventType === 'page_view' ? 'Xem trang'
                              : item.eventType === 'page_leave' ? 'Rời trang'
                                : item.eventType === 'click' ? 'Bấm nút'
                                  : item.eventType === 'search' ? 'Tìm kiếm'
                                    : item.eventType === 'error' ? 'Lỗi'
                                      : 'Hành động'}
                          </span>{' '}
                          <span>{item.actionLabel}</span>
                        </td>
                        <td>
                          <div className="page-cell">
                            <span>{item.pageTitle}</span>
                            <span className="route-code">{item.pagePath}</span>
                          </div>
                        </td>
                        <td className="text-mono">{[item.deviceType, item.os].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination-footer">
              <div className="page-info">
                Trang {streamPagination.page} / {streamPagination.totalPages} (Tổng {formatNumber(streamPagination.total)})
              </div>
              <div className="page-buttons">
                <button
                  type="button"
                  className="btn-page"
                  disabled={streamPagination.page <= 1}
                  onClick={() => setStreamPage((p) => Math.max(1, p - 1))}
                >
                  ◀ Trước
                </button>
                <button
                  type="button"
                  className="btn-page"
                  disabled={streamPagination.page >= streamPagination.totalPages}
                  onClick={() => setStreamPage((p) => p + 1)}
                >
                  Sau ▶
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
