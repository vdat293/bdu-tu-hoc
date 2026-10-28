import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide, getGuideProgress, getLabResult, saveGuideProgress, saveLabResult } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import BlockRenderer from './BlockRenderer.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';
import { whereLabel } from './GuideSidebar.jsx';

// Client-side mirror of the server workdir rule (src/modules/learning/guide.service.js):
// Windows drive path, max 260 chars. Invalid input is rejected inline, no POST.
const WORKDIR_PATTERN = /^[A-Za-z]:\\/;
const MAX_WORKDIR_LENGTH = 260;

// A step is "clean" when every input it declares is satisfied: folderInput and
// requiresDirectory need the saved workdir, resultInput and requiresResult need
// the saved lab result (same progress_version, enforced by the lab query key).
export function stepClean(step, { hasResult = false, hasWorkdir = false } = {}) {
  if (!step || typeof step !== 'object') return false;
  if (step.folderInput && !hasWorkdir) return false;
  if (step.resultInput && !hasResult) return false;
  if (step.requiresResult && !hasResult) return false;
  if (step.requiresDirectory && !hasWorkdir) return false;
  return true;
}

// Which input a blocked step is still missing: 'key' takes precedence because
// the server enforces requiresResult before requiresDirectory in one call.
function missingRequirement(step, { hasResult = false, hasWorkdir = false } = {}) {
  if (!step || typeof step !== 'object') return null;
  if ((step.resultInput || step.requiresResult) && !hasResult) return 'key';
  if ((step.folderInput || step.requiresDirectory) && !hasWorkdir) return 'workdir';
  return null;
}

