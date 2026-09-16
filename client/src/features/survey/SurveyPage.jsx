import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { getProfile } from '../../api/academics.js';
import { getSurveyForms } from '../../api/tools.js';
import { clearSurveyLogs, getSurveyRun, restoreSurveyRun, startSurvey, subscribeSurvey } from './runner.js';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';

const FEEDBACK_SCENARIOS = [
  { id: 'enthusiastic', label: 'Nhiệt tình & dễ hiểu', text: 'Giảng viên dạy nhiệt tình, phương pháp sinh động, tài liệu đầy đủ và hỗ trợ giải đáp thắc mắc của sinh viên rất tốt.' },
  { id: 'structured', label: 'Mạch lạc & có hệ thống', text: 'Nội dung được trình bày mạch lạc, bám sát mục tiêu môn học. Giảng viên hướng dẫn rõ ràng và tạo điều kiện để sinh viên theo kịp bài.' },
  { id: 'practical', label: 'Gắn với thực tế', text: 'Giảng viên kết hợp lý thuyết với ví dụ thực tế, giúp sinh viên dễ hiểu và thấy rõ ứng dụng của kiến thức trong môn học.' },
  { id: 'supportive', label: 'Hỗ trợ sinh viên', text: 'Giảng viên thân thiện, sẵn sàng giải đáp câu hỏi và khuyến khích sinh viên chủ động trao đổi trong quá trình học tập.' },
  { id: 'balanced', label: 'Đánh giá cân bằng', text: 'Nhìn chung môn học được tổ chức tốt, nội dung phù hợp và giảng viên có tinh thần trách nhiệm trong giảng dạy.' }
];

const DEFAULT_FEEDBACK = FEEDBACK_SCENARIOS[0].text;

