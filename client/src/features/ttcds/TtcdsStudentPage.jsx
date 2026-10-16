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

// --- Tab Thời khóa biểu: lưới tuần kiểu Dashboard ---

// Giờ bắt đầu tiết 1..14, khớp TKB cổng trường. Mỗi tiết 45 phút.
const GIO_TIET = [
  '07:00', '07:45', '08:30', '09:15', '10:00', '13:00', '13:45',
  '14:30', '15:15', '16:00', '17:45', '18:30', '19:15', '20:00'
];
const THU_COLS = [1, 2, 3, 4, 5, 6, 7];
const THU_NAMES = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };

function gioBatDau(tiet) {
  return GIO_TIET[tiet - 1] ?? '';
}

function gioKetThuc(tiet, soTiet = 1) {
  const cuoi = Math.min(tiet + Math.max(soTiet, 1) - 1, GIO_TIET.length);
  const bd = GIO_TIET[cuoi - 1];
  if (!bd) return '';
  const [h, m] = bd.split(':').map(Number);
  const total = h * 60 + m + 45;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function addDaysStr(mondayStr, days) {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function fmtDayMonth(dateStr) {
  const d = parseDay(dateStr);
  return d ? shortDay(d) : '';
}

// thu_kieu_so của kho: 2 = Thứ 2 … 8 = Chủ nhật → ISO 1..7.
function isoDow(item) {
  const v = Number(item?.thu_kieu_so);
  if (Number.isInteger(v) && v >= 2 && v <= 8) return v - 1;
  const m = /^Thứ (\d)$/.exec(String(item?.thu ?? '').trim());
  if (m) return Number(m[1]) - 1;
  if (String(item?.thu ?? '').includes('Chủ nhật')) return 7;
  return null;
}

// Nhãn nhóm gọn: `INF1063_24252_01` → `01`.
function shortGroupLabel(maNhom) {
  const text = String(maNhom ?? '');
  const i = text.lastIndexOf('_');
  return i >= 0 && i < text.length - 1 ? text.slice(i + 1) : text;
}

function attendanceClass(pct) {
  if (pct >= 85) return 'nhan-xanh';
  if (pct >= 75) return 'nhan-vang';
  return 'nhan-do';
}

function TimetableTab({ detail }) {
  const sessions = useMemo(
    () => (Array.isArray(detail?.thoi_khoa_bieu) ? detail.thoi_khoa_bieu : []),
    [detail]
  );
  const perSubject = useMemo(
    () => (Array.isArray(detail?.diem_danh_mon) ? detail.diem_danh_mon : []),
    [detail]
  );

  const dsKy = useMemo(
    () => [...new Set(sessions.map((s) => Number(s?.nkhk)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b),
    [sessions]
  );
  // Học kỳ mặc định là kỳ mới nhất; lựa chọn sai thì rơi về mặc định.
  const [ky, setKy] = useState(null);
  const nkhkChon = ky !== null && dsKy.includes(ky) ? ky : dsKy[dsKy.length - 1] ?? null;

  const dsTuan = useMemo(() => {
    const set = new Set();
    for (const s of sessions) {
      if (Number(s?.nkhk) !== nkhkChon) continue;
      const day = parseDay(s?.ngay_hoc);
      if (day) set.add(mondayKey(day));
    }
    return [...set].sort();
  }, [sessions, nkhkChon]);

  const thisMonday = mondayKey(new Date());
  const [tuan, setTuan] = useState(null);
  const tuanChon = tuan !== null && dsTuan.includes(tuan)
    ? tuan
    : dsTuan.includes(thisMonday) ? thisMonday : dsTuan[0] ?? null;
  const iTuan = tuanChon !== null ? dsTuan.indexOf(tuanChon) : -1;

  const buoiTuan = useMemo(
    () => sessions.filter((s) => Number(s?.nkhk) === nkhkChon && (() => {
      const day = parseDay(s?.ngay_hoc);
      return day ? mondayKey(day) === tuanChon : false;
    })()),
    [sessions, nkhkChon, tuanChon]
  );
  // Buổi không có tiết bắt đầu không vào lưới — liệt kê riêng bên dưới.
  const buoiCaNgay = useMemo(
    () => sessions.filter((s) => Number(s?.nkhk) === nkhkChon && !Number(s?.tiet_bat_dau)),
    [sessions, nkhkChon]
  );
  // Chuyên cần gộp theo môn của kỳ đang xem để in ngay trong ô môn.
  const ccTheoMon = useMemo(() => {
    const map = new Map();
    for (const row of perSubject) {
      if (Number(row?.nkhk) === nkhkChon && Number(row?.so_buoi) > 0 && row?.ma_mon_hoc) {
        map.set(String(row.ma_mon_hoc), row);
      }
    }
    return map;
  }, [perSubject, nkhkChon]);

  if (sessions.length === 0) return <p>Chưa có dữ liệu</p>;
  const [termLine, termCode] = termCaption({ nkhk: nkhkChon });
  return (
    <div className="card glass-panel ttcds-panel">
      <div className="ttcds-panel-head">
        <h2>Thời khóa biểu</h2>
        <p className="ttcds-panel-sub">Lưới theo tuần · Cột Thứ 2 – Chủ nhật, hàng Tiết 1 – 14</p>
      </div>
      <div className="tkb-loc">
        <div>
          <label htmlFor="tkb-hoc-ky">Học kỳ</label>
          <select id="tkb-hoc-ky" value={nkhkChon ?? ''} onChange={(e) => setKy(Number(e.target.value))}>
            {dsKy.map((k) => {
              const [line, code] = termCaption({ nkhk: k });
              return <option key={k} value={k}>{code ? `${line} (${code})` : line}</option>;
            })}
          </select>
        </div>
        <div className="tkb-tuan">
          <label htmlFor="tkb-tuan">Tuần</label>
          <div className="tkb-chon-tuan">
            <button
              type="button"
              className="tkb-mui-ten"
              aria-label="Tuần trước"
              title="Tuần trước"
              disabled={iTuan <= 0}
              onClick={() => setTuan(dsTuan[iTuan - 1])}
            >
              ←
            </button>
            <select
              id="tkb-tuan"
              value={tuanChon ?? ''}
              disabled={dsTuan.length === 0}
              onChange={(e) => setTuan(e.target.value)}
            >
              {dsTuan.map((t, i) => (
                <option key={t} value={t}>
                  {`Tuần ${i + 1} [từ ngày ${fmtDayMonth(t)} đến ngày ${fmtDayMonth(addDaysStr(t, 6))}]`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tkb-mui-ten"
              aria-label="Tuần sau"
              title="Tuần sau"
              disabled={iTuan < 0 || iTuan >= dsTuan.length - 1}
              onClick={() => setTuan(dsTuan[iTuan + 1])}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {buoiTuan.length === 0 ? (
        <p className="tkb-note">Tuần này chưa có lịch học{termLine && termLine !== '—' ? ` · ${termLine}${termCode ? ` ${termCode}` : ''}` : ''}</p>
      ) : (
        <WeekGrid sessions={buoiTuan} monday={tuanChon} attendance={ccTheoMon} />
      )}

      {buoiCaNgay.length > 0 && (
        <>
          <h3 className="ttcds-day-head">Buổi không xếp theo tiết</h3>
          <p className="tkb-note">{buoiCaNgay.map((b) => b?.ten_mon || b?.ten_mon_hoc || b?.ma_mon_hoc).filter(Boolean).join(' · ')}</p>
        </>
      )}
    </div>
  );
}

// Lưới tiết × thứ của đúng một tuần. Môn dài `so_tiet` tiết thì nhảy ô
// (rowSpan), tối đa tới hàng cuối của lưới.
function WeekGrid({ sessions, monday, attendance }) {
  const byCell = new Map();
  for (const item of sessions) {
    const dow = isoDow(item);
    const tiet = Number(item?.tiet_bat_dau);
    if (!dow || !Number.isInteger(tiet) || tiet < 1 || tiet > 14) continue;
    const key = `${dow}-${tiet}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(item);
  }
  const occupied = new Set();
  return (
    <div className="tkb-cuon">
      <table className="tkb-luoi">
        <colgroup>
          <col className="tkb-c-tiet" />
          <col className="tkb-c-gio" />
          {THU_COLS.map((n) => <col key={n} className="tkb-c-ngay" />)}
        </colgroup>
        <thead>
          <tr>
            <th className="tkb-tiet">Tiết</th>
            <th className="tkb-gio">Giờ</th>
            {THU_COLS.map((n, i) => (
              <th key={n} className="tkb-cot-ngay">
                {THU_NAMES[n]}
                <span className="ngay">({fmtDayMonth(addDaysStr(monday, i))})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 14 }, (_, i) => i + 1).map((tiet) => (
            <tr key={tiet}>
              <td className="tkb-tiet">Tiết {tiet}</td>
              <td className="tkb-gio">{gioBatDau(tiet)}</td>
              {THU_COLS.map((dow) => {
                const key = `${dow}-${tiet}`;
                if (occupied.has(key)) return null;
                const cell = byCell.get(key);
                if (!cell || cell.length === 0) return <td key={dow} className="tkb-trong" />;
                const soTiet = Math.max(...cell.map((b) => Number(b?.so_tiet) || 1), 1);
                const rowSpan = Math.min(soTiet, 14 - tiet + 1);
                const compact = rowSpan === 1;
                for (let j = 1; j < rowSpan; j++) occupied.add(`${dow}-${tiet + j}`);
                return (
                  <td key={dow} rowSpan={rowSpan} className="tkb-o">
                    {cell.map((item, index) => {
                      const cc = item?.ma_mon_hoc ? attendance.get(String(item.ma_mon_hoc)) : undefined;
                      const pct = cc && Number(cc.so_buoi) > 0 ? (100 * Number(cc.di_hoc)) / Number(cc.so_buoi) : null;
                      const name = item?.ten_mon || item?.ten_mon_hoc || item?.ma_mon_hoc || '—';
                      return (
                        <div className="tkb-mon" key={`${item?.ma_nhom}-${index}`}>
                          <div className="ten">
                            {name} <span className="ma">({item?.ma_mon_hoc || '—'})</span>
                          </div>
                          {!compact && <div className="ct">Nhóm: {shortGroupLabel(item?.ma_nhom)}</div>}
                          {!compact && (item?.phong || item?.ma_phong) && (
                            <div className="ct">Phòng: {item.phong || item.ma_phong}</div>
                          )}
                          {!compact && (item?.giang_vien || item?.ten_giang_vien) && (
                            <div className="ct">GV: {item.giang_vien || item.ten_giang_vien}</div>
                          )}
                          <div className="ct gio">
                            <span className="icon-gio" aria-hidden="true">◷</span>{' '}
                            {gioBatDau(tiet)} → {gioKetThuc(tiet, soTiet)}
                          </div>
                          {pct !== null && (
                            <div className="ct cc">
                              Có mặt{' '}
                              <span className={attendanceClass(pct)}>
                                {cc.di_hoc}/{cc.so_buoi} buổi · {Math.round(pct)}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