function isStepDoneEntry(entry) {
  if (!entry) return false;
  return typeof entry === 'object' ? entry.done === true : entry === true;
}

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
    if (guideQuery.isLoading) return;
    if (guideQuery.isError) {
      // 403 (outside the course) must not hang on loading: bounce to the
      // course page like the not-enabled case. Other errors stay on an
      // error panel with retry rendered below.
      if (guideQuery.error?.status === 403) {
        notify('Môn học chưa có hướng dẫn thực hành.', 'warning');
        navigate(`/learning/${encodeURIComponent(courseCode || '')}`, { replace: true });
      }
      return;
    }
    if (!guideQuery.data?.enabled || !lesson) {
      notify('Môn học chưa có hướng dẫn thực hành.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}`, { replace: true });
      return;
    }
    if (!step) {
      notify('Không tìm thấy chặng hướng dẫn.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}/guides`, { replace: true });
    }
  }, [guideQuery.isLoading, guideQuery.isError, guideQuery.error, guideQuery.data, lesson, step, notify, navigate, courseCode]);

  const labKey = ['guide-lab-result', courseCode, lessonId, progressVersion, user?.mssv];

  const labQuery = useQuery({
    queryKey: labKey,
    queryFn: ({ signal }) => getLabResult(token, courseCode, lessonId, { signal }),
    enabled: Boolean(token && courseCode && lessonId && lesson && guideQuery.data?.enabled)
  });

  // The lab result shares the progressVersion in its key so a content update
  // never unlocks steps with a result saved under a previous version.
  const lab = labQuery.data || null;
  const hasResult = lab != null;

  const [tokenDraft, setTokenDraft] = useState('');
  const [labEditing, setLabEditing] = useState(false);
  const [labError, setLabError] = useState('');

  // Same scope discipline as the workdir draft: pasting state must not leak
  // across lessons or progress versions.
  const labScopeKey = `${courseCode ?? ''}/${lessonId ?? ''}/${progressVersion ?? ''}/${user?.mssv ?? ''}`;
  const labScopeRef = useRef(labScopeKey);

  useEffect(() => {
    if (labScopeRef.current !== labScopeKey) {
      labScopeRef.current = labScopeKey;
      setTokenDraft('');
      setLabError('');
      setLabEditing(false);
    }
  }, [labScopeKey]);

  const labMutation = useMutation({
    mutationFn: (cleanToken) => saveLabResult(token, courseCode, lessonId, { token: cleanToken }),
    onSuccess: (data) => {
      // The POST response is the canonical saved result — write it straight
      // into the cache (no refetch: the server has nothing newer to return).
      client.setQueryData(labKey, data);
      setTokenDraft('');
      setLabError('');
      setLabEditing(false);
      notify('Đã lưu kết quả lab.', 'success');
    },
    onError: (error) => {
      setLabError(error?.message || 'Không thể lưu kết quả lab.');
    }
  });

  const handleLabSave = () => {
    const clean = tokenDraft.trim();
    if (!clean) {
      setLabError('Hãy dán dòng kết quả bắt đầu bằng BDU-LAB-V1: rồi bấm Phân tích & lưu.');
      return;
    }
    setLabError('');
    labMutation.mutate(clean);
  };

  const doneMutation = useMutation({
    mutationFn: () => saveGuideProgress(token, courseCode, lessonId, {
      stepId,
      done: true,
      workdir: progressQuery.data?.steps?.[stepId]?.workdir ?? progressQuery.data?.workdir ?? undefined
    }),
    onSuccess: () => {
      // Sync the cache so the next step unlocks instantly; the invalidation
      // below then reconciles with the server.
      client.setQueryData(progressKey, (old) => {
        const base = old || { steps: {}, workdir: null };
        return {
          ...base,
          steps: {
            ...base.steps,
            [stepId]: { done: true, workdir: base.steps?.[stepId]?.workdir ?? base.workdir ?? '' }
          }
        };
      });
      client.invalidateQueries({ queryKey: ['course-guide', courseCode] });
      client.invalidateQueries({ queryKey: ['guide-progress', courseCode, lessonId] });
      if (stepIndex >= 0 && stepIndex < steps.length - 1) {
        navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(steps[stepIndex + 1].id)}`);
      } else {
        notify('Đã hoàn thành bài hướng dẫn.', 'success');
        navigate(`/learning/${encodeURIComponent(courseCode)}/guides`, { replace: true });
      }
    },
    onError: (error) => {
      // Server clean-check failures (GUIDE_STEP_NOT_CLEAN) carry the exact
      // missing-input message — surface it verbatim in a toast.
      notify(error?.message || 'Không thể lưu tiến độ hướng dẫn.', 'error');
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

  // Mirror GuideIndexPage: a failed guide query never sticks on loading.
  // 403 already redirects via the effect above (return null while navigating);
  // any other error gets a panel with retry.
  if (guideQuery.isError) {
    if (guideQuery.error?.status === 403) return null;
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
  const hasWorkdir = serverWorkdir !== '';
  const isDone = isStepDoneEntry(doneMap[stepId]);
  const clean = stepClean(step, { hasResult, hasWorkdir });
  // While progress is still loading, progressQuery.data is empty and the
  // done mutation would POST workdir ?? undefined (server normalizes to ''
  // and wipes the saved workdir). Keep both write controls disabled until
  // the first progress load resolves.
  const progressLoading = progressQuery.isLoading;
  const labLoading = labQuery.isLoading;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;

  const goToStep = (id) => {
    const target = steps.findIndex((stepItem) => stepItem.id === id);
    if (target < 0) return;
    // Steps unlock strictly in order: reaching step i requires every step
    // < i done. Going back (or to the first open step) is always allowed;
    // jumping ahead toasts what the first incomplete step still misses.
    const firstIncomplete = steps.findIndex((stepItem) => !isStepDoneEntry(doneMap[stepItem.id]));
    const firstOpen = firstIncomplete === -1 ? steps.length : firstIncomplete;
    if (target <= firstOpen) {
      navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(id)}`);
      return;
    }
    const blocker = steps[firstOpen];
    const miss = missingRequirement(blocker, { hasResult, hasWorkdir });
    if (miss === 'key') {
      notify(`Chặng ${firstOpen + 1} chưa mở: hãy dán dòng kết quả lab (BDU-LAB-V1:) ở bước 2 trước.`, 'warning');
    } else if (miss === 'workdir') {
      notify(`Chặng ${firstOpen + 1} chưa mở: hãy lưu thư mục làm việc ở bước 1 trước.`, 'warning');
    } else {
      notify(`Hãy hoàn thành chặng ${firstOpen + 1} trước khi sang chặng này.`, 'warning');
    }
  };

  // Lab fields feed the guide blocks: {{FE_IP}}/{{BE_IP}}/{{DB_ENDPOINT}}
  // substitution plus the connection/keys override slots (block-inline data
  // still wins when present — see BlockRenderer props-override contract).
  const labVars = {
    WORKDIR: workdir,
    FE_IP: lab?.FE_IP,
    BE_IP: lab?.BE_IP,
    DB_ENDPOINT: lab?.DB_ENDPOINT
  };
  const labKeys = lab && (lab.FE_KEY_PATH || lab.BE_KEY_PATH)
    ? [
      lab.FE_KEY_PATH ? { label: 'Key FE', path: lab.FE_KEY_PATH } : null,
      lab.BE_KEY_PATH ? { label: 'Key BE', path: lab.BE_KEY_PATH } : null
    ].filter(Boolean)
    : undefined;
  const labConnection = lab
    ? { feIp: lab.FE_IP, beIp: lab.BE_IP, dbEndpoint: lab.DB_ENDPOINT }
    : undefined;

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
                vars={labVars}
                connection={labConnection}
                keys={labKeys}
              />
            ))}
          </div>
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
                  disabled={workdirMutation.isPending || progressLoading}
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
          {step.resultInput && (
            <div className="guide-lab">
              <label className="guide-lab-label" htmlFor={`guide-lab-token-${stepId}`}>
                Dòng kết quả CloudShell
              </label>
              <p className="guide-lab-hint">Copy nguyên dòng bắt đầu bằng BDU-LAB-V1: trong CloudShell rồi dán vào ô bên dưới, website tự đọc địa chỉ máy và đường dẫn key.</p>
              {lab && !labEditing ? (
                <div className="guide-lab-summary">
                  <dl className="guide-lab-summary-list">
                    <div><dt>STATUS</dt><dd>{lab.STATUS}</dd></div>
                    <div><dt>REGION</dt><dd>{lab.REGION}</dd></div>
                    <div><dt>FE_IP</dt><dd>{lab.FE_IP}</dd></div>
                    <div><dt>BE_IP</dt><dd>{lab.BE_IP}</dd></div>
                  </dl>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setLabEditing(true);
                      setLabError('');
                    }}
                  >
                    Dán lại dòng kết quả
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    id={`guide-lab-token-${stepId}`}
                    className="guide-lab-input"
                    rows={3}
                    value={tokenDraft}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="BDU-LAB-V1:..."
                    onChange={(event) => {
                      setTokenDraft(event.target.value);
                      if (labError) setLabError('');
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={labMutation.isPending || labLoading || progressLoading}
                    onClick={handleLabSave}
                  >
                    Phân tích &amp; lưu
                  </button>
                  {labError && <p className="guide-lab-error" role="alert">{labError}</p>}
                </>
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
            onClick={() => prevStep && navigate(`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(prevStep.id)}`)}
          >
            ← Trước
          </button>
          <span className="guide-step-footer-pos">{stepIndex + 1}/{steps.length}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!clean || progressLoading || labLoading || doneMutation.isPending || isDone}
            onClick={() => doneMutation.mutate()}
          >
            Hoàn thành ✓
          </button>
        </footer>
      </article>
    </GuideLayout>
  );
}
