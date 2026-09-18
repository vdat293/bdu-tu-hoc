import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getVocabWords, saveVocabProgress } from '../../api/vocab.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { FlashcardGame, QuizGame, TypingGame, MatchGame } from './games.jsx';
import { patchProgressInCache } from './vocab-cache.js';
import './vocab.css';

const GAME_MODES = new Set(['flashcard', 'quiz', 'typing', 'match']);
const QUIZ_MODES = new Set(['word-meaning', 'meaning-word', 'context']);

function wordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.words)) return payload.words;
  return [];
}

export default function VocabGamePage() {
  const { setId, mode } = useParams();
  const [params] = useSearchParams();
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [round, setRound] = useState(0);

  const status = params.get('status') || undefined;
  const limit = Number(params.get('limit')) || 20;
  const order = params.get('order') || 'random';
  const q = params.get('q') || undefined;
  const requestedQuiz = params.get('quiz') || 'word-meaning';
  const quizMode = QUIZ_MODES.has(requestedQuiz) ? requestedQuiz : 'word-meaning';
  const validMode = GAME_MODES.has(mode);

  const wordsQuery = useQuery({
    queryKey: ['vocab-words', setId, status, limit, order, q],
    queryFn: ({ signal }) => getVocabWords(auth.token, setId, { status, limit, order, q, signal }),
    enabled: Boolean(auth.token && setId && validMode)
  });
  const words = wordsFrom(wordsQuery.data);
  const setInfo = wordsQuery.data?.set;

  const progressMutation = useMutation({
    mutationFn: ({ wordId, next }) => saveVocabProgress(auth.token, wordId, next),
    onError: (error) => notify(error?.message || 'Không thể lưu tiến độ.', 'error'),
    onSuccess: (_data, { wordId, next }) => {
      patchProgressInCache(client, wordId, next);
      // Cập nhật % ở trang theme/tiến độ bộ từ khi quay lại.
      client.invalidateQueries({ queryKey: ['vocab-sets'] });
      client.invalidateQueries({ queryKey: ['vocab-theme'] });
      client.invalidateQueries({ queryKey: ['vocab-set', setId] });
    }
  });

  const recordProgress = async (wordId, next) => {
    try { await progressMutation.mutateAsync({ wordId, next }); } catch { /* toast đã hiện */ }
  };

  const replay = () => setRound((r) => r + 1);
  const unitUrl = setId ? `/vocab/set/${encodeURIComponent(setId)}` : '/vocab';
  // Deep link trực tiếp vào game không có history để quay lại -> fallback về trang bộ từ.
  const location = useLocation();
  const exit = () => (location.key === 'default' ? navigate(unitUrl, { replace: true }) : navigate(-1));

  if (!validMode) {
    return (
      <section className="tab-pane active">
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <h3>Chế độ học không tồn tại</h3>
          <button className="btn btn-secondary" type="button" onClick={() => navigate(unitUrl)}>← Về bộ từ</button>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-pane active">
      <p className="vocab-game-sub">
        {setInfo ? setInfo.name : 'Đang tải...'}
        {status === 'known' ? ' · Đã thuộc' : status === 'unlearned' ? ' · Chưa thuộc' : ''}
        {words.length ? ` · ${words.length} từ` : ''}
      </p>

      {wordsQuery.isLoading ? (
        <div className="vg-card" aria-busy="true">
          <p style={{ textAlign: 'center' }}>Đang tải từ vựng...</p>
        </div>
      ) : (
        <>
          {mode === 'flashcard' ? <FlashcardGame key={round} words={words} onProgress={recordProgress} onReplay={replay} onExit={exit} /> : null}
          {mode === 'quiz' ? <QuizGame key={`${round}-${quizMode}`} words={words} quizMode={quizMode} onReplay={replay} onExit={exit} /> : null}
          {mode === 'typing' ? <TypingGame key={round} words={words} onProgress={recordProgress} onReplay={replay} onExit={exit} /> : null}
          {mode === 'match' ? <MatchGame key={round} words={words} onReplay={replay} onExit={exit} /> : null}
        </>
      )}
    </section>
  );
}
