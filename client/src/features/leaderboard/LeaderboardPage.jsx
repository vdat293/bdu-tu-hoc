import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getAcademicLeaderboard } from '../../api/academics.js';
import { useAuth } from '../../app/providers.jsx';

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

function normalize(data) {
  const raw = data?.data || data || {};
  return {
    items: Array.isArray(raw.items) ? raw.items : Array.isArray(raw.leaderboard) ? raw.leaderboard : Array.isArray(raw) ? raw : [],
    total: raw.total || raw.count || (Array.isArray(raw) ? raw.length : 0),
    myRank: raw.myRank || raw.current_rank || null,
    scopeName: raw.scopeName || raw.scope_name || 'Toàn trường',
    updatedAt: raw.updatedAt || raw.updated_at || 'Hôm nay'
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

  const query = useQuery({
    queryKey: ['leaderboard', auth.user?.mssv, scope, metric],
    queryFn: ({ signal }) => getAcademicLeaderboard(auth.token, { scope, metric, signal }),
    enabled: Boolean(auth.token)
  });

  const parsed = useMemo(() => normalize(query.data), [query.data]);
  const activeScopeLabel = scopes.find((s) => s.id === scope)?.label || 'Toàn trường';
  const activeMetricLabel = metrics.find((m) => m.id === metric)?.label || 'GPA tích lũy';

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
            <strong id="leaderboard-student-count">{parsed.total || parsed.items.length} sinh viên</strong>
            <span id="leaderboard-updated-at">{parsed.updatedAt}</span>
          </div>
        </div>

        {query.isLoading ? (
          <div id="leaderboard-loading" className="leaderboard-message">
            <span className="leaderboard-loading-dot"></span>
            Đang tải bảng xếp hạng...
          </div>
        ) : parsed.items.length === 0 ? (
          <div id="leaderboard-empty" className="leaderboard-message">
            Chưa có dữ liệu cho khóa này. Hãy quay lại sau lần cập nhật tiếp theo.
          </div>
        ) : (
          <div id="leaderboard-table-wrap" className="leaderboard-table-wrap">
            <div id="leaderboard-table-scroll" className="leaderboard-table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Hạng</th>
                    <th>Sinh viên</th>
                    <th id="leaderboard-group-heading">Phạm vi</th>
                    <th className="leaderboard-value-heading">Thành tích</th>
                    {metric !== 'credits' && <th id="leaderboard-credit-heading" className="leaderboard-credit-heading">Tín chỉ</th>}
                  </tr>
                </thead>
                <tbody id="leaderboard-table-body">
                  {parsed.items.map((item, idx) => {
                    const rank = item.rank || idx + 1;
                    const isMe = item.mssv === auth.user?.mssv;
                    const rankBadgeClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
                    return (
                      <tr key={`${item.mssv || idx}`} className={isMe ? 'leaderboard-row-me' : ''}>
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
                        <td>{item.className || item.lop || item.faculty || activeScopeLabel}</td>
                        <td className="leaderboard-score-cell">
                          <strong>{item.score || item.gpa || item.diem || '--'}</strong>
                        </td>
                        {metric !== 'credits' && (
                          <td className="leaderboard-score-cell">
                            {item.credits || item.tin_chi || '--'} TC
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {parsed.myRank && (
              <div id="leaderboard-current-rank" className="leaderboard-current-rank" role="status">
                <div className="leaderboard-current-rank-row">
                  <div className="leaderboard-current-rank-cell">
                    <span id="leaderboard-current-position" className="leaderboard-rank-badge">
                      #{parsed.myRank.rank || '--'}
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
                    {parsed.myRank.score || '--'}
                  </div>
                  {metric !== 'credits' && (
                    <div id="leaderboard-current-credit" className="leaderboard-current-credit-cell leaderboard-score-cell">
                      {parsed.myRank.credits || '--'} TC
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
