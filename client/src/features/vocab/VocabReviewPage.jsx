import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getVocabReviewWords, reviewVocabWord } from '../../api/vocab.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { FlashcardGame, MatchGame, QuizGame, TypingGame } from './games.jsx';
import './vocab.css';

const GAME_MODES = new Set(['flashcard', 'quiz', 'typing', 'match']);
const SCOPES = {
  day: { label: 'Từ hôm qua', hint: 'từ đến hạn ôn hôm nay' },
  week: { label: 'Từ tuần qua', hint: 'từ đến hạn trong 7 ngày' },
  month: { label: 'Theo tháng', hint: 'từ đến hạn trong 30 ngày' },
  all: { label: 'Toàn bộ', hint: 'theo tháng hoặc tất cả từ chưa thành thạo' }
};

function wordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.words)) return payload.words;
  return [];
}

export default function VocabReviewPage() {
  const { mode } = useParams();
  const [params] = useSearchParams();
  const auth = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [round, setRound] = useState(0);

  const bucketParam = params.get('bucket');
  const bucket = SCOPES[bucketParam] ? bucketParam : 'day';
  const scope = SCOPES[bucket];
  const validMode = GAME_MODES.has(mode);

  const wordsQuery = useQuery({
    queryKey: ['vocab-review-words', bucket],
    queryFn: ({ signal }) => getVocabReviewWords(auth.token, { bucket, limit: 100, signal }),
    enabled: Boolean(auth.token && validMode)
  });
  const words = wordsFrom(wordsQuery.data);

  const reviewMutation = useMutation({
    mutationFn: ({ wordId, result }) => reviewVocabWord(auth.token, wordId, result),
    onError: (error) => notify(error?.message || 'Không thể lưu kết quả ôn tập.', 'error'),
    onSuccess: () => {
      // Chỉ làm mới thống kê; KHÔNG refetch danh sách đang chơi để tránh xáo trộn giữa lượt.
      client.invalidateQueries({ queryKey: ['vocab-review-summary'] });
      client.invalidateQueries({ queryKey: ['vocab-sets'] });
      client.invalidateQueries({ queryKey: ['vocab-theme'] });
    }
  });

  const record = async (wordId, next) => {
    try {
      await reviewMutation.mutateAsync({ wordId, result: next === 'known' ? 'pass' : 'fail' });
    } catch { /* toast đã hiện */ }
  };

  const replay = () => setRound((r) => r + 1);
  const back = () => navigate('/vocab');

  if (!validMode) {
    return (
      <section className="tab-pane active">
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <h3>Chế độ ôn tập không tồn tại</h3>
          <button className="btn btn-secondary" type="button" onClick={back}>← Về trang luyện từ</button>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-pane active">
      <button className="btn btn-secondary" type="button" onClick={back} style={{ marginBottom: '12px' }}>
        ← Ôn tập
      </button>

      <p className="vocab-game-sub">
        Ôn tập · {scope.label}
        {words.length ? ` · ${words.length} từ đến hạn` : ''}
      </p>

      {wordsQuery.isLoading ? (
        <div className="vg-card" aria-busy="true">
          <p style={{ textAlign: 'center' }}>Đang tải từ cần ôn...</p>
        </div>
      ) : words.length === 0 ? (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <h3>Không có từ nào đến hạn</h3>
          <p>Phạm vi &quot;{scope.label}&quot; chưa có từ cần ôn. Hãy quay lại sau hoặc chọn phạm vi khác.</p>
          <button className="btn btn-primary" type="button" onClick={back}>← Về trang luyện từ</button>
        </div>
      ) : (
        <>
          {mode === 'flashcard' ? <FlashcardGame key={round} words={words} onProgress={record} onReplay={replay} onExit={back} /> : null}
          {mode === 'quiz' ? <QuizGame key={round} words={words} onProgress={record} onReplay={replay} onExit={back} /> : null}
          {mode === 'typing' ? <TypingGame key={round} words={words} onProgress={record} onReplay={replay} onExit={back} /> : null}
          {mode === 'match' ? <MatchGame key={round} words={words} onProgress={record} onReplay={replay} onExit={back} /> : null}
        </>
      )}
    </section>
  );
}
