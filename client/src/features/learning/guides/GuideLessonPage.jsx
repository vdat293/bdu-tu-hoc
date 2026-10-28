import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide, getGuideProgress, saveGuideProgress } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import BlockRenderer from './BlockRenderer.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';
import { whereLabel } from './GuideSidebar.jsx';

export default function GuideLessonPage() {
  const { courseCode, lessonId, stepId } = useParams();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const client = useQueryClient();

  const lesson = getLocalGuides(courseCode).find((item) => item.id === lessonId) || null;
  const steps = lesson?.steps || [];
  const stepIndex = steps.findIndex((step) => step.id === stepId);
  const step = stepIndex >= 0 ? steps[stepIndex] : null;

  const guideQuery = useQuery({
    queryKey: ['course-guide', courseCode, user?.mssv],
    queryFn: ({ signal }) => getCourseGuide(token, courseCode, { signal }),
    enabled: Boolean(token && courseCode)
  });

  const progressQuery = useQuery({
    queryKey: ['guide-progress', courseCode, lessonId, user?.mssv],
    queryFn: ({ signal }) => getGuideProgress(token, courseCode, lessonId, { signal }),
    enabled: Boolean(token && courseCode && lessonId && lesson && guideQuery.data?.enabled)
  });

  useEffect(() => {
    if (guideQuery.isLoading || guideQuery.isError) return;
    if (!guideQuery.data?.enabled || !lesson) {
      notify('Môn học chưa có hướng dẫn thực hành.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}`, { replace: true });
      return;
    }
    if (!step) {
      notify('Không tìm thấy chặng hướng dẫn.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}/guides`, { replace: true });
    }
  }, [guideQuery.isLoading, guideQuery.isError, guideQuery.data, lesson, step, notify, navigate, courseCode]);

  const doneMutation = useMutation({
    mutationFn: (done) => saveGuideProgress(token, courseCode, lessonId, {
      stepId,
      done,
      workdir: progressQuery.data?.steps?.[stepId]?.workdir ?? progressQuery.data?.workdir ?? undefined
    }),
    onMutate: async (done) => {
      await client.cancelQueries({ queryKey: ['guide-progress', courseCode, lessonId] });
      const previous = client.getQueryData(['guide-progress', courseCode, lessonId, user?.mssv]);
      client.setQueryData(['guide-progress', courseCode, lessonId, user?.mssv], (old) => {
        const base = old || { steps: {}, workdir: null };
        return {
          ...base,
          steps: { ...base.steps, [stepId]: { done, workdir: base.steps?.[stepId]?.workdir ?? base.workdir ?? '' } }
        };
      });
      return { previous };
    },
    onError: (error, _done, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(['guide-progress', courseCode, lessonId, user?.mssv], context.previous);
      }
      notify(error?.message || 'Không thể lưu tiến độ hướng dẫn.', 'error');
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['course-guide', courseCode] });
      if (stepIndex >= 0 && stepIndex < steps.length - 1) {
        navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(steps[stepIndex + 1].id)}`);
      }
    }
  });

  const goToStep = (id) => {
    navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(id)}`);
  };

  if (guideQuery.isLoading || !guideQuery.data) {
    return (
      <GuideLayout courseCode={courseCode}>
        <p className="guide-page-loading">Đang tải hướng dẫn thực hành...</p>
      </GuideLayout>
    );
  }

  if (!guideQuery.data?.enabled || !lesson || !step) return null;

  const doneMap = progressQuery.data?.steps || {};
  const workdir = progressQuery.data?.workdir || '';
  const isDone = doneMap[stepId]?.done === true;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;

  return (
    <GuideLayout
      courseCode={courseCode}
      sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
    >
      <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
        <header className="guide-step-head">
          <p className="guide-step-kicker">Bước {stepIndex + 1}/{steps.length}</p>
          <p className="guide-step-hint">Làm xong → Xác nhận → Chuyển bước</p>
        </header>

        <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
          <p className="guide-step-stage">CHẶNG {stepIndex + 1}/{steps.length}</p>
          <h1 className="guide-step-title">{step.title}</h1>
          {step.goal && <p className="guide-step-goal">{step.goal}</p>}
          <p><span className="guide-where-badge">{whereLabel(step)}</span></p>
          <div className="guide-step-blocks">
            {(step.blocks || []).map((block, index) => (
              <BlockRenderer key={block?.text || block?.title || block?.label || block?.src || index} block={block} workdir={workdir} />
            ))}
          </div>
          <label className="guide-step-done">
            <input
              type="checkbox"
              checked={isDone}
              disabled={doneMutation.isPending}
              onChange={(event) => doneMutation.mutate(event.target.checked)}
            />
            <span>Tôi đã làm xong chặng này</span>
          </label>
        </section>

        <footer className="guide-step-footer">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!prevStep}
            onClick={() => prevStep && goToStep(prevStep.id)}
          >
            ← Trước
          </button>
          <span className="guide-step-footer-pos">{stepIndex + 1}/{steps.length}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!nextStep}
            onClick={() => nextStep && goToStep(nextStep.id)}
          >
            Tiếp →
          </button>
        </footer>
      </article>
    </GuideLayout>
  );
}
