import { useState } from 'react';
import { chapterTone, formatDuration } from './practice-bank.utils.js';

export default function PracticeExamSummary({
  result,
  onReviewWrong,
  onRetakeExam,
  onBackToHub
}) {
  const [onlyWrong, setOnlyWrong] = useState(false);

  const {
    total_questions: total = 0,
    correct_count: correct = 0,
    wrong_count: wrong = 0,
    skipped_count: skipped = 0,
    score_percent: scorePercent = 0,
    duration_seconds: duration = 0,
    chapter_breakdown: breakdown = [],
    results = []
  } = result || {};

  const score10 = total > 0 ? ((correct / total) * 10).toFixed(1) : '0.0';
  const filteredResults = onlyWrong ? results.filter((item) => !item.is_correct) : results;

  return (
    <>
      <section className="clay-pb-summary-hero" aria-label="Kết quả bài thi thử">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div className="clay-pb-score-orb">
            <strong>{score10}</strong>
            <span>{correct}/{total} câu</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="clay-pb-eyebrow">🏁 Hoàn thành bài thi thử</span>
            <h1 className="clay-pb-hub-title" style={{ margin: 0 }}>
              Đạt {scorePercent}% ({correct} đúng · {wrong} sai{skipped > 0 ? ` · ${skipped} bỏ trống` : ''})
            </h1>
            <p className="clay-pb-hub-sub">
              Thời gian làm bài: {formatDuration(duration)}. Các câu làm sai đã được lưu vào mục Ôn câu làm sai.
            </p>
          </div>
        </div>

        <div className="clay-pb-entry-actions">
          {wrong > 0 && (
            <button
              type="button"
              className="clay-pb-btn clay-pb-btn-coral"
              onClick={onReviewWrong}
            >
              Ôn ngay câu làm sai →
            </button>
          )}
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-primary"
            onClick={onRetakeExam}
          >
            Thi thử đề mới
          </button>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-secondary"
            onClick={onBackToHub}
          >
            Về tổng quan
          </button>
        </div>
      </section>

      {breakdown.length > 0 && (
        <section aria-label="Phân tích theo chương">
          <h2 className="clay-pb-section-title" style={{ marginBottom: 12 }}>
            Phân tích theo từng chương
          </h2>
          <div className="clay-pb-breakdown-grid">
            {breakdown.map((ch) => (
              <div
                key={ch.chapter_index}
                className="clay-pb-breakdown-card"
                data-tone={chapterTone(ch.chapter_index)}
              >
                <div className="clay-pb-chapter-card-top">
                  <span className="clay-pb-chapter-badge">Chương {ch.chapter_index}</span>
                  <span className="clay-pb-chapter-count-tag">
                    {ch.correct}/{ch.total} ({ch.accuracy_percent}%)
                  </span>
                </div>
                <strong style={{ fontSize: '0.9rem', lineHeight: 1.35 }}>{ch.chapter_title}</strong>
                <div className="clay-pb-progress-track" aria-hidden="true">
                  <span
                    className="clay-pb-progress-fill clay-pb-chapter-fill"
                    style={{ width: `${ch.accuracy_percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Chi tiết đáp án bài thi">
        <div className="clay-pb-section-head" style={{ marginBottom: 12 }}>
          <h2 className="clay-pb-section-title">Xem lại lời giải ({filteredResults.length} câu)</h2>
          <div className="clay-pb-filter-tabs">
            <button
              type="button"
              className={`clay-pb-filter-tab ${!onlyWrong ? 'is-active' : ''}`}
              onClick={() => setOnlyWrong(false)}
            >
              Tất cả ({results.length})
            </button>
            <button
              type="button"
              className={`clay-pb-filter-tab ${onlyWrong ? 'is-active' : ''}`}
              onClick={() => setOnlyWrong(true)}
            >
              Câu sai / bỏ trống ({wrong + skipped})
            </button>
          </div>
        </div>

        <div className="clay-pb-review-list">
          {filteredResults.map((item, idx) => (
            <article key={item.question_id} className="clay-pb-review-item" data-tone={chapterTone(item.chapter_index)}>
              <div className="clay-pb-question-head">
                <div className="clay-pb-question-meta">
                  <span className="clay-pb-chapter-badge">Chương {item.chapter_index}</span>
                  <span className="clay-pb-qnum-pill">Câu #{item.external_id}</span>
                </div>
                <span className="clay-pb-pill-badge">
                  {item.is_correct ? '✅ Đúng' : item.selected_answer ? '❌ Sai' : '⚪ Bỏ trống'}
                </span>
              </div>

              <p className="clay-pb-question-text" style={{ fontSize: '1rem' }}>
                {idx + 1}. {item.question_text}
              </p>

              <div className="clay-pb-chapter-meta">
                <span>
                  Bạn chọn: <strong>{item.selected_answer || 'Chưa chọn'}</strong>
                  {item.selected_answer && item.options?.[item.selected_answer] ? ` (${item.options[item.selected_answer]})` : ''}
                </span>
              </div>
              <div className="clay-pb-chapter-meta" style={{ color: 'var(--pb-mint)' }}>
                <span>
                  Đáp án đúng: <strong>{item.correct_answer}</strong>
                  {item.options?.[item.correct_answer] ? ` — ${item.options[item.correct_answer]}` : ''}
                </span>
              </div>

              {item.explanation && (
                <div className={`clay-pb-explanation ${item.is_correct ? 'is-correct' : 'is-wrong'}`}>
                  <p className="clay-pb-explanation-body">{item.explanation}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
