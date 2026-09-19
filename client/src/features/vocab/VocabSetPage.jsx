import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getVocabSet, getVocabSets, getVocabWords, saveVocabProgress } from '../../api/vocab.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { PosBadge } from './games.jsx';
import { VOCAB_MODES, QUIZ_CHOICES } from './modes.js';
import { patchWordsCache, patchProgressInCache } from './vocab-cache.js';
import './vocab.css';

export { VOCAB_MODES, QUIZ_CHOICES };

function wordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.words)) return payload.words;
  return [];
}

function formatKnownAt(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function useDialogKeys(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

function QuizModeModal({ onClose, onPick }) {
  useDialogKeys(onClose);
  return createPortal(
    <div className="vocab-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="vocab-modal" role="dialog" aria-modal="true" aria-label="Chọn chế độ Quiz">
        <div className="vocab-modal-head">
          <h3>Chọn chế độ Quiz</h3>
          <button type="button" className="vocab-modal-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="vocab-quiz-choices">
          {QUIZ_CHOICES.map((choice) => (
            <button
              key={choice.id} type="button"
              className={`vocab-choice ${choice.tone}`}
              onClick={() => onPick(choice.id)}
            >
              <strong>{choice.title}</strong>
              <span>{choice.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function WordDetailModal({ word, onClose, onToggle, pending }) {
  useDialogKeys(onClose);
  if (!word) return null;
  const known = word.progress === 'known';
  return createPortal(
    <div className="vocab-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="vocab-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết từ ${word.term}`}>
        <div className="vocab-modal-head">
          <div className="vocab-detail-title">
            <strong>{word.term}</strong>
            <PosBadge pos={word.pos} />
          </div>
          <button type="button" className="vocab-modal-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        {word.pronunciation ? <p className="vocab-detail-phonetic">{word.pronunciation}</p> : null}
        <div className="vocab-detail-section">
          <span className="vocab-detail-label">NGHĨA</span>
          <p>{word.meaning}</p>
        </div>
        {word.example ? (
          <div className="vocab-detail-section">
            <span className="vocab-detail-label">VÍ DỤ</span>
            <p className="is-example">{word.example}</p>
          </div>
        ) : null}
        <button
          type="button"
          className={`vocab-detail-toggle ${known ? 'is-known' : ''}`}
          onClick={() => onToggle(word)}
          disabled={pending}
        >
          {known ? '✓ Đã thuộc — nhấn để bỏ' : '📙 Thêm vào từ đã thuộc'}
        </button>
      </div>
    </div>,
    document.body
  );
}

export default function VocabSetPage() {
  const { setId } = useParams();
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const client = useQueryClient();

  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState(20);
  const [order, setOrder] = useState('random');
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [quizOpen, setQuizOpen] = useState(false);
  const [detailWord, setDetailWord] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const setQuery = useQuery({
    queryKey: ['vocab-set', setId, auth.user?.mssv],
    queryFn: ({ signal }) => getVocabSet(auth.token, setId, { signal }),
    enabled: Boolean(auth.token && setId)
  });
  const setInfo = setQuery.data || null;
  const themeSlug = setInfo?.theme_slug || '';

  const setsQuery = useQuery({
    queryKey: ['vocab-sets', themeSlug, auth.user?.mssv],
    queryFn: ({ signal }) => getVocabSets(auth.token, themeSlug, { signal }),
    enabled: Boolean(auth.token && themeSlug)
  });
  const sets = Array.isArray(setsQuery.data) ? setsQuery.data : [];

  const wordsQuery = useQuery({
    queryKey: ['vocab-words', setId, status === 'all' ? undefined : status, limit, order, debouncedQ || undefined],
    queryFn: ({ signal }) => getVocabWords(auth.token, setId, {
      status: status === 'all' ? undefined : status, limit, order,
      q: debouncedQ || undefined, signal
    }),
    enabled: Boolean(auth.token && setId)
  });
  const words = wordsFrom(wordsQuery.data);
  const setTotal = Number(setInfo?.crawled || setInfo?.vocab_count) || words.length;

  const progressMutation = useMutation({
    mutationFn: ({ wordId, next }) => saveVocabProgress(auth.token, wordId, next),
    onMutate: async ({ wordId, next }) => {
      await client.cancelQueries({ queryKey: ['vocab-words'] });
      const snapshots = client.getQueriesData({ queryKey: ['vocab-words'] });
      client.setQueriesData({ queryKey: ['vocab-words'] }, (old) => patchWordsCache(old, wordId, next));
      return { snapshots };
    },
    onError: (error, { wordId, prev }, context) => {
      (context?.snapshots || []).forEach(([key, data]) => client.setQueryData(key, data));
      if (prev) {
        setDetailWord((current) => (current && current.id === wordId ? { ...current, progress: prev } : current));
      }
      notify(error?.message || 'Không thể lưu tiến độ.', 'error');
    },
    onSuccess: (_data, { wordId, next, term }) => {
      patchProgressInCache(client, wordId, next);
      // Cập nhật % ở trang theme/select nhưng KHÔNG refetch danh sách từ
      // (ORDER BY RANDOM() sẽ xáo trộn dòng và làm dòng vừa đổi biến mất).
      client.invalidateQueries({ queryKey: ['vocab-sets'] });
      client.invalidateQueries({ queryKey: ['vocab-theme'] });
      client.invalidateQueries({ queryKey: ['vocab-set', setId] });
      notify(next === 'known' ? `Đã thuộc "${term}"!` : `Đã chuyển "${term}" về chưa thuộc.`, 'success');
    }
  });

  const pendingWordId = progressMutation.isPending ? progressMutation.variables?.wordId : null;

  const setWordProgress = (word, next) => {
    if (pendingWordId) return;
    const prev = word.progress === 'known' ? 'known' : 'learning';
    setDetailWord((current) => (current && current.id === word.id ? { ...current, progress: next } : current));
    progressMutation.mutate({ wordId: word.id, next, prev, term: word.term });
  };

  const toggleProgress = (word) => {
    setWordProgress(word, word.progress === 'known' ? 'learning' : 'known');
  };

  const changeSet = (nextSetId) => {
    if (nextSetId && nextSetId !== setId) navigate(`/vocab/set/${encodeURIComponent(nextSetId)}`, { replace: true });
  };

  const openGame = (modeId, quizMode) => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    params.set('limit', String(limit));
    params.set('order', order);
    if (debouncedQ) params.set('q', debouncedQ);
    if (quizMode) params.set('quiz', quizMode);
    navigate(`/vocab/set/${encodeURIComponent(setId)}/${modeId}?${params}`);
  };

  return (
    <section className="tab-pane active">
      <button
        className="btn btn-secondary"
        type="button"
        onClick={() => navigate(themeSlug ? `/vocab/${encodeURIComponent(themeSlug)}` : '/vocab')}
        style={{ marginBottom: '12px' }}
      >
        ← {setInfo?.theme_title || 'Tất cả theme'}
      </button>
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div>
          <h2 className="section-title">{setInfo?.name || 'Bộ từ'}</h2>
          <p className="section-desc">
            {setInfo?.theme_title ? `${setInfo.theme_title} · ` : ''}{words.length}/{setTotal} từ
          </p>
        </div>
      </div>

      {/* Tùy chỉnh */}
      <div className="vocab-panel glass-panel">
        <div className="vocab-panel-head">
          <h3><span aria-hidden="true">⚙️</span> Tùy chỉnh</h3>
          <span className="vocab-count-pill">{words.length}/{setTotal} từ</span>
        </div>
        <div className="vocab-tune-grid">
          <label className="vocab-tune">
            <span className="vocab-tune-label">BỘ TỪ</span>
            <select className="vocab-select" value={setId} onChange={(e) => changeSet(e.target.value)} aria-label="Chọn bộ từ">
              {sets.map((s) => <option key={s.id} value={s.id}>📖 {s.name}</option>)}
            </select>
          </label>
          <label className="vocab-tune">
            <span className="vocab-tune-label">TRẠNG THÁI</span>
            <select className="vocab-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
              <option value="all">Tất cả</option>
              <option value="unlearned">Chưa thuộc</option>
              <option value="known">Đã thuộc</option>
              <option value="due">Đến hạn ôn</option>
            </select>
          </label>
          <label className="vocab-tune">
            <span className="vocab-tune-label">SỐ LƯỢNG</span>
            <select className="vocab-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Số lượng từ">
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} từ</option>)}
            </select>
          </label>
          <label className="vocab-tune">
            <span className="vocab-tune-label">THỨ TỰ</span>
            <select className="vocab-select" value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Thứ tự từ">
              <option value="random">Ngẫu nhiên</option>
              <option value="order">Theo thứ tự</option>
            </select>
          </label>
        </div>
      </div>

      {/* Chọn chế độ học */}
      <div className="vocab-panel glass-panel">
        <div className="vocab-panel-head">
          <h3>Chọn chế độ học</h3>
          <span className="vocab-panel-gear" aria-hidden="true">⚙️</span>
        </div>
        <div className="vocab-modes">
          {VOCAB_MODES.map((m) => (
            <button
              key={m.id} type="button"
              className="vocab-mode"
              style={{ background: `linear-gradient(140deg, ${m.color}, ${m.color}cc)` }}
              onClick={() => (m.id === 'quiz' ? setQuizOpen(true) : openGame(m.id))}
              disabled={!setId || wordsQuery.isLoading}
              aria-label={`Học bằng ${m.title}`}
            >
              <span className="vocab-mode-icon" aria-hidden="true">{m.icon}</span>
              <strong>{m.title}</strong>
              <span className="vocab-mode-desc">{m.desc}</span>
              <span className="vocab-mode-points">{m.points} 🪙</span>
            </button>
          ))}
        </div>
      </div>

      {/* Danh sách từ vựng */}
      <div className="vocab-panel glass-panel">
        <div className="vocab-panel-head">
          <h3>Danh sách từ vựng</h3>
          <span className="vocab-list-count">{words.length} từ</span>
        </div>
        <div className="vocab-list-toolbar">
          <div className="vocab-search">
            <span aria-hidden="true">🔍</span>
            <input type="search" placeholder="Tìm kiếm từ vựng..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm từ vựng" />
          </div>
          <select className="vocab-select vocab-filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc theo trạng thái thuộc">
            <option value="all">Tất cả</option>
            <option value="unlearned">Chưa thuộc</option>
            <option value="known">Đã thuộc</option>
            <option value="due">Đến hạn ôn</option>
          </select>
        </div>
        {wordsQuery.isLoading ? (
          <p>Đang tải từ vựng...</p>
        ) : words.length === 0 ? (
          <p>Không có từ nào. Hãy đổi bộ từ hoặc bộ lọc.</p>
        ) : (
          <div className="vocab-table-wrap">
            <table className="vocab-table">
              <thead><tr><th>TỪ VỰNG</th><th>NGHĨA</th><th>LOẠI TỪ</th><th>VÍ DỤ</th><th>NGÀY THUỘC</th><th>THUỘC</th></tr></thead>
              <tbody>
                {words.map((w) => {
                  const known = w.progress === 'known';
                  return (
                    <tr
                      key={w.id}
                      className={`vocab-row ${known ? 'is-known' : ''}`}
                      tabIndex={0}
                      onClick={() => setDetailWord(w)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetailWord(w); }}
                    >
                      <td>
                        <strong className="vocab-term">{w.term}</strong>
                        <br />
                        <em className="vocab-phonetic">{w.pronunciation}</em>
                      </td>
                      <td>{w.meaning}</td>
                      <td>{w.pos || '—'}</td>
                      <td className="vocab-example">{w.example}</td>
                      <td className="vocab-known-date">{formatKnownAt(w.known_at)}</td>
                      <td className="vocab-progress-cell">
                        <button
                          type="button"
                          className={`vocab-known-toggle ${known ? 'is-known' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleProgress(w); }}
                          disabled={pendingWordId === w.id}
                          aria-pressed={known}
                          aria-label={`${w.term}: ${known ? 'đã thuộc, nhấn để chuyển về chưa thuộc' : 'chưa thuộc, nhấn để đánh dấu đã thuộc'}`}
                          title={known ? 'Đã thuộc — nhấn để chuyển về chưa thuộc' : 'Chưa thuộc — nhấn để đánh dấu đã thuộc'}
                        >
                          {known ? '✓ Đã thuộc' : '○ Chưa thuộc'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {quizOpen ? (
        <QuizModeModal
          onClose={() => setQuizOpen(false)}
          onPick={(quizMode) => { setQuizOpen(false); openGame('quiz', quizMode); }}
        />
      ) : null}

      {detailWord ? (
        <WordDetailModal
          word={detailWord}
          pending={pendingWordId === detailWord.id}
          onClose={() => setDetailWord(null)}
          onToggle={toggleProgress}
        />
      ) : null}
    </section>
  );
}
