import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getVocabReviewSummary, getVocabThemes } from '../../api/vocab.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { VOCAB_MODES } from './modes.js';
import './vocab.css';

function difficultyColor(level) {
  if (level <= 1) return '#16a34a';
  if (level === 2) return '#65a30d';
  if (level === 3) return '#f59e0b';
  if (level === 4) return '#f97316';
  return '#ef4444';
}

const REVIEW_SCOPES = [
  { id: 'day', title: 'Ôn từ hôm qua', tone: 'is-blue', hint: 'từ đến hạn ôn hôm nay' },
  { id: 'week', title: 'Ôn từ tuần qua', tone: 'is-violet', hint: 'từ đến hạn trong 7 ngày' },
  { id: 'all', title: 'Ôn tập toàn bộ', tone: 'is-green', hint: 'theo tháng hoặc tất cả từ chưa thành thạo' }
];

function ReviewScopeModal({ counts, onClose, onPick }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="vocab-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="vocab-modal" role="dialog" aria-modal="true" aria-label="Chọn phạm vi ôn tập">
        <div className="vocab-modal-head">
          <h3>Chọn phạm vi ôn tập</h3>
          <button type="button" className="vocab-modal-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="vocab-quiz-choices">
          {REVIEW_SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              className={`vocab-choice ${scope.tone}`}
              onClick={() => onPick(scope.id)}
            >
              <strong>{scope.title}</strong>
              <span>{counts[scope.id]} từ · {scope.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function VocabThemesPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [scopeOpen, setScopeOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState('typing');

  const query = useQuery({
    queryKey: ['vocab-themes'],
    queryFn: ({ signal }) => getVocabThemes(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const reviewQuery = useQuery({
    queryKey: ['vocab-review-summary', auth.user?.mssv],
    queryFn: ({ signal }) => getVocabReviewSummary(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });
  const review = reviewQuery.data || { due_day: 0, due_week: 0, due_month: 0, mastered: 0, known_total: 0 };
  const scopeCounts = {
    day: Number(review.due_day || 0),
    week: Number(review.due_week || 0),
    all: Math.max(0, Number(review.known_total || 0) - Number(review.mastered || 0))
  };

  const themes = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);

  return (
    <section className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div>
          <h2 className="section-title">Luyện từ vựng</h2>
          <p className="section-desc">Mỗi ngày một ít, tích luỹ cho tương lai</p>
        </div>
      </div>

      {Number(review.known_total) > 0 ? (
        <div className="vocab-panel glass-panel">
          <div className="vocab-panel-head">
            <h3>Chọn chế độ học</h3>
            <span className="vocab-list-count">
              {review.known_total} từ đã thuộc · {review.mastered || 0} thành thạo
            </span>
          </div>
          <div className="vocab-modes">
            {VOCAB_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className="vocab-mode"
                style={{ background: `linear-gradient(140deg, ${m.color}, ${m.color}cc)` }}
                onClick={() => { setPendingMode(m.id); setScopeOpen(true); }}
                aria-label={`Ôn tập bằng ${m.title}`}
              >
                <span className="vocab-mode-icon" aria-hidden="true">{m.icon}</span>
                <strong>{m.title}</strong>
                <span className="vocab-mode-desc">{m.desc}</span>
                <span className="vocab-mode-points">{m.points} 🪙</span>
              </button>
            ))}
            <button
              type="button"
              className="vocab-mode"
              style={{ background: 'linear-gradient(140deg, #e11d48, #e11d48cc)' }}
              onClick={() => { setPendingMode('typing'); setScopeOpen(true); }}
              aria-label="Ôn tập từ vựng"
            >
              <span className="vocab-mode-icon" aria-hidden="true">🔁</span>
              <strong>Ôn tập</strong>
              <span className="vocab-mode-desc">Ôn bằng Typing theo lịch ngày / tuần / tháng</span>
              <span className="vocab-mode-points">{scopeCounts.day} từ đến hạn hôm nay</span>
            </button>
          </div>
        </div>
      ) : null}

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

      {scopeOpen ? (
        <ReviewScopeModal
          counts={scopeCounts}
          onClose={() => setScopeOpen(false)}
          onPick={(scope) => {
            setScopeOpen(false);
            navigate(`/vocab/review/${pendingMode}?bucket=${scope}`);
          }}
        />
      ) : null}
    </section>
  );
}
