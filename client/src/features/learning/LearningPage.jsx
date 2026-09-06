import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getLearningResources } from '../../api/community.js';
import { useAuth } from '../../app/providers.jsx';

function getLearningCourseSemesters(course) {
  if (Array.isArray(course.semesters) && course.semesters.length) {
    return course.semesters.map((semester) => ({
      code: String(semester.code || semester.name || 'other'),
      name: String(semester.name || semester.code || 'Học kỳ khác'),
      hasFinalGrade: Boolean(semester.has_final_grade)
    }));
  }

  const codes = Array.isArray(course.semester_codes) ? course.semester_codes : [];
  const names = Array.isArray(course.semester_names) ? course.semester_names : [];
  const count = Math.max(codes.length, names.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    code: String(codes[index] || names[index] || 'other'),
    name: String(names[index] || codes[index] || 'Học kỳ khác'),
    hasFinalGrade: Boolean(course.has_final_grade && !course.is_studying)
  }));
}

export default function LearningPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const status = params.get('status') || 'all';

  const query = useQuery({
    queryKey: ['learning-resources', auth.user?.mssv],
    queryFn: ({ signal }) => getLearningResources(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const rawCourses = useMemo(() => {
    return Array.isArray(query.data?.courses)
      ? query.data.courses
      : Array.isArray(query.data)
      ? query.data
      : [];
  }, [query.data]);

  const filteredCourses = useMemo(() => {
    const needle = search.toLocaleLowerCase('vi-VN').trim();
    return rawCourses.filter((course) => {
      const matchesText =
        !needle ||
        `${course.code} ${course.display_code || ''} ${course.name || ''}`
          .toLocaleLowerCase('vi-VN')
          .includes(needle);
      const studying = Boolean(course.is_studying);
      return matchesText && (status === 'all' || status === (studying ? 'studying' : 'graded'));
    });
  }, [rawCourses, search, status]);

  // Group by semester
  const semesterGroups = useMemo(() => {
    const map = new Map();
    filteredCourses.forEach((course) => {
      getLearningCourseSemesters(course).forEach((semester) => {
        const matchesStatus =
          status === 'all' ||
          (status === 'studying' && !semester.hasFinalGrade) ||
          (status === 'graded' && semester.hasFinalGrade);
        if (!matchesStatus) return;

        if (!map.has(semester.code)) {
          map.set(semester.code, { ...semester, courses: [] });
        }
        map.get(semester.code).courses.push({ course, semester });
      });
    });

    return [...map.values()].sort((a, b) =>
      String(b.code || '').localeCompare(String(a.code || ''), 'vi', { numeric: true, sensitivity: 'base' })
    );
  }, [filteredCourses, status]);

  const studyingCount = useMemo(
    () => rawCourses.filter((c) => Boolean(c.is_studying)).length,
    [rawCourses]
  );

  const semesterCount = useMemo(() => {
    const set = new Set(
      rawCourses.flatMap((course) => getLearningCourseSemesters(course).map((s) => s.code))
    );
    return set.size;
  }, [rawCourses]);

  const updateParam = (key, value, defaultValue = '') => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: key === 'q' });
  };

  return (
    <section id="tab-learning" className="tab-pane active">
      {/* Section Header */}
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <h2 className="section-title">Kho Tài Liệu</h2>
        <p className="section-desc">
          Tìm lại môn đã học theo từng học kỳ, xem tài liệu và trao đổi của sinh viên cùng mã môn.
        </p>
      </div>

      <div id="learning-course-directory">
        {/* Learning Toolbar faithful to production */}
        <div className="learning-toolbar glass-panel">
          <div>
            <span className="learning-toolbar-label">HỌC KỲ CỦA TÔI</span>
            <strong id="learning-course-summary" style={{ display: 'block', marginTop: '4px', fontSize: '15px' }}>
              {query.isLoading
                ? 'Đang đồng bộ từ BDU...'
                : `${semesterCount} học kỳ · ${rawCourses.length} môn · ${studyingCount} môn đang học`}
            </strong>
          </div>
          <div className="learning-toolbar-controls">
            <select
              id="learning-status-filter"
              className="custom-select"
              aria-label="Lọc trạng thái môn học"
              value={status}
              onChange={(e) => updateParam('status', e.target.value, 'all')}
            >
              <option value="all">Tất cả môn</option>
              <option value="studying">Đang học / chưa có điểm</option>
              <option value="graded">Đã có điểm</option>
            </select>
            <input
              id="learning-course-search"
              className="search-input"
              type="search"
              placeholder="Tìm tên hoặc mã môn..."
              aria-label="Tìm môn học"
              value={search}
              onChange={(e) => updateParam('q', e.target.value)}
            />
          </div>
        </div>

        {/* Content list */}
        {query.isLoading ? (
          <div className="loading-spinner-box glass-panel" style={{ textAlign: 'center', padding: '40px', marginTop: '20px' }}>
            <div className="spinner"></div>
            <p style={{ marginTop: '12px', color: 'var(--text-muted)' }}>Đang tải danh sách học phần...</p>
          </div>
        ) : semesterGroups.length === 0 ? (
          <div className="learning-empty glass-panel" style={{ textAlign: 'center', padding: '48px 24px', marginTop: '20px' }}>
            <h3>{rawCourses.length ? 'Không tìm thấy môn phù hợp' : 'BDU chưa trả về học phần nào'}</h3>
            <p>
              {rawCourses.length
                ? 'Hãy thử đổi từ khóa hoặc bộ lọc.'
                : 'Hệ thống không tạo dữ liệu mẫu. Danh sách sẽ xuất hiện khi API BDU có mã và tên môn.'}
            </p>
          </div>
        ) : (
          <div id="learning-courses-grid" className="learning-semester-list" style={{ marginTop: '20px' }}>
            {semesterGroups.map((group, groupIndex) => (
              <details
                key={group.code}
                className="learning-semester-group glass-panel"
                open={groupIndex === 0 || Boolean(search)}
                style={{ marginBottom: '16px' }}
              >
                <summary className="learning-semester-heading">
                  <span className="learning-semester-heading-copy">
                    <span className="learning-semester-kicker">HỌC KỲ</span>
                    <strong>{group.name || group.code}</strong>
                  </span>
                  <span className="learning-semester-meta">
                    <span>{group.courses.length} môn</span>
                    <span className="learning-semester-chevron" aria-hidden="true"></span>
                  </span>
                </summary>

                <div className="learning-courses-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', padding: '16px' }}>
                  {group.courses
                    .sort((a, b) => String(a.course.name || '').localeCompare(String(b.course.name || ''), 'vi'))
                    .map(({ course, semester }) => {
                      const hasFinalGrade = semester.hasFinalGrade;
                      const statusText = hasFinalGrade ? 'Đã có điểm' : 'Đang học';
                      const resourceCount = Number(course.resource_count || 0);
                      const postCount = Number(
                        course.post_count ?? resourceCount + Number(course.request_count || 0)
                      );
                      const courseTarget = `/learning/${encodeURIComponent(course.code)}`;

                      return (
                        <article className="learning-course-card" key={course.code}>
                          <button
                            className="learning-course-main"
                            type="button"
                            onClick={() => navigate(courseTarget)}
                            aria-label={`Xem môn ${course.name}`}
                          >
                            <span className="learning-course-card-top">
                              <span className="learning-course-code">
                                {course.display_code || course.code}
                              </span>
                              <span
                                className={`learning-status ${hasFinalGrade ? 'is-graded' : 'is-studying'}`}
                              >
                                {statusText}
                              </span>
                            </span>
                            <span className="learning-course-name">{course.name}</span>
                          </button>

                          <div className="learning-course-stats" aria-label="Thống kê nội dung">
                            <span>
                              <strong>{resourceCount}</strong> tài liệu
                            </span>
                            <span>
                              <strong>{postCount}</strong> bài viết
                            </span>
                          </div>

                          <div className="learning-course-card-actions">
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={() => navigate(courseTarget)}
                            >
                              Luận bàn
                            </button>
                            <button
                              className="learning-open-action"
                              type="button"
                              onClick={() => navigate(courseTarget)}
                            >
                              Xem môn học <span aria-hidden="true">→</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
