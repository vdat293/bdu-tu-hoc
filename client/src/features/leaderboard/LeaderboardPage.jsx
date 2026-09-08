import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getAcademicLeaderboard } from '../../api/academics.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';

const scopes = [
  { id: 'class', label: 'Lớp' },
  { id: 'faculty', label: 'Khoa' },
  { id: 'institute', label: 'Viện' },
  { id: 'school', label: 'Toàn trường' }
];

const metrics = [
  { id: 'gpa', label: 'GPA tích lũy' },
  { id: 'credits', label: 'Tín chỉ tích lũy' },
  { id: 'overall', label: 'Xếp hạng tổng' }
];

export const LEADERBOARD_REFRESH_INTERVAL_MS = 60 * 1000;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function formatUpdatedAt(value) {
  if (!value) return 'Dữ liệu mới nhất';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `Cập nhật ${date.toLocaleString('vi-VN')}`;
}

export function normalizeLeaderboard(data) {
  const raw = data?.data || data || {};
  const items = Array.isArray(raw.students)
    ? raw.students
    : Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.leaderboard)
        ? raw.leaderboard
        : Array.isArray(raw)
          ? raw
          : [];
  return {
    items,
    total: firstDefined(raw.student_count, raw.total, raw.count, Array.isArray(raw) ? raw.length : undefined, items.length),
    myRank: firstDefined(raw.myRank, raw.current_rank, raw.my_rank, items.find((item) => item?.la_sinh_vien_hien_tai)),
    scopeName: raw.scopeName || raw.scope_name || 'Toàn trường',
    updatedAt: formatUpdatedAt(firstDefined(raw.synced_at, raw.updatedAt, raw.updated_at))
  };
}

function valueForMetric(item, metric) {
  if (metric === 'overall') {
    return firstDefined(item.gpa_tich_luy, item.gpa, item.gia_tri, item.score, item.diem);
  }
  if (metric === 'credits') {
    return firstDefined(item.gia_tri, item.tin_chi_tich_luy, item.credits, item.tin_chi, item.score);
  }
  return firstDefined(item.gia_tri, item.score, item.gpa, item.diem);
}

function creditsFor(item) {
  return firstDefined(item.tin_chi_tich_luy, item.credits, item.tin_chi);
}

export function leaderboardRowKey(item, index) {
  // MSSV của sinh viên khác đã được che trên API (vd. 24••••25), nên không thể
  // dùng riêng giá trị đó làm React key: rất nhiều sinh viên sẽ bị trùng key.
  // Hàng không có state riêng, vì vậy chỉ số của danh sách đã sắp xếp là định
  // danh an toàn và luôn duy nhất cho lần render hiện tại.
  return `leaderboard-row-${index}-${firstDefined(item.hang, item.rank, 'unranked')}`;
}

export function leaderboardQueryOptions({ token, mssv, scope, metric }) {
  return {
    queryKey: ['leaderboard', mssv, scope, metric],
    queryFn: ({ signal }) => getAcademicLeaderboard(token, { scope, metric, signal }),
    enabled: Boolean(token),
    refetchInterval: LEADERBOARD_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true
  };
}

