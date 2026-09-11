import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getGrades, getMyAcademicRanking } from '../../api/academics.js';
import { useAuth } from '../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import GpaTrendChart from './GpaTrendChart.jsx';
import GradeDistChart from './GradeDistChart.jsx';
import {
  buildGradesCsv,
  formatScore,
  getCourseResult,
  getSemesters,
  latestSummary
} from './grades.js';

function downloadCsv(content, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getGradeLetterClass(letter) {
  if (!letter) return '';
  const l = String(letter).trim().toUpperCase();
  if (l.startsWith('A')) return 'grade-a';
  if (l.startsWith('B')) return 'grade-b';
  if (l.startsWith('C')) return 'grade-c';
  if (l.startsWith('D')) return 'grade-d';
  if (l.startsWith('F')) return 'grade-f';
  return '';
}

function getInitials(name) {
  const parts = String(name || 'SV').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function validHighlightedRank(rank) {
  const position = Number(rank?.hang);
  const total = Number(rank?.tong_sinh_vien);
  if (!Number.isInteger(position) || position < 1 || !Number.isInteger(total) || total < 1) return null;
  return { ...rank, hang: position, tong_sinh_vien: total };
}

function formatRankCaption(rank) {
  const validRank = validHighlightedRank(rank);
  return validRank ? `#${validRank.hang} ${validRank.pham_vi}` : 'Chưa có hạng';
}

function formatRankTitle(rank) {
  const validRank = validHighlightedRank(rank);
  return validRank ? `Hạng ${validRank.hang}/${validRank.tong_sinh_vien} sinh viên ${validRank.pham_vi}` : undefined;
}

function GpaPageSkeleton() {
  return (
    <section id="tab-grades" className="tab-pane active" role="status" aria-label="Đang tải bảng điểm">
      <div className="hero-section glass-panel">
        <div className="hero-profile">
          <SkeletonBlock className="skeleton-avatar" />
          <div className="skeleton-copy skeleton-hero-copy">
            <SkeletonBlock className="skeleton-line eyebrow" />
            <SkeletonBlock className="skeleton-line title" />
            <SkeletonBlock className="skeleton-line wide" />
          </div>
        </div>
        <div className="stats-grid">
          {[1, 2, 3, 4].map((stat) => (
            <div className="stat-card" key={stat}>
              <SkeletonBlock className="skeleton-stat-icon" />
              <div className="skeleton-copy">
                <SkeletonBlock className="skeleton-line" />
                <SkeletonBlock className="skeleton-line value" />
                <SkeletonBlock className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="analytics-grid">
        {[1, 2].map((chart) => (
          <div className="chart-card glass-panel" key={chart}>
            <div className="skeleton-copy">
              <SkeletonBlock className="skeleton-line heading" />
              <SkeletonBlock className="skeleton-line wide" />
              <SkeletonBlock className="skeleton-chart" />
            </div>
          </div>
        ))}
      </div>
      <div className="gradebook-section glass-panel">
        <div className="skeleton-toolbar">
          <SkeletonBlock className="skeleton-control" />
          <SkeletonBlock className="skeleton-control" />
          <SkeletonBlock className="skeleton-control search" />
        </div>
        <div className="skeleton-table">
          {[1, 2, 3, 4].map((row) => <SkeletonBlock className="skeleton-table-row" key={row} />)}
        </div>
      </div>
    </section>
  );
}

function extractComponentDetailList(course) {
  const rawComponents = Array.isArray(course?.ds_diem_thanh_phan) ? course.ds_diem_thanh_phan : [];
  if (rawComponents.length > 0) {
    return rawComponents.map((comp, idx) => {
      const name = comp.ten_thanh_phan || comp.ten_tp || comp.loai_diem || comp.ten_thanh_phan_danh_gia || `Thành phần ${idx + 1}`;
      const weight = comp.trong_so || comp.ty_le || comp.phan_tram || comp.weight || '--';
      const score = comp.diem ?? comp.diem_thanh_phan ?? comp.diem_so ?? comp.diem_tp ?? '--';
      const note = comp.ghi_chu || comp.note || '';
      return { name, weight: String(weight).endsWith('%') ? weight : `${weight}%`, score, note };
    });
  }

  const list = [];
  if (course?.diem_chuyen_can !== undefined && course?.diem_chuyen_can !== null && course?.diem_chuyen_can !== '') {
    list.push({ name: 'Chuyên cần', weight: '10%', score: course.diem_chuyen_can, note: 'Điểm danh' });
  }
  if (course?.diem_giua_ky !== undefined && course?.diem_giua_ky !== null && course?.diem_giua_ky !== '') {
    list.push({ name: 'Điểm giữa kỳ', weight: '30%', score: course.diem_giua_ky, note: 'Kiểm tra giữa kỳ' });
  }
  if (course?.diem_thi !== undefined && course?.diem_thi !== null && course?.diem_thi !== '') {
    list.push({ name: 'Điểm thi kết thúc', weight: '60%', score: course.diem_thi, note: 'Thi cuối kỳ' });
  }
  return list;
}

export default function GpaPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const semester = params.get('semester') || 'ALL';
  const status = params.get('status') || 'ALL';
  const queryText = params.get('q') || '';
  const [selectedCourse, setSelectedCourse] = useState(null);
  const detailDialogRef = useRef(null);
  const detailCloseRef = useRef(null);
  const detailOpenerRef = useRef(null);

  const grades = useQuery({
    queryKey: ['grades', auth.user?.mssv],
    queryFn: ({ signal }) => getGrades(auth.token, { signal }),
    enabled: Boolean(auth.token),
    retry: 1
  });

  const academicRanking = useQuery({
    queryKey: ['academic-ranking', auth.user?.mssv],
    queryFn: ({ signal }) => getMyAcademicRanking(auth.token, { signal }),
    enabled: Boolean(auth.token),
    staleTime: 5 * 60 * 1000,
    retry: false
  });

  const semesters = useMemo(() => getSemesters(grades.data), [grades.data]);
  const summary = useMemo(() => latestSummary(semesters), [semesters]);

  const setParam = (name, value, defaultValue = '') => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };

  const displayName = auth.user?.name || 'Sinh viên BDU';
  const userMssv = auth.user?.mssv || '--';
  const userEmail = auth.user?.email || `${userMssv}@student.bdu.edu.vn`;
  const rankingData = academicRanking.data;
  const gpaRank = validHighlightedRank(rankingData?.xep_hang_noi_bat?.gpa_tich_luy);
  const creditRank = validHighlightedRank(rankingData?.xep_hang_noi_bat?.tin_chi_tich_luy);
  const overallRank = validHighlightedRank(rankingData?.xep_hang_noi_bat?.tong_hop);

  // Filter semesters and courses
  const filteredSemesters = useMemo(() => {
    return semesters
      .filter((sem) => {
        const semId = String(sem.hoc_ky || sem.ten_hoc_ky);
        return semester === 'ALL' || semester === semId;
      })
      .map((sem) => {
        let courses = sem.ds_diem_mon_hoc || [];

        if (status === 'PASS') {
          courses = courses.filter((c) => getCourseResult(c).status === 'passed');
        } else if (status === 'FAIL') {
          courses = courses.filter((c) => getCourseResult(c).status === 'failed');
        }

        if (queryText) {
          const q = queryText.toLowerCase().trim();
          courses = courses.filter((c) => {
            const name = (c.ten_mon || '').toLowerCase();
            const code = (c.ma_mon || '').toLowerCase();
            return name.includes(q) || code.includes(q);
          });
        }

        const semCredits = courses.reduce((sum, c) => sum + (Number(c.so_tin_chi) || 0), 0);
        const hasReportedCredits = sem.so_tin_chi_dat_hk !== undefined && sem.so_tin_chi_dat_hk !== null && String(sem.so_tin_chi_dat_hk).trim() !== '';
        const reportedCredits = Number(sem.so_tin_chi_dat_hk);
        return {
          ...sem,
          courses,
          credits: hasReportedCredits && Number.isFinite(reportedCredits) ? reportedCredits : semCredits,
          visibleCredits: semCredits
        };
      })
      .filter((sem) => sem.courses.length > 0 || (semester === 'ALL' && !queryText && status === 'ALL'));
  }, [semesters, semester, status, queryText]);

  const totalVisibleCourses = filteredSemesters.reduce((sum, s) => sum + s.courses.length, 0);
  const totalVisibleCredits = filteredSemesters.reduce((sum, s) => sum + s.visibleCredits, 0);

  const courseComponents = useMemo(() => {
    return selectedCourse ? extractComponentDetailList(selectedCourse) : [];
  }, [selectedCourse]);

  const closeCourseDetails = () => setSelectedCourse(null);

  useViewportDialog(
    Boolean(selectedCourse),
    closeCourseDetails,
    detailDialogRef,
    detailCloseRef,
    detailOpenerRef
  );

  const openCourseDetails = (course, semTitle, opener) => {
    detailOpenerRef.current = opener;
    setSelectedCourse({ ...course, sem_name: semTitle });
  };

  if (grades.isLoading) return <GpaPageSkeleton />;

  return (
    <section id="tab-grades" className="tab-pane active">
      {/* Student Hero Header */}
      <div className="hero-section glass-panel">
        <div className="hero-profile">
          <img
            className="brand-watermark hero-brand-watermark"
            src="/assets/images/logo-bdu-eng.png"
            alt=""
            aria-hidden="true"
          />
          <div id="hero-avatar" className="hero-avatar">
            {getInitials(displayName)}
          </div>
          <div className="hero-info">
            <div className="hero-tags">
              <span id="hero-role" className="tag tag-role">Sinh Viên</span>
              <span id="hero-status" className="tag tag-active">Đang Học</span>
            </div>
            <div className="hero-name-line">
              <h1 id="hero-name" className="hero-name">{displayName}</h1>
              <span
                id="hero-overall-rank-badge"
                className={`hero-overall-rank-badge${overallRank ? '' : ' rank-unavailable'}`}
                title={formatRankTitle(overallRank)}
              >
                {overallRank ? `#${overallRank.hang} · ${overallRank.pham_vi.toLocaleUpperCase('vi-VN')}` : 'Chưa xếp hạng'}
              </span>
            </div>
            <div className="hero-meta">
              <span className="meta-item">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="5" rx="2" />
                  <line x1="2" x2="22" y1="10" y2="10" />
                </svg>
                MSSV: <strong id="hero-mssv">{userMssv}</strong>
              </span>
              <span className="meta-item">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                Email: <span id="hero-email">{userEmail}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon icon-gpa-10">10</div>
            <div className="stat-info">
              <span className="stat-title">GPA Tích Lũy (10)</span>
              <h3 id="stat-gpa-10" className="stat-value text-gradient-amber">{summary.gpa10}</h3>
              <span id="stat-gpa-10-school-rank" className="stat-rank-caption" title={formatRankTitle(gpaRank)}>
                {formatRankCaption(gpaRank)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon icon-gpa-4">4.0</div>
            <div className="stat-info">
              <span className="stat-title">GPA Tích Lũy (4.0)</span>
              <h3 id="stat-gpa-4" className="stat-value text-gradient-emerald">{summary.gpa4}</h3>
              <span id="stat-gpa-school-rank" className="stat-rank-caption" title={formatRankTitle(gpaRank)}>
                {formatRankCaption(gpaRank)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon icon-credits">TC</div>
            <div className="stat-info">
              <span className="stat-title">Tín Chỉ Đạt</span>
              <h3 id="stat-credits" className="stat-value text-gradient-blue">{summary.credits} TC</h3>
              <span id="stat-credit-school-rank" className="stat-rank-caption" title={formatRankTitle(creditRank)}>
                {formatRankCaption(creditRank)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon icon-rank">XL</div>
            <div className="stat-info">
              <span className="stat-title">Xếp Loại</span>
              <h3
                id="stat-rank"
                className={`stat-value${summary.rank === 'Chưa xếp loại' ? ' stat-value-unavailable' : ' text-gradient-purple'}`}
              >
                {summary.rank}
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="analytics-grid">
        <div className="chart-card glass-panel">
          <div className="card-header">
            <div className="card-title-group">
              <h3 className="card-title">Tiến Trình Học Tập (GPA)</h3>
              <p className="card-desc">Biến động điểm trung bình qua từng học kỳ</p>
            </div>
          </div>
          <div className="chart-container">
            {semesters.length > 0 ? (
              <GpaTrendChart semesters={semesters} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Đang tải dữ liệu học kỳ…
              </div>
            )}
          </div>
        </div>

        <div className="chart-card glass-panel">
          <div className="card-header">
            <div className="card-title-group">
              <h3 className="card-title">Phân Bố Điểm Chữ</h3>
              <p className="card-desc">Tỷ lệ các thang điểm chữ (A, B, C, D, F)</p>
            </div>
          </div>
          <div className="chart-container">
            {semesters.length > 0 ? (
              <GradeDistChart semesters={semesters} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Đang tải phân bố điểm…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Gradebook Section */}
      <div className="gradebook-section glass-panel">
        <div className="toolbar">
          <div className="toolbar-left">
            <div className="filter-group">
              <label htmlFor="semester-select" className="filter-label">Chọn Học Kỳ:</label>
              <select
                id="semester-select"
                className="custom-select"
                value={semester}
                onChange={(e) => setParam('semester', e.target.value, 'ALL')}
              >
                <option value="ALL">Tất cả các học kỳ</option>
                {semesters.map((s) => (
                  <option key={s.hoc_ky || s.ten_hoc_ky} value={s.hoc_ky || s.ten_hoc_ky}>
                    {s.ten_hoc_ky || `Học kỳ ${s.hoc_ky}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="status-filter" className="filter-label">Trạng Thái:</label>
              <select
                id="status-filter"
                className="custom-select"
                value={status}
                onChange={(e) => setParam('status', e.target.value, 'ALL')}
              >
                <option value="ALL">Tất cả môn</option>
                <option value="PASS">Môn đạt</option>
                <option value="FAIL">Môn chưa đạt (F)</option>
              </select>
            </div>
          </div>

          <div className="toolbar-right">
            <div className="search-box">
              <span className="search-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                type="text"
                id="search-subject"
                className="search-input"
                placeholder="Tìm tên môn, mã môn..."
                value={queryText}
                onChange={(e) => setParam('q', e.target.value)}
              />
            </div>

            <button
              id="btn-export-csv"
              className="btn-action-sm"
              title="Xuất file CSV"
              onClick={() => downloadCsv(buildGradesCsv(semesters, { semester, status, query: queryText }), `BDU_BangDiem_${userMssv}.csv`)}
              disabled={!semesters.length}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              <span>CSV</span>
            </button>

            <button
              id="btn-print"
              className="btn-action-sm"
              title="In hoặc lưu PDF"
              onClick={() => window.print()}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect width="12" height="8" x="6" y="14" />
              </svg>
              <span>In</span>
            </button>
          </div>
        </div>

        <div id="semester-groups-container" className="semester-groups-container">
          {filteredSemesters.map((sem) => {
            const semTitle = sem.ten_hoc_ky || `Học kỳ ${sem.hoc_ky}`;
            return (
              <div className="semester-block" key={sem.hoc_ky || semTitle}>
                <div className="semester-header">
                  <div className="sem-title">{semTitle}</div>
                  <div className="sem-meta">
                    Môn học: <strong>{sem.courses.length}</strong> | Tín chỉ HK: <strong>{sem.credits}</strong> | GPA HK (10): <strong>{formatScore(sem.dtb_hk_he10)}</strong> | GPA HK (4): <strong>{formatScore(sem.dtb_hk_he4)}</strong>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="grade-table">
                    <thead>
                      <tr>
                        <th>Mã Môn</th>
                        <th>Tên Môn Học</th>
                        <th>Số TC</th>
                        <th>Điểm GK</th>
                        <th>Điểm Thi</th>
                        <th>Điểm TK (10)</th>
                        <th>Điểm Hệ 4</th>
                        <th>Điểm Chữ</th>
                        <th>Kết Quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sem.courses.length === 0 ? (
                        <tr>
                          <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                            Chưa có dữ liệu môn học cho học kỳ này.
                          </td>
                        </tr>
                      ) : (
                        sem.courses.map((c, idx) => {
                          const result = getCourseResult(c);
                          return (
                            <tr
                              key={`${c.ma_mon}-${idx}`}
                              className="course-row"
                              tabIndex={0}
                              role="button"
                              aria-label={`Xem chi tiết điểm môn ${c.ten_mon || c.ma_mon || 'học phần'}`}
                              onClick={(event) => openCourseDetails(c, semTitle, event.currentTarget)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openCourseDetails(c, semTitle, event.currentTarget);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              <td><code>{c.ma_mon || '--'}</code></td>
                              <td className="course-name-cell" title="Bấm để xem chi tiết điểm thành phần">
                                {c.ten_mon || '--'}
                              </td>
                              <td><strong>{c.so_tin_chi || 0}</strong></td>
                              <td>{c.diem_giua_ky !== undefined && c.diem_giua_ky !== null && c.diem_giua_ky !== '' ? c.diem_giua_ky : '--'}</td>
                              <td>{c.diem_thi !== undefined && c.diem_thi !== null && c.diem_thi !== '' ? c.diem_thi : '--'}</td>
                              <td><strong>{formatScore(c.diem_tk)}</strong></td>
                              <td><strong>{formatScore(c.diem_tk_so)}</strong></td>
                              <td><span className={`grade-pill ${getGradeLetterClass(c.diem_tk_chu)}`}>{c.diem_tk_chu || '--'}</span></td>
                              <td>
                                {result.status === 'passed' ? (
                                  <span className="tag tag-active">Đạt</span>
                                ) : result.status === 'failed' ? (
                                  <span className="tag" style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
                                    Chưa đạt
                                  </span>
                                ) : (
                                  <span className="tag tag-neutral">Chưa có điểm</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        {totalVisibleCourses === 0 && (
          <div id="table-empty" className="empty-state">
            <div className="empty-monogram">0</div>
            <p className="empty-text">Không tìm thấy môn học nào phù hợp với bộ lọc.</p>
          </div>
        )}

        <div className="table-footer">
          <div className="footer-stats">
            Tổng cộng hiển thị: <strong id="visible-courses-count">{totalVisibleCourses}</strong> môn học (<strong id="visible-credits-count">{totalVisibleCredits}</strong> tín chỉ)
          </div>
        </div>
      </div>

      {/* Modal: Xem chi tiết điểm thành phần môn học */}
      {selectedCourse && (
        <ViewportModal
          id="detail-modal"
          title={selectedCourse.ten_mon || 'Chi Tiết Môn Học'}
          labelledBy="modal-course-name"
          onClose={closeCourseDetails}
          dialogRef={detailDialogRef}
          className="gpa-detail-dialog"
        >
            <div className="modal-header">
              <div className="modal-title-group">
                <h3 id="modal-course-name" className="modal-title">{selectedCourse.ten_mon || 'Chi Tiết Môn Học'}</h3>
                <span id="modal-course-code" className="modal-badge">{selectedCourse.ma_mon || '--'}</span>
              </div>
              <button
                ref={detailCloseRef}
                id="modal-close"
                type="button"
                className="modal-close-btn"
                title="Đóng"
                aria-label="Đóng chi tiết môn học"
                onClick={closeCourseDetails}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="course-summary-row">
                <div className="m-summary-item">Số Tín Chỉ: <strong id="modal-credits">{selectedCourse.so_tin_chi || 0}</strong></div>
                <div className="m-summary-item">Điểm TK (10): <strong id="modal-tk-10">{formatScore(selectedCourse.diem_tk)}</strong></div>
                <div className="m-summary-item">Điểm Hệ 4: <strong id="modal-tk-4">{formatScore(selectedCourse.diem_tk_so)}</strong></div>
                <div className="m-summary-item">
                  Điểm Chữ: <strong id="modal-letter" className={`grade-pill ${getGradeLetterClass(selectedCourse.diem_tk_chu)}`}>
                    {selectedCourse.diem_tk_chu || '--'}
                  </strong>
                </div>
              </div>

              <h4 className="component-section-title">Bảng Điểm Thành Phần Chi Tiết:</h4>

              <div className="table-responsive">
                <table className="modal-table">
                  <thead>
                    <tr>
                      <th>Tên Thành Phần</th>
                      <th>Tỷ Lệ (%)</th>
                      <th>Điểm Số</th>
                      <th>Ghi Chú</th>
                    </tr>
                  </thead>
                  <tbody id="modal-components-body">
                    {courseComponents.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          Không có dữ liệu điểm thành phần chi tiết cho môn học này.
                        </td>
                      </tr>
                    ) : (
                      courseComponents.map((comp, i) => (
                        <tr key={i}>
                          <td><strong>{comp.name}</strong></td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{comp.weight}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontWeight: 700 }}>{comp.score}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{comp.note}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button id="modal-btn-dismiss" type="button" className="btn btn-secondary" onClick={closeCourseDetails}>
                Đóng
              </button>
            </div>
        </ViewportModal>
      )}
    </section>
  );
}