function findGenderValue(value, depth = 0) {
  if (value && typeof value === 'object' && depth < 4) {
    for (const key of ['label', 'name', 'text', 'value', 'id', 'code', 'description']) {
      const found = findGenderValue(value[key], depth + 1);
      if (found) return found;
    }
    for (const nested of Object.values(value)) {
      const found = findGenderValue(nested, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '0') return '0';
  if (normalized === '1') return '1';
  if (/nữ|nu|female|woman|girl/.test(normalized)) return '1';
  if (/nam|male|man|boy/.test(normalized)) return '0';
  return null;
}

function detectGender(payload, depth = 0) {
  if (!payload || depth > 8) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = detectGender(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  for (const [key, value] of Object.entries(payload)) {
    if (/gioi.?tinh|gender|sex|phai/i.test(key)) {
      const found = findGenderValue(value);
      if (found) return found;
    }
  }
  for (const value of Object.values(payload)) {
    const found = detectGender(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export default function SurveyPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const [rating, setRating] = useState('5');
  const [courseRatings, setCourseRatings] = useState({});
  const [gender, setGender] = useState('0');
  const [feedback, setFeedback] = useState(DEFAULT_FEEDBACK);
  const [feedbackScenario, setFeedbackScenario] = useState('random');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState('ratings');
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [courses, setCourses] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [courseError, setCourseError] = useState('');
  const [genderLabel, setGenderLabel] = useState('Đang tự nhận diện');
  const [run, setRun] = useState(getSurveyRun());

  const settingsDialogRef = useRef(null);
  const coursePickerDialogRef = useRef(null);
  const terminalRef = useRef(null);
  const processedKeysRef = useRef(new Set());
  const lastFinishedStatusRef = useRef(null);

  useViewportDialog(showSettingsModal, () => setShowSettingsModal(false), settingsDialogRef);
  useViewportDialog(showCoursePicker, () => setShowCoursePicker(false), coursePickerDialogRef);

  useEffect(() => subscribeSurvey(setRun), []);

  // A page refresh must reconnect to the already-created backend run, never
  // create a second survey request just to restore the terminal output.
  useEffect(() => {
    if (auth.token) restoreSurveyRun(auth.token);
  }, [auth.token]);

  // Auto-scroll terminal log to bottom on new log entries
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [run?.logs]);

  // Live update courses as each subject completes
  useEffect(() => {
    const completedKeys = run?.completedKeys;
    if (!Array.isArray(completedKeys) || completedKeys.length === 0) return;

    let hasNew = false;
    completedKeys.forEach((key) => {
      if (!processedKeysRef.current.has(key)) {
        processedKeysRef.current.add(key);
        hasNew = true;
      }
    });

    if (hasNew) {
      setCourses((prev) => {
        if (!prev) return prev;
        return prev.map((course) => {
          if (processedKeysRef.current.has(course.surveyKey)) {
            return { ...course, completed: true };
          }
          return course;
        });
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        completedKeys.forEach((key) => next.delete(key));
        return next;
      });
    }
  }, [run?.completedKeys]);

  // When run finishes (success), automatically re-fetch from BDU server
  useEffect(() => {
    if (run?.status === 'success' && lastFinishedStatusRef.current !== run) {
      lastFinishedStatusRef.current = run;
      const timer = window.setTimeout(() => {
        loadCourses();
      }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [run?.status, run]);

  const loadCourses = async () => {
    if (!auth.token || loadingCourses) return;
    setLoadingCourses(true);
    setCourseError('');
    try {
      const [items, profile] = await Promise.all([
        getSurveyForms(auth.token),
        getProfile(auth.token, { idsv: auth.user?.idsv || '', mssv: auth.user?.mssv || '' }).catch(() => null)
      ]);
      const pending = items.filter((item) => !item.completed);
      setCourses(items);
      setSelectedKeys(new Set(pending.map((item) => item.surveyKey)));
      const detected = detectGender(profile) || findGenderValue(auth.user?.gender) || findGenderValue(auth.user?.gioi_tinh);
      if (detected) {
        setGender(detected);
        setGenderLabel(detected === '1' ? 'Nữ (tự nhận diện)' : 'Nam (tự nhận diện)');
      } else {
        setGenderLabel('Chưa đọc được, dùng Nam');
      }
    } catch (error) {
      setCourseError(error.message || 'Không thể tải danh sách môn khảo sát.');
      notify(error.message || 'Không thể tải danh sách môn khảo sát.', 'error');
    } finally {
      setLoadingCourses(false);
    }
  };

  const isRunning = ['starting', 'queued', 'running'].includes(run?.status);
  const pendingCourses = useMemo(() => (courses || []).filter((course) => !course.completed), [courses]);
  const selectedCourses = useMemo(
    () => pendingCourses.filter((course) => selectedKeys.has(course.surveyKey)),
    [pendingCourses, selectedKeys]
  );
  const allSelected = pendingCourses.length > 0 && selectedCourses.length === pendingCourses.length;

  const getCourseRating = (surveyKey) => courseRatings[surveyKey] || rating;

  const setSingleCourseRating = (surveyKey, score) => {
    setCourseRatings((prev) => ({ ...prev, [surveyKey]: score }));
  };

  const handleGlobalRatingChange = (score) => {
    setRating(score);
    const updated = {};
    pendingCourses.forEach((course) => {
      updated[course.surveyKey] = score;
    });
    setCourseRatings(updated);
  };

  const setAllRatings = (score) => {
    setRating(score);
    const updated = {};
    pendingCourses.forEach((course) => {
      updated[course.surveyKey] = score;
    });
    setCourseRatings(updated);
  };

  const customCount = useMemo(() => {
    return selectedCourses.filter((course) => {
      const r = courseRatings[course.surveyKey];
      return r && r !== rating;
    }).length;
  }, [courseRatings, rating, selectedCourses]);

  const toggleCourse = (surveyKey) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(surveyKey)) next.delete(surveyKey);
      else next.add(surveyKey);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(pendingCourses.map((course) => course.surveyKey)));
  };

  const start = async () => {
    if (isRunning || selectedCourses.length === 0) return;
    processedKeysRef.current = new Set();
    try {
      const runState = await startSurvey({
        token: auth.token,
        mssv: auth.user?.mssv || '',
        ratingLevel: rating,
        genderLevel: gender,
        attendanceLevel: '1',
        feedback,
        feedbackScenarios: feedbackScenario === 'random'
          ? FEEDBACK_SCENARIOS.map((scenario) => scenario.text)
          : [feedback],
        feedbackMode: feedbackScenario === 'random' ? 'random' : 'ordered',
        courseRatings,
        selectedSurveys: selectedCourses.map((course) => course.surveyKey)
      });
      notify(runState?.reused
        ? 'Khảo sát đang chạy trên backend; đã kết nối lại theo dõi tiến trình.'
        : `Đã khởi chạy khảo sát cho ${selectedCourses.length} môn.`, 'info');
    } catch (error) {
      notify(error.message || 'Không thể khởi chạy khảo sát.', 'error');
    }
  };

  const clearLog = () => {
    clearSurveyLogs();
  };

  return (
    <section id="tab-survey" className="tab-pane active survey-page">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Tự Động Đánh Giá Khảo Sát Giảng Viên</h2>
            <p className="section-desc">Đọc form khảo sát đang mở, chọn môn rồi gửi câu trả lời trực tiếp qua API BDU.</p>
          </div>
          <span className="badge-mini badge-pill-purple">Direct API Bot</span>
        </div>
      </div>

      <div className="survey-layout">
        <div className={`survey-card glass-panel${courses ? '' : ' survey-card-empty'}`}>
          {!courses && <div className="survey-list-hero survey-load-only">
            <div>
              <span className="survey-list-kicker">BDU SURVEY SCANNER</span>
              <h3 className="card-subheading">Lấy dữ liệu khảo sát</h3>
              <p>Nhấn nút để tải danh sách môn đang mở.</p>
            </div>
            <button type="button" className="survey-load-button" onClick={loadCourses} disabled={loadingCourses}>
              <span aria-hidden="true">✦</span>{loadingCourses ? 'Đang lấy…' : 'Lấy danh sách'}
            </button>
          </div>}

          {courses && <>
          <div className="survey-card-topbar">
            <div className="survey-card-topbar-left">
              <span className="survey-card-topbar-title">BỘ ĐIỀU KHIỂN KHẢO SÁT</span>
              {customCount > 0 && (
                <span className="survey-custom-alert-pill" title="Có môn được đặt mức đánh giá riêng">
                  {customCount} môn chỉnh riêng
                </span>
              )}
            </div>
            <button
              type="button"
              className={`survey-settings-gear-btn ${showSettingsModal || customCount > 0 ? 'active' : ''}`}
              onClick={() => setShowSettingsModal(true)}
              aria-label="Cấu hình chi tiết khảo sát"
              title="Tùy chỉnh mức hài lòng riêng cho từng môn & Kịch bản nhận xét"
            >
              <span className="survey-gear-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </span>
              <span className="survey-gear-label">Tùy chỉnh riêng & Nhận xét</span>
            </button>
          </div>

          <div className="survey-selection-summary">
            <div>
              <span className="survey-list-kicker">SURVEY SUBJECTS</span>
              <strong>{selectedCourses.length}/{pendingCourses.length} môn được chọn</strong>
            </div>
            <button
              type="button"
              className="survey-pick-button"
              onClick={() => setShowCoursePicker(true)}
              disabled={isRunning || pendingCourses.length === 0}
            >
              Chọn môn
            </button>
          </div>

          <h3 className="card-subheading survey-settings-heading">Mức đánh giá</h3>

          {courseError && <div className="survey-inline-error" role="alert">{courseError}</div>}
          <div className="survey-autofill-note">
            <span aria-hidden="true">🪄</span>
            <span>Giới tính: <strong>{genderLabel}</strong> · Tỷ lệ tham gia: <strong>Trên 80%</strong></span>
          </div>

          <div className="form-group">
            <div className="survey-rating-compact" aria-label="Chọn số điểm đánh giá chung">
              {['3', '4', '5'].map((value) => (
                <label className={`survey-score-pill ${rating === value ? 'active' : ''}`} key={value}>
                  <input type="radio" name="survey-rating" value={value} checked={rating === value} onChange={() => handleGlobalRatingChange(value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="button" id="btn-start-survey" className="btn btn-primary btn-block btn-lg" onClick={start} disabled={isRunning || selectedCourses.length === 0}>
            <span className="btn-text">{run?.status === 'starting' ? 'Đang khởi tạo khảo sát…' : isRunning ? 'Đang chạy khảo sát…' : `Bắt đầu khảo sát (${selectedCourses.length} môn)`}</span>
          </button>
          </>}
        </div>

        <div className="terminal-card glass-panel">
          <div className="terminal-header">
            <div className="terminal-dots"><span className="dot dot-red"></span><span className="dot dot-yellow"></span><span className="dot dot-green"></span></div>
            <span className="terminal-title">SURVEY_BOT_CONSOLE // LIVE LOG</span>
            <button type="button" id="btn-clear-terminal" className="btn-terminal-clear" onClick={clearLog}>Xóa Log</button>
          </div>
          <div id="survey-terminal" ref={terminalRef} className="terminal-body" style={{ minHeight: '0', maxHeight: 'none', overflowY: 'auto' }}>
            <div className="term-line term-info"><span className="term-time">[00:00:00]</span> Đang chờ danh sách form khảo sát BDU…</div>
            {run?.logs?.map((item, index) => (
              <div className={`term-line term-${item.type || 'info'}`} key={index}>
                <span className="term-time">[{item.at || 'LOG'}]</span> {item.message}
              </div>
            ))}
          </div>
        </div>
      </div>
      {showCoursePicker && courses && (
        <ViewportModal
          id="modal-survey-course-picker"
          title="Chọn môn muốn đánh giá"
          labelledBy="survey-course-modal-title"
          onClose={() => setShowCoursePicker(false)}
          dialogRef={coursePickerDialogRef}
          className="survey-course-modal"
        >
          <div className="survey-course-modal-head">
            <div><span className="survey-list-kicker">SURVEY SUBJECTS</span><h3 id="survey-course-modal-title">Chọn môn muốn đánh giá</h3></div>
            <button type="button" className="survey-modal-close" onClick={() => setShowCoursePicker(false)} aria-label="Đóng">×</button>
          </div>
          <div className="survey-course-modal-actions">
            <span>{selectedCourses.length}/{pendingCourses.length} môn được chọn</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll}>{allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button>
          </div>
          <div className="survey-course-modal-list">
            {courses.map((course) => {
              const checked = selectedKeys.has(course.surveyKey);
              return <label className={`survey-course-row${checked ? ' selected' : ''}${course.completed ? ' completed' : ''}`} key={course.surveyKey}>
                <input type="checkbox" checked={checked} disabled={course.completed || isRunning} onChange={() => toggleCourse(course.surveyKey)} />
                <span className="survey-course-main">
                  <strong>{course.courseName || course.courseCode || 'Môn chưa đặt tên'}</strong>
                  <small>
                    {course.courseCode}{course.lecturer ? ` · GV: ${course.lecturer}` : ''}
                    {!course.completed && <span className="course-rating-mini-badge"> · {getCourseRating(course.surveyKey)} ⭐</span>}
                  </small>
                </span>
                <span className={`survey-course-status ${course.completed ? 'done' : ''}`}>{course.completed ? 'Đã khảo sát' : 'Chờ khảo sát'}</span>
              </label>;
            })}
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setShowCoursePicker(false)}>Xác nhận lựa chọn</button>
        </ViewportModal>
      )}

      {showSettingsModal && courses && (
        <ViewportModal
          id="modal-survey-advanced-settings"
          title="Cấu hình khảo sát chi tiết"
          labelledBy="survey-settings-modal-title"
          onClose={() => setShowSettingsModal(false)}
          dialogRef={settingsDialogRef}
          className="survey-settings-modal"
        >
          <div className="survey-course-modal-head">
            <div>
              <span className="survey-list-kicker">ADVANCED SURVEY CONFIG</span>
              <h3 id="survey-settings-modal-title">Cấu hình khảo sát chi tiết</h3>
            </div>
            <button type="button" className="survey-modal-close" onClick={() => setShowSettingsModal(false)} aria-label="Đóng">×</button>
          </div>

          <div className="survey-settings-tabs">
            <button
              type="button"
              className={`survey-tab-pill ${settingsTab === 'ratings' ? 'active' : ''}`}
              onClick={() => setSettingsTab('ratings')}
            >
              <span>⭐ Mức hài lòng từng môn</span>
              <span className="survey-tab-badge">{selectedCourses.length} môn chọn</span>
            </button>
            <button
              type="button"
              className={`survey-tab-pill ${settingsTab === 'feedback' ? 'active' : ''}`}
              onClick={() => setSettingsTab('feedback')}
            >
              <span>💬 Kịch bản nhận xét</span>
            </button>
          </div>

          {settingsTab === 'ratings' && (
            <div className="survey-settings-tab-pane">
              <div className="survey-quick-actions-bar">
                <span className="quick-actions-label">Đặt nhanh tất cả:</span>
                <div className="quick-actions-pills">
                  <button type="button" className="btn-quick-pill" onClick={() => setAllRatings('5')}>Tất cả 5 ⭐</button>
                  <button type="button" className="btn-quick-pill" onClick={() => setAllRatings('4')}>Tất cả 4 ⭐</button>
                  <button type="button" className="btn-quick-pill" onClick={() => setAllRatings('3')}>Tất cả 3 ⭐</button>
                </div>
              </div>

              <div className="survey-course-ratings-list">
                {pendingCourses.length === 0 && (
                  <div className="survey-empty-state">Không có môn nào đang chờ khảo sát.</div>
                )}
                {pendingCourses.map((course) => {
                  const isSelected = selectedKeys.has(course.surveyKey);
                  const currentScore = getCourseRating(course.surveyKey);
                  return (
                    <div className={`survey-course-rating-card ${isSelected ? 'selected' : 'unselected'}`} key={course.surveyKey}>
                      <div className="course-rating-meta">
                        <div className="course-rating-title-line">
                          <span className={`course-status-indicator ${isSelected ? 'active' : ''}`}></span>
                          <strong>{course.courseName || course.courseCode || 'Môn chưa đặt tên'}</strong>
                        </div>
                        <div className="course-rating-sub">
                          <span>{course.courseCode}</span>
                          {course.lecturer && <span> · GV: {course.lecturer}</span>}
                          {!isSelected && <span className="course-unselected-tag">(Chưa chọn khảo sát)</span>}
                        </div>
                      </div>

                      <div className="course-rating-score-group" aria-label={`Chọn mức đánh giá cho ${course.courseName}`}>
                        {['3', '4', '5'].map((val) => (
                          <button
                            type="button"
                            key={val}
                            disabled={!isSelected || isRunning}
                            className={`score-choice-pill ${currentScore === val ? 'active' : ''}`}
                            onClick={() => setSingleCourseRating(course.surveyKey, val)}
                          >
                            {val} ⭐
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {settingsTab === 'feedback' && (
            <div className="survey-settings-tab-pane">
              <div className="survey-feedback-intro-box">
                <span aria-hidden="true">💡</span>
                <p>Nội dung này được tự động gửi vào các câu tự luận cuối phiếu (Câu 41 - 44: Ưu điểm, Điều chưa hài lòng, Đề xuất cho GV & Nhà trường).</p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="modal-feedback-scenario">Kịch bản nhận xét</label>
                <select
                  id="modal-feedback-scenario"
                  className="form-select survey-feedback-select"
                  value={feedbackScenario}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFeedbackScenario(value);
                    if (value !== 'random') setFeedback(FEEDBACK_SCENARIOS.find((scenario) => scenario.id === value)?.text || DEFAULT_FEEDBACK);
                  }}
                >
                  <option value="random">🎲 Ngẫu nhiên {FEEDBACK_SCENARIOS.length} kịch bản (mỗi môn một kiểu khác nhau)</option>
                  {FEEDBACK_SCENARIOS.map((scenario) => (
                    <option value={scenario.id} key={scenario.id}>{scenario.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="modal-feedback-textarea">
                  {feedbackScenario === 'random' ? 'Mẫu nhận xét tham khảo' : 'Nội dung nhận xét cụ thể'}
                </label>
                <textarea
                  id="modal-feedback-textarea"
                  className="form-textarea"
                  rows={4}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Nhập nội dung nhận xét hoặc đề xuất cho giảng viên..."
                />
              </div>
            </div>
          )}

          <div className="survey-modal-footer">
            <div className="survey-modal-footer-stats">
              <span>Áp dụng cho <strong>{selectedCourses.length} môn</strong> đã chọn</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setShowSettingsModal(false)}>
              Hoàn tất & Áp dụng
            </button>
          </div>
        </ViewportModal>
      )}
    </section>
  );
}
