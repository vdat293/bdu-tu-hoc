import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  getInitials,
  safeNumber
} from '../utils/format.js';
import { Icons } from '../components/Icons.jsx';
import { ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

export default function StudentsPage({ refreshMs, onOpenJourney, onFilterLogs }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [sortValue, setSortValue] = useState('last_login_at:desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [sortBy, sortDir] = sortValue.split(':');
  const pollMs = refreshMs > 0 ? refreshMs : false;

  const visitedQuery = useQuery({
    queryKey: ['admin-visited-students', page, filter, sortBy, sortDir, debouncedSearch],
    queryFn: ({ signal }) => AdminApi.getVisitedStudents({
      page,
      limit: 25,
      filter,
      sortBy,
      sortDir,
      search: debouncedSearch
    }, signal),
    refetchInterval: pollMs
  });

  const data = visitedQuery.data || {};
  const stats = data.stats || {};
  const students = Array.isArray(data.students) ? data.students : [];
  const pagination = data.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 };
  const startItem = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const endItem = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="admin-page-stack" id="pane-users">
      {/* Mini KPI Cards */}
      <div className="kpi-grid kpi-grid--compact">
        <div className="kpi-card kpi-card--row">
          <div className="kpi-icon-wrap icon-green"><Icons.users size={20} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Đã Vào Web (Kích Hoạt)</span>
            <span className="kpi-value" id="kpi-visited-active">{formatNumber(stats.visitedStudents)}</span>
            <span className="kpi-trend positive">Hồ sơ sinh viên đang hoạt động</span>
          </div>
        </div>

        <div className="kpi-card kpi-card--row">
          <div className="kpi-icon-wrap icon-blue"><Icons.clock size={20} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Đăng Nhập Hôm Nay</span>
            <span className="kpi-value" id="kpi-visited-today">{formatNumber(stats.visitedToday)}</span>
            <span className="kpi-trend neutral">Tính từ 00:00 hôm nay</span>
          </div>
        </div>

        <div className="kpi-card kpi-card--row">
          <div className="kpi-icon-wrap icon-amber"><Icons.activity size={20} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Đăng Nhập 7 Ngày Qua</span>
            <span className="kpi-value" id="kpi-visited-7days">{formatNumber(stats.visited7Days)}</span>
            <span className="kpi-trend positive">Sinh viên tích cực tuần này</span>
          </div>
        </div>

        <div className="kpi-card kpi-card--row">
          <div className="kpi-icon-wrap icon-purple"><Icons.database size={20} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Tổng Sinh Viên Trong CSDL</span>
            <span className="kpi-value" id="kpi-visited-total">{formatNumber(stats.totalStudents)}</span>
            <span className="kpi-trend neutral">Hồ sơ CSDL PostgreSQL</span>
          </div>
        </div>
      </div>

      {/* Students Table Panel */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Danh Sách Sinh Viên Đã Vào Web</h2>
            <p className="card-subtitle">
              Bấm nút <strong>Hành trình</strong> để xem toàn bộ quá trình sinh viên xem trang, bấm nút và tương tác theo từng phiên.
            </p>
          </div>

          <div className="table-filter-bar">
            <div className="search-input-wrapper">
              <span className="search-icon"><Icons.search size={16} /></span>
              <input
                type="text"
                id="input-visited-search"
                className="admin-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Tìm sinh viên theo MSSV, tên hoặc lớp"
                placeholder="Tìm theo MSSV, Tên hoặc Lớp..."
              />
            </div>

            <select
              id="select-visited-filter"
              className="admin-select"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="active">Chỉ sinh viên đã vào web</option>
              <option value="all">Tất cả sinh viên trong CSDL</option>
            </select>

            <select
              id="select-visited-sort"
              className="admin-select"
              value={sortValue}
              onChange={(e) => {
                setSortValue(e.target.value);
                setPage(1);
              }}
            >
              <option value="last_login_at:desc">Vào gần nhất (Mới nhất)</option>
              <option value="first_login_at:asc">Lần đầu vào (Sớm nhất)</option>
              <option value="total_requests:desc">Nhiều lượt request nhất</option>
              <option value="full_name:asc">Tên sinh viên (A-Z)</option>
              <option value="mssv:asc">MSSV tăng dần</option>
            </select>

            <button
              type="button"
              className="btn-refresh"
              id="btn-refresh-visited"
              onClick={() => visitedQuery.refetch()}
              title="Làm mới dữ liệu"
            >
              <Icons.refresh size={15} />
              <span>Làm Mới</span>
            </button>
          </div>
        </div>

        {visitedQuery.isLoading ? (
          <SkeletonBlock rows={6} />
        ) : visitedQuery.isError ? (
          <ErrorState message={visitedQuery.error?.message} onRetry={() => visitedQuery.refetch()} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="admin-data-table">
                <caption className="sr-only">Danh sách sinh viên đã truy cập website</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '48px' }}>#</th>
                    <th scope="col" data-sort-key="mssv" aria-sort={sortBy === 'mssv' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      Sinh Viên
                    </th>
                    <th scope="col">Lớp / Khoa</th>
                    <th scope="col">Quan Tâm Gần Nhất</th>
                    <th scope="col" data-sort-key="last_login_at" aria-sort={sortBy === 'last_login_at' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      Hoạt Động Cuối
                    </th>
                    <th scope="col" data-sort-key="total_requests" aria-sort={sortBy === 'total_requests' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      Tương Tác / Req
                    </th>
                    <th scope="col">Trạng Thái</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Thao Tác</th>
                  </tr>
                </thead>
                <tbody id="visited-students-table-body">
                  {students.length === 0 ? (
                    <tr><td colSpan={8} className="text-center-muted">Không tìm thấy sinh viên nào phù hợp bộ lọc.</td></tr>
                  ) : (
                    students.map((s, idx) => {
                      const stt = (pagination.page - 1) * pagination.limit + idx + 1;
                      const fullName = s.full_name || 'Sinh viên BDU';
                      const classText = s.class_code || (s.faculty_code ? `Khoa ${s.faculty_code}` : '--');
                      const lastSeen = s.last_interaction_at || s.last_request_at || s.last_login_at;
                      const uiCount = safeNumber(s.interaction_count);
                      const reqCount = safeNumber(s.total_requests);

                      return (
                        <tr key={s.mssv}>
                          <td className="text-mono muted-cell">#{stt}</td>
                          <td>
                            <div className="student-cell">
                              <span className="avatar-badge avatar-badge--sm" aria-hidden="true">
                                {getInitials(fullName, s.mssv?.slice(0, 2))}
                              </span>
                              <div>
                                <strong className="student-name">{fullName}</strong>
                                <div><span className="mssv-tag">{s.mssv}</span></div>
                              </div>
                            </div>
                          </td>
                          <td>{classText}</td>
                          <td>
                            {s.recent_feature_label ? (
                              <span className="feature-chip-mini">{s.recent_feature_label}</span>
                            ) : (
                              <span className="muted-cell">--</span>
                            )}
                          </td>
                          <td title={lastSeen ? formatDateTime(lastSeen) : ''}>
                            <div className="time-cell">
                              <strong>{lastSeen ? formatRelativeTime(lastSeen) : 'Chưa có'}</strong>
                              {lastSeen ? <span className="muted-sub">{formatDateTime(lastSeen)}</span> : null}
                            </div>
                          </td>
                          <td className="text-mono">
                            <div className="counts-cell">
                              {uiCount > 0 ? <strong className="text-accent">{formatNumber(uiCount)} UI</strong> : null}
                              <span className="muted-sub">{formatNumber(reqCount)} req</span>
                            </div>
                          </td>
                          <td>
                            {s.is_active ? (
                              <span className="status-pill status-pill--active">
                                <Icons.checkCircle size={14} />
                                <span>Đã vào web</span>
                              </span>
                            ) : (
                              <span className="status-pill status-pill--inactive">
                                <span>Chưa kích hoạt</span>
                              </span>
                            )}
                          </td>
                          <td className="student-row-actions">
                            <button
                              type="button"
                              className="btn-filter-student btn-view-student-journey"
                              onClick={() => onOpenJourney?.(s.mssv)}
                            >
                              <Icons.route size={14} />
                              <span>Hành trình</span>
                            </button>
                            <button
                              type="button"
                              className="btn-filter-student"
                              onClick={() => onFilterLogs?.(s.mssv)}
                              title="Lọc nhật ký HTTP của sinh viên này"
                            >
                              <Icons.list size={14} />
                              <span>Logs</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar" id="visited-pagination-bar">
              <span className="pagination-info" id="visited-pagination-info">
                Hiển thị {startItem}–{endItem} trên tổng số {formatNumber(pagination.total)} sinh viên
              </span>
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="btn-page"
                  id="btn-visited-prev"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Trang Trước
                </button>
                <span className="page-current" id="visited-page-current">
                  {pagination.page} / {Math.max(1, pagination.totalPages)}
                </span>
                <button
                  type="button"
                  className="btn-page"
                  id="btn-visited-next"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Trang Sau →
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
