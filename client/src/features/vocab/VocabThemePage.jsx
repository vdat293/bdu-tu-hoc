import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getVocabTheme, getVocabSets } from '../../api/vocab.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import './vocab.css';

function pctOf(known, total) {
  return total > 0 ? Math.round((known / total) * 100) : 0;
}

export default function VocabThemePage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();

  const themeQuery = useQuery({
    queryKey: ['vocab-theme', slug, auth.user?.mssv],
    queryFn: ({ signal }) => getVocabTheme(auth.token, slug, { signal }),
    enabled: Boolean(auth.token && slug)
  });
  const setsQuery = useQuery({
    queryKey: ['vocab-sets', slug, auth.user?.mssv],
    queryFn: ({ signal }) => getVocabSets(auth.token, slug, { signal }),
    enabled: Boolean(auth.token && slug)
  });

  const theme = themeQuery.data || null;
  const sets = useMemo(() => (Array.isArray(setsQuery.data) ? setsQuery.data : []), [setsQuery.data]);
  const totalWords = Number(theme?.total_words || 0);
  const knownWords = Math.min(Number(theme?.known_words || 0), totalWords);
  const donePct = pctOf(knownWords, totalWords);

  if (themeQuery.isError && !theme) {
    const notFound = themeQuery.error?.status === 404;
    return (
      <section className="tab-pane active">
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/vocab')} style={{ marginBottom: '12px' }}>
          ← Tất cả theme
        </button>
        <div className="glass-panel" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <h3>{notFound ? 'Không tìm thấy theme' : 'Không thể tải theme'}</h3>
          <p>{notFound ? 'Theme không tồn tại hoặc đã bị gỡ.' : (themeQuery.error?.message || 'Vui lòng thử lại sau.')}</p>
          <button className="btn btn-primary" type="button" onClick={() => themeQuery.refetch()}>Thử lại</button>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-pane active">
      <button className="btn btn-secondary" type="button" onClick={() => navigate('/vocab')} style={{ marginBottom: '12px' }}>
        ← Tất cả theme
      </button>

      <div className="vocab-panel glass-panel vocab-theme-hero">
        <div className="vocab-theme-head">
          <span className="vocab-theme-icon" aria-hidden="true">📖</span>
          <h2 className="vocab-theme-title">{theme?.title || 'Đang tải...'}</h2>
          <div className="vocab-theme-badges">
            <span className="vocab-theme-badge is-sky">📚 {theme?.total_sets ?? sets.length} bộ từ</span>
            <span className="vocab-theme-badge is-mint">🔤 {totalWords} từ vựng</span>
            <span className="vocab-theme-badge is-violet">✓ {donePct}% hoàn thành</span>
          </div>
        </div>
        <div className="vocab-theme-progress">
          <div className="vocab-theme-progress-label">
            <span>Tiến độ: <strong>{knownWords}/{totalWords} từ</strong></span>
            <span className="vocab-theme-difficulty">Độ khó {theme?.difficulty || 1}/5</span>
          </div>
          <div
            className="vocab-theme-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalWords || 1}
            aria-valuenow={knownWords}
            aria-label={`Tiến độ ${knownWords}/${totalWords} từ`}
          >
            <i style={{ width: `${donePct}%` }} />
          </div>
        </div>
      </div>

      <div className="vocab-panel glass-panel">
        <div className="vocab-panel-head">
          <h3>Các bộ từ</h3>
          <span className="vocab-list-count">{sets.length} bộ</span>
        </div>

        {setsQuery.isLoading ? (
          <div className="vocab-set-grid" aria-busy="true">
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <article className="vocab-set-card glass-panel" key={k} aria-hidden="true">
                <SkeletonBlock className="skeleton-line heading" />
                <SkeletonBlock className="skeleton-line wide" />
                <SkeletonBlock className="skeleton-line short" />
              </article>
            ))}
          </div>
        ) : sets.length === 0 ? (
          <p>Theme chưa có bộ từ.</p>
        ) : (
          <div className="vocab-set-grid">
            {sets.map((s, index) => {
              const total = Number(s.crawled || s.vocab_count || 0);
              const known = Number(s.known_count || 0);
              const pct = pctOf(known, total);
              const target = `/vocab/set/${encodeURIComponent(s.id)}`;
              return (
                <article
                  key={s.id}
                  className="vocab-set-card glass-panel"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(target)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(target); }
                  }}
                  aria-label={`Học bộ từ ${s.name}`}
                >
                  <div className="vocab-set-card-top">
                    <span className="vocab-set-index">#{index + 1}</span>
                    <span className="vocab-set-pct" style={{ color: pct > 0 ? '#16a34a' : '#94a3b8' }}>{pct}%</span>
                  </div>
                  <strong className="vocab-set-name">{s.name}</strong>
                  <span className="vocab-set-count">{known}/{total} từ</span>
                  <div className="vocab-set-progress" aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <span className="vocab-set-play" aria-hidden="true">▶</span>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
