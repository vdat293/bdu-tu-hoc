import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getVocabThemes } from '../../api/vocab.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import './vocab.css';

function difficultyColor(level) {
  if (level <= 1) return '#16a34a';
  if (level === 2) return '#65a30d';
  if (level === 3) return '#f59e0b';
  if (level === 4) return '#f97316';
  return '#ef4444';
}

export default function VocabThemesPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['vocab-themes'],
    queryFn: ({ signal }) => getVocabThemes(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const themes = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);

  return (
    <section className="tab-pane active">
      <div className="section-header-box glass-panel">
        <h2 className="section-title">Luyện từ vựng</h2>
        <p className="section-desc">
          {themes.length
            ? `${themes.length} theme · Flashcard, Quiz, Typing, Ghép cặp — không cần Listening`
            : 'Đang tải theme từ máy chủ...'}
        </p>
      </div>

      {query.isLoading ? (
        <div className="vocab-grid" aria-busy="true">
          {[1, 2, 3, 4, 5, 6].map((k) => (
            <article className="vocab-card glass-panel" key={k} aria-hidden="true">
              <SkeletonBlock className="skeleton-line heading" />
              <SkeletonBlock className="skeleton-line wide" />
              <SkeletonBlock className="skeleton-line short" />
            </article>
          ))}
        </div>
      ) : themes.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', marginTop: '20px' }}>
          <h3>Chưa có dữ liệu từ vựng</h3>
          <p>Hệ thống đang crawl từ luyentu. Vui lòng quay lại sau khi admin chạy import.</p>
        </div>
      ) : (
        <div className="vocab-grid" style={{ marginTop: '20px' }}>
          {themes.map((t) => {
            const color = difficultyColor(Number(t.difficulty) || 1);
            const pct = Math.min(100, ((Number(t.difficulty) || 1) / 5) * 100);
            return (
              <article
                className="vocab-card glass-panel"
                key={t.slug}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vocab/${encodeURIComponent(t.slug)}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') navigate(`/vocab/${encodeURIComponent(t.slug)}`);
                }}
                aria-label={`Mở theme ${t.title}`}
              >
                <h3 className="vocab-card-title">{t.title}</h3>
                <span className="vocab-count-badge">📚 {t.total_sets} bộ từ</span>
                <div className="vocab-difficulty">
                  <div className="vocab-difficulty-row">
                    <span>ĐỘ KHÓ</span>
                    <strong style={{ color }}>{t.difficulty}/5</strong>
                  </div>
                  <div className="vocab-difficulty-bar">
                    <div className="vocab-difficulty-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