export default function LeaderboardPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') || 'school';
  const metric = params.get('metric') || 'gpa';

  const setScope = (val) => {
    const next = new URLSearchParams(params);
    next.set('scope', val);
    setParams(next);
  };

  const setMetric = (val) => {
    const next = new URLSearchParams(params);
    next.set('metric', val);
    setParams(next);
  };

  const query = useQuery(leaderboardQueryOptions({ token: auth.token, mssv: auth.user?.mssv, scope, metric }));

  const parsed = useMemo(() => normalizeLeaderboard(query.data), [query.data]);
  const activeScopeLabel = scopes.find((s) => s.id === scope)?.label || 'Toàn trường';
  const activeMetricLabel = metrics.find((m) => m.id === metric)?.label || 'GPA tích lũy';
  const isOverall = metric === 'overall';
  const showCredits = isOverall;
  const hasItems = parsed.items.length > 0;

  return (
    <section id="tab-leaderboard" className="tab-pane active">
      <div className="section-header-box glass-panel leaderboard-header-box">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Bảng Xếp Hạng Học Tập</h2>
            <p id="leaderboard-context-description" className="section-desc">
              So sánh thành tích học tập theo phạm vi bạn chọn
            </p>
          </div>
        </div>
      </div>

      <div className="leaderboard-toolbar glass-panel">
        <div className="leaderboard-switch-group" aria-label="Phạm vi xếp hạng">
          <span className="leaderboard-switch-label">Phạm vi</span>
          <div className="leaderboard-segments" id="leaderboard-scope-buttons">
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                className={scope === s.id ? 'active' : ''}
                onClick={() => setScope(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="leaderboard-switch-group" aria-label="Chỉ số xếp hạng">
          <span className="leaderboard-switch-label">Thành tích</span>
          <div className="leaderboard-segments" id="leaderboard-metric-buttons">
            {metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                className={metric === m.id ? 'active' : ''}
                onClick={() => setMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="leaderboard-board glass-panel" aria-live="polite">
        <div className="leaderboard-board-head">
          <div>
            <span id="leaderboard-eyebrow" className="leaderboard-eyebrow">
              {activeScopeLabel.toUpperCase()} · {activeMetricLabel.toUpperCase()}
            </span>
            <h3 id="leaderboard-title">Bảng xếp hạng thành tích</h3>
          </div>
          <div className="leaderboard-board-meta">
            <strong id="leaderboard-student-count">{parsed.total ?? parsed.items.length} sinh viên</strong>
            <span id="leaderboard-updated-at">{parsed.updatedAt}</span>
            {query.isFetching && !query.isLoading && <span className="leaderboard-refreshing" role="status">Đang cập nhật…</span>}
          </div>
        </div>

        {query.isLoading ? (
          <div id="leaderboard-table-wrap" className="leaderboard-table-wrap" aria-busy="true" aria-label="Đang tải bảng xếp hạng">
            <div className="leaderboard-table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Hạng</th>
                    <th>Sinh viên</th>
                    <th>Lớp</th>
                    <th className="leaderboard-value-heading">{isOverall ? 'GPA tích lũy' : activeMetricLabel}</th>
                    {showCredits && <th className="leaderboard-credit-heading">Tín chỉ</th>}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((row) => (
                    <tr key={row} aria-hidden="true">
                      <td><SkeletonBlock className="skeleton-line short" /></td>
                      <td><SkeletonBlock className="skeleton-line heading" /></td>
                      <td><SkeletonBlock className="skeleton-line medium" /></td>
                      <td><SkeletonBlock className="skeleton-line short" /></td>
                      {showCredits && <td><SkeletonBlock className="skeleton-line short" /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : query.isError && !hasItems ? (
          <div id="leaderboard-error" className="leaderboard-message leaderboard-error" role="alert">
            <strong>Không thể tải bảng xếp hạng.</strong>
            <span>Dữ liệu chưa được tải. Vui lòng thử lại.</span>
            <button type="button" className="leaderboard-retry" onClick={() => query.refetch()}>Thử lại</button>
          </div>
        ) : !hasItems ? (
          <div id="leaderboard-empty" className="leaderboard-message">
            Chưa có dữ liệu cho khóa này. Hãy quay lại sau lần cập nhật tiếp theo.
          </div>
        ) : (
          <div id="leaderboard-table-wrap" className="leaderboard-table-wrap">
            {query.isError && (
              <div className="leaderboard-refresh-error" role="status">
                Chưa thể cập nhật dữ liệu mới. Đang hiển thị lần tải thành công gần nhất.
                <button type="button" className="leaderboard-retry" onClick={() => query.refetch()}>Thử lại</button>
              </div>
            )}
            <div id="leaderboard-table-scroll" className="leaderboard-table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Hạng</th>
                    <th>Sinh viên</th>
                    <th id="leaderboard-group-heading">Lớp</th>
                    <th className="leaderboard-value-heading">{isOverall ? 'GPA tích lũy' : activeMetricLabel}</th>
                    {showCredits && <th id="leaderboard-credit-heading" className="leaderboard-credit-heading">Tín chỉ</th>}
                  </tr>
                </thead>
                <tbody id="leaderboard-table-body">
                  {parsed.items.map((item, idx) => {
                    const rank = firstDefined(item.rank, item.hang, idx + 1);
                    const isMe = item.la_sinh_vien_hien_tai || item.mssv === auth.user?.mssv;
                    const rankBadgeClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
                    const score = valueForMetric(item, metric);
                    const credits = creditsFor(item);
                    return (
                      <tr key={leaderboardRowKey(item, idx)} className={isMe ? 'leaderboard-row-me' : ''}>
                        <td>
                          <span className={`leaderboard-rank-badge ${rankBadgeClass}`}>
                            #{rank}
                          </span>
                        </td>
                        <td>
                          <div className="leaderboard-student-identity">
                            <strong>{item.name || item.ho_ten || 'Sinh viên'}</strong>
                            <span>{item.mssv || '---'}</span>
                            {isMe && <em>Bạn</em>}
                          </div>
                        </td>
                        <td>{firstDefined(item.className, item.lop, item.ma_lop, item.faculty, item.ma_khoa, activeScopeLabel)}</td>
                        <td className="leaderboard-score-cell">
                          <strong>{score ?? '--'}</strong>
                        </td>
                        {showCredits && (
                          <td className="leaderboard-score-cell">
                            {credits ?? '--'} TC
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {parsed.myRank && (
              <div id="leaderboard-current-rank" className={`leaderboard-current-rank${isOverall ? ' is-overall' : ''}`} role="status">
                <div className="leaderboard-current-rank-row">
                  <div className="leaderboard-current-rank-cell">
                    <span id="leaderboard-current-position" className="leaderboard-rank-badge">
                      #{firstDefined(parsed.myRank.rank, parsed.myRank.hang, '--')}
                    </span>
                  </div>
                  <div className="leaderboard-current-student-cell">
                    <div className="leaderboard-student-identity">
                      <strong id="leaderboard-current-name">{auth.user?.name || 'Bạn'}</strong>
                      <span id="leaderboard-current-mssv">{auth.user?.mssv}</span>
                      <em>Bạn</em>
                    </div>
                  </div>
                  <div id="leaderboard-current-group" className="leaderboard-current-group-cell leaderboard-group-cell">
                    {activeScopeLabel}
                  </div>
                  <div id="leaderboard-current-value" className="leaderboard-current-value-cell leaderboard-score-cell">
                    {valueForMetric(parsed.myRank, metric) ?? '--'}
                  </div>
                  {showCredits && (
                    <div id="leaderboard-current-credit" className="leaderboard-current-credit-cell leaderboard-score-cell">
                      {creditsFor(parsed.myRank) ?? '--'} TC
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
