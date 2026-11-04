import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useToasts } from '../../app/providers.jsx';
import {
  getCatalog,
  getPriority,
  savePriority,
  getRegistered,
  withdraw,
  startRun,
  getRunStatus,
  stopRun,
  submitOtp,
  subscribeRun
} from '../../api/enrollment.js';
import { groupBySubject, moveItem, removeItem, toSavePayload } from './priority.js';
import { DAY_OPTIONS, SESSION_OPTIONS, parseTkb, sessionOf, tkbBadges, tkbMatchesDay, tkbMatchesSession } from './tkb.js';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';

const FILTER_OPTIONS = [
  { value: 10, label: 'Tất cả môn đang mở (không lọc)' },
  { value: 2, label: 'Môn trong CTĐT kế hoạch' },
  { value: 6, label: 'Môn chưa học trong CTĐT kế hoạch' }
];

const RUN_STORAGE_KEY = 'bdu_enrollment_run_id';
const ACTIVE_STATUSES = ['scheduled', 'running', 'otp_required'];

const toInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const defaultTrigger = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(7, 0, 0, 0);
  return date;
};

const normalizeItems = (items) => (items ?? []).map((item) => ({
  maMon: item.maMon ?? item.ma_mon ?? '',
  tenMon: item.tenMon ?? item.ten_mon ?? '',
  soTc: item.soTc ?? item.so_tc ?? null,
  idToHoc: item.idToHoc ?? item.id_to_hoc ?? '',
  nhomTo: item.nhomTo ?? item.nhom_to ?? null,
  lop: item.lop ?? null,
  loai: item.loai === 'du_phong' ? 'du_phong' : 'chinh',
  thuTu: Number(item.thuTu ?? item.thu_tu) || 0
}));

const filterCatalog = (rows, loaiLoc) => {
  if (loaiLoc === 2) return rows.filter((row) => row.isCtdt);
  if (loaiLoc === 6) return rows.filter((row) => row.isChctdt);
  return rows;
};

const capacityTone = (row) => {
  if (!row.slCp) return 'muted';
  const ratio = row.slCl / row.slCp;
  if (ratio <= 0) return 'danger';
  if (ratio < 0.2) return 'warn';
  return 'ok';
};

const statusLabel = {
  scheduled: 'Chờ mở cổng',
  running: 'Đang đăng ký',
  otp_required: 'Chờ OTP',
  done: 'Hoàn tất',
  failed: 'Thất bại',
  stopped: 'Đã dừng'
};

const WEEK_DAYS = [
  { value: 2, label: 'T2' },
  { value: 3, label: 'T3' },
  { value: 4, label: 'T4' },
  { value: 5, label: 'T5' },
  { value: 6, label: 'T6' },
  { value: 7, label: 'T7' },
  { value: 8, label: 'CN' }
];
const WEEK_SESSIONS = [
  { value: 'morning', label: 'Sáng' },
  { value: 'afternoon', label: 'Chiều' },
  { value: 'evening', label: 'Tối' }
];

/* ---------- icons (inline SVG, 18px) ---------- */
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const IconRefresh = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
);
const IconBolt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
);
const IconStop = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
);
const IconUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
);
const IconDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
);
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
);
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const IconCalendar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
);
const IconCheck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
);

