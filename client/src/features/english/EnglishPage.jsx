import { useState } from 'react';
import { getEnglishActivities, loginEnglish, startEnglishExercise } from '../../api/tools.js';
import { useAuth, useToasts } from '../../app/providers.jsx';

export default function EnglishPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const [form, setForm] = useState({ username: '', password: '', courseId: '281' });
  const [session, setSession] = useState(null);
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState('');
  const [delay, setDelay] = useState('2');
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([
    { time: '00:00:00', text: 'Sẵn sàng kết nối Moodle.', type: 'info' },
    { time: '00:00:00', text: 'Chưa có dữ liệu nào được gửi ra dịch vụ AI.', type: 'muted' }
  ]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function connect(event) {
    event.preventDefault();
    if (!form.username || !form.password) {
      notify('Vui lòng nhập tài khoản và mật khẩu Moodle.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await loginEnglish({ username: form.username, password: form.password });
      setSession(result);
      const list = await getEnglishActivities(result.sessionId || result.id, form.courseId);
      const acts = Array.isArray(list) ? list : list?.activities || [];
      setActivities(acts);
      if (acts.length > 0) setSelectedActivity(acts[0].id || acts[0].cmid || '');
      setLog((cur) => [...cur, { time: new Date().toLocaleTimeString(), text: 'Đã kết nối Moodle và tải danh sách bài tập.', type: 'info' }]);
      notify('Đã kết nối Moodle thành công.', 'success');
    } catch (error) {
      notify(error.message, 'error');
      setLog((cur) => [...cur, { time: new Date().toLocaleTimeString(), text: `Lỗi kết nối: ${error.message}`, type: 'error' }]);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!session) return;
    setBusy(true);
    try {
      await startEnglishExercise(session.sessionId || session.id, {
        activityId: selectedActivity || activities[0]?.id,
        delaySeconds: Number(delay),
        autoSubmit
      });
      setLog((cur) => [...cur, { time: new Date().toLocaleTimeString(), text: 'Đã bắt đầu tiến trình giải bài tập tự động.', type: 'info' }]);
    } catch (error) {
      notify(error.message, 'error');
      setLog((cur) => [...cur, { time: new Date().toLocaleTimeString(), text: `Lỗi: ${error.message}`, type: 'error' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="tab-english" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Tự Động Bài Tập Tiếng Anh Moodle</h2>
            <p className="section-desc">Quét quiz, điền từ ngân hàng đáp án cục bộ và theo dõi tiến trình trực tiếp</p>
          </div>
          <span className="badge-mini badge-pill-emerald">bdu.vn247.org</span>
        </div>
      </div>

      <div className="english-layout">
        <div className="english-card glass-panel">
          <div className="english-card-heading">
            <div>
              <h3 className="card-subheading">Kết Nối Moodle</h3>
              <p className="english-help">
                Mật khẩu chỉ dùng để tạo phiên đăng nhập trong bộ nhớ và không được lưu xuống đĩa.
              </p>
            </div>
            <span
              id="english-connection-status"
              className={`english-status ${session ? 'is-online' : 'is-offline'}`}
            >
              {session ? 'Đã kết nối' : 'Chưa kết nối'}
            </span>
          </div>

          <form onSubmit={connect}>
            <div className="english-form-grid">
              <div className="form-group">
                <label htmlFor="english-username" className="form-label">Tài khoản Moodle</label>
                <input
                  id="english-username"
                  className="form-input english-input"
                  type="text"
                  autoComplete="username"
                  placeholder="MSSV / Username"
                  value={form.username}
                  onChange={update('username')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="english-password" className="form-label">Mật khẩu Moodle</label>
                <input
                  id="english-password"
                  className="form-input english-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Mật khẩu"
                  value={form.password}
                  onChange={update('password')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="english-course-id" className="form-label">Course ID</label>
                <input
                  id="english-course-id"
                  className="form-input english-input"
                  type="number"
                  min="1"
                  value={form.courseId}
                  onChange={update('courseId')}
                />
              </div>
            </div>

            <button
              type="submit"
              id="btn-english-connect"
              className="btn btn-secondary btn-block"
              disabled={busy}
            >
              <span className="btn-text">{busy ? 'Đang kết nối…' : 'Đăng nhập & quét khóa học'}</span>
            </button>
          </form>

          <div
            id="english-run-settings"
            className={`english-run-settings ${!session ? 'is-disabled' : ''}`}
            aria-disabled={!session}
            style={{ marginTop: '20px' }}
          >
            <div className="form-group">
              <label htmlFor="english-activity" className="form-label">Bài tập / hoạt động</label>
              <select
                id="english-activity"
                className="custom-select english-select"
                disabled={!session || activities.length === 0}
                value={selectedActivity}
                onChange={(e) => setSelectedActivity(e.target.value)}
              >
                {activities.length > 0 ? (
                  activities.map((act) => (
                    <option key={act.id || act.cmid} value={act.id || act.cmid}>
                      {act.name || act.title || `Bài tập #${act.id}`}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {session ? 'Không có bài tập nào trong khóa này' : 'Đăng nhập để tải danh sách bài tập'}
                  </option>
                )}
              </select>
            </div>

            <div className="english-options-row">
              <div className="form-group">
                <label htmlFor="english-delay" className="form-label">Độ trễ mỗi câu</label>
                <select
                  id="english-delay"
                  className="custom-select english-select"
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                  disabled={!session}
                >
                  <option value="0">Không trễ</option>
                  <option value="1">1 giây</option>
                  <option value="2">2 giây</option>
                  <option value="3">3 giây</option>
                </select>
              </div>

              <label className="english-submit-option" htmlFor="english-auto-submit">
                <input
                  id="english-auto-submit"
                  type="checkbox"
                  checked={autoSubmit}
                  onChange={(e) => setAutoSubmit(e.target.checked)}
                  disabled={!session}
                />
                <span>
                  <strong>Tự động nộp bài</strong>
                  <small>Có thể ảnh hưởng điểm và số lượt thi</small>
                </span>
              </label>
            </div>

            <div className="english-warning" role="note">
              Câu chưa có trong ngân hàng đáp án sẽ được bỏ qua. Khi bật tự nộp, bạn phải xác nhận thêm một lần trước khi chạy.
            </div>

            <div className="english-actions" style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
              <button
                type="button"
                id="btn-english-start"
                className="btn btn-primary"
                disabled={!session || busy}
                onClick={start}
              >
                <span className="btn-text">Bắt đầu tự động làm bài</span>
              </button>
            </div>
          </div>
        </div>

        <div className="terminal-card glass-panel english-terminal-card">
          <div className="terminal-header">
            <div className="terminal-dots">
              <span className="dot dot-red"></span>
              <span className="dot dot-yellow"></span>
              <span className="dot dot-green"></span>
            </div>
            <span className="terminal-title">ENGLISH_BOT // LIVE LOG</span>
            <button
              type="button"
              id="btn-clear-english-terminal"
              className="btn-terminal-clear"
              onClick={() => setLog([])}
            >
              Xóa Log
            </button>
          </div>
          <div id="english-terminal" className="terminal-body" aria-live="polite" style={{ minHeight: '260px', maxHeight: '420px', overflowY: 'auto' }}>
            {log.map((item, idx) => (
              <div key={idx} className={`term-line term-${item.type}`}>
                <span className="term-time">[{item.time}]</span> {item.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
