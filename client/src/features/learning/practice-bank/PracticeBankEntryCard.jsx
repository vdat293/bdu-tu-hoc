import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getPracticeBankSummary } from '../../../api/practice-bank.js';
import { useAuth } from '../../../app/providers.jsx';
import { chapterTone, shortChapterTitle } from './practice-bank.utils.js';
import './practice-bank.css';

export default function PracticeBankEntryCard({ courseCode }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const summaryQuery = useQuery({
    queryKey: ['practice-bank-summary', courseCode, auth.user?.mssv],
    queryFn: ({ signal }) => getPracticeBankSummary(auth.token, courseCode, { signal }),
    enabled: Boolean(auth.token && courseCode),
    retry: false
  });

  const data = summaryQuery.data;
  if (!data?.enabled || !data?.bank) {
    return null;
  }

  const { bank, stats = {}, chapters = [] } = data;
  const total = Number(stats.total_questions ?? bank.question_count ?? 0);
  const answered = Number(stats.answered_count || 0);
  const accuracy = Number(stats.accuracy_percent || 0);
  const wrong = Number(stats.wrong_count || 0);
  const bookmarked = Number(stats.bookmarked_count || 0);
  const completion = Number(stats.completion_percent || 0);
  const basePath = `/learning/${encodeURIComponent(courseCode || '')}/practice`;

  return (
    <section className="clay-pb-scope clay-pb-entry" aria-label="Phòng ôn tập trắc nghiệm">
      <div className="clay-pb-entry-top">
        <div className="clay-pb-entry-copy">
          <span className="clay-pb-eyebrow">
            ✨ Phòng Ôn Tập Riêng · {total} câu · {chapters.length} chương
          </span>
          <h2 className="clay-pb-entry-title">{bank.title}</h2>
          <p className="clay-pb-entry-desc">
            {bank.description || 'Hệ thống ôn tập trắc nghiệm tách biệt hoàn toàn: luyện từng chương kèm giải thích chi tiết, ôn lại câu làm sai và thi thử tổng hợp.'}
          </p>
        </div>

        <div className="clay-pb-entry-actions">
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-primary"
            onClick={() => navigate(basePath)}
          >
            Vào phòng ôn tập →
          </button>
          <button
            type="button"
            className="clay-pb-btn clay-pb-btn-secondary"
            onClick={() => navigate(`${basePath}?mode=exam`)}
          >
            Thi thử nhanh
          </button>
        </div>
      </div>

      <div className="clay-pb-entry-metrics">
        <div className="clay-pb-meter-box">
          <div className="clay-pb-meter-head">
            <span>Tiến độ ôn tập</span>
            <span>{answered}/{total} câu ({completion}%)</span>
          </div>
          <div className="clay-pb-progress-track" aria-hidden="true">
            <span className="clay-pb-progress-fill" style={{ width: `${completion}%` }} />
          </div>
        </div>

        <div className="clay-pb-stat-bubble">
          <strong>{accuracy}%</strong>
          <span>Tỉ lệ đúng</span>
        </div>

        <div className="clay-pb-stat-bubble">
          <strong>{wrong}</strong>
          <span>Câu làm sai</span>
        </div>

        <div className="clay-pb-stat-bubble">
          <strong>{bookmarked}</strong>
          <span>Đã đánh dấu</span>
        </div>
      </div>

      {chapters.length > 0 && (
        <div className="clay-pb-entry-chapters" aria-label="Truy cập nhanh theo chương">
          {chapters.map((ch) => (
            <button
              key={ch.chapter_index}
              type="button"
              className="clay-pb-chapter-pill"
              data-tone={chapterTone(ch.chapter_index)}
              onClick={() => navigate(`${basePath}?chapter=${ch.chapter_index}`)}
              title={ch.chapter_title}
            >
              <span className="clay-pb-chapter-dot">{ch.chapter_index}</span>
              <span>{shortChapterTitle(ch.chapter_title)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
