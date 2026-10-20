import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteQuizSet, getQuizSets } from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import QuizSetCard from './QuizSetCard.jsx';
import './quiz.css';

export function setsFrom(data) {
  if (Array.isArray(data?.sets)) return data.sets;
  if (Array.isArray(data)) return data;
  return [];
}

export default function QuizSetSection({ courseCode, canCreate, onCreate }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();

  const setsQuery = useQuery({
    queryKey: ['quiz-sets', courseCode, auth.user?.mssv],
    queryFn: ({ signal }) => getQuizSets(auth.token, courseCode, { signal }),
    enabled: Boolean(auth.token && courseCode)
  });

  const remove = useMutation({
    mutationFn: (setId) => deleteQuizSet(auth.token, courseCode, setId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
      notify('Đã xóa bộ đề trắc nghiệm.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const handleDelete = async (set) => {
    const ok = await askConfirm({
      title: 'Xóa bộ đề?',
      message: `Bộ đề “${set.title}” và toàn bộ tiến độ làm bài sẽ bị xóa vĩnh viễn.`,
      confirmText: 'Xóa bộ đề',
      danger: true
    });
    if (ok) remove.mutate(set.id);
  };

  const sets = setsFrom(setsQuery.data);

  return (
    <section className="quiz-set-section glass-panel" aria-label="Bộ đề trắc nghiệm">
      <div className="quiz-set-section-head">
        <h2 className="quiz-set-section-title">Bộ đề trắc nghiệm</h2>
        {canCreate && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onCreate}>
            + Tạo bộ đề
          </button>
        )}
      </div>

      {setsQuery.isLoading ? (
        <div className="quiz-set-state">
          <div className="spinner"></div>
          <p>Đang tải bộ đề trắc nghiệm...</p>
        </div>
      ) : setsQuery.isError ? (
        <div className="quiz-set-state">
          <p>Không thể tải bộ đề trắc nghiệm.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setsQuery.refetch()}>
            Tải lại
          </button>
        </div>
      ) : sets.length === 0 ? (
        <div className="quiz-set-state">
          <p>Chưa có bộ đề trắc nghiệm nào cho môn này.</p>
        </div>
      ) : (
        <div className="quiz-set-grid">
          {sets.map((set) => (
            <QuizSetCard
              key={set.id}
              courseCode={courseCode}
              set={set}
              onDelete={handleDelete}
              deleting={remove.isPending}
            />
          ))}
        </div>
      )}
      {confirmUI}
    </section>
  );
}