function OtpBoxes({ value, onChange, disabled }) {
  const inputsRef = useRef([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const setDigit = (index, raw) => {
    const digit = String(raw).replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit || ' ';
    onChange(next.join('').replace(/\s/g, ' ').trimEnd());
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const text = String(event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    onChange(text);
    inputsRef.current[Math.min(text.length, 5)]?.focus();
  };

  return (
    <div className="enroll-otp-boxes" onPaste={handlePaste}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => { inputsRef.current[index] = element; }}
          className="enroll-otp-box"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Chữ số OTP ${index + 1}`}
          disabled={disabled}
          value={digit.trim()}
          onChange={(event) => setDigit(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index].trim() && index > 0) {
              inputsRef.current[index - 1]?.focus();
            }
          }}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}

export default function EnrollmentPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const withdrawDialogRef = useRef(null);
  const otpDialogRef = useRef(null);
  const logRef = useRef(null);

  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loaiLoc, setLoaiLoc] = useState(10);
  const [search, setSearch] = useState('');
  const [thu, setThu] = useState(0);
  const [buoi, setBuoi] = useState('all');

  const [selected, setSelected] = useState([]);
  const [priorityError, setPriorityError] = useState('');
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [triggerInput, setTriggerInput] = useState(() => toInputValue(defaultTrigger()));
  const [autoFixScheduleConflict, setAutoFixScheduleConflict] = useState(false);
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const [otpOpen, setOtpOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);

  const [registered, setRegistered] = useState(null);
  const [registeredError, setRegisteredError] = useState('');
  const [loadingRegistered, setLoadingRegistered] = useState(true);
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const unsubscribeRef = useRef(null);
  const runIdRef = useRef(null);

  const activeRun = run && ACTIVE_STATUSES.includes(run.status);

  const loadCatalog = useCallback(async () => {
    if (!auth.token) return;
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const data = await getCatalog(auth.token, 10);
      setCatalog(data);
    } catch (error) {
      setCatalogError(error.message || 'Không tải được danh sách môn học.');
    } finally {
      setLoadingCatalog(false);
    }
  }, [auth.token]);

  const loadPriority = useCallback(async () => {
    if (!auth.token) return;
    setPriorityError('');
    try {
      const items = await getPriority(auth.token);
      setSelected(normalizeItems(items));
      setDirty(false);
    } catch (error) {
      setPriorityError(error.message || 'Không tải được danh sách ưu tiên.');
    }
  }, [auth.token]);

  const loadRegistered = useCallback(async () => {
    if (!auth.token) return;
    setLoadingRegistered(true);
    setRegisteredError('');
    try {
      const data = await getRegistered(auth.token);
      setRegistered(data);
    } catch (error) {
      setRegisteredError(error.message || 'Không tải được danh sách đã đăng ký.');
    } finally {
      setLoadingRegistered(false);
    }
  }, [auth.token]);

  useEffect(() => {
    loadCatalog();
    loadPriority();
    loadRegistered();
  }, [loadCatalog, loadPriority, loadRegistered]);

  useEffect(() => {
    if (!auth.token) return;
    const storedId = window.sessionStorage.getItem(RUN_STORAGE_KEY);
    if (!storedId) return;
    getRunStatus(auth.token, storedId)
      .then((status) => {
        if (!status) { window.sessionStorage.removeItem(RUN_STORAGE_KEY); return; }
        setRun(status);
        if (!ACTIVE_STATUSES.includes(status.status)) window.sessionStorage.removeItem(RUN_STORAGE_KEY);
      })
      .catch(() => window.sessionStorage.removeItem(RUN_STORAGE_KEY));
  }, [auth.token]);

  useEffect(() => {
    if (!activeRun) return undefined;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.logs?.length]);

  useEffect(() => {
    const runId = run?.runId;
    if (!runId || !activeRun) return undefined;
    if (unsubscribeRef.current && runIdRef.current === runId) return undefined;
    unsubscribeRef.current?.();
    runIdRef.current = runId;
    unsubscribeRef.current = subscribeRun(runId, {
      onMessage: (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'snapshot' && payload.run) { setRun(payload.run); return; }
        if (payload.type === 'log') {
          setRun((current) => current ? { ...current, logs: [...(current.logs ?? []), payload] } : current);
          return;
        }
        if (payload.type === 'item_done') {
          const line = {
            type: payload.status === 'success' ? 'success' : 'error',
            message: payload.status === 'success'
              ? `✔ ${payload.maMon}${payload.fallbackFrom ? ` (dự phòng, thay cho ${payload.fallbackFrom})` : ''}`
              : `✖ ${payload.maMon}: ${payload.reason ?? 'thất bại'}`,
            timestamp: new Date().toLocaleTimeString('vi-VN')
          };
          setRun((current) => current ? { ...current, logs: [...(current.logs ?? []), line] } : current);
          return;
        }
        if (payload.type === 'otp_required') {
          setOtpOpen(true);
          setOtpCode('');
          setOtpError('');
          return;
        }
        if (payload.type === 'done') {
          setRun((current) => ({ ...(payload.run ?? current), status: payload.run?.status ?? current?.status ?? 'done' }));
          window.sessionStorage.removeItem(RUN_STORAGE_KEY);
          loadRegistered();
          notify(payload.run?.status === 'done' ? 'Lượt đăng ký đã hoàn tất.' : 'Lượt đăng ký kết thúc với lỗi.', payload.run?.status === 'done' ? 'success' : 'warning');
        }
      },
      onError: () => {
        notify('Mất kết nối log realtime. Trạng thái run có thể chưa cập nhật — thử "Làm mới trạng thái".', 'warning');
      }
    });
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      runIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId, activeRun]);

  const refreshRunStatus = useCallback(async () => {
    if (!auth.token || !run?.runId) return;
    try {
      const status = await getRunStatus(auth.token, run.runId);
      if (status) setRun(status);
    } catch (error) {
      notify(error.message || 'Không đọc được trạng thái lượt chạy.', 'error');
    }
  }, [auth.token, run?.runId, notify]);

  const toggleGroup = useCallback((row) => {
    setSelected((current) => {
      const exists = current.some((item) => item.idToHoc === row.idToHoc);
      setDirty(true);
      if (exists) return removeItem(current, row.idToHoc);
      return [...current, {
        maMon: row.maMon,
        tenMon: row.tenMon,
        soTc: row.soTc,
        idToHoc: row.idToHoc,
        nhomTo: row.nhomTo,
        lop: row.lop,
        loai: current.some((item) => item.maMon === row.maMon && item.loai === 'chinh') ? 'du_phong' : 'chinh',
        thuTu: current.length + 1
      }];
    });
  }, []);

  const removeItemFromSelection = useCallback((idToHoc) => {
    setSelected((current) => removeItem(current, idToHoc));
    setDirty(true);
  }, []);

  const moveSelected = useCallback((idToHoc, direction) => {
    setSelected((current) => moveItem(current, idToHoc, direction));
    setDirty(true);
  }, []);

  const makeChinh = useCallback((item) => {
    setSelected((current) => current.map((entry) => {
      if (entry.maMon !== item.maMon) return entry;
      if (entry.idToHoc === item.idToHoc) return { ...entry, loai: 'chinh' };
      if (entry.loai === 'chinh') return { ...entry, loai: 'du_phong' };
      return entry;
    }));
    setDirty(true);
  }, []);

  const saveList = useCallback(async () => {
    if (!auth.token) return;
    setPrioritySaving(true);
    try {
      const saved = await savePriority(auth.token, toSavePayload(selected));
      setSelected(normalizeItems(saved));
      setDirty(false);
      notify('Đã lưu danh sách ưu tiên.', 'success');
    } catch (error) {
      notify(error.message || 'Không lưu được danh sách.', 'error');
    } finally {
      setPrioritySaving(false);
    }
  }, [auth.token, selected, notify]);

  const grouped = useMemo(() => groupBySubject(selected), [selected]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.idToHoc)), [selected]);
  const selectedCredits = useMemo(
    () => selected.filter((item) => item.loai === 'chinh').reduce((sum, item) => sum + (Number(item.soTc) || 0), 0),
    [selected]
  );
  const minCredits = Number(registered?.soTinChiMin) || null;

  // Mini weekly schedule built from the selected groups (joined with the
  // catalog for their TKB). Duplicate id_to_hoc across "tổ" variants is a BDU
  // data quirk; matching id + nhóm picks the first variant.
  const scheduleCells = useMemo(() => {
    const cells = new Map();
    const groups = catalog?.dsNhomTo ?? [];
    for (const item of selected) {
      const group = groups.find((g) => g.idToHoc === item.idToHoc && (!item.nhomTo || g.nhomTo === item.nhomTo));
      for (const segment of parseTkb(group?.tkb ?? '')) {
        const key = `${segment.thu}:${sessionOf(segment)}`;
        if (!cells.has(key)) cells.set(key, new Map());
        cells.get(key).set(item.maMon, { maMon: item.maMon, loai: item.loai });
      }
    }
    return cells;
  }, [selected, catalog]);

  const baseRows = useMemo(() => filterCatalog(catalog?.dsNhomTo ?? [], loaiLoc), [catalog, loaiLoc]);
  const visibleCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseRows.filter((row) => {
      if (q && !`${row.maMon} ${row.tenMon}`.toLowerCase().includes(q)) return false;
      if (!tkbMatchesDay(row.tkb, thu)) return false;
      if (!tkbMatchesSession(row.tkb, buoi)) return false;
      return true;
    });
  }, [baseRows, search, thu, buoi]);

  const monDangMo = useMemo(() => new Set(baseRows.map((row) => row.maMon)).size, [baseRows]);

  const canActivate = selected.length > 0 && !dirty && !activeRun && !starting;

  const handleStart = useCallback(async () => {
    if (!auth.token || !canActivate) return;
    setStarting(true);
    try {
      const when = new Date(triggerInput);
      if (Number.isNaN(when.getTime())) {
        notify('Giờ mở cổng không hợp lệ.', 'error');
        return;
      }
      const result = await startRun(auth.token, { triggerAt: when.toISOString(), autoFixScheduleConflict, refreshToken: auth.refreshToken });
      const runId = result?.runId;
      if (!runId) throw new Error('Server không trả về runId.');
      window.sessionStorage.setItem(RUN_STORAGE_KEY, runId);
      setRun({ runId, status: 'scheduled', triggerAt: when.toISOString(), logs: [], results: [], summary: null, error: null });
      setNowTick(Date.now());
      notify('Đã kích hoạt lượt đăng ký.', 'success');
    } catch (error) {
      notify(error.message || 'Không khởi chạy được.', 'error');
    } finally {
      setStarting(false);
    }
  }, [auth.token, auth.refreshToken, canActivate, triggerInput, autoFixScheduleConflict, notify]);

  const handleStop = useCallback(async () => {
    if (!auth.token || !run?.runId) return;
    try {
      const status = await stopRun(auth.token, run.runId);
      if (status) setRun(status);
      notify('Đã gửi yêu cầu dừng.', 'info');
    } catch (error) {
      notify(error.message || 'Không dừng được lượt chạy.', 'error');
    }
  }, [auth.token, run?.runId, notify]);

  const handleSubmitOtp = useCallback(async () => {
    if (!auth.token || !run?.runId) return;
    const digits = otpCode.replace(/\D/g, '');
    if (digits.length !== 6) {
      setOtpError('Mã OTP phải gồm đúng 6 chữ số.');
      return;
    }
    setOtpSending(true);
    setOtpError('');
    try {
      const result = await submitOtp(auth.token, run.runId, digits);
      if (result?.ok) {
        setOtpOpen(false);
        setOtpError('');
        notify('OTP hợp lệ — tiếp tục đăng ký.', 'success');
      } else {
        setOtpError(`OTP không hợp lệ. Còn ${result?.attemptsLeft ?? 0} lần thử.`);
      }
    } catch (error) {
      setOtpError(error.status === 501
        ? 'Cổng xác thực chưa mở để kích hoạt OTP — bạn vui lòng vào sv.bdu.edu.vn xác thực thủ công rồi bấm "Làm mới trạng thái".'
        : (error.message || 'Không gửi được OTP.'));
    } finally {
      setOtpSending(false);
    }
  }, [auth.token, run?.runId, otpCode, notify]);

  const handleWithdraw = useCallback(async () => {
    if (!auth.token || !withdrawTarget) return;
    setWithdrawing(true);
    try {
      await withdraw(auth.token, withdrawTarget.idToHoc);
      notify('Đã rút môn học.', 'success');
      setWithdrawTarget(null);
      loadRegistered();
    } catch (error) {
      notify(error.message || 'Không rút được môn học.', 'error');
    } finally {
      setWithdrawing(false);
    }
  }, [auth.token, withdrawTarget, notify, loadRegistered]);

  useViewportDialog(Boolean(withdrawTarget), () => setWithdrawTarget(null), withdrawDialogRef);
  useViewportDialog(otpOpen, () => setOtpOpen(false), otpDialogRef);

  const countdown = useMemo(() => {
    if (!run?.triggerAt) return null;
    const diff = new Date(run.triggerAt).getTime() - nowTick;
    if (Number.isNaN(diff)) return null;
    if (diff <= 0) return { text: 'Đã tới giờ — đang chờ server mở…', tone: 'now' };
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { text: `${hours > 0 ? `${hours}h ` : ''}${minutes}p ${String(seconds).padStart(2, '0')}s`, tone: 'wait' };
  }, [run?.triggerAt, nowTick]);

  const gateOpen = catalog?.trongThoiGianDangKy === true;
  const registeredRows = useMemo(() => {
    const list = registered?.dsKqdkmh ?? [];
    return list.map((entry, index) => {
      const toHoc = entry?.to_hoc ?? entry ?? {};
      return {
        key: entry?.id_kqdk ?? toHoc?.id_to_hoc ?? index,
        maMon: toHoc?.ma_mon ?? '',
        tenMon: toHoc?.ten_mon ?? '',
        nhomTo: toHoc?.nhom_to ?? '',
        soTc: toHoc?.so_tc ?? '',
        ngayDangKy: entry?.ngay_dang_ky ?? '',
        trangThai: entry?.trang_thai ?? entry?.trang_thai_duyet ?? '',
        idToHoc: toHoc?.id_to_hoc ?? entry?.id_to_hoc ?? ''
      };
    });
  }, [registered]);

  const registeredCredits = useMemo(
    () => registeredRows.reduce((sum, row) => sum + (Number(row.soTc) || 0), 0),
    [registeredRows]
  );

  const filtersActive = search.trim() !== '' || thu !== 0 || buoi !== 'all';

  return (
    <section id="tab-enrollment" className="tab-pane active">
      <div className="enroll-page">
        {/* ---------- hero ---------- */}
        <header className="enroll-hero">
          <div className="enroll-hero-main">
            <span className="enroll-eyebrow">Đăng ký tín chỉ · BDU</span>
            <h1>Tự động đăng ký môn học</h1>
            <p>
              {catalog?.hocKyDangKy || 'Đang tải thông tin học kỳ…'}
              {catalog?.dienGiaiEnableChung ? <span className="enroll-hero-note"> · {catalog.dienGiaiEnableChung}</span> : null}
            </p>
          </div>
          <div className="enroll-hero-stats">
            <div className="enroll-stat">
              <span className="enroll-stat-value">{monDangMo}</span>
              <span className="enroll-stat-label">môn đang mở</span>
            </div>
            <div className="enroll-stat">
              <span className="enroll-stat-value">{selected.length}</span>
              <span className="enroll-stat-label">đã chọn</span>
            </div>
            <div className="enroll-stat">
              <span className="enroll-stat-value">{minCredits ? `${selectedCredits}/${minCredits}` : selectedCredits}</span>
              <span className="enroll-stat-label">{minCredits ? 'tín chỉ · tối thiểu' : 'tín chỉ đã chọn'}</span>
            </div>
            <div className={`enroll-gate-pill ${gateOpen ? 'is-open' : 'is-closed'}`}>
              <span className="enroll-gate-dot" aria-hidden="true" />
              {gateOpen ? 'Cổng đang mở' : 'Cổng chưa mở'}
            </div>
          </div>
        </header>

        {/* ---------- catalog ---------- */}
        <div className="enroll-card enroll-catalog">
          <div className="enroll-card-head">
            <div>
              <h2>Môn học đang mở</h2>
              <p className="enroll-sub">{visibleCatalog.length} nhóm-tổ{monDangMo ? ` · ${monDangMo} môn` : ''}{filtersActive ? ' · đang lọc' : ''}</p>
            </div>
            <button type="button" className="enroll-ghost" onClick={loadCatalog} disabled={loadingCatalog}>
              <IconRefresh /> {loadingCatalog ? 'Đang tải…' : 'Làm mới'}
            </button>
          </div>

          <div className="enroll-toolbar">
            <label className="enroll-search">
              <IconSearch />
              <input
                type="search"
                placeholder="Tìm mã hoặc tên môn…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="enroll-select">
              <span>Chương trình</span>
              <select value={loaiLoc} onChange={(event) => setLoaiLoc(Number(event.target.value))}>
                {FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="enroll-chip-group" role="group" aria-label="Lọc theo thứ">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`enroll-chip ${thu === option.value ? 'is-active' : ''}`}
                  aria-pressed={thu === option.value}
                  onClick={() => setThu(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="enroll-chip-group" role="group" aria-label="Lọc theo buổi">
              {SESSION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`enroll-chip ${buoi === option.value ? 'is-active' : ''}`}
                  aria-pressed={buoi === option.value}
                  onClick={() => setBuoi(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {catalogError ? <p className="enroll-error">{catalogError}</p> : null}
          {loadingCatalog && !catalog ? <div className="enroll-empty">Đang tải danh sách môn học…</div> : null}
          {catalog && visibleCatalog.length === 0 ? (
            <div className="enroll-empty">
              Không có nhóm-tổ nào khớp bộ lọc.
              {filtersActive ? (
                <button type="button" className="enroll-link" onClick={() => { setSearch(''); setThu(0); setBuoi('all'); }}>
                  Xoá bộ lọc
                </button>
              ) : null}
            </div>
          ) : null}

          {visibleCatalog.length > 0 ? (
            <div className="enroll-table-wrap">
              <table className="enroll-table">
                <thead>
                  <tr>
                    <th className="enroll-col-check"><span className="sr-only">Chọn</span></th>
                    <th>Mã môn</th>
                    <th>Tên môn học</th>
                    <th>Nhóm-tổ</th>
                    <th>Lớp</th>
                    <th>TC</th>
                    <th>Còn lại</th>
                    <th>Lịch học</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCatalog.map((row) => {
                    const checked = selectedIds.has(row.idToHoc);
                    const badges = tkbBadges(row.tkb);
                    const tone = capacityTone(row);
                    const ratio = row.slCp ? Math.max(0, Math.min(1, row.slCl / row.slCp)) : 0;
                    // BDU occasionally returns the same id_to_hoc for two "tổ" variants
                    // (e.g. 01-01 and 01-02). id alone is not unique, so the React key
                    // must include nhóm/tổ to avoid stale rows after filtering.
                    const rowKey = `${row.idToHoc}|${row.nhomTo ?? ''}|${row.to ?? ''}`;
                    return (
                      <tr
                        key={rowKey}
                        className={`${checked ? 'is-selected' : ''} ${row.enable ? '' : 'is-closed'}`}
                        onClick={() => toggleGroup(row)}
                        title={row.enable ? '' : (row.gcEnable || 'Ngoài thời gian cho phép đăng ký')}
                      >
                        <td className="enroll-col-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="enroll-check"
                            checked={checked}
                            aria-label={`Chọn ${row.maMon} nhóm ${row.nhomTo}`}
                            onChange={() => toggleGroup(row)}
                          />
                        </td>
                        <td><span className="enroll-code">{row.maMon}</span></td>
                        <td>
                          <span className="enroll-name">{row.tenMon || '—'}</span>
                          {row.isCtdt ? <span className="enroll-tag">CTĐT</span> : null}
                          {!row.enable ? <span className="enroll-tag is-warn">Ngoài giờ</span> : null}
                        </td>
                        <td>{row.nhomTo}{row.to ? `-${row.to}` : ''}</td>
                        <td className="enroll-muted">{row.lop || '—'}</td>
                        <td>{row.soTc ?? ''}</td>
                        <td>
                          <div className={`enroll-cap is-${tone}`}>
                            <span>{row.slCl}/{row.slCp}</span>
                            <span className="enroll-cap-bar" aria-hidden="true"><span style={{ width: `${ratio * 100}%` }} /></span>
                          </div>
                        </td>
                        <td>
                          <div className="enroll-tkb-chips">
                            {badges.length ? badges.map((badge) => <span key={badge} className="enroll-tkb-chip">{badge}</span>) : <span className="enroll-muted">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ---------- priority + activation ---------- */}
        <div className="enroll-grid">
          <div className="enroll-card">
            <div className="enroll-card-head">
              <div>
                <h2>Danh sách ưu tiên</h2>
                <p className="enroll-sub">{selected.length ? `${grouped.length} môn · ${selected.length} lựa chọn · ${selectedCredits} TC chính` : 'Chưa chọn môn nào'}</p>
              </div>
              <button type="button" className="enroll-primary sm" onClick={saveList} disabled={prioritySaving || selected.length === 0}>
                {prioritySaving ? 'Đang lưu…' : dirty ? 'Lưu thay đổi' : 'Đã lưu'}
                {dirty ? <span className="enroll-dirty-dot" aria-hidden="true" /> : null}
              </button>
            </div>
            {priorityError ? <p className="enroll-error">{priorityError}</p> : null}
            {selected.length === 0 ? (
              <div className="enroll-empty">
                Tick chọn nhóm-tổ ở bảng phía trên. Mỗi môn chọn 1 lớp chính và có thể thêm nhiều lớp dự phòng; thứ tự càng cao càng được ưu tiên.
              </div>
            ) : (
              <div className="enroll-subjects">
                {grouped.map((group) => (
                  <div key={group.maMon} className="enroll-subject">
                    <div className="enroll-subject-head">
                      <span className="enroll-code">{group.maMon}</span>
                      <span className="enroll-subject-name">{group.tenMon || '—'}</span>
                      {group.soTc != null ? <span className="enroll-subject-tc">{group.soTc} TC</span> : null}
                    </div>
                    {[group.chinh, ...group.duPhong].filter(Boolean).map((item) => (
                      <div key={item.idToHoc} className={`enroll-priority-row ${item.loai === 'chinh' ? 'is-chinh' : ''}`}>
                        <span className="enroll-order">#{item.thuTu}</span>
                        <span className={`enroll-pill ${item.loai === 'chinh' ? 'is-chinh' : ''}`}>{item.loai === 'chinh' ? 'Chính' : 'Dự phòng'}</span>
                        <span className="enroll-priority-meta">Nhóm {item.nhomTo}{item.lop ? ` · ${item.lop}` : ''}</span>
                        <span className="enroll-row-actions">
                          <button type="button" className="enroll-icon-btn" aria-label="Đưa lên trước" onClick={() => moveSelected(item.idToHoc, -1)}><IconUp /></button>
                          <button type="button" className="enroll-icon-btn" aria-label="Đưa xuống sau" onClick={() => moveSelected(item.idToHoc, 1)}><IconDown /></button>
                          {item.loai === 'du_phong' ? (
                            <button type="button" className="enroll-text-btn" onClick={() => makeChinh(item)}>Đặt chính</button>
                          ) : null}
                          <button type="button" className="enroll-icon-btn danger" aria-label="Bỏ khỏi danh sách" onClick={() => removeItemFromSelection(item.idToHoc)}><IconTrash /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {dirty ? <p className="enroll-hint">Danh sách chưa lưu — lưu trước khi kích hoạt.</p> : null}
              </div>
            )}
          </div>

          <div className="enroll-side">
            <div className="enroll-card">
              <div className="enroll-card-head">
                <div>
                  <h2>Lịch tuần</h2>
                  <p className="enroll-sub">Sáng · Chiều · Tối theo các môn đã chọn</p>
                </div>
              </div>
              <div className="enroll-mini-wrap">
                <table className="enroll-mini">
                  <thead>
                    <tr>
                      <th className="enroll-mini-corner"><span className="sr-only">Buổi</span></th>
                      {WEEK_DAYS.map((day) => <th key={day.value}>{day.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEK_SESSIONS.map((session) => (
                      <tr key={session.value}>
                        <th scope="row">{session.label}</th>
                        {WEEK_DAYS.map((day) => {
                          const entries = [...(scheduleCells.get(`${day.value}:${session.value}`)?.values() ?? [])];
                          const conflict = entries.length > 1;
                          return (
                            <td
                              key={day.value}
                              className={`enroll-mini-cell${conflict ? ' is-conflict' : ''}`}
                              title={entries.length ? entries.map((entry) => entry.maMon).join(', ') : ''}
                            >
                              {entries.length
                                ? entries.slice(0, 2).map((entry) => (
                                  <span key={entry.maMon} className={`enroll-mini-chip${entry.loai === 'du_phong' ? ' is-duphong' : ''}`}>{entry.maMon}</span>
                                ))
                                : <span className="enroll-mini-empty">·</span>}
                              {entries.length > 2 ? <span className="enroll-mini-more">+{entries.length - 2}</span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="enroll-hint">{selected.length ? 'Ô đỏ = trùng lịch giữa các môn đã chọn.' : 'Chọn môn để xem lịch tuần.'}</p>
            </div>

            <div className="enroll-card enroll-run-card">
            <div className="enroll-card-head">
              <div>
                <h2>Kích hoạt</h2>
                <p className="enroll-sub">Canh giờ mở cổng và tự đăng ký</p>
              </div>
              {run ? <span className={`enroll-status is-${run.status}`}>{statusLabel[run.status] ?? run.status}</span> : null}
            </div>

            <label className="enroll-field">
              <span><IconCalendar /> Giờ mở cổng dự kiến</span>
              <input type="datetime-local" value={triggerInput} onChange={(event) => setTriggerInput(event.target.value)} disabled={activeRun} />
            </label>

            <label className="enroll-switch">
              <input type="checkbox" checked={autoFixScheduleConflict} onChange={(event) => setAutoFixScheduleConflict(event.target.checked)} disabled={activeRun} />
              <span className="enroll-switch-track" aria-hidden="true" />
              <span>
                Tự dọn trùng TKB sau khi chạy
                <small>Tự rút môn ưu tiên thấp hơn nếu 2 môn đã đăng ký trùng lịch. Mặc định tắt.</small>
              </span>
            </label>

            <div className="enroll-run-actions">
              <button type="button" className="enroll-primary" onClick={handleStart} disabled={!canActivate}>
                <IconBolt /> {starting ? 'Đang khởi chạy…' : activeRun ? 'Đang chạy…' : 'Kích hoạt Auto'}
              </button>
              {activeRun ? (
                <button type="button" className="enroll-ghost" onClick={handleStop}><IconStop /> Dừng</button>
              ) : (
                <button type="button" className="enroll-ghost" onClick={refreshRunStatus} disabled={!run?.runId}>
                  <IconRefresh /> Làm mới
                </button>
              )}
            </div>

            {countdown ? (
              <div className={`enroll-countdown is-${countdown.tone}`}>
                <IconClock /> <span>{countdown.text}</span>
              </div>
            ) : null}

            {run ? (
              <div className="enroll-terminal">
                <div className="enroll-terminal-bar" aria-hidden="true"><span /><span /><span /></div>
                <pre ref={logRef} className="enroll-terminal-body" aria-live="polite">
                  {(run.logs ?? []).map((entry, index) => `[${entry.timestamp ?? ''}] ${entry.message ?? ''}`).join('\n') || 'Chưa có log…'}
                </pre>
              </div>
            ) : null}

            {run?.summary?.thanh_cong?.length || run?.summary?.that_bai?.length || run?.summary?.rut?.length ? (
              <div className="enroll-summary">
                {(run.summary?.thanh_cong ?? []).map((item) => <div key={`ok-${item.id_to_hoc}`} className="enroll-summary-row is-ok"><IconCheck /> {item.ma_mon}</div>)}
                {(run.summary?.that_bai ?? []).map((item) => <div key={`fail-${item.id_to_hoc}`} className="enroll-summary-row is-fail">✕ {item.ma_mon} — {item.ly_do}</div>)}
                {(run.summary?.rut ?? []).map((item) => <div key={`rut-${item.id_to_hoc}`} className="enroll-summary-row is-warn">↩ {item.ma_mon} — {item.ly_do}</div>)}
              </div>
            ) : null}

            {run?.error ? <p className="enroll-error">{run.error}</p> : null}
            <p className="enroll-hint">Đúng giờ hẹn tool mới bắt đầu canh cổng và bắn lệnh; trước đó chỉ giữ phiên BDU tươi. Nếu phiên hết hạn hoàn toàn, bạn cần đăng nhập lại (liên kết Discord để nhận cảnh báo).</p>
            </div>
          </div>
        </div>

        {/* ---------- registered ---------- */}
        <div className="enroll-card">
          <div className="enroll-card-head">
            <div>
              <h2>Mô đã đăng ký</h2>
              <p className="enroll-sub">{registeredRows.length ? `${registeredRows.length} môn · ${registeredCredits} TC` : 'Chưa đăng ký môn nào'}</p>
            </div>
            <button type="button" className="enroll-ghost" onClick={loadRegistered} disabled={loadingRegistered}>
              <IconRefresh /> {loadingRegistered ? 'Đang tải…' : 'Làm mới'}
            </button>
          </div>
          {registeredError ? <p className="enroll-error">{registeredError}</p> : null}
          {registeredRows.length === 0 ? (
            <div className="enroll-empty">Chưa đăng ký môn nào trong học kỳ này.</div>
          ) : (
            <div className="enroll-table-wrap">
              <table className="enroll-table">
                <thead>
                  <tr>
                    <th>Mã môn</th>
                    <th>Tên môn học</th>
                    <th>Nhóm-tổ</th>
                    <th>TC</th>
                    <th>Ngày đăng ký</th>
                    <th>Trạng thái</th>
                    <th><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {registeredRows.map((row) => (
                    <tr key={row.key}>
                      <td><span className="enroll-code">{row.maMon}</span></td>
                      <td>{row.tenMon || '—'}</td>
                      <td>{row.nhomTo}</td>
                      <td>{row.soTc}</td>
                      <td className="enroll-muted">{String(row.ngayDangKy).slice(0, 10)}</td>
                      <td>{row.trangThai}</td>
                      <td>
                        {row.idToHoc ? (
                          <button type="button" className="enroll-danger-btn" onClick={() => setWithdrawTarget({ idToHoc: row.idToHoc, label: `${row.maMon} (${row.nhomTo})` })}>
                            Rút
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {withdrawTarget ? (
        <ViewportModal id="enroll-withdraw-modal" title="Xác nhận rút môn" labelledBy="enroll-withdraw-title" onClose={() => setWithdrawTarget(null)} dialogRef={withdrawDialogRef}>
          <div id="enroll-withdraw-title" className="enroll-modal-title">Xác nhận rút môn</div>
          <p className="enroll-modal-text">Bạn có chắc muốn rút <strong>{withdrawTarget.label}</strong>?</p>
          <div className="enroll-modal-actions">
            <button type="button" className="enroll-ghost" onClick={() => setWithdrawTarget(null)} autoFocus>Hủy</button>
            <button type="button" className="enroll-danger-btn lg" onClick={handleWithdraw} disabled={withdrawing}>{withdrawing ? 'Đang rút…' : 'Rút môn'}</button>
          </div>
        </ViewportModal>
      ) : null}

      {otpOpen ? (
        <ViewportModal id="enroll-otp-modal" title="Xác thực OTP" labelledBy="enroll-otp-title" onClose={() => setOtpOpen(false)} dialogRef={otpDialogRef}>
          <div id="enroll-otp-title" className="enroll-modal-title">Nhập mã OTP</div>
          <p className="enroll-modal-text">Server yêu cầu xác thực trước khi đăng ký. Nhập mã 6 chữ số đã gửi tới email/SMS của bạn.</p>
          <OtpBoxes value={otpCode} onChange={setOtpCode} disabled={otpSending} />
          {otpError ? <p className="enroll-error">{otpError}</p> : null}
          <div className="enroll-modal-actions">
            <button type="button" className="enroll-ghost" onClick={() => setOtpOpen(false)}>Để sau</button>
            <button type="button" className="enroll-primary" onClick={handleSubmitOtp} disabled={otpSending || otpCode.replace(/\D/g, '').length !== 6}>
              {otpSending ? 'Đang gửi…' : 'Xác nhận'}
            </button>
          </div>
        </ViewportModal>
      ) : null}
    </section>
  );
}
