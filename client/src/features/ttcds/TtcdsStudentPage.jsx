import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTtcdsStudent } from '../../api/ttcds.js';
import { useAuth } from '../../app/providers.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import '../clubs/clubs.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

const TABS = [
  { id: 'tong-quan', label: 'Tổng quan' },
  { id: 'tkb', label: 'Thời khóa biểu' },
  { id: 'bang-diem', label: 'Bảng điểm chi tiết' },
  { id: 'su-kien', label: 'Sự kiện' }
];

function fmt(value, digits = 2) {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

/**
 * Mã kỳ dạng số của Dashboard (`25262` → học kỳ 2, năm 2025): 2 ký tự đầu là
 * năm (2000 + yy), ký tự thứ 5 là học kỳ — cùng công thức với `hocKyLabel`
 * của backend (`odp-sync.service.js`), viết lại cho frontend hiển thị.
 */
function parseTermCode(nkhk) {
  const text = String(nkhk ?? '').trim();
  if (text.length < 5) return null;
  const year = Number(text.slice(0, 2));
  const hk = Number(text.charAt(4));
  if (!Number.isInteger(year) || year <= 0) return null;
  if (!Number.isInteger(hk) || hk < 1 || hk > 3) return { year: 2000 + year, hk: null };
  return { year: 2000 + year, hk };
}

/**
 * Caption kỳ NHẤT QUÁN cho cả 4 ô số: `["Học kỳ 2 · 2025-2026", "mã 25262"]`.
 * Ưu tiên `hoc_ky`/`nien_khoa` API đã gộp sẵn, thiếu thì suy từ mã `nkhk`,
 * mã lạ thì giữ đúng 1 dòng theo nhãn cũ để không vỡ dữ liệu.
 */
function termCaption(source) {
  const nkhk = source?.nkhk;
  const hasCode = nkhk !== null && nkhk !== undefined && String(nkhk).trim() !== '';
  let hk = Number(source?.hoc_ky);
  if (!Number.isInteger(hk) || hk < 1 || hk > 3) hk = null;
  let year = Number(source?.nien_khoa);
  if (!Number.isInteger(year) || year <= 0) year = null;
  if ((hk === null || year === null) && hasCode) {
    const parsed = parseTermCode(nkhk);
    if (parsed) {
      if (hk === null) hk = parsed.hk;
      if (year === null) year = parsed.year;
    }
  }
  if (hk !== null && year !== null) return [`Học kỳ ${hk} · ${year}-${year + 1}`, `mã ${nkhk}`];
  if (source?.ten_hoc_ky || source?.ten_nkhk) return [source.ten_hoc_ky || source.ten_nkhk];
  return [hasCode ? `Học kỳ ${nkhk}` : '—'];
}

function TermCaption({ source }) {
  const lines = termCaption(source);
  return (
    <>
      {lines.map((line) => <span key={line} className="ttcds-stat__meta">{line}</span>)}
    </>
  );
}

function TermCell({ source }) {
  const [line, code] = termCaption(source);
  return (
    <>
      <span className="ttcds-term-main">{line}</span>
      {code && <span className="ttcds-term-code">{code}</span>}
    </>
  );
}

/**
 * Kỳ mới nhất của SV cho ô "Học kỳ đang học" trong thẻ hồ sơ: bản ghi cuối
 * (mới nhất) của điểm danh → GPA → rèn luyện → TKB → bảng điểm → sự kiện.
 */
function latestTermSource(detail) {
  const pick = (items) => (Array.isArray(items) && items.length > 0 ? items[items.length - 1] : null);
  return (
    pick(detail?.diem_danh) ??
    pick(detail?.gpa_hoc_ky) ??
    pick(detail?.ren_luyen) ??
    pick(detail?.thoi_khoa_bieu) ??
    pick(detail?.bang_diem) ??
    pick(detail?.su_kien)
  );
}

/**
 * Thẻ hồ sơ SV kiểu Dashboard: một khối có viền, bên trong là lưới các ô con
 * CÓ VIỀN (Lớp / Khoa / Niên khóa / Học kỳ đang học / Trạng thái) — mỗi ô gồm
 * nhãn nhỏ + giá trị lớn + caption mờ. Thiếu dữ liệu → '—'.
 */
function ProfileCard({ profile, mssv, termSource }) {
  const [termLine, termCode] = termCaption(termSource);
  const cells = [
    { label: 'Lớp', value: profile.ma_lop ?? '—', meta: profile.ten_lop || null },
    { label: 'Khoa', value: profile.ten_khoa ?? '—', meta: null },
    { label: 'Niên khóa', value: profile.nien_khoa ?? '—', meta: null },
    { label: 'Học kỳ đang học', value: termLine, meta: termCode || null },
    { label: 'Trạng thái', value: profile.hien_dien ?? 'Đang học', meta: null }
  ];
  return (
    <div className="profile-hero-card glass-panel ttcds-panel">
      <h2>{profile.ten_day_du || '—'} <span className="club-muted">{profile.mssv || mssv}</span></h2>
      <div className="ttcds-cell-grid">
        {cells.map((cell) => (
          <div key={cell.label} className="ttcds-cell">
            <span className="ttcds-cell__label">{cell.label}</span>
            <span className="ttcds-cell__value">{cell.value}</span>
            {cell.meta && <span className="ttcds-cell__meta">{cell.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ detail }) {
  const gpa = Array.isArray(detail?.gpa_hoc_ky) ? detail.gpa_hoc_ky : [];
  const attendance = Array.isArray(detail?.diem_danh) ? detail.diem_danh : [];
  const renLuyen = Array.isArray(detail?.ren_luyen) ? detail.ren_luyen : [];
  const events = Array.isArray(detail?.su_kien) ? detail.su_kien : [];

  const lastGpa = gpa[gpa.length - 1];
  const lastAttendance = attendance[attendance.length - 1];
  const lastRenLuyen = renLuyen[renLuyen.length - 1];
  const latestNkhk = lastAttendance?.nkhk ?? lastGpa?.nkhk ?? null;
  const eventCount = latestNkhk != null ? events.filter((event) => event?.nkhk === latestNkhk).length : 0;

  const present = Number(lastAttendance?.di_hoc) || 0;
  const absent = Number(lastAttendance?.vang) || 0;
  const total = present + absent;

  const tiles = [
    { label: 'ĐTB tích lũy', value: lastGpa ? fmt(lastGpa.dtb_tich_luy_he_4) : '—', detail: null, term: lastGpa ?? null },
    {
      label: 'Chuyên cần',
      value: lastAttendance ? (total > 0 ? `${((100 * present) / total).toFixed(1)}%` : '—') : '—',
      detail: lastAttendance ? `${present} có mặt · ${absent} vắng` : null,
      term: lastAttendance ?? null
    },
    {
      label: 'Rèn luyện',
      value: lastRenLuyen?.diem_ren_luyen != null ? `${lastRenLuyen.diem_ren_luyen} · ${lastRenLuyen.xep_loai || '—'}` : '—',
      detail: null,
      term: lastRenLuyen ?? null
    },
    {
      label: 'Sự kiện',
      value: latestNkhk != null ? String(eventCount) : '—',
      detail: null,
      term: latestNkhk != null ? { nkhk: latestNkhk } : null
    }
  ];

  return (
    <div className="card glass-panel ttcds-panel ttcds-student-overview">
      <div className="ttcds-panel-head">
        <h2>Tổng quan kỳ gần nhất</h2>
        <p className="ttcds-panel-sub">Số liệu mới nhất, rèn luyện có thể trễ một nhịp</p>
      </div>
      <div className="ttcds-stats">
        {tiles.map((tile) => (
          <div key={tile.label} className="ttcds-stat" data-testid="ttcds-stat">
            <span className="ttcds-stat__label">{tile.label}</span>
            <span className="ttcds-stat__value">{tile.value}</span>
            {tile.detail && <span className="ttcds-stat__meta">{tile.detail}</span>}
            {tile.term ? <TermCaption source={tile.term} /> : <span className="ttcds-stat__meta">—</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupRows(items, termKey) {
  const map = new Map();
  for (const item of items) {
    const term = termKey(item);
    if (!map.has(term)) map.set(term, []);
    map.get(term).push(item);
  }
  return [...map.entries()];
}

function TimetableTab({ detail }) {
  const sessions = Array.isArray(detail?.thoi_khoa_bieu) ? detail.thoi_khoa_bieu : [];
  if (sessions.length === 0) return <p>Chưa có dữ liệu</p>;
  const byTerm = groupRows(sessions, (session) => session?.nkhk ?? '?');
  return (
    <>
      {byTerm.map(([nkhk, rows]) => {
        const [termLine, termCode] = termCaption(rows[0] ?? { nkhk });
        return (
          <div className="card glass-panel ttcds-panel" key={nkhk}>
            <div className="ttcds-panel-head">
              <h2>{termLine}</h2>
              <p className="ttcds-panel-sub">{termCode ? `${termCode} · ` : ''}{rows.length} buổi học</p>
            </div>
            <div className="table-scroll">
              <table className="ttcds-groups-table">
                <thead><tr><th scope="col">Ngày</th><th scope="col">Thứ</th><th scope="col">Môn</th><th scope="col" style={{ textAlign: 'right' }}>Tiết</th><th scope="col">Phòng</th><th scope="col">Giảng viên</th></tr></thead>
                <tbody>
                  {rows.map((item, index) => (
                    <tr key={`${item.ma_mon_hoc}-${item.ma_nhom}-${index}`}>
                      <td>{item.ngay_hoc ?? '—'}</td>
                      <td>{item.thu ?? '—'}</td>
                      <td>{item.ten_mon || item.ma_mon_hoc || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{item.tiet_bat_dau ?? '—'}</td>
                      <td>{item.phong ?? '—'}</td>
                      <td>{item.giang_vien ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

function GradesTab({ detail }) {
  const grades = Array.isArray(detail?.bang_diem) ? detail.bang_diem : [];
  const byTerm = groupRows(grades, (row) => row?.nkhk ?? '?');
  if (grades.length === 0) return <p>Chưa có dữ liệu</p>;
  return (
    <>
      {byTerm.map(([nkhk, rows]) => {
        const [termLine, termCode] = termCaption(rows[0] ?? { nkhk });
        return (
          <div className="card glass-panel ttcds-panel" key={nkhk}>
            <div className="ttcds-panel-head">
              <h2>{termLine}</h2>
              <p className="ttcds-panel-sub">{termCode ? `${termCode} · ` : ''}{rows.length} môn</p>
            </div>
            <div className="table-scroll">
              <table className="ttcds-groups-table ttcds-grades-table">
              <thead><tr><th scope="col">Mã môn</th><th scope="col">Tên môn</th><th scope="col" style={{ textAlign: 'right' }}>Tín chỉ</th><th scope="col" style={{ textAlign: 'right' }}>Điểm</th><th scope="col" style={{ textAlign: 'right' }}>Thang 4</th><th scope="col">Chữ</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.ma_mon_hoc}-${index}`}>
                    <td>{row.ma_mon_hoc ?? '—'}</td>
                    <td>{row.ten_mon ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{row.so_tin_chi ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{row.diem ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{row.diem_he_4 ?? '—'}</td>
                    <td>{row.diem_chu ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        );
      })}
    </>
  );
}

function EventsTab({ detail }) {
  const events = Array.isArray(detail?.su_kien) ? detail.su_kien : [];
  if (events.length === 0) return <p>Chưa tham gia sự kiện nào</p>;
  return (
    <div className="card glass-panel ttcds-panel">
      <div className="ttcds-panel-head">
        <h2>Sự kiện · {events.length} sự kiện đã tham gia</h2>
        <p className="ttcds-panel-sub">Hoạt động đã ghi nhận theo từng học kỳ</p>
      </div>
      <div className="table-scroll">
        <table className="ttcds-groups-table">
          <thead><tr><th scope="col">Ngày</th><th scope="col">Sự kiện</th><th scope="col">Loại</th><th scope="col">Học kỳ</th></tr></thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.ten_su_kien}-${index}`}>
                <td>{event.ngay ?? '—'}</td>
                <td>{event.ten_su_kien ?? '—'}</td>
                <td>{event.loai ?? event.the_loai ?? '—'}</td>
                <td><TermCell source={event} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TtcdsStudentPage() {
  const { mssv } = useParams();
  const auth = useAuth();
  const [tab, setTab] = useState('tong-quan');
  const tabRefs = useRef({});

  const focusTab = (id) => {
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  // WAI-ARIA APG: tablist điều hướng bằng ←/→/Home/End + roving tabindex, để chỉ
  // tab đang chọn nằm trong tab-order còn các tab khác nhường phím cho panel.
  const onTablistKeyDown = (event) => {
    const currentIndex = TABS.findIndex((entry) => entry.id === tab);
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    focusTab(TABS[nextIndex].id);
  };

  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);

  const detail = useQuery({
    queryKey: ['ttcds-student', String(mssv ?? '').toUpperCase()],
    queryFn: ({ signal }) => getTtcdsStudent(auth.token, mssv, { signal }),
    enabled: Boolean(auth.token && canAccess && mssv),
    retry: false
  });

  if (caps.isLoading || (detail.isLoading && canAccess)) {
    return (
      <section className="club-directory-grid" aria-label="Đang tải chi tiết sinh viên">
        {[1, 2].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }
  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  if (detail.isError) {
    // Lỗi không được là ngõ cụt: luôn giữ link quay lại danh sách và h1 cho trang.
    // 404 là lỗi vĩnh viễn nên "Thử lại" vô nghĩa → đổi hành động thành về danh sách.
    const notFound = detail.error?.status === 404;
    return (
      <section id="tab-ttcds-student" className="tab-pane club-experience">
        <p><Link to="/mystudent">← Sinh viên của tôi</Link></p>
        <div className="club-empty" role="alert">
          <h1>{notFound ? 'Không tìm thấy sinh viên' : 'Chưa thể tải thông tin sinh viên'}</h1>
          <p>{notFound ? 'Không có sinh viên với mã này trong hệ thống.' : (detail.error?.message || 'Vui lòng thử lại sau ít phút.')}</p>
          {notFound ? (
            <Link className="btn btn-secondary" to="/mystudent">Về danh sách</Link>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => detail.refetch()}>Thử lại</button>
          )}
        </div>
      </section>
    );
  }

  const data = detail.data || {};
  const profile = data.ho_so || {};

  return (
    <section id="tab-ttcds-student" className="tab-pane club-experience">
      <p><Link to="/mystudent">← Sinh viên của tôi</Link></p>
      <ProfileCard profile={profile} mssv={mssv} termSource={latestTermSource(data)} />

      <div className="club-tabs" role="tablist" aria-label="Chi tiết sinh viên" onKeyDown={onTablistKeyDown}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`tab-${entry.id}`}
            ref={(element) => { tabRefs.current[entry.id] = element; }}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'tong-quan' && <OverviewTab detail={data} />}
        {tab === 'tkb' && <TimetableTab detail={data} />}
        {tab === 'bang-diem' && <GradesTab detail={data} />}
        {tab === 'su-kien' && <EventsTab detail={data} />}
      </div>
    </section>
  );
}
