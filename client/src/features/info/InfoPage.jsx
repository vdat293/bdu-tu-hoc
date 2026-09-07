import { useQuery } from '@tanstack/react-query';
import { getProfile } from '../../api/academics.js';
import { getMyIdentityPresentation } from '../../api/identity.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';

function profileRecord(response) {
  const raw = response?.data || response;
  const record = raw?.ds_thong_tin_sinh_vien || raw?.thong_tin_sinh_vien || raw?.student || raw?.sinh_vien;
  return Array.isArray(raw) ? raw[0] : Array.isArray(record) ? record[0] : record || raw || {};
}

function field(profile, keys, fallback = '---') {
  return keys.map((key) => profile?.[key]).find((val) => val !== undefined && val !== null && String(val).trim() !== '') || fallback;
}

function getInitials(name) {
  const parts = String(name || 'SV').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function InfoPageSkeleton() {
  return (
    <section id="tab-profile" className="tab-pane active" role="status" aria-label="Đang tải hồ sơ sinh viên">
      <div className="section-header-box glass-panel">
        <div className="skeleton-copy">
          <SkeletonBlock className="skeleton-line heading" />
          <SkeletonBlock className="skeleton-line wide" />
        </div>
      </div>
      <div className="bdu-profile-bento-grid">
        <div className="profile-hero-card glass-panel">
          <div className="hero-card-body">
            <SkeletonBlock className="skeleton-avatar profile" />
            <div className="skeleton-copy skeleton-profile-copy">
              <SkeletonBlock className="skeleton-line title" />
              <SkeletonBlock className="skeleton-line medium" />
              <div className="skeleton-chip-row">
                {[1, 2, 3].map((chip) => <SkeletonBlock className="skeleton-chip" key={chip} />)}
              </div>
            </div>
          </div>
        </div>
        <div className="profile-sub-grid">
          {[1, 2].map((card) => (
            <div className="sub-bento-card glass-panel" key={card}>
              <SkeletonBlock className="skeleton-line heading" />
              <div className="skeleton-table compact">
                {[1, 2, 3, 4].map((row) => <SkeletonBlock className="skeleton-table-row" key={row} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function InfoPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const profile = useQuery({
    queryKey: ['profile', auth.user?.mssv],
    queryFn: ({ signal }) => getProfile(auth.token, { idsv: auth.user?.idsv, mssv: auth.user?.mssv, signal }),
    enabled: Boolean(auth.token)
  });

  const presentation = useQuery({
    queryKey: ['identity-presentation', auth.user?.mssv],
    queryFn: ({ signal }) => getMyIdentityPresentation(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const person = profileRecord(profile.data);
  const fullName = field(person, ['ho_ten', 'ho_va_ten', 'ten_day_du', 'name'], auth.user?.name || 'Sinh viên BDU');
  const mssv = field(person, ['ma_sinh_vien', 'ma_sv', 'userName'], auth.user?.mssv || '---');
  const dob = field(person, ['ngay_sinh', 'ngay_thang_nam_sinh']);
  const gender = field(person, ['gioi_tinh', 'ten_gioi_tinh']);
  const faculty = field(person, ['ten_khoa', 'ten_khoa_quan_ly', 'khoa']);
  const major = field(person, ['ten_chuyen_nganh', 'ten_nganh', 'nganh']);
  const className = field(person, ['ten_lop', 'ten_lop_hanh_chinh', 'lop']);
  const status = field(person, ['ten_tinh_trang', 'tinh_trang_hoc', 'trang_thai'], 'Đang học');
  const cohort = field(person, ['nien_khoa', 'ten_nien_khoa', 'khoa_hoc']);
  const advisor = field(person, ['ten_co_van_hoc_tap', 'ho_ten_co_van_hoc_tap', 'ten_cvht'], 'Chưa cập nhật');
  const advisorId = field(person, ['ma_co_van_hoc_tap', 'ma_cvht'], '--');
  const photo = profile.data?.student_image || person.hinh_anh || person.url_hinh_anh || person.image || person.anh_the;

  const copyMssv = () => {
    if (mssv && mssv !== '---') {
      navigator.clipboard?.writeText(mssv);
      notify(`Đã sao chép MSSV: ${mssv}`, 'success');
    }
  };

  if (profile.isLoading) return <InfoPageSkeleton />;

  return (
    <section id="tab-profile" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <h2 className="section-title">Lý Lịch & Hồ Sơ Sinh Viên</h2>
        <p className="section-desc">Thông tin học vụ cá nhân được đồng bộ từ cổng quản lý sinh viên BDU</p>
      </div>

      <div className="bdu-profile-bento-grid">
        {/* 1. Hero Master Student Card */}
        <div className="profile-hero-card glass-panel">
          <div className="hero-card-header">
            <div className="bdu-badge-brand">
              <img
                className="bdu-badge-logo"
                src="/assets/images/logo-hao-quang-transparent.png"
                alt="Logo Đại học Bình Dương"
              />
              <span>TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG</span>
              <span className="badge-pipe">|</span>
              <span className="brand-sub">CỔNG QUẢN LÝ ĐÀO TẠO BDU</span>
            </div>
            <div className="live-sync-badge">
              <span className="pulse-dot"></span>
              <span>Đồng bộ thời gian thực</span>
            </div>
          </div>

          <div className="hero-card-body">
            <div className="student-avatar-box">
              <div className="avatar-ring">
                {photo ? (
                  <img id="profile-student-photo" src={photo} alt="Ảnh sinh viên" className="student-avatar-img" />
                ) : (
                  <div id="card-avatar" className="student-avatar-fallback">
                    {getInitials(fullName)}
                  </div>
                )}
              </div>
              <div className="student-status-badge">
                <span className="status-indicator"></span>
                <span id="p-status">{status}</span>
              </div>
            </div>

            <div className="student-core-info">
              <div className="name-row">
                <h2 id="p-fullname" className="student-main-name">{fullName}</h2>
                <span className="verified-icon" title="Hồ sơ đã xác thực từ BDU">✓</span>
              </div>

              <div className="mssv-copy-row">
                <div
                  className="mssv-badge"
                  onClick={copyMssv}
                  style={{ cursor: 'pointer' }}
                  title="Bấm để sao chép MSSV"
                >
                  <span className="mssv-label">MSSV:</span>
                  <strong id="p-mssv" className="mssv-number">{mssv}</strong>
                </div>
                <span className="meta-tag">
                  <span id="p-dob">{dob}</span>
                </span>
                <span className="meta-tag">
                  <span id="p-gender">{gender}</span>
                </span>
              </div>

              <div className="quick-chips-row">
                <div className="info-chip">
                  <div className="chip-content">
                    <span className="chip-title">Khoa</span>
                    <span id="p-faculty" className="chip-val">{faculty}</span>
                  </div>
                </div>

                <div className="info-chip">
                  <div className="chip-content">
                    <span className="chip-title">Ngành</span>
                    <span id="p-major" className="chip-val">{major}</span>
                  </div>
                </div>

                <div className="info-chip">
                  <div className="chip-content">
                    <span className="chip-title">Lớp</span>
                    <span id="p-class" className="chip-val chip-highlight">{className}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Dual Sub Bento Grid */}
        <div className="profile-sub-grid">
          {/* Sub Card A: Chi tiết học vụ */}
          <div className="sub-bento-card glass-panel">
            <div className="card-head-mini">
              <div className="card-head-title">
                <h3>Thông Tin Khóa Học & Đào Tạo</h3>
              </div>
              <span className="badge-mini badge-pill-blue">Chính Quy</span>
            </div>

            <div className="bento-list-items">
              <div className="bento-item">
                <div className="item-left">
                  <span className="item-label">Bậc hệ đào tạo</span>
                </div>
                <strong id="p-education-level" className="item-value">Đại học chính quy</strong>
              </div>

              <div className="bento-item">
                <div className="item-left">
                  <span className="item-label">Niên khóa đào tạo</span>
                </div>
                <strong id="p-cohort-years" className="item-value text-blue">{cohort}</strong>
              </div>

              <div className="bento-item">
                <div className="item-left">
                  <span className="item-label">Hình thức học</span>
                </div>
                <span className="item-value">Tích lũy tín chỉ</span>
              </div>

              <div className="bento-item">
                <div className="item-left">
                  <span className="item-label">Trạng thái hồ sơ</span>
                </div>
                <span className="item-value text-emerald">Đầy đủ & Hợp lệ</span>
              </div>
            </div>
          </div>

          {/* Sub Card B: Cố vấn học tập */}
          <div className="sub-bento-card glass-panel">
            <div className="card-head-mini">
              <div className="card-head-title">
                <h3>Cố Vấn Học Tập (CVHT)</h3>
              </div>
              <span className="badge-mini badge-pill-emerald">Quản Nhiệm</span>
            </div>

            <div className="advisor-profile-box">
              <div className="advisor-header-inline">
                <div className="advisor-avatar-circle">
                  <span>GV</span>
                </div>
                <div className="advisor-title-info">
                  <h4 id="p-advisor-name" className="advisor-name">{advisor}</h4>
                  <div className="advisor-sub">
                    <span>Mã CB: <strong id="p-advisor-id">{advisorId}</strong></span>
                    <span className="dot-separator">•</span>
                    <span>BDU</span>
                  </div>
                </div>
              </div>

              <div className="advisor-actions">
                <a
                  id="btn-mail-advisor"
                  href={advisor !== 'Chưa cập nhật' ? `mailto:${advisorId}@bdu.edu.vn` : '#'}
                  className="btn-advisor-action"
                  title="Gửi email cho cố vấn"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <span>Gửi email trao đổi</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
