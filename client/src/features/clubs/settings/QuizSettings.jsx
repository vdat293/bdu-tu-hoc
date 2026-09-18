import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getClanQuiz, updateClanQuiz } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { parseQuizText, QUIZ_IMPORT_SCHEMA } from '../lib/quiz.js';
import { safeNumber } from '../lib/format.js';

// Bản gọn của form quiz cũ: toggle + ngưỡng đúng + import JSON/CSV + lưu.
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

  const submit = (event) => {
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
    <form className="club-panel" onSubmit={submit}>
      <div className="club-settings-row">
        <div><h2>Quiz gia nhập</h2><p>{quizQuery.data?.total || 0}/30 câu hỏi</p></div>
        <label className="club-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>Bật quiz</span></label>
      </div>
      {enabled && (
        <label htmlFor="club-quiz-min">Số câu đúng tối thiểu
          <input id="club-quiz-min" className="form-input club-input--sm" type="number" min="0" max="30" value={minCorrect} onChange={(e) => setMinCorrect(Number(e.target.value))} />
        </label>
      )}
      <div className="club-form-grid">
        <label htmlFor="club-quiz-format">Định dạng
          <select id="club-quiz-format" className="form-input" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label htmlFor="club-quiz-import">Nội dung câu hỏi (để trống để giữ nguyên)
          <textarea id="club-quiz-import" className="form-input" rows={4} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={QUIZ_IMPORT_SCHEMA} />
        </label>
      </div>
      <div className="club-settings-actionbar">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || quizQuery.isLoading}>
          {save.isPending ? 'Đang lưu…' : 'Lưu cấu hình quiz'}
        </button>
      </div>
    </form>
  );
}
