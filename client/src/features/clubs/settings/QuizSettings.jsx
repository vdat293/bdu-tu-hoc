import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getClanQuiz, updateClanQuiz } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { safeNumber } from '../lib/format.js';
import { parseQuizText, QUIZ_IMPORT_SCHEMA } from '../lib/quiz.js';

export default function QuizSettings({ clanId, queryBase }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [minCorrect, setMinCorrect] = useState(0);
  const [importText, setImportText] = useState('');
  const [format, setFormat] = useState('json');

  const quizQuery = useQuery({
    queryKey: [...(queryBase || ['clan', auth.user?.mssv, String(clanId)]), 'quiz'],
    queryFn: ({ signal }) => getClanQuiz(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && clanId)
  });

  useEffect(() => {
    if (quizQuery.data) {
      setEnabled(Boolean(quizQuery.data.enabled));
      setMinCorrect(safeNumber(quizQuery.data.min_correct));
    }
  }, [quizQuery.data]);

  const save = useMutation({
    mutationFn: (payload) => updateClanQuiz(auth.token, clanId, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...(queryBase || ['clan', auth.user?.mssv, String(clanId)]), 'quiz'] });
      notify('Đã lưu cấu hình quiz gia nhập.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    let questions;
    if (importText.trim()) {
      try {
        questions = parseQuizText(importText, format);
      } catch (error) {
        notify(error.message, 'error');
        return;
      }
      if (questions.length > 30) return notify('Quiz chỉ được tối đa 30 câu hỏi.', 'warning');
    }
    save.mutate({ enabled, minCorrect: Number(minCorrect) || 0, ...(questions ? { questions } : {}) });
  };

  return (
    <form className="clb-surface clb-form" onSubmit={handleSubmit}>
      <div className="clb-panel-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>Quiz gia nhập</h2>
          <p>{quizQuery.data?.total || 0}/30 câu hỏi hiện có</p>
        </div>
        <label className="clb-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Bật quiz</span>
        </label>
      </div>

      {enabled && (
        <label className="clb-field" htmlFor="club-quiz-min">
          <span>Số câu đúng tối thiểu</span>
          <input
            id="club-quiz-min"
            className="clb-input clb-input--compact"
            type="number"
            min="0"
            max="30"
            value={minCorrect}
            onChange={(event) => setMinCorrect(Number(event.target.value))}
          />
        </label>
      )}

      <div className="clb-form-row">
        <label className="clb-field" htmlFor="club-quiz-import">
          <span>Nội dung câu hỏi (để trống để giữ nguyên)</span>
          <textarea
            id="club-quiz-import"
            className="clb-textarea"
            rows={4}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={QUIZ_IMPORT_SCHEMA}
          />
        </label>
        <label className="clb-field" htmlFor="club-quiz-format">
          <span>Định dạng</span>
          <select
            id="club-quiz-format"
            className="clb-select"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
      </div>

      <div className="clb-settings-bar">
        <button type="submit" className="clb-btn clb-btn--primary" disabled={save.isPending || quizQuery.isLoading}>
          {save.isPending ? 'Đang lưu…' : 'Lưu cấu hình quiz'}
        </button>
      </div>
    </form>
  );
}
