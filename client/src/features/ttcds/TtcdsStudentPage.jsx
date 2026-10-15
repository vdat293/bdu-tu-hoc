import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTtcdsStudent } from '../../api/ttcds.js';
import { useAuth } from '../../app/providers.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
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

function termName(row) {
  if (row?.ten_hoc_ky || row?.ten_nkhk) return row.ten_hoc_ky || row.ten_nkhk;
  return row?.nkhk != null ? `Học kỳ ${row.nkhk}` : '—';
}

function OverviewTab({ detail }) {
  const gpa = Array.isArray(detail?.gpa_hoc_ky) ? detail.gpa_hoc_ky : [];
  const attendance = Array.isArray(detail?.diem_danh) ? detail.diem_danh : [];
  const renLuyen = Array.isArray(detail?.ren_luyen) ? detail.ren_luyen : [];
  return (
    <>
      <div className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }}>
        <h2>Điểm theo học kỳ</h2>
        {gpa.length === 0 ? (
          <p>Chưa có dữ liệu</p>
        ) : (
          <table>
            <thead><tr><th>Học kỳ / năm học</th><th>ĐTB kỳ</th><th>Tích lũy</th><th>Tín chỉ kỳ</th><th>Xếp loại</th></tr></thead>
            <tbody>
              {gpa.map((row) => (
                <tr key={row.nkhk}>
                  <td>{termName(row)}</td>
                  <td>{fmt(row.dtb_hk_he_4)}</td>
                  <td>{fmt(row.dtb_tich_luy_he_4)}</td>
                  <td>{row.so_tin_chi_dat_hk ?? '—'}</td>
                  <td>{row.xep_loai_hoc_ki ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }}>
        <h2>Điểm danh theo học kỳ</h2>
        {attendance.length === 0 ? (
          <p>Chưa có dữ liệu</p>
        ) : (
          <table>
            <thead><tr><th>Học kỳ / năm học</th><th>Có mặt</th><th>Vắng</th><th>Tỷ lệ</th></tr></thead>
            <tbody>
              {attendance.map((row) => {
                const present = Number(row.di_hoc) || 0;
                const absent = Number(row.vang) || 0;
                const total = present + absent;
                return (
                  <tr key={row.nkhk}>
                    <td>{termName(row)}</td>
                    <td>{row.di_hoc ?? '—'}</td>
                    <td>{row.vang ?? '—'}</td>
                    <td>{total > 0 ? `${((100 * present) / total).toFixed(1)}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="card glass-panel" style={{ padding: '16px' }}>
        <h2>Điểm rèn luyện</h2>
        {renLuyen.length === 0 ? (
          <p>—</p>
        ) : (
          <table>
            <thead><tr><th>Học kỳ</th><th>Điểm</th><th>Xếp loại</th></tr></thead>
            <tbody>
              {renLuyen.map((row) => (
                <tr key={row.nkhk}>
                  <td>{row.nkhk ?? '—'}</td>
                  <td>{row.diem_ren_luyen ?? '—'}</td>
                  <td>{row.xep_loai ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function groupBy(items, termKey, dayKey) {
  const map = new Map();
  for (const item of items) {
    const term = termKey(item);
    if (!map.has(term)) map.set(term, new Map());
    const byDay = map.get(term);
    const day = dayKey(item);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  return [...map.entries()].map(([term, byDay]) => [term, [...byDay.entries()]]);
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
  const byTerm = groupBy(sessions, (session) => session?.nkhk ?? '?', (session) => session?.ngay_hoc || session?.thu || '—');
  if (sessions.length === 0) return <p>Chưa có dữ liệu</p>;
  return (
    <>
      {byTerm.map(([nkhk, byDay]) => (
        <div className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }} key={nkhk}>
          <h2>Học kỳ {nkhk}</h2>
          {[...byDay.entries()].map(([day, items]) => (
            <div key={day}>
              <h3>{day}</h3>
              <ul>
                {items.map((item, index) => (
                  <li key={`${item.ma_mon_hoc}-${item.ma_nhom}-${index}`}>
                    {item.ten_mon || item.ma_mon_hoc || '—'} · Tiết {item.tiet_bat_dau ?? '—'} · {item.phong ?? '—'} · {item.giang_vien ?? '—'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function GradesTab({ detail }) {
  const grades = Array.isArray(detail?.bang_diem) ? detail.bang_diem : [];
  const byTerm = groupRows(grades, (row) => row?.nkhk ?? '?');
  if (grades.length === 0) return <p>Chưa có dữ liệu</p>;
  return (
    <>
      {byTerm.map(([nkhk, rows]) => (
        <div className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }} key={nkhk}>
          <h2>Học kỳ {nkhk} · {rows.length} môn</h2>
          <table>
            <thead><tr><th>Mã môn</th><th>Tên môn</th><th>Tín chỉ</th><th>Điểm</th><th>Thang 4</th><th>Chữ</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.ma_mon_hoc}-${index}`}>
                  <td>{row.ma_mon_hoc ?? '—'}</td>
                  <td>{row.ten_mon ?? '—'}</td>
                  <td>{row.so_tin_chi ?? '—'}</td>
                  <td>{row.diem ?? '—'}</td>
                  <td>{row.diem_he_4 ?? '—'}</td>
                  <td>{row.diem_chu ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function EventsTab({ detail }) {
  const events = Array.isArray(detail?.su_kien) ? detail.su_kien : [];
  if (events.length === 0) return <p>Chưa tham gia sự kiện nào</p>;
  return (
    <div className="card glass-panel" style={{ padding: '16px' }}>
      <h2>Sự kiện · {events.length} sự kiện đã tham gia</h2>
      <ul>
        {events.map((event, index) => (
          <li key={`${event.ten_su_kien}-${index}`}>
            {event.ngay ?? '—'} · {event.ten_su_kien ?? '—'} · {event.loai ?? event.the_loai ?? '—'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TtcdsStudentPage() {
  const { mssv } = useParams();
  const auth = useAuth();
  const [tab, setTab] = useState('tong-quan');

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
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải thông tin sinh viên</h2>
        <p>{detail.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => detail.refetch()}>Thử lại</button>
      </div>
    );
  }

  const data = detail.data || {};
  const profile = data.ho_so || {};
  const gpaTerms = Array.isArray(data.gpa_hoc_ky) ? data.gpa_hoc_ky : [];
  const lastGpa = gpaTerms[gpaTerms.length - 1];

  return (
    <section id="tab-ttcds-student" className="tab-pane club-experience">
      <p><Link to="/ttcds">← Trung tâm CĐS</Link></p>
      <div className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }}>
        <h2>{profile.ten_day_du || '—'} <span>{profile.mssv || mssv}</span></h2>
        <p>Lớp {profile.ma_lop ?? '—'} · {profile.ten_khoa ?? '—'} · Niên khóa {profile.nien_khoa ?? '—'}</p>
        <p>ĐTB tích lũy {lastGpa ? fmt(lastGpa.dtb_tich_luy_he_4) : '—'} · Tín chỉ tích lũy {lastGpa?.so_tin_chi_dat_tich_luy ?? '—'}</p>
      </div>

      <div className="nav-tab" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            className={`tab${tab === entry.id ? ' active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'tong-quan' && <OverviewTab detail={data} />}
        {tab === 'tkb' && <TimetableTab detail={data} />}
        {tab === 'bang-diem' && <GradesTab detail={data} />}
        {tab === 'su-kien' && <EventsTab detail={data} />}
      </div>
    </section>
  );
}
