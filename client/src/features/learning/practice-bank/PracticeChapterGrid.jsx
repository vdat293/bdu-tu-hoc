import { useState } from 'react';
import { chapterTone, formatDuration } from './practice-bank.utils.js';

const EXAM_COUNTS = [20, 50, 60];
const DEFAULT_EXAM_COUNT = 50;
const SECONDS_PER_EXAM_QUESTION = 30;

function examDurationMinutes(count) {
  return Math.max(5, Math.round((count * SECONDS_PER_EXAM_QUESTION) / 60));
}

export default function PracticeChapterGrid({
  summary,
  initialExamMode = false,
  startingExam = false,
  resettingChapter = null,
  onStartPractice,
  onStartExam,
  onResetChapter
}) {
  const [examCount, setExamCount] = useState(DEFAULT_EXAM_COUNT);
  const { bank, stats = {}, chapters = [], recent_exams: recentExams = [] } = summary;
  const total = Number(stats.total_questions ?? bank.question_count ?? 0);
  const answered = Number(stats.answered_count || 0);
  const accuracy = Number(stats.accuracy_percent || 0);
  const wrong = Number(stats.wrong_count || 0);
  const bookmarked = Number(stats.bookmarked_count || 0);
  const completion = Number(stats.completion_percent || 0);

  return (
    <>
      {/* Hero Tổng quan */}
      <section className="clay-pb-hub-hero" aria-label="Tổng quan ngân hàng ôn tập">
        <div className="clay-pb-hub-head">
          <div>
            <span className="clay-pb-eyebrow">
              🧩 Phòng Ôn Tập Claymorphism · {bank.course_code}
            </span>
            <h1 className="clay-pb-hub-title">{bank.title}</h1>
            <p className="clay-pb-hub-sub">
              {bank.description || `Ngân hàng ${total} câu hỏi trắc nghiệm có giải thích chi tiết. Chọn chế độ ôn theo chương, ôn lại câu sai hoặc thi thử bấm giờ.`}
            </p>
          </div>
          {answered > 0 && (
            <button
              type="button"
              className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm"
              disabled={resettingChapter !== null}
              onClick={() => onResetChapter(null, 'toàn bộ ngân hàng câu hỏi')}
            >
              {resettingChapter === 'all' ? 'Đang đặt lại...' : 'Làm lại toàn bộ'}
            </button>
          )}
        </div>

        <div className="clay-pb-progress-track" aria-label={`Đã hoàn thành ${completion}%`}>
          <span className="clay-pb-progress-fill" style={{ width: `${completion}%` }} />
        </div>

        <div className="clay-pb-hub-stats">
          <div className="clay-pb-hub-stat">
            <span className="clay-pb-hub-stat-value">{answered}/{total}</span>
            <span className="clay-pb-hub-stat-label">Đã ôn ({completion}%)</span>
          </div>
          <div className="clay-pb-hub-stat">
            <span className="clay-pb-hub-stat-value">{accuracy}%</span>
            <span className="clay-pb-hub-stat-label">Độ chính xác</span>
          </div>
          <div className="clay-pb-hub-stat">
            <span className="clay-pb-hub-stat-value">{wrong}</span>
            <span className="clay-pb-hub-stat-label">Câu làm sai</span>
          </div>
          <div className="clay-pb-hub-stat">
            <span className="clay-pb-hub-stat-value">{bookmarked}</span>
            <span className="clay-pb-hub-stat-label">Câu đã đánh dấu</span>
          </div>
        </div>
      </section>

      {/* 4 Chế độ ôn nhanh */}
      <section className="clay-pb-modes-grid" aria-label="Chế độ ôn tập nhanh">
        <article className="clay-pb-mode-card">
          <div>
            <div className="clay-pb-mode-icon" aria-hidden="true">🎯</div>
            <h2 className="clay-pb-mode-title" style={{ marginTop: 10 }}>Ôn toàn bộ {total} câu</h2>
            <p className="clay-pb-mode-desc">Làm tuần tự hoặc trộn ngẫu nhiên qua tất cả các chương.</p>
          </div>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-primary clay-pb-btn-sm"
            onClick={() => onStartPractice({ chapter: 'all', filter: 'all', title: `Toàn bộ ${total} câu` })}
          >
            Bắt đầu ôn →
          </button>
        </article>

        <article className="clay-pb-mode-card">
          <div>
            <div className="clay-pb-mode-icon" aria-hidden="true">🔥</div>
            <h2 className="clay-pb-mode-title" style={{ marginTop: 10 }}>Ôn câu làm sai</h2>
            <p className="clay-pb-mode-desc">
              {wrong > 0
                ? `Tập trung xử lý ${wrong} câu bạn từng chọn nhầm để nắm chắc kiến thức.`
                : 'Tuyệt vời! Hiện chưa có câu nào bị làm sai.'}
            </p>
          </div>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-coral clay-pb-btn-sm"
            disabled={wrong === 0}
            onClick={() => onStartPractice({ chapter: 'all', filter: 'wrong', title: 'Ôn lại câu làm sai' })}
          >
            Ôn {wrong} câu sai
          </button>
        </article>

        <article className="clay-pb-mode-card">
          <div>
            <div className="clay-pb-mode-icon" aria-hidden="true">⭐</div>
            <h2 className="clay-pb-mode-title" style={{ marginTop: 10 }}>Câu đã đánh dấu</h2>
            <p className="clay-pb-mode-desc">
              {bookmarked > 0
                ? `Xem lại nhanh ${bookmarked} câu hỏi quan trọng bạn đã gắn sao.`
                : 'Bấm gắn sao ở bất kỳ câu hỏi nào để lưu vào đây.'}
            </p>
          </div>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm"
            disabled={bookmarked === 0}
            onClick={() => onStartPractice({ chapter: 'all', filter: 'bookmarked', title: 'Câu đã đánh dấu' })}
          >
            Mở {bookmarked} câu sao
          </button>
        </article>

        <article
          className="clay-pb-mode-card"
          style={initialExamMode ? { outline: '2px solid var(--pb-accent)' } : undefined}
        >
          <div>
            <div className="clay-pb-mode-icon" aria-hidden="true">⏱️</div>
            <h2 className="clay-pb-mode-title" style={{ marginTop: 10 }}>Thi thử tổng hợp</h2>
            <p className="clay-pb-mode-desc">
              Chuẩn thi giữa kì 50 câu · 25 phút, chọn ngẫu nhiên đều khắp {chapters.length || 6} chương &amp; phân tích chương yếu.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="clay-pb-exam-pills" role="group" aria-label="Số câu thi thử">
              {EXAM_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`clay-pb-count-pill ${examCount === count ? 'is-active' : ''}`}
                  onClick={() => setExamCount(count)}
                >
                  {count} câu · {examDurationMinutes(count)}p
                </button>
              ))}
            </div>
            <button
              type="button"
              className="clay-pb-btn clay-pb-btn-mint clay-pb-btn-sm"
              disabled={startingExam}
              onClick={() => onStartExam({ count: examCount })}
            >
              {startingExam ? 'Đang tạo đề...' : `Bắt đầu thi ${examCount} câu · ${examDurationMinutes(examCount)}p →`}
            </button>
          </div>
        </article>
      </section>

      {/* Lưới 6 chương học */}
      <section aria-label="Ôn tập theo từng chương">
        <div className="clay-pb-section-head" style={{ marginBottom: 14 }}>
          <h2 className="clay-pb-section-title">Ôn tập theo chương ({chapters.length} chương)</h2>
        </div>

        <div className="clay-pb-chapters-grid">
          {chapters.map((ch) => (
            <article
              key={ch.chapter_index}
              className="clay-pb-chapter-card"
              data-tone={chapterTone(ch.chapter_index)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="clay-pb-chapter-card-top">
                  <span className="clay-pb-chapter-badge">Chương {ch.chapter_index}</span>
                  <span className="clay-pb-chapter-count-tag">{ch.answered}/{ch.total} câu</span>
                </div>

                <h3 className="clay-pb-chapter-name">{ch.chapter_title}</h3>

                <div className="clay-pb-progress-track" aria-hidden="true">
                  <span
                    className="clay-pb-progress-fill clay-pb-chapter-fill"
                    style={{ width: `${ch.completion_percent}%` }}
                  />
                </div>

                <div className="clay-pb-chapter-meta">
                  <span>✓ {ch.correct} đúng</span>
                  {ch.wrong > 0 && <span>· ✕ {ch.wrong} sai</span>}
                  {ch.bookmarked > 0 && <span>· ★ {ch.bookmarked} sao</span>}
                </div>
              </div>

              <div className="clay-pb-chapter-actions">
                <button
                  type="button"
                  className="clay-pb-btn clay-pb-btn-primary clay-pb-btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => onStartPractice({
                    chapter: ch.chapter_index,
                    filter: 'all',
                    title: ch.chapter_title
                  })}
                >
                  Ôn chương {ch.chapter_index}
                </button>
                {ch.answered > 0 && (
                  <button
                    type="button"
                    className="clay-pb-btn clay-pb-btn-secondary clay-pb-btn-sm"
                    disabled={resettingChapter !== null}
                    onClick={() => onResetChapter(ch.chapter_index, ch.chapter_title)}
                    title="Làm lại chương này"
                  >
                    {resettingChapter === ch.chapter_index ? '...' : 'Làm lại'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Lịch sử thi thử */}
      {recentExams.length > 0 && (
        <section className="clay-pb-recent-exams" aria-label="Lịch sử thi thử gần đây">
          <h2 className="clay-pb-section-title">Lịch sử thi thử gần đây</h2>
          <div className="clay-pb-exam-history-list">
            {recentExams.map((attempt) => (
              <div key={attempt.id} className="clay-pb-exam-chip">
                <span className="clay-pb-exam-score-pill">
                  {attempt.correct_count}/{attempt.total_questions} ({attempt.score_percent}%)
                </span>
                <span>{formatDuration(attempt.duration_seconds)}</span>
                <span style={{ color: 'var(--pb-muted)' }}>
                  {attempt.created_at ? new Date(attempt.created_at).toLocaleDateString('vi-VN') : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
