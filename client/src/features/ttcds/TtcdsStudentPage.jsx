import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTtcdsAttendance, getTtcdsStudent } from '../../api/ttcds.js';
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

function OverviewTab({ detail, attendance }) {
  const data = useMemo(() => (detail && typeof detail === 'object' ? detail : {}), [detail]);
  const gpa = useMemo(() => (Array.isArray(data.gpa_hoc_ky) ? data.gpa_hoc_ky : []), [data]);
  const attendanceRows = useMemo(() => (Array.isArray(data.diem_danh) ? data.diem_danh : []), [data]);
  const renLuyen = useMemo(() => (Array.isArray(data.ren_luyen) ? data.ren_luyen : []), [data]);
  const events = useMemo(() => (Array.isArray(data.su_kien) ? data.su_kien : []), [data]);
  const journal = useMemo(
    () => (Array.isArray(attendance?.nhat_ky) ? attendance.nhat_ky : []),
    [attendance]
  );
  const series = useMemo(() => gpaSeries(gpa), [gpa]);

  const lastGpa = gpa[gpa.length - 1];
  const lastAttendance = attendanceRows[attendanceRows.length - 1];
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
    <>
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
      <div className="ttcds-chart-grid">
        <GpaLineCard terms={gpa} series={series} />
        <AttendanceWeekCard journal={journal} />
        <AttendanceTermCard gpa={gpa} series={series} attendance={attendanceRows} />
      </div>
    </>
  );
}

/* --- Biểu đồ Tổng quan (chart.js, cùng pattern GpaTrendChart) --- */

function chartTheme() {
  const isDark = typeof document !== 'undefined' && document.body.classList.contains('theme-dark');
  return {
    text: isDark ? '#c0b8ae' : '#625f59',
    grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(79, 70, 61, 0.09)',
    red: '#ad171c',
    blue: '#029acf'
  };
}

// Nhãn số trên từng chấm (kiểu Dashboard) — plugin inline, không thêm dep.
const valueLabelPlugin = {
  id: 'ttcdsValueLabels',
  afterDatasetsDraw(chart, args, opts) {
    const { ctx } = chart;
    const format = opts?.format || ((v) => String(v));
    const only = opts?.onlyDataset;
    ctx.save();
    ctx.font = '600 10.5px Manrope, sans-serif';
    ctx.textAlign = 'center';
    chart.data.datasets.forEach((dataset, di) => {
      if (only !== undefined && di !== only) return;
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((point, pi) => {
        const v = dataset.data[pi];
        if (v === null || v === undefined) return;
        ctx.fillStyle = dataset.borderColor || '#ad171c';
        ctx.fillText(format(v), point.x, point.y - 9);
      });
    });
    ctx.restore();
  }
};

