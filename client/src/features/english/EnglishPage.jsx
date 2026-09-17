import { useState, useEffect, useRef } from 'react';
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

export default function EnglishPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const [form, setForm] = useState({ username: '', password: '' });
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

  const updateForm = (key) => (e) => setForm((cur) => ({ ...cur, [key]: e.target.value }));

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log]);

  useEffect(() => {
    if (session?.sessionId) {
      setupEventStream(session.sessionId);
    }
    return () => {
      if (cleanupStreamRef.current) {
        cleanupStreamRef.current();
        cleanupStreamRef.current = null;
      }
    };
  }, [session?.sessionId]);

  function setupEventStream(sessionId) {
    if (cleanupStreamRef.current) cleanupStreamRef.current();
    const streamUrl = `/api/english/${encodeURIComponent(sessionId)}/stream`;
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
  }

  async function handleBrowseCourses(e) {
    if (e) e.preventDefault();
    if (!form.username.trim() || !form.password) {
      notify('Vui lòng nhập đầy đủ Tài khoản (MSSV) và Mật khẩu Moodle.', 'error');
      return;
    }

    setBusy(true);
    setLog((cur) => [
      ...cur,
      { time: new Date().toLocaleTimeString(), text: `Đang kết nối Moodle tài khoản ${form.username}...`, type: 'info' }
    ]);

    try {
      const res = await loginEnglish({ username: form.username.trim(), password: form.password });
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

      setupEventStream(res.sessionId);

      if (courseList.length > 0) {
        selectCourse(res.sessionId, courseList[0]);
      }
    } catch (err) {
      notify(err.message || 'Đăng nhập Moodle thất bại.', 'error');
      setLog((cur) => [
        ...cur,
        { time: new Date().toLocaleTimeString(), text: `Lỗi đăng nhập: ${err.message}`, type: 'error' }
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
      const list = await getEnglishActivities(sessionId, course.id);
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
      const refreshed = await getEnglishCourses(session.sessionId);
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

    try {
      await startEnglishCourseFinish(session.sessionId, {
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
    try {
      await startEnglishExercise(session.sessionId, {
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
      await stopEnglishExercise(session.sessionId);
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
        await closeEnglishSession(session.sessionId);
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
      <div className="section-header-box glass-panel">
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
        <div style={{ maxWidth: '520px', margin: '40px auto' }}>
          <div className="english-card glass-panel" style={{ padding: '32px', borderRadius: '16px' }}>
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
              <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-main, #fff)' }}>
                Duyệt Khóa Học & Bài Tập Moodle
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)', lineHeight: '1.5' }}>
                Nhập tài khoản và mật khẩu Moodle để quét tất cả các khóa học cùng mức độ hoàn thành (% Progress).
              </p>
            </div>

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

              <button
                type="submit"
                id="btn-english-connect"
                className="btn btn-primary btn-block"
                style={{
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                  cursor: busy ? 'not-allowed' : 'pointer'
                }}
                disabled={busy}
              >
                {busy ? (
                  <span>⏳ Đang kết nối Moodle & duyệt khóa học…</span>
                ) : (
                  <span>🚀 Duyệt khóa học</span>
                )}
              </button>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
              🔒 Mật khẩu chỉ dùng tạo phiên làm việc trong bộ nhớ tạm và không được lưu giữ.
            </div>
          </div>
        </div>
      ) : (
        /* STATE 2: ĐÃ ĐĂNG NHẬP (Hiển thị Bảng Khóa Học & % Hoàn Thành) */
        <div className="english-dashboard-layout" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Top Session Bar */}
          <div
            className="glass-panel"
            style={{
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '12px',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#10b981',
                  fontSize: '13px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
                Đã kết nối: {session.username}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>
                Tổng cộng <strong>{courses.length}</strong> khóa học đã đăng ký
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {!isRunning ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    fontWeight: '700',
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
          <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px' }}>
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
                <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0, color: 'var(--text-main, #fff)' }}>
                  📚 Danh Sách Khóa Học & Mức Độ Hoàn Thành
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 0 0' }}>
                  Chọn một khóa học bên dưới để duyệt chi tiết từng bài tập hoặc kích hoạt tự động hoàn thành khóa
                </p>
              </div>

              <input
                type="text"
                placeholder="🔍 Tìm kiếm khóa học..."
                className="form-input"
                style={{ width: '240px', padding: '8px 14px', fontSize: '13px', borderRadius: '8px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredCourses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted, #94a3b8)' }}>
                Không tìm thấy khóa học nào khớp với tìm kiếm.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: '16px'
                }}
              >
                {filteredCourses.map((c) => {
                  const isSelected = selectedCourse?.id === c.id;
                  const progressVal = c.progress !== null && c.progress !== undefined ? c.progress : 0;
                  const isHigh = progressVal >= 80;
                  const isMed = progressVal >= 30 && progressVal < 80;

                  const badgeBg = isHigh
                    ? 'rgba(16, 185, 129, 0.2)'
                    : isMed
                    ? 'rgba(245, 158, 11, 0.2)'
                    : 'rgba(239, 68, 68, 0.15)';
                  const badgeColor = isHigh ? '#10b981' : isMed ? '#f59e0b' : '#ef4444';
                  const progressColor = isHigh ? '#10b981' : isMed ? '#f59e0b' : '#ef4444';

                  return (
                    <div
                      key={c.id}
                      style={{
                        padding: '18px',
                        borderRadius: '12px',
                        background: isSelected
                          ? 'rgba(16, 185, 129, 0.08)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected
                          ? '2px solid #10b981'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '8px'
                          }}
                        >
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: '600',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: 'rgba(255, 255, 255, 0.1)',
                              color: 'var(--text-muted, #cbd5e1)'
                            }}
                          >
                            {c.category || `ID: ${c.id}`}
                          </span>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: '700',
                              padding: '4px 10px',
                              borderRadius: '12px',
                              background: badgeBg,
                              color: badgeColor
                            }}
                          >
                            {c.progress !== null && c.progress !== undefined ? `${c.progress}%` : 'N/A'}
                          </span>
                        </div>

                        <h4
                          style={{
                            fontSize: '15px',
                            fontWeight: '600',
                            margin: '8px 0 12px 0',
                            color: 'var(--text-main, #fff)',
                            lineHeight: '1.4'
                          }}
                        >
                          {c.fullname}
                        </h4>
                      </div>

                      <div>
                        {/* Progress bar */}
                        <div
                          style={{
                            width: '100%',
                            height: '8px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            overflow: 'hidden',
                            marginBottom: '14px'
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, progressVal))}%`,
                              height: '100%',
                              borderRadius: '4px',
                              background: progressColor,
                              transition: 'width 0.4s ease'
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          className={`btn btn-block ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                          style={{
                            padding: '8px',
                            fontSize: '13px',
                            fontWeight: '600',
                            borderRadius: '8px'
                          }}
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
              <div className="english-card glass-panel" style={{ padding: '24px', borderRadius: '16px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>KHÓA HỌC ĐÃ CHỌN</span>
                  <h3 style={{ fontSize: '17px', fontWeight: '700', margin: '4px 0 0 0', color: '#fff' }}>
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
                        className="btn btn-primary"
                        style={{
                          padding: '12px',
                          fontWeight: '700',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                        }}
                        disabled={busy || loadingActivities}
                        onClick={() => handleAutoFinishCourse(false)}
                      >
                        ⚡ Tự động hoàn thành khóa học này ({activities.length} hoạt động)
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: '600',
                          borderRadius: '8px'
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
                      className="btn btn-danger"
                      style={{
                        padding: '12px',
                        fontWeight: '700',
                        borderRadius: '8px',
                        background: '#ef4444'
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
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '14px 18px',
                    borderRadius: '12px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    color: '#fbbf24',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontWeight: '600',
                    fontSize: '14px',
                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.1)'
                  }}
                >
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
              <div className="terminal-card glass-panel english-terminal-card" style={{ borderRadius: '16px', overflow: 'hidden' }}>
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
