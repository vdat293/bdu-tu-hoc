import { useEffect, useState } from 'react';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { getSurveyRun, startSurvey, subscribeSurvey } from './runner.js';

export default function SurveyPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const [rating, setRating] = useState('5');
  const [feedback, setFeedback] = useState(
    'Giảng viên dạy nhiệt tình, phương pháp sinh động, tài liệu đầy đủ và hỗ trợ giải đáp thắc mắc của sinh viên rất tốt.'
  );
  const [run, setRun] = useState(getSurveyRun());

  useEffect(() => {
    return subscribeSurvey(setRun);
  }, []);

  const isRunning = run?.status === 'running';

  const start = () => {
    if (isRunning) return;
    startSurvey({
      token: auth.token,
      mssv: auth.user?.mssv || '',
      ratingLevel: rating,
      feedback
    });
    notify('Đã khởi chạy bot tự động khảo sát.', 'info');
  };

  const clearLog = () => {
    setRun((current) => (current ? { ...current, logs: [] } : current));
  };

  return (
    <section id="tab-survey" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Tự Động Đánh Giá Khảo Sát Giảng Viên</h2>
            <p className="section-desc">
              Tự động hoàn thành phiếu khảo sát môn học và giảng viên trên cổng BDU siêu tốc
            </p>
          </div>
          <span className="badge-mini badge-pill-purple">Direct API Bot</span>
        </div>
      </div>

      <div className="survey-layout">
        {/* Left: Settings */}
        <div className="survey-card glass-panel">
          <h3 className="card-subheading">Cấu Hình Đánh Giá Khảo Sát</h3>

          <div className="form-group">
            <label className="form-label">Mức Độ Đánh Giá Mặc Định:</label>
            <div className="radio-options-grid">
              <label
                className={`radio-card ${rating === '5' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setRating('5')}
              >
                <input
                  type="radio"
                  name="survey-rating"
                  value="5"
                  checked={rating === '5'}
                  onChange={() => setRating('5')}
                  style={{ display: 'none' }}
                />
                <div className="radio-content">
                  <span className="r-title">⭐ Rất Tốt / Rất Hài Lòng (5/5)</span>
                  <span className="r-desc">Tự động tick mức điểm cao nhất cho tất cả 40 tiêu chí</span>
                </div>
              </label>

              <label
                className={`radio-card ${rating === '4' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setRating('4')}
              >
                <input
                  type="radio"
                  name="survey-rating"
                  value="4"
                  checked={rating === '4'}
                  onChange={() => setRating('4')}
                  style={{ display: 'none' }}
                />
                <div className="radio-content">
                  <span className="r-title">Tốt / Hài Lòng (4/5)</span>
                  <span className="r-desc">Tự động tick mức điểm tốt</span>
                </div>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nhận Xét & Đóng Góp Ý Kiến Tự Động:</label>
            <textarea
              className="form-textarea"
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>

          <button
            type="button"
            id="btn-start-survey"
            className="btn btn-primary btn-block btn-lg"
            onClick={start}
            disabled={isRunning}
          >
            <span className="btn-text">
              {isRunning ? 'Đang chạy khảo sát…' : 'Bắt đầu khảo sát tự động'}
            </span>
          </button>
        </div>

        {/* Right: Terminal Live Console */}
        <div className="terminal-card glass-panel">
          <div className="terminal-header">
            <div className="terminal-dots">
              <span className="dot dot-red"></span>
              <span className="dot dot-yellow"></span>
              <span className="dot dot-green"></span>
            </div>
            <span className="terminal-title">SURVEY_BOT_CONSOLE // LIVE LOG</span>
            <button
              type="button"
              id="btn-clear-terminal"
              className="btn-terminal-clear"
              onClick={clearLog}
            >
              Xóa Log
            </button>
          </div>
          <div id="survey-terminal" className="terminal-body" style={{ minHeight: '260px', maxHeight: '420px', overflowY: 'auto' }}>
            <div className="term-line term-info">
              <span className="term-time">[00:00:00]</span> Sẵn sàng kết nối máy chủ BDU...
            </div>
            <div className="term-line term-muted">
              <span className="term-time">[00:00:00]</span> Nhấn "Bắt đầu khảo sát tự động" để khởi chạy bot.
            </div>
            {run?.logs?.map((item, index) => (
              <div className={`term-line term-${item.type || 'info'}`} key={index}>
                <span className="term-time">[{item.at || 'LOG'}]</span> {item.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
