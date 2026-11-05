import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, useToasts } from '../../app/providers.jsx';
import {
  getCatalog,
  getPriority,
  getSchedule,
  savePriority,
  getRegistered,
  getFilters,
  withdraw,
  startRun,
  getRunStatus,
  getLatestRun,
  checkSession,
  stopRun,
  subscribeRun
} from '../../api/enrollment.js';
import { groupBySubject, moveItem, removeItem, toSavePayload } from './priority.js';
import CredentialsModal from './CredentialsModal.jsx';
import ScheduleCard from './ScheduleCard.jsx';
import ReminderSettings from '../../components/notifications/ReminderSettings.jsx';
import { filterCatalog } from './catalog-filter.js';
import { checkboxState } from './catalog-selection.js';
import { buildScheduleCells } from './schedule-cells.js';
import { clearRunId, readHiddenRunId, readRunId, saveHiddenRunId, saveRunId } from './run-storage.js';
import { DAY_OPTIONS, SESSION_OPTIONS, tkbBadges, tkbMatchesDay, tkbMatchesSession } from './tkb.js';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';

const FALLBACK_FILTERS = [
  { value: 10, label: 'Lọc theo môn học', isDefault: true },
  { value: 0, label: 'Môn mở theo lớp sinh viên' },
  { value: 2, label: 'Môn trong CTĐT kế hoạch' },
  { value: 6, label: 'Môn chưa học trong CTĐT kế hoạch' },
  { value: 1, label: 'Môn cần học lại (đã rớt)' },
  { value: 3, label: 'Lọc theo khoa quản lý môn học' },
  { value: 4, label: 'Lọc theo lớp' }
];

const ACTIVE_STATUSES = ['scheduled', 'running'];
const TOKEN_SOON_MS = 30 * 60 * 1000;

// Lịch đăng ký là giờ Việt Nam (UTC+7) và không kèm timezone trong chuỗi
// "YYYY-MM-DDTHH:mm" — luôn parse tường minh để server ở múi giờ khác vẫn đúng.
const parseScheduleTime = (value) => new Date(`${value}:00+07:00`);

