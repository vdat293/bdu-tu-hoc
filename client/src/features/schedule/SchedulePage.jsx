import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getSchedule } from '../../api/academics.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';

function normalize(data) {
  return data?.data || data || { semesters: [], items: [], week: null, nextOccurrence: null, upcomingOccurrence: null };
}

export default function SchedulePage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get('semester') || '';

  const schedule = useQuery({
    queryKey: ['schedule', auth.user?.mssv, selected || 'default'],
    queryFn: ({ signal }) => getSchedule(auth.token, selected || null, { signal }),
    enabled: Boolean(auth.token)
  });

  const data = normalize(schedule.data);
  const semesters = Array.isArray(data.semesters) ? data.semesters : [];

  // The API returns pre-filtered, dated occurrences. Rendering only this
  // contract prevents the browser from accidentally rebuilding an all-term
  // schedule from raw BDU weekday records.
  const items = useMemo(() => (Array.isArray(data.items) ? data.items : []), [data.items]);

  useEffect(() => {
    if (!selected && data.selectedHocKy && semesters.length) {
      const next = new URLSearchParams(params);
      next.set('semester', String(data.selectedHocKy));
      setParams(next, { replace: true });
    }
  }, [data.selectedHocKy, semesters.length, params, selected, setParams]);

  const onSemesterChange = (e) => {
    const val = e.target.value;
    const next = new URLSearchParams(params);
    if (val) next.set('semester', val);
    else next.delete('semester');
    setParams(next, { replace: false });
  };

  const selectedSemesterObj = semesters.find((s) => String(s.hoc_ky || s.ma_hoc_ky || s.id) === String(selected || data.selectedHocKy));
  const semesterTitle = selectedSemesterObj?.ten_hoc_ky || selectedSemesterObj?.ten || (selected ? `Học kỳ ${selected}` : '');
  const week = data.week;
  const weekRange = week ? `${week.startLabel}–${week.endLabel}` : '';
  const weekContext = week
    ? `${data.isCurrentWeek ? 'Tuần hiện tại' : 'Tuần học kế tiếp'}: ${week.label} (${weekRange})`
    : '';
  // "Đang học" and "Môn tiếp theo" are different states. If a class is in
  // progress, the next card must still tell the student what to prepare for.
  const upcomingOccurrenceKey = data.upcomingOccurrence?.occurrenceKey || data.nextOccurrence?.occurrenceKey || '';

  let statusText = 'Chưa có dữ liệu';
  if (schedule.isLoading) statusText = 'Đang tải…';
  else if (data.isSessionExpired) statusText = 'Phiên BDU đã hết hạn';
  else if (data.scheduleStatus === 'date_range_unavailable') statusText = 'BDU · Chưa xác định tuần học';
  else if (data.scheduleStatus === 'no_upcoming') statusText = 'Không còn buổi học sắp tới';
  else if (data.scheduleStatus === 'ongoing') statusText = 'Cổng BDU · Đang học';
  else if (data.isCurrentWeek) statusText = 'Cổng BDU · Buổi học sắp tới';
  else if (week) statusText = 'Cổng BDU · Tuần kế tiếp';

  return (
    <section id="tab-schedule" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Thời Khóa Biểu Học Tập</h2>
            <p id="schedule-subtitle" className="section-desc">
              {weekContext || (semesterTitle ? `Lịch học: ${semesterTitle} (Đồng bộ từ Cổng BDU)` : 'Đồng bộ tự động từ Cổng Quản Lý Đào Tạo Đại Học Bình Dương')}
            </p>
          </div>
          <div className="schedule-controls-row">
            <div className="schedule-select-wrapper">
              <select
                id="schedule-semester-select"
                className="form-select schedule-dropdown"
                title="Chọn học kỳ tra cứu thời khóa biểu"
                value={selected || data.selectedHocKy || ''}
                onChange={onSemesterChange}
              >
                {semesters.length > 0 ? (
                  semesters.map((s) => {
                    const val = s.hoc_ky || s.ma_hoc_ky || s.id;
                    const text = s.ten_hoc_ky || s.ten || `Học kỳ ${val}`;
                    return <option key={val} value={val}>{text}</option>;
                  })
                ) : (
                  <option value="">-- Chưa có dữ liệu học kỳ --</option>
                )}
              </select>
            </div>
            <div id="schedule-badge-status" className="schedule-badge">
              <span className="pulse-dot"></span>
              <span id="schedule-status-text">
                {statusText}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div id="schedule-grid" className="schedule-grid">
        {schedule.isLoading ? (
          [1, 2, 3].map((card) => (
            <div className="schedule-card glass-panel schedule-skeleton-card" key={card} aria-hidden="true">
              <div className="skeleton-copy">
                <SkeletonBlock className="skeleton-line eyebrow" />
                <SkeletonBlock className="skeleton-line heading" />
                <SkeletonBlock className="skeleton-line wide" />
                <SkeletonBlock className="skeleton-line medium" />
              </div>
              <SkeletonBlock className="skeleton-line short" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="glass-panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
            <div className="empty-monogram">TKB</div>
            <h4 style={{ color: 'var(--text-main)', fontSize: '16px', marginBottom: '6px' }}>
              {data.scheduleStatus === 'date_range_unavailable'
                ? 'Chưa xác định được tuần học hiện tại'
                : data.scheduleStatus === 'no_upcoming'
                  ? 'Không còn buổi học sắp tới'
                  : 'Không có lịch học trong học kỳ này'}
            </h4>
            <p style={{ fontSize: '13px' }}>
              {data.scheduleStatus === 'date_range_unavailable'
                ? 'Cổng BDU chưa trả về khoảng ngày của tuần học nên hệ thống không hiển thị lịch có thể đã cũ.'
                : data.scheduleStatus === 'no_upcoming'
                  ? 'Hệ thống đã kiểm tra tuần hiện tại và các tuần kế tiếp trong học kỳ đã chọn.'
                  : 'Sinh viên chưa đăng ký học phần hoặc chưa có lịch xếp phòng từ phòng đào tạo.'}
            </p>
          </div>
        ) : (
          items.map((item) => {
            const occurrenceKey = item.occurrenceKey || `${item.courseCode}-${item.startAt}-${item.room}`;
            const isNext = occurrenceKey === upcomingOccurrenceKey;
            const isOngoing = item.status === 'ongoing';
            const showLecturer = item.lecturer && item.lecturer !== 'Bộ môn BDU';

            return (
              <div key={occurrenceKey} className={`schedule-card glass-panel${isNext ? ' schedule-card--next' : ''}${isOngoing ? ' schedule-card--ongoing' : ''}`}>
                <div>
                  <div className="schedule-card__eyebrow">
                    <div className="sch-day-badge">
                      <span className="sch-day">{item.day}</span>
                      {item.displayDate && <span className="sch-date">{item.displayDate}</span>}
                    </div>
                    <span className={`sch-status-chip${isOngoing ? ' is-ongoing' : ''}`}>
                      {isOngoing ? 'Đang học' : isNext ? 'Môn tiếp theo' : 'Sắp tới'}
                    </span>
                  </div>
                  <h4 className="sch-name" title={item.courseName}>{item.courseName}</h4>
                  <div className="sch-meta">
                    <div className="sch-meta-item">
                      <strong>{item.periods}</strong>
                    </div>
                    <div className="sch-meta-item">
                      <span className="sch-room-pill">{item.room}</span>
                    </div>
                    {showLecturer && (
                      <div className="sch-meta-item">
                        <span>{item.lecturer}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="sch-footer">
                  <span className="sch-code">Mã: <code>{item.courseCode}</code></span>
                  <span className="badge-mini badge-pill-blue">{item.credits} Tín Chỉ</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
