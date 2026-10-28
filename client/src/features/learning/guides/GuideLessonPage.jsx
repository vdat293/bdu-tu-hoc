import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide, getGuideProgress, getLabResult, saveGuideProgress, saveLabResult } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import BlockImage from './BlockImage.jsx';
import BlockRenderer, { GuideGateWarn, MISSING_LAB_TEXT, MISSING_WORKDIR_TEXT } from './BlockRenderer.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';
import { whereLabel } from './GuideSidebar.jsx';

// Client-side mirror of the server workdir rule (src/modules/learning/guide.service.js):
// Windows drive path, max 260 chars. Invalid input is rejected inline, no POST.
const WORKDIR_PATTERN = /^[A-Za-z]:\\/;
const MAX_WORKDIR_LENGTH = 260;

const LAB_RESULT_IMAGE = {
  type: 'image',
  src: '/guides/inf1003/hinh-copy-ket-qua-cloudshell.png',
  alt: 'Ảnh CloudShell sau khi script hoàn tất: mũi tên và khung đỏ chỉ toàn bộ chuỗi kết quả bắt đầu bằng BDU-LAB-V1:, hiển thị trải trên hai dòng màn hình.',
  caption: 'Khung đỏ đánh dấu phần cần copy. Ảnh chỉ minh họa vị trí: hãy lấy chuỗi kết quả từ CloudShell của chính bạn.',
  fullSizeLink: true
};

const LAB_RESULT_GUIDE_STEPS = [
  'Trong CloudShell, bôi đen và copy toàn bộ chuỗi trong khung đỏ: bắt đầu từ chữ BDU-LAB-V1: đến ký tự cuối cùng. Nếu chuỗi tự xuống dòng như ảnh, chọn cả phần tiếp theo ở dòng dưới.',
  'Chỉ lấy chuỗi kết quả; bỏ qua câu Đã hoàn tất, hai dòng dấu =, dấu nhắc ~ $ và các lệnh phía trên.',
  'Nhấn chuột trái vào ô bên dưới, nhấn Ctrl+V để dán rồi bấm Phân tích & sang bước 3.'
];

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

  const [tokenDraft, setTokenDraft] = useState('');
  const [labError, setLabError] = useState('');
  const labInputRef = useRef(null);

  // Same scope discipline as the workdir draft: pasting state must not leak
  // across lessons or progress versions.
  const labScopeKey = `${courseCode ?? ''}/${lessonId ?? ''}/${progressVersion ?? ''}/${user?.mssv ?? ''}`;
  const labScopeRef = useRef(labScopeKey);

  useEffect(() => {
    if (labScopeRef.current !== labScopeKey) {
      labScopeRef.current = labScopeKey;
      setTokenDraft('');
      setLabError('');
    }
  }, [labScopeKey]);

  // Workdir is saved once per lesson step via the same progress endpoint and
  // reused by every `localDirectory` code block through {{WORKDIR}} / cd-insert.
  const serverWorkdir = progressQuery.data?.workdir || '';
  const [workdirDraft, setWorkdirDraft] = useState('');
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [workdirError, setWorkdirError] = useState('');
  const workdirInputRef = useRef(null);

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
  const isDone = isStepDoneEntry(doneMap[stepId]);
  const isLast = stepIndex === steps.length - 1;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex >= 0 && stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;

  // Step lookups mirror the original hard-coded "#/bai-1/buoc-2" links but stay
  // data-driven: the collecting step of the same lesson, first-step fallback.
  const resultStep = steps.find((item) => item?.resultInput) || steps[1] || null;
  const folderStep = steps.find((item) => item?.folderInput) || steps[0] || null;

  const stepUrl = (id) => `/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lessonId)}/${encodeURIComponent(id)}`;
  const resultStepUrl = resultStep ? stepUrl(resultStep.id) : null;
  const folderStepUrl = folderStep ? stepUrl(folderStep.id) : null;

  // Sidebar clicks are free like the original: the gate lives in the content.
  const goToStep = (id) => {
    navigate(stepUrl(id));
  };

  return (
    <GuideLessonPageBody
      courseCode={courseCode}
      lesson={lesson}
      steps={steps}
      step={step}
      stepId={stepId}
      stepIndex={stepIndex}
      isLast={isLast}
      prevStep={prevStep}
      nextStep={nextStep}
      doneMap={doneMap}
      isDone={isDone}
      workdir={workdir}
      serverWorkdir={serverWorkdir}
      lab={lab}
      labKey={labKey}
      progressKey={progressKey}
      resultStep={resultStep}
      folderStep={folderStep}
      resultStepUrl={resultStepUrl}
      folderStepUrl={folderStepUrl}
      goToStep={goToStep}
      token={token}
      notify={notify}
      workdirDraft={workdirDraft}
      setWorkdirDraft={setWorkdirDraft}
      workdirTouched={workdirTouched}
      setWorkdirTouched={setWorkdirTouched}
      workdirError={workdirError}
      setWorkdirError={setWorkdirError}
      workdirInputRef={workdirInputRef}
      tokenDraft={tokenDraft}
      setTokenDraft={setTokenDraft}
      labError={labError}
      setLabError={setLabError}
      labInputRef={labInputRef}
      client={client}
      navigate={navigate}
    />
  );
}