function useChartCanvas(draw, deps) {
  const ref = useRef(null);
  useEffect(() => {
    let chart;
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas) return undefined;
    let ctx = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    // jsdom/test: chỉ render canvas, không dựng Chart.
    if (!ctx) return undefined;
    import('chart.js/auto').then(({ default: Chart }) => {
      if (cancelled || !ref.current) return;
      chart = draw(Chart, ref.current);
    });
    return () => {
      cancelled = true;
      if (chart) chart.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function termShortLabel(source) {
  const [line] = termCaption(source);
  return line.replace('Học kỳ ', 'Kỳ ').replace(/(\d{4})-(\d{4})/, '$1');
}

function gpaNumber(term, keys) {
  for (const key of keys) {
    const v = Number(term?.[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

// Ưu tiên thang 10; không có thì dùng thang 4 (giữ đúng thang, không trộn).
function gpaSeries(terms) {
  const rows = Array.isArray(terms) ? terms : [];
  const he10 = rows.map((t) => gpaNumber(t, ['dtb_tich_luy_he_10', 'dtb_hk_he_10']));
  if (he10.some((v) => v !== null)) return { values: he10, scale: 'thang 10' };
  return {
    values: rows.map((t) => gpaNumber(t, ['dtb_tich_luy_he_4', 'dtb_hk_he_4'])),
    scale: 'thang 4'
  };
}

function GpaLineCard({ terms, series }) {
  const rows = Array.isArray(terms) ? terms : [];
  const data = series && Array.isArray(series.values) ? series : gpaSeries(rows);
  const valid = data.values.filter((v) => v !== null);
  const ref = useChartCanvas((Chart, canvas) => {
    const theme = chartTheme();
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: rows.map((t) => termShortLabel(t)),
        datasets: [{
          label: `GPA tích lũy (${series.scale})`,
          data: series.values,
          borderColor: theme.red,
          backgroundColor: 'rgba(173, 23, 28, 0.08)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
          y: { grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } }
        },
        plugins: {
          legend: { labels: { color: theme.text, font: { family: 'Manrope', weight: '600' } } },
          ttcdsValueLabels: { format: (v) => Number(v).toFixed(2) }
        }
      },
      plugins: [valueLabelPlugin]
    });
  }, [terms]);
  return (
    <div className="card glass-panel ttcds-panel ttcds-chart-card">
      <div className="ttcds-panel-head">
        <h2>Điểm trung bình tích lũy</h2>
        <p className="ttcds-panel-sub">{series.scale === 'thang 4' ? 'Thang 4' : 'Thang 10'} · qua các học kỳ</p>
      </div>
      {valid.length === 0 ? (
        <p className="ttcds-chart-note">Chưa có dữ liệu GPA</p>
      ) : (
        <div className="ttcds-chart-wrap"><canvas ref={ref} id="ttcdsGpaLine" aria-label="Biểu đồ GPA tích lũy" /></div>
      )}
    </div>
  );
}

function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mondayKey(day) {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shortDay(day) {
  return `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
}

function weekRangeLabel(mondayStr) {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  return `${shortDay(start)}–${shortDay(end)}`;
}

// Gom nhật ký điểm danh theo tuần T2–CN. Buổi chưa chấm (diem_danh null)
// không tính vào mẫu — tuần không buổi nào đã chấm thì bỏ trống (null),
// không vẽ 0% (kiểu Dashboard).
function groupJournalByWeek(nhatKy) {
  const groups = new Map();
  for (const row of Array.isArray(nhatKy) ? nhatKy : []) {
    const day = parseDay(row?.ngay);
    if (!day) continue;
    const key = mondayKey(day);
    if (!groups.has(key)) groups.set(key, { key, sessions: [] });
    groups.get(key).sessions.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((group, index) => {
      const graded = group.sessions.filter((s) => s?.diem_danh !== null && s?.diem_danh !== undefined && String(s.diem_danh).trim() !== '');
      const present = graded.filter((s) => s?.co_mat === true).length;
      return {
        ...group,
        index: index + 1,
        total: graded.length,
        present,
        rate: graded.length > 0 ? (100 * present) / graded.length : null
      };
    });
}

function AttendanceWeekCard({ journal }) {
  const weeks = groupJournalByWeek(journal).filter((w) => w.rate !== null);
  const ref = useChartCanvas((Chart, canvas) => {
    const theme = chartTheme();
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks.map((w) => `Tuần ${w.index}`),
        datasets: [{
          label: 'Tỷ lệ chuyên cần',
          data: weeks.map((w) => Number(w.rate.toFixed(2))),
          borderColor: theme.red,
          backgroundColor: 'rgba(173, 23, 28, 0.08)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
          y: {
            min: 0,
            max: 100,
            grid: { color: theme.grid },
            ticks: { color: theme.text, font: { size: 10 }, callback: (v) => `${v}%` }
          }
        },
        plugins: {
          legend: { labels: { color: theme.text, font: { family: 'Manrope', weight: '600' } } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const w = weeks[items[0]?.dataIndex];
                return w ? `Tuần ${w.index} (${weekRangeLabel(w.key)}) · ${w.present}/${w.total} buổi` : '';
              },
              label: (item) => ` ${item.parsed.y}% có mặt`
            }
          },
          ttcdsValueLabels: { format: (v) => `${v}` }
        }
      },
      plugins: [valueLabelPlugin]
    });
  }, [journal]);
  return (
    <div className="card glass-panel ttcds-panel ttcds-chart-card">
      <div className="ttcds-panel-head">
        <h2>Tỷ lệ chuyên cần theo tuần</h2>
        <p className="ttcds-panel-sub">Tuần chưa đủ dữ liệu thì bỏ trống</p>
      </div>
      {weeks.length === 0 ? (
        <p className="ttcds-chart-note">Chưa có dữ liệu điểm danh theo tuần</p>
      ) : (
        <div className="ttcds-chart-wrap"><canvas ref={ref} id="ttcdsAttendanceWeek" aria-label="Biểu đồ chuyên cần theo tuần" /></div>
      )}
    </div>
  );
}

function attendanceRate(row) {
  const present = Number(row?.di_hoc) || 0;
  const absent = Number(row?.vang) || 0;
  const total = present + absent;
  return total > 0 ? (100 * present) / total : null;
}

// Combo cột + đường theo học kỳ (kiểu Dashboard): cột % chuyên cần,
// đường GPA tích lũy — chỉ dùng mảng tổng hợp đã có, không gọi thêm API.
function AttendanceTermCard({ gpa, series, attendance }) {
  const terms = Array.isArray(gpa) ? gpa : [];
  const line = series && Array.isArray(series.values) ? series : gpaSeries(terms);
  const byNkhk = new Map((Array.isArray(attendance) ? attendance : []).map((r) => [String(r?.nkhk), r]));
  const ref = useChartCanvas((Chart, canvas) => {
    const theme = chartTheme();
    return new Chart(canvas, {
      data: {
        labels: terms.map((t) => termShortLabel(t)),
        datasets: [
          {
            type: 'bar',
            label: 'Tỷ lệ chuyên cần',
            data: terms.map((t) => {
              const rate = attendanceRate(byNkhk.get(String(t?.nkhk)));
              return rate === null ? null : Number(rate.toFixed(2));
            }),
            backgroundColor: theme.blue,
            borderRadius: 4,
            maxBarThickness: 56,
            yAxisID: 'yRate'
          },
          {
            type: 'line',
            label: `Điểm TB tích lũy (${line.scale})`,
            data: line.values,
            borderColor: theme.red,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'yGpa'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
          yRate: {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 100,
            grid: { color: theme.grid },
            ticks: { color: theme.blue, font: { size: 10 }, callback: (v) => `${v}%` }
          },
          yGpa: {
            type: 'linear',
            position: 'right',
            grid: { display: false },
            ticks: { color: theme.red, font: { size: 10 } }
          }
        },
        plugins: {
          legend: { labels: { color: theme.text, font: { family: 'Manrope', weight: '600' } } },
          ttcdsValueLabels: { onlyDataset: 1, format: (v) => Number(v).toFixed(2) }
        }
      },
      plugins: [valueLabelPlugin]
    });
  }, [gpa, series, attendance]);
  if (terms.length === 0) return null;
  return (
    <div className="card glass-panel ttcds-panel ttcds-chart-card ttcds-chart-card--wide">
      <div className="ttcds-panel-head">
        <h2>Chuyên cần &amp; điểm trung bình theo học kỳ</h2>
        <p className="ttcds-panel-sub">Cột: tỷ lệ chuyên cần · Đường: điểm TB tích lũy</p>
      </div>
      <div className="ttcds-chart-wrap"><canvas ref={ref} id="ttcdsTermCombo" aria-label="Biểu đồ chuyên cần và điểm trung bình theo học kỳ" /></div>
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

function todayKey() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Tab TKB dạng card (cùng markup với trang /schedule): gom buổi học theo
// (học kỳ, tuần lịch T2–CN), trong tuần gom theo ngày — hiện CẢ tuần kể cả
// buổi đã học xong (làm mờ), không chỉ buổi sắp tới.
function TimetableTab({ detail }) {
  const today = todayKey();
  const weeks = useMemo(() => {
    const sessions = Array.isArray(detail?.thoi_khoa_bieu) ? detail.thoi_khoa_bieu : [];
    const byWeek = new Map();
    for (const item of sessions) {
      const day = parseDay(item?.ngay_hoc);
      const weekKey = day ? mondayKey(day) : 'unknown';
      const groupKey = `${item?.nkhk ?? '?'}|${weekKey}`;
      if (!byWeek.has(groupKey)) byWeek.set(groupKey, { key: groupKey, nkhk: item?.nkhk, monday: weekKey, sessions: [] });
      byWeek.get(groupKey).sessions.push(item);
    }
    return [...byWeek.values()]
      .sort((a, b) => {
        if ((a.monday === 'unknown') !== (b.monday === 'unknown')) return a.monday === 'unknown' ? 1 : -1;
        if (a.monday !== b.monday) return a.monday < b.monday ? -1 : 1;
        return String(a.nkhk ?? '') < String(b.nkhk ?? '') ? -1 : 1;
      })
      .map((week) => {
        const days = new Map();
        for (const item of week.sessions) {
          const dateKey = /^\d{4}-\d{2}-\d{2}/.test(String(item?.ngay_hoc ?? '')) ? String(item.ngay_hoc).slice(0, 10) : 'unknown';
          if (!days.has(dateKey)) days.set(dateKey, { key: dateKey, thu: item?.thu, sessions: [] });
          days.get(dateKey).sessions.push(item);
        }
        return {
          ...week,
          title: week.monday === 'unknown' ? 'Chưa rõ ngày học' : `Tuần ${weekRangeLabel(week.monday)}`,
          days: [...days.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
        };
      });
  }, [detail]);
  if (weeks.length === 0) return <p>Chưa có dữ liệu</p>;
  return (
    <>
      {weeks.map((week) => {
        const [termLine, termCode] = termCaption({ nkhk: week.nkhk });
        return (
          <div className="card glass-panel ttcds-panel" key={week.key}>
            <div className="ttcds-panel-head">
              <h2>{week.title}</h2>
              <p className="ttcds-panel-sub">{termLine}{termCode ? ` · ${termCode}` : ''} · {week.sessions.length} buổi học</p>
            </div>
            {week.days.map((day) => (
              <div key={day.key}>
                <h3 className="ttcds-day-head">{day.thu || '—'}{day.key !== 'unknown' ? ` · ${day.key.slice(8, 10)}/${day.key.slice(5, 7)}` : ''}</h3>
                <div className="schedule-grid">
                  {day.sessions.map((item, index) => {
                    const dateKey = String(item?.ngay_hoc ?? '').slice(0, 10);
                    const past = dateKey !== 'unknown' && dateKey < today;
                    const tiet = Number(item?.tiet_bat_dau);
                    const soTiet = Number(item?.so_tiet);
                    const periods = Number.isFinite(tiet)
                      ? `Tiết ${tiet}${Number.isFinite(soTiet) && soTiet > 1 ? `–${tiet + soTiet - 1}` : ''}`
                      : '—';
                    const courseCode = item?.ma_mon_hoc || '—';
                    return (
                      <div
                        key={`${courseCode}-${item?.ma_nhom}-${dateKey}-${tiet}-${index}`}
                        className={`schedule-card glass-panel${past ? ' schedule-card--past' : ''}`}
                      >
                        <div>
                          <div className="schedule-card__eyebrow">
                            <div className="sch-day-badge">
                              <span className="sch-day">{item?.thu || '—'}</span>
                              {day.key !== 'unknown' && <span className="sch-date">{`${day.key.slice(8, 10)}/${day.key.slice(5, 7)}`}</span>}
                            </div>
                            <span className={`sch-status-chip${past ? ' is-past' : ''}`}>
                              {past ? 'Đã học' : dateKey === today ? 'Hôm nay' : 'Sắp tới'}
                            </span>
                          </div>
                          <h4 className="sch-name" title={item?.ten_mon || item?.ten_mon_hoc}>{item?.ten_mon || item?.ten_mon_hoc || courseCode}</h4>
                          <div className="sch-meta">
                            <div className="sch-meta-item"><strong>{periods}</strong></div>
                            {item?.phong || item?.ma_phong ? (
                              <div className="sch-meta-item"><span className="sch-room-pill">{item.phong || item.ma_phong}</span></div>
                            ) : null}
                            {item?.giang_vien || item?.ten_giang_vien ? (
                              <div className="sch-meta-item"><span>{item.giang_vien || item.ten_giang_vien}</span></div>
                            ) : null}
                          </div>
                        </div>
                        <div className="sch-footer">
                          <span className="sch-code">Mã: <code>{courseCode}</code></span>
                          {item?.ma_nhom ? <span className="badge-mini badge-pill-blue">{item.ma_nhom}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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

  // Nhật ký điểm danh từng buổi cho chart tuần — 404 (chưa có dữ liệu) thì
  // ẩn chart, các tile tổng hợp vẫn hiện bình thường.
  const attendanceJournal = useQuery({
    queryKey: ['ttcds-attendance', String(mssv ?? '').toUpperCase()],
    queryFn: ({ signal }) => getTtcdsAttendance(auth.token, mssv, { signal }),
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
        {tab === 'tong-quan' && <OverviewTab detail={data} attendance={attendanceJournal.data || null} />}
        {tab === 'tkb' && <TimetableTab detail={data} />}
        {tab === 'bang-diem' && <GradesTab detail={data} />}
        {tab === 'su-kien' && <EventsTab detail={data} />}
      </div>
    </section>
  );
}
