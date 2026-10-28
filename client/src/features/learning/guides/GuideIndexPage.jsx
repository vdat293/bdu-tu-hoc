import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCourseGuide } from '../../../api/guides.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import GuideLayout, { getLocalGuides } from './GuideLayout.jsx';

export default function GuideIndexPage() {
  const { courseCode } = useParams();
  const { token, user } = useAuth();
  const { notify } = useToasts();
  const navigate = useNavigate();

  const guideQuery = useQuery({
    queryKey: ['course-guide', courseCode, user?.mssv],
    queryFn: ({ signal }) => getCourseGuide(token, courseCode, { signal }),
    enabled: Boolean(token && courseCode)
  });

  const guide = guideQuery.data;
  const enabled = Boolean(guide?.enabled);
  const lessons = getLocalGuides(courseCode);

  useEffect(() => {
    if (guideQuery.isLoading || guideQuery.isError) return;
    if (!guide || !enabled || lessons.length === 0) {
      notify('Môn học chưa có hướng dẫn thực hành.', 'warning');
      navigate(`/learning/${encodeURIComponent(courseCode || '')}`, { replace: true });
    }
  }, [guideQuery.isLoading, guideQuery.isError, guide, enabled, lessons.length, notify, navigate, courseCode]);

  const serverLessons = Array.isArray(guide?.lessons) ? guide.lessons : [];
  const doneByLesson = new Map(serverLessons.map((item) => [item.id, Number(item.doneCount || 0)]));

  if (guideQuery.isLoading || !guide) {
    return (
      <GuideLayout courseCode={courseCode}>
        <p className="guide-page-loading">Đang tải hướng dẫn thực hành...</p>
      </GuideLayout>
    );
  }

  if (guideQuery.isError) {
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

  if (!enabled || lessons.length === 0) return null;

  return (
    <GuideLayout courseCode={courseCode}>
      <section className="guide-index glass-panel" aria-label="Danh sách bài hướng dẫn">
        <h1 className="guide-index-title">Hướng dẫn thực hành</h1>
        <p className="guide-index-sub">Làm theo từng chặng, xác nhận khi xong để lưu tiến độ theo tài khoản của bạn.</p>
        <ul className="guide-index-list">
          {lessons.map((lesson) => {
            const firstStep = lesson.steps?.[0]?.id;
            const done = doneByLesson.get(lesson.id) || 0;
            const total = lesson.steps?.length || 0;
            return (
              <li key={lesson.id} className="guide-index-item">
                <div className="guide-index-item-text">
                  <h2 className="guide-index-item-title">{lesson.title}</h2>
                  {lesson.summary && <p className="guide-index-item-summary">{lesson.summary}</p>}
                  <p className="guide-index-item-meta">
                    {[lesson.duration && `${lesson.duration}`, total ? `Đã xong ${done}/${total}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {firstStep && (
                  <Link
                    className="btn btn-primary btn-sm"
                    to={`/learning/${encodeURIComponent(courseCode)}/guides/${encodeURIComponent(lesson.id)}/${encodeURIComponent(firstStep)}`}
                  >
                    {done > 0 ? 'Học tiếp' : 'Bắt đầu'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </GuideLayout>
  );
}
