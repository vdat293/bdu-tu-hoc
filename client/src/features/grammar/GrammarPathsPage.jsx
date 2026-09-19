import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getGrammarGroups } from '../../api/grammar.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { difficultyColor, groupTheme } from './grammar-lib.js';
import './grammar.css';

export default function GrammarPathsPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['grammar-groups', auth.user?.mssv],
    queryFn: ({ signal }) => getGrammarGroups(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const groups = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const totals = useMemo(() => groups.reduce((acc, group) => {
    for (const path of group.paths || []) {
      acc.paths += 1;
      acc.lessons += Number(path.lesson_count || 0);
      acc.questions += Number(path.question_count || 0);
    }
    return acc;
  }, { paths: 0, lessons: 0, questions: 0 }), [groups]);

  return (
    <section className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div>
          <h2 className="section-title">Luyện ngữ pháp</h2>
          <p className="section-desc">
            {groups.length
              ? `${groups.length} nhóm · ${totals.paths} lộ trình · ${totals.lessons} bài học · ${totals.questions.toLocaleString('vi-VN')} câu hỏi`
              : 'Đang tải lộ trình ngữ pháp...'}
          </p>
        </div>
      </div>

      {query.isLoading ? (
        <div className="gr-grid" aria-busy="true">
          {[1, 2, 3, 4].map((k) => (
            <article className="gr-path-card glass-panel" key={k} aria-hidden="true">
              <SkeletonBlock className="skeleton-line heading" />
              <SkeletonBlock className="skeleton-line wide" />
              <SkeletonBlock className="skeleton-line short" />
            </article>
          ))}
        </div>
      ) : query.isError ? (
        <div className="glass-panel" style={{ padding: '40px 24px', textAlign: 'center', marginTop: '16px' }}>
          <h3>Không thể tải danh sách ngữ pháp</h3>
          <p>{query.error?.message || 'Vui lòng thử lại sau.'}</p>
          <button className="btn btn-primary" type="button" onClick={() => query.refetch()}>Thử lại</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', marginTop: '20px' }}>
          <h3>Chưa có dữ liệu ngữ pháp</h3>
          <p>Hệ thống đang crawl từ luyennguphap. Vui lòng quay lại sau khi admin chạy import.</p>
        </div>
      ) : (
        groups.map((group, groupIndex) => {
          const theme = groupTheme(group, groupIndex);
          return (
            <section className="gr-section" key={group.id}>
              <div className="gr-section-head">
                <h3>{group.name}</h3>
                <span className="gr-section-count">{group.paths.length} lộ trình</span>
              </div>
              <div className="gr-grid">
                {group.paths.map((path) => {
                  const color = difficultyColor(Number(path.difficulty) || 1);
                  const pct = Math.min(100, ((Number(path.difficulty) || 1) / 5) * 100);
                  const completed = Number(path.completed_lessons || 0);
                  const target = `/grammar/path/${encodeURIComponent(path.id)}`;
                  return (
                    <article
                      className="gr-path-card glass-panel"
                      key={path.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(target)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(target);
                        }
                      }}
                      aria-label={`Mở lộ trình ${path.name}`}
                    >
                      <div className="gr-path-banner" style={{ background: theme.banner }}>
                        <span className="gr-path-eyebrow">NGỮ PHÁP</span>
                        <strong className="gr-path-banner-label">{path.banner_label || path.name}</strong>
                        {path.badge_label ? <span className="gr-path-badge">{path.badge_label}</span> : null}
                      </div>
                      <div className="gr-path-body">
                        <h4 className="gr-path-name">{path.name}</h4>
                        <span className="gr-path-meta">
                          📚 {path.lesson_count} bài · {Number(path.question_count || 0).toLocaleString('vi-VN')} câu
                        </span>
                        {completed > 0 ? (
                          <span className="gr-path-done" style={{ color: theme.text, background: theme.soft }}>
                            ✓ Đã học {completed}/{path.lesson_count} bài
                          </span>
                        ) : null}
                        <div className="gr-difficulty">
                          <div className="gr-difficulty-row">
                            <span>ĐỘ KHÓ</span>
                            <strong style={{ color }}>{path.difficulty}/5</strong>
                          </div>
                          <div className="gr-difficulty-bar">
                            <div className="gr-difficulty-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
