import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide, getGuideProgress, saveGuideProgress } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import BlockRenderer from './BlockRenderer.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';
import { whereLabel } from './GuideSidebar.jsx';

// Client-side mirror of the server workdir rule (src/modules/learning/guide.service.js):
// Windows drive path, max 260 chars. Invalid input is rejected inline, no POST.
const WORKDIR_PATTERN = /^[A-Za-z]:\\/;
const MAX_WORKDIR_LENGTH = 260;

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

  // progressVersion is part of the key so a content update (new version) never
  // reads progress cached under the previous version — the server also filters
  // by progress_version, the key keeps the client from serving stale cache.
  const progressVersion = lesson?.progressVersion || null;
  const progressKey = ['guide-progress', courseCode, lessonId, progressVersion, user?.mssv];

  const progressQuery = useQuery({
    queryKey: progressKey,
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
      const previous = client.getQueryData(progressKey);
      client.setQueryData(progressKey, (old) => {
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
        client.setQueryData(progressKey, context.previous);
      }
      notify(error?.message || 'Không thể lưu tiến độ hướng dẫn.', 'error');
    },
    // Auto-advance only when the step was ticked done; unchecking stays put.
    onSuccess: (_data, done) => {
      client.invalidateQueries({ queryKey: ['course-guide', courseCode] });
      if (done !== true) return;
      if (stepIndex >= 0 && stepIndex < steps.length - 1) {
        navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(steps[stepIndex + 1].id)}`);
      }
    }
  });

  // Workdir is saved once per lesson step via the same progress endpoint and
  // reused by every `localDirectory` code block through {{WORKDIR}} / cd-insert.
  const serverWorkdir = progressQuery.data?.workdir || '';
  const [workdirDraft, setWorkdirDraft] = useState('');
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [workdirError, setWorkdirError] = useState('');

  // The router reuses this component across lesson/step params, so a touched
  // draft from one step must never leak into another lesson (or a new
  // progressVersion with a fresh serverWorkdir). The scope key forces a reset
  // on identity change; otherwise the touched guard stays so background
  // refetches don't clobber in-progress typing.
  const workdirScopeKey = `${courseCode ?? ''}/${lessonId ?? ''}/${stepId ?? ''}/${progressVersion ?? ''}/${user?.mssv ?? ''}`;
  const workdirScopeRef = useRef(workdirScopeKey);

  useEffect(() => {
    if (workdirScopeRef.current !== workdirScopeKey) {
      workdirScopeRef.current = workdirScopeKey;
      setWorkdirTouched(false);
      setWorkdirDraft(serverWorkdir);
      return;
    }
    if (!workdirTouched) setWorkdirDraft(serverWorkdir);
  }, [workdirScopeKey, serverWorkdir, workdirTouched]);

  const workdirMutation = useMutation({
    mutationFn: (clean) => {
      const currentDone = client.getQueryData(progressKey)?.steps?.[stepId]?.done === true;
      return saveGuideProgress(token, courseCode, lessonId, { stepId, done: currentDone, workdir: clean });
    },
    onSuccess: (data) => {
      client.setQueryData(progressKey, (old) => {
        const base = old || { steps: {}, workdir: null };
        const savedWorkdir = data?.workdir ?? base.workdir ?? null;
        return {
          ...base,
          workdir: savedWorkdir,
          steps: {
            ...base.steps,
            [stepId]: { done: base.steps?.[stepId]?.done === true, workdir: savedWorkdir ?? '' }
          }
        };
      });
      client.invalidateQueries({ queryKey: ['guide-progress', courseCode, lessonId] });
      setWorkdirError('');
      notify('Đã lưu thư mục làm việc.', 'success');
    },
    onError: (error) => {
      notify(error?.message || 'Không thể lưu thư mục làm việc.', 'error');
    }
  });

  const handleWorkdirSave = () => {
    const clean = workdirDraft.trim();
    if (!WORKDIR_PATTERN.test(clean) || clean.length > MAX_WORKDIR_LENGTH) {
      setWorkdirError('Đường dẫn phải dạng ổ Windows, ví dụ C:\\lab1.');
      return;
    }
    setWorkdirError('');
    workdirMutation.mutate(clean);
  };

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
  const workdir = serverWorkdir;
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
              <BlockRenderer
                key={block?.text || block?.title || block?.label || block?.src || index}
                block={block}
                workdir={workdir}
                vars={{ WORKDIR: workdir }}
              />
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
          {step.folderInput && (
            <div className="guide-workdir">
              <label className="guide-workdir-label" htmlFor={`guide-workdir-${stepId}`}>
                Đường dẫn thư mục làm việc
              </label>
              <p className="guide-workdir-hint">Dán đường dẫn đã copy ở mục 5. Website dùng đường dẫn này để lệnh CMD tự vào đúng thư mục.</p>
              <div className="guide-workdir-row">
                <input
                  id={`guide-workdir-${stepId}`}
                  className="guide-workdir-input"
                  type="text"
                  value={workdirDraft}
                  placeholder="Ví dụ: C:\\lab1"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => {
                    setWorkdirTouched(true);
                    setWorkdirDraft(event.target.value);
                    if (workdirError) setWorkdirError('');
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={workdirMutation.isPending}
                  onClick={handleWorkdirSave}
                >
                  Lưu thư mục
                </button>
              </div>
              {workdirError && <p className="guide-workdir-error" role="alert">{workdirError}</p>}
              {serverWorkdir && !workdirError && (
                <p className="guide-workdir-saved">Đang dùng: {serverWorkdir}</p>
              )}
            </div>
          )}
          {step.requiresDirectory && !serverWorkdir && (
            <p className="guide-workdir-missing">Chưa lưu thư mục làm việc ở bước 1 nên lệnh CMD bên dưới chưa tự vào thư mục — quay lại bước 1 để lưu.</p>
          )}
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