function GuideLessonPageBody({
  courseCode, lesson, steps, step, stepId, stepIndex, isLast, prevStep, nextStep,
  doneMap, isDone, workdir, serverWorkdir, lab, labKey, progressKey,
  resultStep, folderStep, resultStepUrl, folderStepUrl, goToStep,
  token, notify,
  workdirDraft, setWorkdirDraft, setWorkdirTouched, workdirError, setWorkdirError, workdirInputRef,
  tokenDraft, setTokenDraft, labError, setLabError, labInputRef,
  client, navigate
}) {
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

  const stepUrl = (id) => `/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lesson.id)}/${encodeURIComponent(id)}`;

  const updateProgressCache = (updater) => {
    client.setQueryData(progressKey, (old) => {
      const base = old || { steps: {}, workdir: null };
      return updater(base);
    });
  };

  const refreshProgress = () => {
    client.invalidateQueries({ queryKey: ['course-guide', courseCode] });
    client.invalidateQueries({ queryKey: ['guide-progress', courseCode, lesson.id] });
  };

  // Normal steps: one primary button like the original markButton. Content is
  // only shown when every requirement is met, so the server clean-check is a
  // backstop — its message surfaces verbatim in a toast.
  const doneMutation = useMutation({
    mutationFn: () => saveGuideProgress(token, courseCode, lesson.id, {
      stepId,
      done: true,
      workdir: doneMap[stepId]?.workdir ?? serverWorkdir ?? undefined
    }),
    onSuccess: () => {
      updateProgressCache((base) => ({
        ...base,
        steps: {
          ...base.steps,
          [stepId]: { done: true, workdir: base.steps?.[stepId]?.workdir ?? base.workdir ?? '' }
        }
      }));
      refreshProgress();
      if (nextStep) navigate(stepUrl(nextStep.id));
    },
    onError: (error) => {
      notify(error?.message || 'Không thể lưu tiến độ hướng dẫn.', 'error');
    }
  });

  // Folder form mirrors directoryForm: one submit marks this step done with
  // the new workdir; when the workdir changed, every other done step except
  // the lab-result step is unmarked (the original kept buoc-2 on reset).
  const folderMutation = useMutation({
    mutationFn: async (clean) => {
      await saveGuideProgress(token, courseCode, lesson.id, { stepId, done: true, workdir: clean });
      const changed = clean !== serverWorkdir;
      if (changed) {
        for (const item of steps) {
          if (!item || item.id === stepId || item.id === resultStep?.id) continue;
          if (isStepDoneEntry(doneMap[item.id])) {
            await saveGuideProgress(token, courseCode, lesson.id, { stepId: item.id, done: false, workdir: clean });
          }
        }
      }
      return clean;
    },
    onSuccess: (clean) => {
      const changed = clean !== serverWorkdir;
      updateProgressCache((base) => {
        const nextSteps = { ...(base.steps || {}) };
        nextSteps[stepId] = { done: true, workdir: clean };
        if (changed) {
          for (const item of steps) {
            if (!item || item.id === stepId || item.id === resultStep?.id) continue;
            if (isStepDoneEntry(nextSteps[item.id])) {
              nextSteps[item.id] = { done: false, workdir: nextSteps[item.id]?.workdir ?? '' };
            }
          }
        }
        return { ...base, workdir: clean, steps: nextSteps };
      });
      refreshProgress();
      if (nextStep) navigate(stepUrl(nextStep.id));
      notify('Đã lưu thư mục làm việc.', 'success');
    },
    onError: (error) => {
      notify(error?.message || 'Không thể lưu thư mục làm việc.', 'error');
    }
  });

  const handleFolderSubmit = (event) => {
    event.preventDefault();
    const clean = workdirDraft.trim();
    if (!WORKDIR_PATTERN.test(clean) || clean.length > MAX_WORKDIR_LENGTH) {
      setWorkdirError('Đường dẫn phải dạng ổ Windows, ví dụ C:\\lab1.');
      workdirInputRef.current?.focus();
      return;
    }
    setWorkdirError('');
    folderMutation.mutate(clean);
  };

  // Result form mirrors labResultForm: save the lab token; when the token
  // changed, every other done step except the folder step is unmarked (the
  // original kept buoc-1 on reset). The current step is always marked done.
  const labMutation = useMutation({
    mutationFn: async (cleanToken) => {
      const data = await saveLabResult(token, courseCode, lesson.id, { token: cleanToken });
      const tokenChanged = !lab || lab.token !== data?.token;
      if (tokenChanged) {
        for (const item of steps) {
          if (!item || item.id === stepId || item.id === folderStep?.id) continue;
          if (isStepDoneEntry(doneMap[item.id])) {
            await saveGuideProgress(token, courseCode, lesson.id, {
              stepId: item.id, done: false, workdir: serverWorkdir || undefined
            });
          }
        }
      }
      await saveGuideProgress(token, courseCode, lesson.id, {
        stepId, done: true, workdir: serverWorkdir || undefined
      });
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(labKey, data);
      const tokenChanged = !lab || lab.token !== data?.token;
      updateProgressCache((base) => {
        const nextSteps = { ...(base.steps || {}) };
        if (tokenChanged) {
          for (const item of steps) {
            if (!item || item.id === stepId || item.id === folderStep?.id) continue;
            if (isStepDoneEntry(nextSteps[item.id])) {
              nextSteps[item.id] = { done: false, workdir: nextSteps[item.id]?.workdir ?? '' };
            }
          }
        }
        nextSteps[stepId] = { done: true, workdir: serverWorkdir };
        return { ...base, steps: nextSteps };
      });
      refreshProgress();
      setTokenDraft('');
      setLabError('');
      if (nextStep) navigate(stepUrl(nextStep.id));
    },
    onError: (error) => {
      setLabError(error?.message || 'Không thể lưu kết quả lab.');
      labInputRef.current?.focus();
    }
  });

  const handleLabSubmit = (event) => {
    event.preventDefault();
    const clean = tokenDraft.trim();
    if (!clean) {
      setLabError('Hãy dán dòng kết quả bắt đầu bằng BDU-LAB-V1: rồi bấm Phân tích & sang bước 3.');
      labInputRef.current?.focus();
      return;
    }
    setLabError('');
    labMutation.mutate(clean);
  };

  const blocks = Array.isArray(step.blocks) ? step.blocks : [];
  const explain = Array.isArray(step.explain) ? step.explain : [];
  const expect = Array.isArray(step.expect) ? step.expect : [];
  const errors = Array.isArray(step.errors) ? step.errors : [];

  const blocksNode = (
    <div className="guide-step-blocks">
      {blocks.map((block, index) => (
        <BlockRenderer
          key={[block?.type, block?.text, block?.title, block?.label, block?.src, index].filter((part) => part !== undefined && part !== null && part !== '').join('|') || String(index)}
          block={block}
          workdir={workdir}
          vars={labVars}
          connection={labConnection}
          keys={labKeys}
          lab={lab}
          labHref={resultStepUrl}
          workdirHref={folderStepUrl}
        />
      ))}
    </div>
  );

  const explainNode = explain.length > 0 && (
    <div className="guide-step-explain">
      <h3>Chuyện gì đang xảy ra</h3>
      {explain.map((item, index) => (
        <p key={index}>{String(item)}</p>
      ))}
    </div>
  );

  const expectNode = expect.length > 0 && (
    <div className="guide-step-expect">
      <h3>Bạn sẽ thấy</h3>
      <ul>
        {expect.map((item, index) => (
          <li key={index}>{String(item)}</li>
        ))}
      </ul>
    </div>
  );

  const errorsNode = errors.length > 0 && (
    <details className="guide-step-errors">
      <summary>Gặp vấn đề? Xem cách xử lý lỗi</summary>
      {errors.map((item, index) => (
        item && typeof item === 'object' ? (
          <div key={index} className="guide-error-item">
            <p><strong>Triệu chứng: </strong>{String(item.symptom ?? '')}</p>
            <p><strong>Nguyên nhân: </strong>{String(item.cause ?? '')}</p>
            <p><strong>Cách sửa: </strong>{String(item.fix ?? '')}</p>
          </div>
        ) : null
      ))}
    </details>
  );

  const cardHead = (
    <>
      <p className="guide-step-stage">CHẶNG {stepIndex + 1}/{steps.length}</p>
      <h1 className="guide-step-title">{step.title}</h1>
      {step.goal && <p className="guide-step-goal">{step.goal}</p>}
      <p><span className="guide-where-badge">{whereLabel(step)}</span></p>
    </>
  );

  // Guard order mirrors renderSection: the lab requirement is checked before
  // the workdir one, and a blocked step shows only the warn box — no blocks,
  // no forms, no footer.
  if (step.requiresResult && !lab) {
    return (
      <GuideLayout
        courseCode={courseCode}
        sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
      >
        <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
          <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
            {cardHead}
            <GuideGateWarn text={MISSING_LAB_TEXT} href={resultStepUrl} action="→ Dán kết quả ở bước 2" />
          </section>
        </article>
      </GuideLayout>
    );
  }

  if (step.requiresDirectory && !serverWorkdir) {
    return (
      <GuideLayout
        courseCode={courseCode}
        sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
      >
        <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
          <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
            {cardHead}
            <GuideGateWarn text={MISSING_WORKDIR_TEXT} href={folderStepUrl} action="Lưu đường dẫn ở bước 1" />
          </section>
        </article>
      </GuideLayout>
    );
  }

  // Folder-input step mirrors directoryForm: blocks, then the single submit
  // form — no separate save button, no "in use" line, no common footer.
  if (step.folderInput) {
    return (
      <GuideLayout
        courseCode={courseCode}
        sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
      >
        <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
          <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
            {cardHead}
            {blocksNode}
            {explainNode}
            {expectNode}
            {errorsNode}
            <form className="guide-workdir" onSubmit={handleFolderSubmit}>
              <h3 className="guide-workdir-title">Lưu đường dẫn thư mục của bạn</h3>
              <label className="guide-workdir-label" htmlFor={`guide-workdir-${stepId}`}>
                Đường dẫn thư mục làm việc
              </label>
              <p className="guide-workdir-hint">Dán đường dẫn lab1 vừa copy từ File Explorer. Website sẽ nhớ đường dẫn này và thêm sẵn lệnh vào đúng thư mục cho các khối lệnh Máy local ở bước 4.</p>
              <div className="guide-workdir-row">
                <input
                  id={`guide-workdir-${stepId}`}
                  ref={workdirInputRef}
                  className="guide-workdir-input"
                  type="text"
                  value={workdirDraft}
                  placeholder="C:\thu-muc\lab1"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={`guide-workdir-feedback-${stepId}`}
                  onChange={(event) => {
                    setWorkdirTouched(true);
                    setWorkdirDraft(event.target.value);
                    if (workdirError) setWorkdirError('');
                  }}
                />
              </div>
              {workdirError && <p id={`guide-workdir-feedback-${stepId}`} className="guide-workdir-error" role="alert">{workdirError}</p>}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={folderMutation.isPending}
              >
                Lưu đường dẫn &amp; sang bước 2
              </button>
            </form>
          </section>
        </article>
      </GuideLayout>
    );
  }

  // Result-input step mirrors labResultForm: blocks, then the paste form with
  // the CloudShell screenshot and the 3-step copy guide — no summary panel,
  // no re-paste button, no common footer.
  if (step.resultInput) {
    return (
      <GuideLayout
        courseCode={courseCode}
        sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
      >
        <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
          <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
            {cardHead}
            {blocksNode}
            {explainNode}
            {expectNode}
            {errorsNode}
            <form className="guide-lab-form" onSubmit={handleLabSubmit}>
              <h3 className="guide-lab-title">Kết quả CloudShell</h3>
              <BlockImage block={LAB_RESULT_IMAGE} />
              <ol className="guide-lab-steps">
                {LAB_RESULT_GUIDE_STEPS.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
              <label className="guide-lab-label" htmlFor={`guide-lab-token-${stepId}`}>
                Dán toàn bộ chuỗi bắt đầu bằng BDU-LAB-V1: vào đây
              </label>
              <p className="guide-lab-hint">Bạn chỉ cần copy và dán. Website sẽ đọc kết quả và tự điền đường dẫn key, IP và địa chỉ database cho các bước sau. Dữ liệu được xử lý và lưu trên trình duyệt này.</p>
              <textarea
                id={`guide-lab-token-${stepId}`}
                ref={labInputRef}
                className="guide-lab-input"
                rows={4}
                value={tokenDraft}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                placeholder="BDU-LAB-V1:…"
                maxLength={100000}
                aria-describedby={`guide-lab-feedback-${stepId}`}
                onChange={(event) => {
                  setTokenDraft(event.target.value);
                  if (labError) setLabError('');
                }}
              />
              {labError && <p id={`guide-lab-feedback-${stepId}`} className="guide-lab-error" role="alert">{labError}</p>}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={labMutation.isPending}
              >
                Phân tích &amp; sang bước 3
              </button>
              {lab && (
                <p className="guide-lab-saved">
                  Đã có kết quả hợp lệ cho region {lab.REGION}.{' '}
                  {nextStep && (
                    <Link className="btn btn-secondary btn-sm" to={stepUrl(nextStep.id)}>
                      Dùng kết quả đã lưu · Sang bước 3
                    </Link>
                  )}
                </p>
              )}
            </form>
            {prevStep && (
              <div className="guide-step-actions">
                <Link className="btn btn-secondary" to={stepUrl(prevStep.id)}>
                  ← Bước trước
                </Link>
              </div>
            )}
          </section>
        </article>
      </GuideLayout>
    );
  }

  const allDone = steps.every((item) => isStepDoneEntry(doneMap[item.id]));

  return (
    <GuideLayout
      courseCode={courseCode}
      sidebar={{ lesson, steps, doneMap, activeStep: stepId, onSelect: goToStep }}
    >
      <article className="guide-step" aria-label={`Chặng ${stepIndex + 1}: ${step.title}`}>
        <section className="guide-step-card glass-panel" aria-label={`Chặng ${stepIndex + 1}/${steps.length}`}>
          {cardHead}
          {blocksNode}
          {explainNode}
          {expectNode}
          {errorsNode}
          <div className="guide-step-actions">
            {prevStep && (
              <Link className="btn btn-secondary" to={stepUrl(prevStep.id)}>
                ← Bước trước
              </Link>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={doneMutation.isPending || (isLast && isDone)}
              onClick={() => doneMutation.mutate()}
            >
              {isLast
                ? (isDone ? 'Đã hoàn thành bước cuối' : 'Tôi đã hoàn thành bước cuối')
                : `Tôi đã hoàn thành · Sang bước ${stepIndex + 2}`}
            </button>
          </div>
          {isLast && isDone && (
            <div className="guide-step-completion" role="status">
              <h3>{allDone ? 'Bạn đã hoàn thành bài thực hành!' : 'Đã hoàn thành bước cuối!'}</h3>
              <p>Các bước đã được lưu. Sau khi dọn dẹp, hãy kiểm tra AWS Console để chắc chắn tài nguyên của lab đã được xóa.</p>
              <Link className="btn btn-secondary" to={`/learning/${encodeURIComponent(courseCode)}/guides`}>
                Về tổng quan
              </Link>
            </div>
          )}
        </section>
      </article>
    </GuideLayout>
  );
}