const formatDateVN = (value) => {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

const formatDateTimeVN = (value) => {
  if (!value) return '';
  const date = parseScheduleTime(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const time = value.slice(11, 16);
  return `${formatDateVN(value)} ${time}`;
};

const formatClockVN = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('vi-VN');
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

const formatConflictPair = (pair) => {
  const label = (entry) => (entry?.tenMon ? `${entry.maMon} (${entry.tenMon})` : entry?.maMon || '?');
  return `${label(pair?.a)} – ${label(pair?.b)}`;
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
  done: 'Hoàn tất',
  failed: 'Thất bại',
  stopped: 'Đã dừng'
};

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

export default function EnrollmentPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const withdrawDialogRef = useRef(null);
  const credentialDialogRef = useRef(null);
  const credentialPasswordRef = useRef(null);
  const logRef = useRef(null);

  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loaiLoc, setLoaiLoc] = useState(2);
  const [filters, setFilters] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedKhoa, setSelectedKhoa] = useState('');
  const [selectedLop, setSelectedLop] = useState('');
  const [search, setSearch] = useState('');
  const [thu, setThu] = useState(0);
  const [buoi, setBuoi] = useState('all');

  const [selected, setSelected] = useState([]);
  const [priorityError, setPriorityError] = useState('');
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [scheduleConflicts, setScheduleConflicts] = useState([]);
  const [dirty, setDirty] = useState(false);

  const [selectedRound, setSelectedRound] = useState('dot1');
  const [autoFixScheduleConflict, setAutoFixScheduleConflict] = useState(false);
  const [watchSlots, setWatchSlots] = useState(false);
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const [credentialOpen, setCredentialOpen] = useState(false);
  const [credentialPassword, setCredentialPassword] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [reminderOpen, setReminderOpen] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState('');
  const [sessionCheck, setSessionCheck] = useState(null);
  const [sessionChecking, setSessionChecking] = useState(false);

  const [registered, setRegistered] = useState(null);
  const [registeredError, setRegisteredError] = useState('');
  const [loadingRegistered, setLoadingRegistered] = useState(true);
  const [schedule, setSchedule] = useState(null);
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const unsubscribeRef = useRef(null);
  const runIdRef = useRef(null);
  const dirtyRef = useRef(false);

  const activeRun = run && ACTIVE_STATUSES.includes(run.status);
  const watching = run?.phase === 'watching' && ACTIVE_STATUSES.includes(run?.status);
  const mssv = auth.user?.mssv ?? '';

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

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

  const loadSchedule = useCallback(async () => {
    if (!auth.token) return;
    try {
      const data = await getSchedule(auth.token);
      if (!data) return;
      setSchedule(data);
    } catch {
      /* lịch chỉ là gợi ý; lỗi tải lịch không chặn trang */
    }
  }, [auth.token]);

  const loadFilters = useCallback(async () => {
    if (!auth.token) return;
    try {
      const list = await getFilters(auth.token);
      if (Array.isArray(list) && list.length) setFilters(list);
    } catch {
      /* giữ bộ lọc fallback khi BDU lỗi */
    }
  }, [auth.token]);

  useEffect(() => {
    loadCatalog();
    loadPriority();
    loadRegistered();
    loadSchedule();
    loadFilters();
  }, [loadCatalog, loadPriority, loadRegistered, loadSchedule, loadFilters]);

  // BDU trả bộ lọc theo tài khoản; giữ "CTĐT kế hoạch" làm mặc định nếu có.
  useEffect(() => {
    if (!filters.length) return;
    setLoaiLoc((current) => (
      filters.some((filter) => filter.value === current)
        ? current
        : (filters.find((filter) => filter.isDefault)?.value ?? filters[0].value)
    ));
  }, [filters]);

  useEffect(() => {
    setSelectedSubject('');
    setSelectedKhoa('');
    setSelectedLop('');
  }, [loaiLoc]);

  useEffect(() => {
    if (!auth.token || !mssv) return undefined;
    let active = true;
    const storedId = readRunId(mssv);

    const restore = async () => {
      if (storedId) {
        try {
          const status = await getRunStatus(auth.token, storedId);
          if (!active) return;
          if (status) {
            setRun(status);
            saveRunId(mssv, status.runId ?? storedId);
            setRestoreNotice('');
            return;
          }
        } catch (error) {
          if (!active) return;
          // 404: server không còn lượt này → thử lượt gần nhất trong DB.
          // Lỗi mạng/5xx: giữ nguyên key, đừng ném mất "tay nắm" để dừng run.
          if (error?.status !== 404) {
            setRestoreNotice('Không kết nối được để khôi phục lượt chạy — vẫn giữ lượt này, bấm "Làm mới" để thử lại.');
            return;
          }
        }
      }
      try {
        const latest = await getLatestRun(auth.token);
        if (!active) return;
        if (latest?.runId && latest.runId !== readHiddenRunId(mssv)) {
          setRun(latest);
          saveRunId(mssv, latest.runId);
          setRestoreNotice('');
        } else {
          if (storedId) clearRunId(mssv);
          setRestoreNotice('');
        }
      } catch (error) {
        if (!active) return;
        if (error?.status === 404) {
          if (storedId) clearRunId(mssv);
          return;
        }
        setRestoreNotice('Không kết nối được để khôi phục lượt chạy — bấm "Làm mới" để thử lại.');
      }
    };

    restore();
    return () => { active = false; };
  }, [auth.token, mssv]);

  useEffect(() => {
    const interval = activeRun ? 1000 : 30_000;
    const timer = window.setInterval(() => setNowTick(Date.now()), interval);
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
        if (payload.type === 'priority_updated') {
          const removed = Array.isArray(payload.removedMaMons) ? payload.removedMaMons : [];
          if (removed.length) {
            setSelected((current) => current.filter((item) => !removed.includes(item.maMon)));
            notify(`Đã gỡ ${removed.length} môn đã đăng ký khỏi danh sách ưu tiên.`, 'info');
          }
          loadRegistered();
          return;
        }
        if (payload.type === 'done') {
          setRun((current) => ({ ...(payload.run ?? current), status: payload.run?.status ?? current?.status ?? 'done' }));
          setRestoreNotice('');
          loadRegistered();
          if (!dirtyRef.current) loadPriority();
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
    if (!auth.token) return;
    try {
      if (run?.runId) {
        try {
          const status = await getRunStatus(auth.token, run.runId);
          if (status) {
            setRun(status);
            saveRunId(mssv, status.runId ?? run.runId);
            setRestoreNotice('');
          }
          return;
        } catch (error) {
          // Run đã bị dọn khỏi RAM nhưng vẫn còn trong DB → đọc bản gần nhất
          // thay vì xoá kết quả người dùng đang xem.
          if (error?.status !== 404) throw error;
        }
      }
      const latest = await getLatestRun(auth.token);
      if (latest?.runId) {
        setRun(latest);
        saveRunId(mssv, latest.runId);
        setRestoreNotice('');
        return;
      }
      clearRunId(mssv);
      setRun(null);
      notify(run?.runId ? 'Lượt đăng ký này không còn trên server.' : 'Chưa có lượt đăng ký nào để hiển thị.', run?.runId ? 'warning' : 'info');
    } catch (error) {
      notify(error.message || 'Không đọc được trạng thái lượt chạy.', 'error');
    }
  }, [auth.token, run?.runId, mssv, notify]);

  const handleHideResult = useCallback(() => {
    if (run?.runId) saveHiddenRunId(mssv, run.runId);
    clearRunId(mssv);
    setRun(null);
    setRestoreNotice('');
  }, [mssv, run?.runId]);

  const handleCheckSession = useCallback(async () => {
    if (!auth.token) return;
    setSessionChecking(true);
    try {
      const result = await checkSession(auth.token);
      setSessionCheck({ ...result, checkedAt: result?.checkedAt || new Date().toISOString() });
      notify(
        result?.gateOpen
          ? `Phiên BDU còn sống · cổng đang mở${result?.hocKy ? ` (${result.hocKy})` : ''}.`
          : 'Phiên BDU còn sống · cổng đang đóng.',
        'success'
      );
    } catch (error) {
      if (error?.status === 401) notify('Phiên BDU đã hết hạn — vui lòng đăng nhập lại.', 'warning');
      else notify(error.message || 'Không kiểm tra được phiên BDU.', 'error');
    } finally {
      setSessionChecking(false);
    }
  }, [auth.token, notify]);

  const toggleGroup = useCallback((row) => {
    setScheduleConflicts([]);
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
    setScheduleConflicts([]);
    setSelected((current) => removeItem(current, idToHoc));
    setDirty(true);
  }, []);

  const moveSelected = useCallback((idToHoc, direction) => {
    setScheduleConflicts([]);
    setSelected((current) => moveItem(current, idToHoc, direction));
    setDirty(true);
  }, []);

  const makeChinh = useCallback((item) => {
    setScheduleConflicts([]);
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
      setSelected(normalizeItems(saved.items));
      setScheduleConflicts(saved.conflicts);
      setDirty(false);
      if (saved.conflicts.length) {
        notify(`Trùng lịch học: ${saved.conflicts.map(formatConflictPair).join('; ')}`, 'warning');
      }
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

  // Lịch tuần dự kiến: từ danh sách ưu tiên đang chọn, ghép TKB từ catalog.
  // Duplicate id_to_hoc across "tổ" variants is a BDU data quirk; matching id +
  // nhóm picks the first variant.
  const plannedCells = useMemo(() => {
    const groups = catalog?.dsNhomTo ?? [];
    const entries = selected.map((item) => {
      const group = groups.find((g) => g.idToHoc === item.idToHoc && (!item.nhomTo || g.nhomTo === item.nhomTo));
      return { maMon: item.maMon, tkb: group?.tkb ?? '', loai: item.loai };
    });
    return buildScheduleCells(entries);
  }, [selected, catalog]);

  const filterOptions = filters.length ? filters : FALLBACK_FILTERS;
  const subjectOptions = useMemo(() => {
    const map = new Map();
    for (const row of catalog?.dsNhomTo ?? []) {
      if (row.maMon && !map.has(row.maMon)) map.set(row.maMon, row.tenMon || '');
    }
    return [...map.entries()]
      .map(([value, name]) => ({ value, label: name ? `${value} — ${name}` : value }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [catalog]);
  const khoaOptions = useMemo(
    () => [...new Set((catalog?.dsNhomTo ?? []).flatMap((row) => row.dsKhoa ?? []))].sort((a, b) => a.localeCompare(b)),
    [catalog]
  );
  const lopOptions = useMemo(
    () => [...new Set((catalog?.dsNhomTo ?? []).flatMap((row) => row.dsLop ?? []))].sort((a, b) => a.localeCompare(b)),
    [catalog]
  );

  const baseRows = useMemo(
    () => filterCatalog(catalog?.dsNhomTo ?? [], {
      loaiLoc,
      studentClass: schedule?.studentClass ?? '',
      subject: selectedSubject,
      khoa: selectedKhoa,
      lop: selectedLop
    }),
    [catalog, loaiLoc, schedule?.studentClass, selectedSubject, selectedKhoa, selectedLop]
  );
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

  // Các đợt đăng ký do nhà trường set cứng — người dùng chỉ chọn đợt, không tự
  // nhập ngày/giờ. Đợt đã qua giờ đóng bị khoá, không kích hoạt được nữa.
  const scheduleRounds = useMemo(() => {
    if (!schedule) return [];
    const build = (slot, id) => {
      if (!slot) return null;
      return {
        id,
        roundLabel: slot.roundLabel,
        label: slot.label,
        opensAt: slot.opensAt,
        closesAt: slot.closesAt,
        rangeText: slot.date
          ? formatDateVN(slot.date)
          : `${formatDateVN(slot.from)} – ${formatDateVN(slot.to)}`,
        closed: Date.now() > parseScheduleTime(slot.closesAt).getTime()
      };
    };
    return [build(schedule.primary, 'dot1'), build(schedule.supplementary, 'bo_sung')].filter(Boolean);
  }, [schedule]);

  useEffect(() => {
    if (!scheduleRounds.length) return;
    setSelectedRound((current) => {
      const picked = scheduleRounds.find((round) => round.id === current);
      if (picked && !picked.closed) return current;
      const next = scheduleRounds.find((round) => !round.closed);
      return next ? next.id : current;
    });
  }, [scheduleRounds]);

  const selectedRoundInfo = scheduleRounds.find((round) => round.id === selectedRound) ?? null;
  const canActivate = selected.length > 0 && !dirty && !activeRun && !starting && Boolean(selectedRoundInfo) && !selectedRoundInfo.closed;

  const handleStart = useCallback(() => {
    if (!canActivate) return;
    setCredentialPassword('');
    setCredentialError('');
    setCredentialOpen(true);
  }, [canActivate]);

  const closeCredentials = useCallback(() => {
    setCredentialPassword('');
    setCredentialError('');
    setCredentialOpen(false);
  }, []);

  const handleConfirmStart = useCallback(async () => {
    if (!auth.token || !canActivate) return;
    const password = credentialPassword.trim();
    if (!password) {
      setCredentialError('Vui lòng nhập mật khẩu BDU.');
      return;
    }
    setStarting(true);
    setCredentialError('');
    try {
      const result = await startRun(auth.token, {
        roundId: selectedRound,
        autoFixScheduleConflict,
        watchSlots,
        refreshToken: auth.refreshToken,
        password
      });
      const runId = result?.runId;
      if (!runId) throw new Error('Server không trả về runId.');
      saveRunId(mssv, runId);
      saveHiddenRunId(mssv, '');
      setRestoreNotice('');
      setCredentialPassword('');
      setCredentialOpen(false);
      setRun({
        runId,
        status: 'scheduled',
        phase: 'registering',
        watchSlots,
        triggerAt: selectedRoundInfo ? `${selectedRoundInfo.opensAt}:00+07:00` : null,
        watchUntil: selectedRoundInfo ? `${selectedRoundInfo.closesAt}:00+07:00` : null,
        logs: [],
        results: [],
        summary: null,
        error: null
      });
      setNowTick(Date.now());
      notify('Đã kích hoạt lượt đăng ký.', 'success');
    } catch (error) {
      setCredentialError(error.message || 'Không khởi chạy được.');
    } finally {
      setStarting(false);
    }
  }, [auth.token, auth.refreshToken, canActivate, selectedRound, selectedRoundInfo, autoFixScheduleConflict, watchSlots, credentialPassword, mssv, notify]);

  const handleStop = useCallback(async () => {
    if (!auth.token || !run?.runId) return;
    try {
      const status = await stopRun(auth.token, run.runId);
      if (status) setRun(status);
      saveRunId(mssv, run.runId);
      notify('Đã gửi yêu cầu dừng.', 'info');
    } catch (error) {
      notify(error.message || 'Không dừng được lượt chạy.', 'error');
    }
  }, [auth.token, run?.runId, mssv, notify]);

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
  useViewportDialog(credentialOpen, closeCredentials, credentialDialogRef, credentialPasswordRef);

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

  const watchCountdown = useMemo(() => (
    watching
      ? `Đang canh slot · thử lại mỗi 60s · tới ${new Date(run.watchUntil).toLocaleString('vi-VN')}`
      : null
  ), [watching, run?.watchUntil]);

  const sessionBadge = useMemo(() => {
    if (!auth.expiresAt) return { tone: 'unknown', text: 'Phiên BDU: chưa rõ hạn' };
    const diff = auth.expiresAt - nowTick;
    if (diff <= 0) return { tone: 'expired', text: 'Phiên BDU đã hết hạn — đăng nhập lại' };
    const totalMinutes = Math.floor(diff / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return {
      tone: diff < TOKEN_SOON_MS ? 'soon' : 'ok',
      text: `Phiên BDU: còn ${hours > 0 ? `${hours}h ` : ''}${minutes}p`
    };
  }, [auth.expiresAt, nowTick]);

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
        idToHoc: toHoc?.id_to_hoc ?? entry?.id_to_hoc ?? '',
        tkb: toHoc?.tkb ?? ''
      };
    });
  }, [registered]);

  const registeredIds = useMemo(
    () => new Set(registeredRows.map((row) => row.idToHoc).filter(Boolean)),
    [registeredRows]
  );

  const registeredCells = useMemo(
    () => buildScheduleCells(registeredRows.map((row) => ({ maMon: row.maMon, tkb: row.tkb }))),
    [registeredRows]
  );

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
              <span>Bộ lọc</span>
              <select value={loaiLoc} onChange={(event) => setLoaiLoc(Number(event.target.value))}>
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {loaiLoc === 10 ? (
              <label className="enroll-select">
                <span>Môn học</span>
                <select value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>
                  <option value="">— Chọn môn —</option>
                  {subjectOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {loaiLoc === 3 ? (
              <label className="enroll-select">
                <span>Khoa</span>
                <select value={selectedKhoa} onChange={(event) => setSelectedKhoa(event.target.value)}>
                  <option value="">— Chọn khoa —</option>
                  {khoaOptions.map((khoa) => <option key={khoa} value={khoa}>{khoa}</option>)}
                </select>
              </label>
            ) : null}
            {loaiLoc === 4 ? (
              <label className="enroll-select">
                <span>Lớp</span>
                <select value={selectedLop} onChange={(event) => setSelectedLop(event.target.value)}>
                  <option value="">— Chọn lớp —</option>
                  {lopOptions.map((lop) => <option key={lop} value={lop}>{lop}</option>)}
                </select>
              </label>
            ) : null}
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
                    const box = checkboxState({ idToHoc: row.idToHoc, selectedIds, registeredIds });
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
                        className={`${box.checked ? 'is-selected' : ''} ${box.registered ? 'is-registered' : ''} ${row.enable ? '' : 'is-closed'}`}
                        onClick={() => { if (!box.registered) toggleGroup(row); }}
                        title={row.enable ? '' : (row.gcEnable || 'Ngoài thời gian cho phép đăng ký')}
                      >
                        <td className="enroll-col-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="enroll-check"
                            checked={box.checked}
                            disabled={box.registered}
                            aria-label={`Chọn ${row.maMon} nhóm ${row.nhomTo}`}
                            onChange={() => toggleGroup(row)}
                          />
                        </td>
                        <td><span className="enroll-code">{row.maMon}</span></td>
                        <td>
                          <span className="enroll-name">{row.tenMon || '—'}</span>
                          {row.isCtdt ? <span className="enroll-tag">CTĐT</span> : null}
                          {box.registered ? <span className="enroll-tag is-ok">Đã ĐK</span> : null}
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
            {scheduleConflicts.length ? (
              <p className="enroll-warning" role="status">
                Trùng lịch học: {scheduleConflicts.map(formatConflictPair).join('; ')}
              </p>
            ) : null}
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
            <div className="enroll-card enroll-run-card">
              <div className="enroll-card-head">
                <div>
                  <h2>Lịch đăng ký &amp; Kích hoạt</h2>
                  <p className="enroll-sub">
                    {schedule ? `${schedule.semesterLabel} · Khóa ${schedule.cohortYear ?? '—'}` : 'Đang tải lịch…'}
                  </p>
                </div>
                {run ? <span className={`enroll-status is-${watching ? 'watching' : run.status}`}>{watching ? 'Đang canh slot' : (statusLabel[run.status] ?? run.status)}</span> : null}
              </div>

              {scheduleRounds.length ? (
                <fieldset className="enroll-schedule-picker" disabled={activeRun}>
                  <legend><IconCalendar /> Chọn đợt đăng ký (lịch cố định của trường)</legend>
                  {scheduleRounds.map((round) => {
                    const checked = round.id === selectedRound;
                    return (
                      <label
                        key={round.id}
                        className={`enroll-schedule-option${checked ? ' is-selected' : ''}${round.closed ? ' is-closed' : ''}`}
                      >
                        <input
                          type="radio"
                          name="enroll-round"
                          value={round.id}
                          checked={checked}
                          onChange={() => setSelectedRound(round.id)}
                          disabled={activeRun || round.closed}
                        />
                        <span className="enroll-schedule-option-body">
                          <span className="enroll-schedule-option-head">
                            <span className="enroll-schedule-round">{round.roundLabel}</span>
                            <span className="enroll-schedule-label">{round.label}</span>
                            {round.closed ? <span className="enroll-pill">Đã đóng</span> : null}
                          </span>
                          <strong>{round.rangeText} · {schedule.hours.open}–{schedule.hours.close}</strong>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="enroll-hint">Chưa tải được lịch đăng ký nên chưa thể kích hoạt.</p>
              )}

              <div className={`enroll-gate-time${selectedRoundInfo && !selectedRoundInfo.closed ? ' is-ready' : ''}`}>
                <IconClock />
                <span>
                  {selectedRoundInfo
                    ? <>Mở cổng lúc <strong>{formatDateTimeVN(selectedRoundInfo.opensAt)}</strong> — không thể tự đổi</>
                    : 'Chưa chọn đợt đăng ký'}
                </span>
              </div>

              <div className={`enroll-session is-${sessionBadge.tone}`}>
                <span className="enroll-session-state">
                  <IconClock /> {sessionBadge.text}
                  {sessionCheck?.checkedAt ? (
                    <small>
                      Đã kiểm tra {formatClockVN(sessionCheck.checkedAt)} · {sessionCheck.gateOpen ? 'cổng mở' : 'cổng đóng'}
                      {sessionCheck.hocKy ? ` · ${sessionCheck.hocKy}` : ''}
                    </small>
                  ) : null}
                </span>
                <button type="button" className="enroll-text-btn" onClick={handleCheckSession} disabled={sessionChecking}>
                  {sessionChecking ? 'Đang kiểm tra…' : 'Kiểm tra phiên'}
                </button>
              </div>

              {restoreNotice ? <p className="enroll-warning" role="status">{restoreNotice}</p> : null}

              <label className="enroll-switch">
                <input type="checkbox" checked={autoFixScheduleConflict} onChange={(event) => setAutoFixScheduleConflict(event.target.checked)} disabled={activeRun} />
                <span className="enroll-switch-track" aria-hidden="true" />
                <span>
                  Tự dọn trùng TKB sau khi chạy
                  <small>Tự rút môn ưu tiên thấp hơn nếu 2 môn đã đăng ký trùng lịch. Mặc định tắt.</small>
                </span>
              </label>

              <label className="enroll-switch">
                <input
                  type="checkbox"
                  checked={activeRun ? run?.watchSlots === true : watchSlots}
                  onChange={(event) => setWatchSlots(event.target.checked)}
                  disabled={activeRun}
                />
                <span className="enroll-switch-track" aria-hidden="true" />
                <span>
                  Canh slot lớp hết chỗ
                  <small>Cứ 1 phút thử lại lớp báo hết chỗ (gồm dự phòng) tới khi đăng ký được hoặc đợt đóng. Mặc định tắt.</small>
                </span>
              </label>

              <div className="enroll-run-actions">
                <button type="button" className="enroll-primary" onClick={handleStart} disabled={!canActivate}>
                  <IconBolt /> {starting ? 'Đang khởi chạy…' : activeRun ? 'Đang chạy…' : 'Kích hoạt Auto'}
                </button>
                {activeRun ? (
                  <button type="button" className="enroll-ghost" onClick={handleStop}><IconStop /> Dừng</button>
                ) : (
                  <button type="button" className="enroll-ghost" onClick={refreshRunStatus}>
                    <IconRefresh /> Làm mới
                  </button>
                )}
                {run && !activeRun ? (
                  <button type="button" className="enroll-ghost" onClick={handleHideResult}>Ẩn kết quả</button>
                ) : null}
              </div>

              <p className="enroll-hint enroll-notify-hint">
                🔔 <strong>Nhận thông báo ngay</strong> khi lượt đăng ký xong hoặc gặp lỗi —{' '}
                <button type="button" className="enroll-text-btn" onClick={() => setReminderOpen(true)}>
                  bật thông báo Discord
                </button>
                .
              </p>

              {watching ? (
                <div className="enroll-countdown">
                  <IconClock /> <span>{watchCountdown}</span>
                </div>
              ) : countdown ? (
                <div className={`enroll-countdown is-${countdown.tone}`}>
                  <IconClock /> <span>{countdown.text}</span>
                </div>
              ) : null}

              {run ? (
                <div className="enroll-terminal">
                  <div className="enroll-terminal-bar" aria-hidden="true"><span /><span /><span /></div>
                  <pre ref={logRef} className="enroll-terminal-body" aria-live="polite">
                    {(run.logs ?? []).map((entry, index) => `${entry.timestamp ? `[${entry.timestamp}] ` : ''}${entry.message ?? ''}`).join('\n') || 'Chưa có log…'}
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
              <p className="enroll-hint">Lịch do nhà trường quy định theo khóa và cập nhật mỗi học kỳ; bạn chỉ chọn đợt, không tự đặt ngày/giờ. Đúng giờ hẹn tool mới bắt đầu canh cổng và bắn lệnh; trước đó chỉ giữ phiên BDU tươi. Nếu phiên hết hạn hoàn toàn, bạn cần đăng nhập lại (liên kết Discord để nhận cảnh báo).</p>
            </div>

          </div>
        </div>

        {/* ---------- weekly schedules ---------- */}
        <div className="enroll-schedules">
          <ScheduleCard
            title="Lịch tuần dự kiến"
            subtitle={selected.length ? `${grouped.length} môn trong danh sách ưu tiên` : 'Chưa chọn môn nào'}
            cells={plannedCells}
            hasEntries={selected.length > 0}
            emptyHint="Chọn môn ở Danh sách ưu tiên để xem lịch dự kiến."
            conflictHint="Ô đỏ = trùng lịch giữa các môn dự kiến."
            note="Lịch dự kiến là lịch của các môn đang chọn để Auto đăng ký."
          />
          <ScheduleCard
            title="Lịch tuần đã đăng ký"
            subtitle={registeredRows.length ? `${registeredRows.length} môn đã đăng ký thành công` : 'Chưa có môn nào'}
            cells={registeredCells}
            hasEntries={registeredRows.length > 0}
            emptyHint="Chưa đăng ký môn nào để dựng lịch tuần."
            conflictHint="Ô đỏ = trùng lịch giữa các môn đã đăng ký."
            note="Lịch đã đăng ký là lịch của các môn đã đăng ký thành công."
          />
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
        <ViewportModal id="enroll-withdraw-modal" title="Xác nhận rút môn" labelledBy="enroll-withdraw-title" onClose={() => setWithdrawTarget(null)} dialogRef={withdrawDialogRef} className="enroll-modal">
          <div id="enroll-withdraw-title" className="enroll-modal-title">Xác nhận rút môn</div>
          <p className="enroll-modal-text">Bạn có chắc muốn rút <strong>{withdrawTarget.label}</strong>?</p>
          <div className="enroll-modal-actions">
            <button type="button" className="enroll-ghost" onClick={() => setWithdrawTarget(null)} autoFocus>Hủy</button>
            <button type="button" className="enroll-danger-btn lg" onClick={handleWithdraw} disabled={withdrawing}>{withdrawing ? 'Đang rút…' : 'Rút môn'}</button>
          </div>
        </ViewportModal>
      ) : null}

      <CredentialsModal
        open={credentialOpen}
        mssv={mssv}
        password={credentialPassword}
        error={credentialError}
        busy={starting}
        onPasswordChange={setCredentialPassword}
        onClose={closeCredentials}
        onSubmit={handleConfirmStart}
        dialogRef={credentialDialogRef}
        passwordRef={credentialPasswordRef}
      />

      {reminderOpen ? createPortal(
        <ReminderSettings onClose={() => setReminderOpen(false)} />,
        document.body
      ) : null}
    </section>
  );
}
