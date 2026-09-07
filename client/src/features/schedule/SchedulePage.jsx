import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getSchedule } from '../../api/academics.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';

function normalize(data) {
  return data?.data || data || { semesters: [], items: [] };
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

  const items = useMemo(() => {
    if (Array.isArray(data.items)) return data.items;
    if (data.schedule) {
      const sch = data.schedule;
      if (Array.isArray(sch)) return sch;
      if (Array.isArray(sch.ds_thoi_khoa_bieu)) return sch.ds_thoi_khoa_bieu;
      if (Array.isArray(sch.ds_tuan_tkb)) return sch.ds_tuan_tkb;
      if (Array.isArray(sch.ds_lop_hoc_phan)) return sch.ds_lop_hoc_phan;
      if (Array.isArray(sch.data)) return sch.data;
    }
    return [];
  }, [data]);

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

  return (
    <section id="tab-schedule" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Thời Khóa Biểu Học Tập</h2>
            <p id="schedule-subtitle" className="section-desc">
              {semesterTitle ? `Lịch học: ${semesterTitle} (Đồng bộ từ Cổng BDU)` : 'Đồng bộ tự động từ Cổng Quản Lý Đào Tạo Đại Học Bình Dương'}
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
                {schedule.isLoading ? 'Đang tải…' : data.isRealData !== false ? 'Cổng BDU · Thời gian thực' : 'Chưa có dữ liệu'}
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
              Không có lịch học trong học kỳ này
            </h4>
            <p style={{ fontSize: '13px' }}>
              Sinh viên chưa đăng ký học phần hoặc chưa có lịch xếp phòng từ phòng đào tạo.
            </p>
          </div>
        ) : (
          items.map((rawItem, idx) => {
            const day = rawItem.thu || (rawItem.thu_kieu_so ? `Thứ ${rawItem.thu_kieu_so}` : rawItem.day || `Buổi ${idx + 1}`);
            const courseName = rawItem.ten_mon_hoc || rawItem.ten_mon || rawItem.ten_hp || rawItem.courseName || 'Môn học BDU';
            const courseCode = rawItem.ma_mon_hoc || rawItem.ma_mon || rawItem.ma_hp || rawItem.courseCode || '--';
            const credits = rawItem.so_tin_chi || rawItem.credits || '3';

            let periods = rawItem.periods || '';
            if (!periods) {
              const startPeriod = rawItem.tiet_bat_dau || rawItem.tiet_bd;
              const periodCount = rawItem.so_tiet;
              if (startPeriod && periodCount) {
                const endPeriod = parseInt(startPeriod, 10) + parseInt(periodCount, 10) - 1;
                periods = `Tiết ${startPeriod} - ${endPeriod} (${periodCount} tiết)`;
              } else if (rawItem.tiet_hoc) {
                periods = `Tiết: ${rawItem.tiet_hoc}`;
              } else {
                periods = 'Lịch học tiêu chuẩn';
              }
            }

            const room = rawItem.phong_hoc || rawItem.ten_phong || rawItem.ten_phong_hoc || rawItem.room || 'Phòng học BDU';
            const lecturer = rawItem.ten_giang_vien || rawItem.giang_vien || rawItem.cb_giang_day || rawItem.lecturer || 'Giảng viên khoa';
            const note = rawItem.ghi_chu || rawItem.lop_hoc_phan || '';

            return (
              <div key={`${courseCode}-${idx}`} className="schedule-card glass-panel">
                <div>
                  <div className="sch-day-badge">
                    <span className="sch-day">{day}</span>
                  </div>
                  <h4 className="sch-name" title={courseName}>{courseName}</h4>
                  <div className="sch-meta">
                    <div className="sch-meta-item">
                      <strong>{periods}</strong>
                    </div>
                    <div className="sch-meta-item">
                      <span className="sch-room-pill">{room}</span>
                    </div>
                    <div className="sch-meta-item">
                      <span>{lecturer}</span>
                    </div>
                    {note && (
                      <div className="sch-meta-item sch-note">
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{note}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="sch-footer">
                  <span className="sch-code">Mã: <code>{courseCode}</code></span>
                  <span className="badge-mini badge-pill-blue">{credits} Tín Chỉ</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
