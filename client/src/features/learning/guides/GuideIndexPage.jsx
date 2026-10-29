import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide, resetGuideProgress } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { useConfirm } from '../../../components/feedback/ConfirmDialog.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';
import GuidePlatformDialog from './GuidePlatformDialog.jsx';

export default function GuideIndexPage() {
  const { courseCode } = useParams();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();
  const [platformTarget, setPlatformTarget] = useState(null);

  const guideQuery = useQuery({
    queryKey: ['course-guide', courseCode, user?.mssv],
    queryFn: ({ signal }) => getCourseGuide(token, courseCode, { signal }),
    enabled: Boolean(token && courseCode)
  });

  const guide = guideQuery.data;
  const enabled = Boolean(guide?.enabled);
  const lessons = getLocalGuides(courseCode);

  useEffect(() => {
    if (guideQuery.isLoading || guideQuery.isError) return;
    if (!guide || !enabled || lessons.length === 0) {
      notify('Môn học chưa có hướng dẫn thực hành.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}`, { replace: true });
    }
  }, [guideQuery.isLoading, guideQuery.isError, guide, enabled, lessons.length, notify, navigate, courseCode]);

  const serverLessons = Array.isArray(guide?.lessons) ? guide.lessons : [];
  const doneByLesson = new Map(serverLessons.map((item) => [item.id, Number(item.doneCount || 0)]));

  const reset = useMutation({
    mutationFn: ({ lessonId }) => resetGuideProgress(token, courseCode, lessonId),
    onSuccess: (_data, { lessonId, firstStep }) => {
      try {
        const storage = window.localStorage;
        const prefix = `bdu:guide-setup:${user?.mssv ?? ''}:${courseCode}:${lessonId}:`;
        for (let index = storage.length - 1; index >= 0; index--) {
          const key = storage.key(index);
          if (key?.startsWith(prefix)) storage.removeItem(key);
        }
      } catch { /* The reset URL explicitly selects CloudShell if storage is blocked. */ }
      client.invalidateQueries({ queryKey: ['course-guide', courseCode] });
      client.invalidateQueries({ queryKey: ['guide-progress', courseCode, lessonId] });
      client.removeQueries({ queryKey: ['guide-lab-result', courseCode, lessonId] });
      notify('Đã xóa tiến độ, bắt đầu lại từ đầu với CloudShell.', 'success');
      if (firstStep) {
        setPlatformTarget({ path: `/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(firstStep)}`, setup: 'cloudshell' });
      }
    },
    onError: (error) => {
      notify(error?.message || 'Không thể làm lại từ đầu.', 'error');
    }
  });

  const handleReset = async (lesson) => {
    const ok = await askConfirm({
      title: 'Làm lại từ đầu?',
      message: 'Các chặng đã hoàn thành, thư mục đã lưu và kết quả lab đã lưu của bài này sẽ bị xóa và không thể khôi phục. Bài học sẽ trở về hướng dẫn dùng CloudShell.',
      confirmText: 'Làm lại từ đầu',
      danger: true
    });
    if (!ok) return;
    reset.mutate({ lessonId: lesson.id, firstStep: lesson.steps?.[0]?.id });
  };

  if (guideQuery.isLoading || !guide) {
    return (
      <GuideLayout courseCode={courseCode}>
        <p className="guide-page-loading">Đang tải hướng dẫn thực hành...</p>
      </GuideLayout>
    );
  }

  if (guideQuery.isError) {
    return (
      <GuideLayout courseCode={courseCode}>
        <section className="guide-page-error" role="alert">
          <p>{guideQuery.error?.message || 'Không thể tải hướng dẫn thực hành.'}</p>
          <button type="button" className="btn btn-secondary" onClick={() => guideQuery.refetch()}>
            Tải lại
          </button>
        </section>
      </GuideLayout>
    );
  }

  if (!enabled || lessons.length === 0) return null;

  return (
    <GuideLayout courseCode={courseCode}>
      <section className="guide-index glass-panel" aria-label="Danh sách bài hướng dẫn">
        <h1 className="guide-index-title">Hướng dẫn thực hành</h1>
        <p className="guide-index-sub">Làm theo từng chặng, xác nhận khi xong để lưu tiến độ theo tài khoản của bạn.</p>
        <ul className="guide-index-list">
          {lessons.map((lesson) => {
            const firstStep = lesson.steps?.[0]?.id;
            const done = doneByLesson.get(lesson.id) || 0;
            const total = lesson.steps?.length || 0;
            // Sequential gating guarantees completed steps form a prefix, so
            // doneCount is exactly the first incomplete index; when everything
            // is done (or the count overshoots) fall back to the first step.
            const targetStep = (done < total ? lesson.steps?.[done]?.id : null) || firstStep;
            return (
              <li key={lesson.id} className="guide-index-item">
                <div className="guide-index-item-text">
                  <h2 className="guide-index-item-title">{lesson.title}</h2>
                  {lesson.summary && <p className="guide-index-item-summary">{lesson.summary.replace('một cửa sổ CMD', 'một cửa sổ CMD trên Windows hoặc Terminal trên macOS')}</p>}
                  <p className="guide-index-item-meta">
                    {[lesson.duration && `${lesson.duration}`, total ? `Đã xong ${done}/${total}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {targetStep && (
                  <>
                    <Link
                      className="btn btn-primary btn-sm"
                      to={`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lesson.id)}/${encodeURIComponent(targetStep)}`}
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        setPlatformTarget({ path: event.currentTarget.getAttribute('href') });
                      }}
                    >
                      {done > 0 ? 'Học tiếp' : 'Bắt đầu'}
                    </Link>
                    {done > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleReset(lesson)}
                        disabled={reset.isPending && reset.variables?.lessonId === lesson.id}
                      >
                        Làm lại từ đầu
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {confirmUI}
      {platformTarget && (
        <GuidePlatformDialog
          onClose={() => setPlatformTarget(null)}
          onSelect={(platform) => {
            const params = new URLSearchParams({ os: platform });
            if (platformTarget.setup) params.set('setup', platformTarget.setup);
            navigate(`${platformTarget.path}?${params}`);
          }}
        />
      )}
    </GuideLayout>
  );
}
