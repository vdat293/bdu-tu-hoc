import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getEnglishActivities,
  getEnglishCourses,
  loginEnglish,
  startEnglishExercise,
  startEnglishCourseFinish,
  stopEnglishExercise,
  closeEnglishSession,
  createEventStream
} from '../../api/tools.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { trackAction } from '../../services/telemetry.js';
import { ImpactButton, ImpactProgress, hasLiveCanvas } from '../../lib/bdu-vfx/index.js';

export default function EnglishPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const [form, setForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState('');
  const [delay, setDelay] = useState('1');
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [queueInfo, setQueueInfo] = useState({ queued: false, position: 0, totalWaiting: 0, runningCount: 0 });

  const [log, setLog] = useState([
    { time: new Date().toLocaleTimeString(), text: 'Sẵn sàng kết nối Moodle (bdu.vn247.org).', type: 'info' }
  ]);

  const terminalEndRef = useRef(null);
  const cleanupStreamRef = useRef(null);
  const connectBtnRef = useRef(null);
  const connectProgressRef = useRef(null);
  const progressTimerRef = useRef(null);
  const completeResolverRef = useRef(null);

  const updateForm = (key) => (e) => {
    setLoginError('');
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  };

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [log]);

  useEffect(() => {
    if (!busy || session) return;

    const mainEl = document.getElementById('main-content');
    const prevBodyOverflow = document.body.style.overflow;
    const prevDocOverflow = document.documentElement.style.overflow;
    const prevMainOverflow = mainEl ? mainEl.style.overflow : '';

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (mainEl) mainEl.style.overflow = 'hidden';

    const preventScroll = (e) => {
      e.preventDefault();
    };
    const preventScrollKeys = (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', preventScroll, { passive: false });
    window.addEventListener('touchmove', preventScroll, { passive: false });
    window.addEventListener('keydown', preventScrollKeys, { passive: false });

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevDocOverflow;
      if (mainEl) mainEl.style.overflow = prevMainOverflow;
      window.removeEventListener('wheel', preventScroll);
      window.removeEventListener('touchmove', preventScroll);
      window.removeEventListener('keydown', preventScrollKeys);
    };
  }, [busy, session]);

  useEffect(() => {
    if (!busy || session) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      return;
    }

    const progEl = connectProgressRef.current;
    let progressGoal = 0.08;
    let tickCount = 0;
    if (progEl) {
      progEl.reset?.();
      progEl.set?.(progressGoal);
    }

    progressTimerRef.current = setInterval(() => {
      tickCount += 1;
      const step = (0.995 - progressGoal) * (0.14 + 0.04 * Math.sin(tickCount * 0.7));
      progressGoal = Math.min(0.995, progressGoal + Math.max(0.015, step));
      connectProgressRef.current?.set?.(progressGoal);
    }, 100);

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [busy, session]);

  async function reachNinetyNinePercent() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    const progEl = connectProgressRef.current;
    if (!progEl) return;

    const live = hasLiveCanvas();
    if (!live) {
      progEl.set?.(0.995, true);
      return;
    }

    progEl.set?.(0.995);
    await new Promise((resolve) => {
      const start = performance.now();
      const timer = setInterval(() => {
        const currentP = progEl.p || 0;
        const elapsed = performance.now() - start;
        if (currentP >= 0.99 || elapsed > 900) {
          clearInterval(timer);
          progEl.set?.(0.995, true);
          setTimeout(resolve, 180);
        } else if (currentP < 0.85 && elapsed > 200) {
          progEl.set?.(Math.min(0.995, currentP + 0.2), true);
          progEl.set?.(0.995);
        }
      }, 45);
    });
  }

  const setupEventStream = useCallback((sessionId, streamToken) => {
    if (cleanupStreamRef.current) cleanupStreamRef.current();
    const streamUrl = `/api/english/${encodeURIComponent(sessionId)}/stream?streamToken=${encodeURIComponent(streamToken || '')}`;
    cleanupStreamRef.current = createEventStream(streamUrl, {
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'log' || ['info', 'action', 'success', 'warning', 'error', 'question'].includes(data.type)) {
            setLog((cur) => [
              ...cur,
              { time: data.timestamp || new Date().toLocaleTimeString(), text: data.message, type: data.logType || data.type || 'info' }
            ]);
          } else if (data.type === 'courses_updated' && Array.isArray(data.courses)) {
            setCourses(data.courses);
          } else if (data.type === 'ready') {
            if (data.running) {
              setIsRunning(true);
            }
            if (data.queued && data.position > 0) {
              setIsRunning(true);
              setQueueInfo({ queued: true, position: data.position, totalWaiting: data.totalWaiting || 0, runningCount: data.runningCount || 0 });
            } else {
              setQueueInfo({ queued: false, position: 0, totalWaiting: data.totalWaiting || 0, runningCount: data.runningCount || 0 });
            }
          } else if (data.type === 'queue_update') {
            if (data.status === 'queued') {
              setIsRunning(true);
              setQueueInfo({
                queued: true,
                position: data.position,
                totalWaiting: data.totalWaiting,
                runningCount: data.runningCount
              });
            } else if (data.status === 'running') {
              setIsRunning(true);
              setQueueInfo({ queued: false, position: 0, totalWaiting: data.totalWaiting, runningCount: data.runningCount });
            }
          } else if (data.type === 'done') {
            setIsRunning(false);
            setBusy(false);
            setQueueInfo({ queued: false, position: 0, totalWaiting: 0, runningCount: 0 });
            notify('Đã hoàn thành tiến trình làm bài!', 'success');
          } else if (data.type === 'stopped') {
            setIsRunning(false);
            setBusy(false);
            setQueueInfo({ queued: false, position: 0, totalWaiting: 0, runningCount: 0 });
            notify('Đã dừng tiến trình.', 'warning');
          } else if (data.type === 'error') {
            setIsRunning(false);
            setBusy(false);
            setQueueInfo({ queued: false, position: 0, totalWaiting: 0, runningCount: 0 });
            notify(`Lỗi: ${data.message}`, 'error');
          }
        } catch {
          // Stream đã đóng giữa chừng: trạng thái phiên sẽ được xử lý ở lần mở kế tiếp.
        }
      }
    });
  }, [notify]);

  useEffect(() => {
    if (session?.sessionId) {
      setupEventStream(session.sessionId, session.streamToken);
    }
    return () => {
      if (cleanupStreamRef.current) {
        cleanupStreamRef.current();
        cleanupStreamRef.current = null;
      }
    };
  }, [session?.sessionId, session?.streamToken, setupEventStream]);

  async function handleBrowseCourses(e) {
    if (e) e.preventDefault();
    if (!form.username.trim() || !form.password) {
      setLoginError('Vui lòng nhập đầy đủ Tài khoản (MSSV) và Mật khẩu Moodle.');
      notify('Vui lòng nhập đầy đủ Tài khoản (MSSV) và Mật khẩu Moodle.', 'error');
      return;
    }

    if (connectBtnRef.current && (connectBtnRef.current.lastImpactAt === null || performance.now() - connectBtnRef.current.lastImpactAt > 150)) {
      connectBtnRef.current.impact?.();
    }

    setLoginError('');
    setBusy(true);
    setLog((cur) => [
      ...cur,
      { time: new Date().toLocaleTimeString(), text: `Đang kết nối Moodle tài khoản ${form.username}...`, type: 'info' }
    ]);

    try {
      const credentials = { username: form.username.trim(), password: form.password };
      setForm((current) => ({ ...current, password: '' }));
      const res = await loginEnglish(auth.token, credentials);
      trackAction('english_login', {
        label: 'Đăng nhập Moodle tiếng Anh',
        featureId: 'english'
      });

      // Luôn cho thanh chạy tới 99% trước khi nhảy lên 100% khi đúng TK/MK
      await reachNinetyNinePercent();

      connectBtnRef.current?.done?.();
      const progEl = connectProgressRef.current;
      if (progEl) {
        const live = hasLiveCanvas();
        progEl.set?.(1, !live);
        if (live) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              completeResolverRef.current = null;
              resolve();
            };
            completeResolverRef.current = () => setTimeout(finish, 600);
            setTimeout(finish, 850);
          });
        }
      }

      setSession(res);

      const courseList = Array.isArray(res.courses) ? res.courses : [];
      setCourses(courseList);

      setLog((cur) => [
        ...cur,
        {
          time: new Date().toLocaleTimeString(),
          text: `Đã xác thực thành công! Quét được ${courseList.length} khóa học cùng mức độ hoàn thành.`,
          type: 'success'
        }
      ]);
      notify(`Đăng nhập thành công! Tìm thấy ${courseList.length} khóa học.`, 'success');

      setupEventStream(res.sessionId, res.streamToken);

      if (courseList.length > 0) {
        selectCourse(res.sessionId, courseList[0]);
      }
    } catch (err) {
      // Vẫn chạy tới 99% rồi dừng lại và báo lỗi khi sai TK/MK hoặc lỗi kết nối
      await reachNinetyNinePercent();
      const errMsg = err.message || 'Đăng nhập Moodle thất bại.';
      setLoginError(errMsg);
      notify(errMsg, 'error');
      setLog((cur) => [
        ...cur,
        { time: new Date().toLocaleTimeString(), text: `Lỗi đăng nhập: ${errMsg}`, type: 'error' }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function selectCourse(sessionId, course) {
    setSelectedCourse(course);
    setLoadingActivities(true);
    setActivities([]);
    setSelectedActivity('');

    setLog((cur) => [
      ...cur,
      {
        time: new Date().toLocaleTimeString(),
        text: `Đang tải danh sách bài tập cho khóa: "${course.fullname}" (ID: ${course.id})...`,
        type: 'info'
      }
    ]);

    try {
      const list = await getEnglishActivities(auth.token, sessionId, course.id);
      const acts = Array.isArray(list) ? list : list?.activities || [];
      setActivities(acts);
      if (acts.length > 0) {
        setSelectedActivity(acts[0].cmid || acts[0].id || '');
      }
      setLog((cur) => [
        ...cur,
        {
          time: new Date().toLocaleTimeString(),
          text: `Tìm thấy ${acts.length} bài tập/hoạt động trong khóa "${course.fullname}".`,
          type: acts.length > 0 ? 'success' : 'warning'
        }
      ]);
    } catch (err) {
      notify(`Không thể tải bài tập khóa #${course.id}: ${err.message}`, 'error');
    } finally {
      setLoadingActivities(false);
    }
  }

  async function handleRefreshCourses() {
    if (!session) return;
    setBusy(true);
    try {
      const refreshed = await getEnglishCourses(auth.token, session.sessionId);
      setCourses(refreshed);
      notify('Đã cập nhật danh sách khóa học mới nhất.', 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoFinishCourse(all = false) {
    if (!session) return;
    if (!all && !selectedCourse) {
      notify('Vui lòng chọn một khóa học.', 'error');
      return;
    }

    const actionText = all
      ? '🚀 Bắt đầu tự động duyệt & hoàn thành TẤT CẢ các khóa học...'
      : `⚡ Bắt đầu tự động hoàn thành khóa "${selectedCourse.fullname}"...`;

    setBusy(true);
    setIsRunning(true);
    trackAction('english_auto_finish', {
      label: all ? 'Chạy auto tất cả khóa tiếng Anh' : 'Chạy auto khóa tiếng Anh',
      featureId: 'english',
      metadata: { allCourses: all }
    });

    try {
      await startEnglishCourseFinish(auth.token, session.sessionId, {
        courseId: all ? null : selectedCourse.id,
        allCourses: all,
        delaySeconds: Number(delay),
        autoSubmit
      });
      setLog((cur) => [
        ...cur,
        { time: new Date().toLocaleTimeString(), text: actionText, type: 'action' }
      ]);
    } catch (err) {
      setIsRunning(false);
      setBusy(false);
      notify(err.message, 'error');
    }
  }

  async function handleStartSingleQuiz() {
    if (!session || !selectedActivity) {
      notify('Vui lòng chọn một bài tập để làm.', 'error');
      return;
    }

    const selectedActObj = activities.find((a) => String(a.cmid || a.id) === String(selectedActivity));
    const actType = selectedActObj ? selectedActObj.type : 'quiz';

    setBusy(true);
    setIsRunning(true);
    trackAction('english_single_quiz', {
      label: `Làm bài tiếng Anh (${actType})`,
      featureId: 'english',
      metadata: { actType }
    });
    try {
      await startEnglishExercise(auth.token, session.sessionId, {
        cmid: selectedActivity,
        type: actType,
        delaySeconds: Number(delay),
        autoSubmit
      });
      setLog((cur) => [
        ...cur,
        {
          time: new Date().toLocaleTimeString(),
          text: `Đã khởi chạy xử lý hoạt động [${actType}] #${selectedActivity}...`,
          type: 'action'
        }
      ]);
    } catch (err) {
      setIsRunning(false);
      setBusy(false);
      if (err.message && err.message.includes('Phiên Moodle không còn tồn tại')) {
        setSession(null);
        notify('Phiên đăng nhập Moodle đã hết hạn. Vui lòng kết nối lại tài khoản.', 'warning');
      } else {
        notify(err.message, 'error');
      }
    }
  }

  async function handleStopExercise() {
    if (!session) return;
    try {
      await stopEnglishExercise(auth.token, session.sessionId);
      setIsRunning(false);
      setBusy(false);
      notify('Đã phát lệnh dừng tiến trình.', 'warning');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleLogout() {
    if (session) {
      try {
        await closeEnglishSession(auth.token, session.sessionId);
      } catch {
        // Phiên có thể đã hết hạn trên máy chủ; đăng xuất cục bộ vẫn phải chạy.
      }
    }
    if (cleanupStreamRef.current) cleanupStreamRef.current();
    setSession(null);
    setCourses([]);
    setSelectedCourse(null);
    setActivities([]);
    setForm({ username: '', password: '' });
    notify('Đã đóng phiên đăng nhập Moodle.', 'info');
  }

  const filteredCourses = courses.filter((c) =>
    (c.fullname || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.category || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <section id="tab-english" className="tab-pane active">
      {/* Header Banner */}
      <div
        className="section-header-box glass-panel"
        style={{
          filter: busy && !session ? 'blur(6px)' : 'none',
          opacity: busy && !session ? 0.35 : 1,
          pointerEvents: busy && !session ? 'none' : 'auto',
          transition: 'filter 0.3s ease, opacity 0.3s ease'
        }}
      >
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Tự Động Bài Tập Tiếng Anh Moodle</h2>
            <p className="section-desc">Tự động duyệt mọi hoạt động & tự nộp bài tập trên Moodle (bdu.vn247.org)</p>
          </div>
          <span className="badge-mini badge-pill-emerald">bdu.vn247.org</span>
        </div>
      </div>

      {/* STATE 1: CHƯA ĐĂNG NHẬP (Hiển thị 1 Modal Form Duyệt Khóa Học) */}
      {!session ? (
        <div style={{ maxWidth: '520px', margin: '40px auto', position: 'relative' }}>
          {/* Làm mờ luôn cả div lớn .english-card bên ngoài form đăng nhập khi đang kết nối */}
          <div
            id="english-login-form-content"
            className="english-card glass-panel"
            style={{
              padding: '32px',
              borderRadius: '16px',
              filter: busy ? 'blur(8px)' : 'none',
              opacity: busy ? 0.25 : 1,
              pointerEvents: busy ? 'none' : 'auto',
              userSelect: busy ? 'none' : 'auto',
              transition: 'filter 0.3s ease, opacity 0.3s ease'
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '14px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px auto',
                  fontSize: '24px'
                }}
              >
                🎓
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px', color: 'var(--text-main)' }}>
                Duyệt Khóa Học & Bài Tập Moodle
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Nhập tài khoản và mật khẩu Moodle để quét tất cả các khóa học cùng mức độ hoàn thành (% Progress).
              </p>
            </div>

            {loginError && !busy && (
              <div
                id="english-login-error"
                role="alert"
                style={{
                  marginBottom: '16px',
                  padding: '12px 14px',
                  borderRadius: '4px',
                  background: 'var(--nb-tint-rose, rgba(239, 68, 68, 0.14))',
                  border: '2px solid var(--color-rose, #ef4444)',
                  color: 'var(--color-rose, #ef4444)',
                  fontSize: '13px',
                  fontWeight: '700',
                  lineHeight: '1.45'
                }}
              >
                ⚠️ {loginError}
              </div>
            )}

            <form onSubmit={handleBrowseCourses}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label htmlFor="english-username" className="form-label" style={{ fontWeight: '600' }}>
                  Tài khoản Moodle (MSSV)
                </label>
                <input
                  id="english-username"
                  className="form-input english-input"
                  type="text"
                  autoComplete="username"
                  placeholder="Ví dụ: 24050126"
                  value={form.username}
                  onChange={updateForm('username')}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label htmlFor="english-password" className="form-label" style={{ fontWeight: '600' }}>
                  Mật khẩu Moodle
                </label>
                <input
                  id="english-password"
                  className="form-input english-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Mật khẩu của bạn"
                  value={form.password}
                  onChange={updateForm('password')}
                  required
                />
              </div>

              <button type="submit" tabIndex={-1} aria-hidden="true" style={{ display: 'none' }} />

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <ImpactButton
                  ref={connectBtnRef}
                  id="btn-english-connect"
                  type="submit"
                  tone="primary"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? '⏳ Đang kết nối Moodle…' : '🚀 Duyệt khóa học'}
                </ImpactButton>
              </div>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
              🔒 Mật khẩu chỉ dùng tạo phiên làm việc trong bộ nhớ tạm và không được lưu giữ.
            </div>
          </div>

          {/* Thanh BDU Impact Progress nổi sắc nét ở chính giữa phía trên khối div đã bị làm mờ */}
          {busy && (
            <div
              id="english-connect-progress-wrap"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px'
              }}
            >
              <div
                id="english-connect-status"
                className="english-connect-status"
                role="status"
                aria-live="polite"
              >
                <span>Đang đăng nhập, chờ tí</span>
                <span
                  className="bdu-vfx-dot bdu-vfx-dot-1"
                  style={{
                    display: 'inline-block',
                    marginLeft: '2px',
                    animation: 'bduVfxDotBounce 1.2s infinite ease-in-out both',
                    animationDelay: '0s'
                  }}
                >
                  .
                </span>
                <span
                  className="bdu-vfx-dot bdu-vfx-dot-2"
                  style={{
                    display: 'inline-block',
                    marginLeft: '2px',
                    animation: 'bduVfxDotBounce 1.2s infinite ease-in-out both',
                    animationDelay: '0.18s'
                  }}
                >
                  .
                </span>
                <span
                  className="bdu-vfx-dot bdu-vfx-dot-3"
                  style={{
                    display: 'inline-block',
                    marginLeft: '2px',
                    animation: 'bduVfxDotBounce 1.2s infinite ease-in-out both',
                    animationDelay: '0.36s'
                  }}
                >
                  .
                </span>
              </div>
              <ImpactProgress
                ref={connectProgressRef}
                id="english-connect-progress"
                label="Đang đăng nhập, chờ tí…"
                doneLabel="100% ✓"
                onComplete={() => completeResolverRef.current?.()}
                style={{ width: 'min(320px, 86vw)', margin: '0 auto' }}
              />
            </div>
          )}
        </div>
      ) : (
        /* STATE 2: ĐÃ ĐĂNG NHẬP (Hiển thị Bảng Khóa Học & % Hoàn Thành) */
        <div className="english-dashboard-layout" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Top Session Bar */}
          <div
            className="glass-panel english-connected-bar"
            style={{
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="english-connected-badge">
                <span className="english-connected-dot"></span>
                Đã kết nối: {session.username}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Tổng cộng <strong>{courses.length}</strong> khóa học đã đăng ký
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {!isRunning ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{
                    background: 'var(--color-emerald, #10b981)',
                    color: '#111111',
                    fontWeight: '800',
                    padding: '8px 14px'
                  }}
                  onClick={() => handleAutoFinishCourse(true)}
                  disabled={busy}
                >
                  🚀 Tự Động Hoàn Thành TẤT CẢ Khóa Học
                </button>
              ) : (
                <button type="button" className="btn btn-danger btn-sm" onClick={handleStopExercise}>
                  ⏹ Dừng Tiến Trình
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRefreshCourses}
                disabled={busy || isRunning}
              >
                🔄 Cập nhật %
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleLogout} disabled={isRunning}>
                🚪 Đổi tài khoản
              </button>
            </div>
          </div>

          {/* Section: Danh sách Khóa học & Tiến độ */}
          <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-md)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--text-main)' }}>
                  📚 Danh Sách Khóa Học & Mức Độ Hoàn Thành
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  Chọn một khóa học bên dưới để duyệt chi tiết từng bài tập hoặc kích hoạt tự động hoàn thành khóa
                </p>
              </div>

              <input
                type="text"
                placeholder="🔍 Tìm kiếm khóa học..."
                className="form-input"
                style={{ width: '240px', padding: '8px 14px', fontSize: '13px', borderRadius: '4px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredCourses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                Không tìm thấy khóa học nào khớp với tìm kiếm.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
                  gap: '16px'
                }}
              >
                {filteredCourses.map((c) => {
                  const isSelected = selectedCourse?.id === c.id;
                  const progressVal = c.progress !== null && c.progress !== undefined ? c.progress : 0;
                  const isHigh = progressVal >= 80;
                  const isMed = progressVal >= 30 && progressVal < 80;

                  const badgeBg = isHigh
                    ? 'var(--nb-tint-emerald, rgba(16, 185, 129, 0.18))'
                    : isMed
                    ? 'var(--nb-tint-yellow, rgba(250, 204, 21, 0.22))'
                    : 'var(--nb-tint-rose, rgba(239, 68, 68, 0.16))';
                  const badgeColor = isHigh ? 'var(--color-emerald, #10b981)' : isMed ? 'var(--color-amber, #f59e0b)' : 'var(--color-rose, #ef4444)';
                  const progressColor = isHigh ? 'var(--color-emerald, #10b981)' : isMed ? 'var(--color-amber, #f59e0b)' : 'var(--color-rose, #ef4444)';

                  return (
                    <div
                      key={c.id}
                      className={`english-course-card${isSelected ? ' is-selected' : ''}`}
                    >
                      <div>
                        <div className="english-course-card-head">
                          <span className="english-course-tag">
                            {c.category || `ID: ${c.id}`}
                          </span>
                          <span
                            className="english-course-pct"
                            style={{
                              background: badgeBg,
                              color: badgeColor
                            }}
                          >
                            {c.progress !== null && c.progress !== undefined ? `${c.progress}%` : 'N/A'}
                          </span>
                        </div>

                        <h4 className="english-course-title">
                          {c.fullname}
                        </h4>
                      </div>

                      <div>
                        {/* Progress bar */}
                        <div className="english-course-progress">
                          <div
                            className="english-course-progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, progressVal))}%`,
                              background: progressColor
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          className={`btn btn-block english-course-select-btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => selectCourse(session.sessionId, c)}
                        >
                          {isSelected ? '✓ Đang chọn khóa này' : '📌 Chọn khóa học này'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Bảng Điều Khiển Bài Tập & Live Terminal */}
          {selectedCourse && (
            <div className="english-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Card Xử lý bài tập */}
              <div className="english-card glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-emerald, #10b981)', fontWeight: '800' }}>KHÓA HỌC ĐÃ CHỌN</span>
                  <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '4px 0 0 0', color: 'var(--text-main)' }}>
                    {selectedCourse.fullname}
                  </h3>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label htmlFor="english-activity" className="form-label" style={{ fontWeight: '600' }}>
                    Bài tập / Hoạt động trong khóa
                  </label>
                  {loadingActivities ? (
                    <div style={{ padding: '10px', fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>
                      ⏳ Đang quét danh sách bài tập...
                    </div>
                  ) : (
                    <select
                      id="english-activity"
                      className="custom-select english-select"
                      disabled={activities.length === 0 || isRunning}
                      value={selectedActivity}
                      onChange={(e) => setSelectedActivity(e.target.value)}
                    >
                      {activities.length > 0 ? (
                        activities.map((act) => (
                          <option key={act.cmid || act.id} value={act.cmid || act.id}>
                            [{act.type}] {act.title || act.name || `Hoạt động #${act.cmid || act.id}`}
                          </option>
                        ))
                      ) : (
                        <option value="">Không tìm thấy bài tập nào trong khóa này</option>
                      )}
                    </select>
                  )}
                </div>

                <div className="english-options-row" style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="english-delay" className="form-label">
                      Độ trễ mỗi câu
                    </label>
                    <select
                      id="english-delay"
                      className="custom-select english-select"
                      value={delay}
                      onChange={(e) => setDelay(e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="0">0 giây (Nhanh nhất)</option>
                      <option value="1">1 giây</option>
                      <option value="2">2 giây</option>
                      <option value="3">3 giây</option>
                    </select>
                  </div>

                  <label className="english-submit-option" htmlFor="english-auto-submit" style={{ flex: 1 }}>
                    <input
                      id="english-auto-submit"
                      type="checkbox"
                      checked={autoSubmit}
                      onChange={(e) => setAutoSubmit(e.target.checked)}
                      disabled={isRunning}
                    />
                    <span>
                      <strong>Tự động nộp bài</strong>
                      <small style={{ display: 'block' }}>Điền & Nộp sau khi làm xong</small>
                    </span>
                  </label>
                </div>

                <div className="english-warning" role="note" style={{ marginBottom: '20px' }}>
                  💡 Bot sẽ duyệt toàn bộ tài liệu (`scorm`, `icontent`, `h5p`, v.v.) và tự điền/nộp các bài `quiz`.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {!isRunning ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary english-action-btn"
                        style={{
                          padding: '12px',
                          fontWeight: '800',
                          background: 'var(--color-emerald, #10b981)',
                          color: '#111111'
                        }}
                        disabled={busy || loadingActivities}
                        onClick={() => handleAutoFinishCourse(false)}
                      >
                        ⚡ Tự động hoàn thành khóa học này ({activities.length} hoạt động)
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary english-action-btn"
                        style={{
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: '700'
                        }}
                        disabled={!selectedActivity || busy || loadingActivities}
                        onClick={handleStartSingleQuiz}
                      >
                        {(() => {
                          const currentActObj = activities.find((a) => String(a.cmid || a.id) === String(selectedActivity));
                          const currentType = currentActObj ? currentActObj.type : 'quiz';
                          if (currentType === 'quiz') {
                            return `▶ Chỉ chạy duy nhất Quiz được chọn (#${selectedActivity})`;
                          }
                          return `👁 Duyệt hoàn thành [${currentType.toUpperCase()}] được chọn (#${selectedActivity})`;
                        })()}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger english-action-btn"
                      style={{
                        padding: '12px',
                        fontWeight: '800',
                        background: 'var(--color-rose, #ef4444)',
                        color: '#ffffff'
                      }}
                      onClick={handleStopExercise}
                    >
                      {queueInfo.queued ? '⏹ Hủy hàng chờ' : '⏹ Dừng tiến trình'}
                    </button>
                  )}
                </div>
              </div>

              {/* Queue Status Banner if in waiting queue */}
              {queueInfo.queued && (
                <div className="english-queue-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>⏳</span>
                    <span>
                      Bạn đang ở vị trí <strong>#{queueInfo.position}</strong> trong hàng chờ ({queueInfo.runningCount}/5 luồng đang chạy). Hệ thống sẽ tự động bắt đầu khi đến lượt!
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', opacity: 0.85, whiteSpace: 'nowrap' }}>Vui lòng giữ trang mở</span>
                </div>
              )}

              {/* Terminal Log Card */}
              <div className="terminal-card glass-panel english-terminal-card" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <span className="dot dot-red"></span>
                    <span className="dot dot-yellow"></span>
                    <span className="dot dot-green"></span>
                  </div>
                  <span className="terminal-title">ENGLISH_BOT // LIVE LOG</span>
                  <button
                    type="button"
                    className="btn-terminal-clear"
                    onClick={() => setLog([])}
                  >
                    Xóa Log
                  </button>
                </div>
                <div
                  id="english-terminal"
                  className="terminal-body"
                  aria-live="polite"
                  style={{ minHeight: '300px', maxHeight: '420px', overflowY: 'auto' }}
                >
                  {log.map((item, idx) => (
                    <div key={idx} className={`term-line term-${item.type}`}>
                      <span className="term-time">[{item.time}]</span> {item.text}
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
