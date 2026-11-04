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
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';

const FILTER_OPTIONS = [
  { value: 2, label: 'Môn trong CTĐT kế hoạch' },
  { value: 6, label: 'Môn chưa học trong CTĐT kế hoạch' },
  { value: 10, label: 'Tất cả môn đang mở' }
];

const RUN_STORAGE_KEY = 'bdu_enrollment_run_id';

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

const statusLabel = {
  scheduled: 'Chờ mở cổng',
  running: 'Đang đăng ký',
  otp_required: 'Chờ OTP',
  done: 'Hoàn tất',
  failed: 'Thất bại',
  stopped: 'Đã dừng'
};

export default function EnrollmentPage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const catalogDialogRef = useRef(null);
  const otpDialogRef = useRef(null);
  const withdrawDialogRef = useRef(null);
  const logRef = useRef(null);

  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loaiLoc, setLoaiLoc] = useState(2);
  const [search, setSearch] = useState('');

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

  const activeRun = run && ['scheduled', 'running', 'otp_required'].includes(run.status);

  // --- tải dữ liệu ban đầu --------------------------------------------------
  const loadCatalog = useCallback(async () => {
    if (!auth.token) return;
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const data = await getCatalog(auth.token, 2);
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

  // Restore a run that was already running when the page was last closed.
  useEffect(() => {
    if (!auth.token) return;
    const storedId = window.sessionStorage.getItem(RUN_STORAGE_KEY);
    if (!storedId) return;
    getRunStatus(auth.token, storedId)
      .then((status) => {
        if (!status) { window.sessionStorage.removeItem(RUN_STORAGE_KEY); return; }
        setRun(status);
        if (!['scheduled', 'running', 'otp_required'].includes(status.status)) window.sessionStorage.removeItem(RUN_STORAGE_KEY);
      })
      .catch(() => window.sessionStorage.removeItem(RUN_STORAGE_KEY));
  }, [auth.token]);

  // Tick for the countdown.
  useEffect(() => {
    if (!activeRun) return undefined;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  // Live log auto-scroll.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.logs?.length]);

  // --- subscribe SSE khi có run đang hoạt động --------------------------------
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
        if (payload.type === 'snapshot' && payload.run) {
          setRun(payload.run);
          return;
        }
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

  // --- danh sách ưu tiên ------------------------------------------------------
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

  const visibleCatalog = useMemo(() => {
    const rows = catalog?.dsNhomTo ?? [];
    const filtered = filterCatalog(rows, loaiLoc);
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((row) => `${row.maMon} ${row.tenMon}`.toLowerCase().includes(q));
  }, [catalog, loaiLoc, search]);

  // --- kích hoạt run -----------------------------------------------------------
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
      const triggerAt = when.toISOString();
      const result = await startRun(auth.token, { triggerAt, autoFixScheduleConflict });
      const runId = result?.runId;
      if (!runId) throw new Error('Server không trả về runId.');
      window.sessionStorage.setItem(RUN_STORAGE_KEY, runId);
      setRun({ runId, status: 'scheduled', triggerAt, logs: [], results: [], summary: null, error: null });
      setNowTick(Date.now());
      notify('Đã kích hoạt lượt đăng ký.', 'success');
    } catch (error) {
      notify(error.message || 'Không khởi chạy được.', 'error');
    } finally {
      setStarting(false);
    }
  }, [auth.token, canActivate, triggerInput, autoFixScheduleConflict, notify]);

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
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setOtpError('Mã OTP phải gồm đúng 6 chữ số.');
      return;
    }
    setOtpSending(true);
    setOtpError('');
    try {
      const result = await submitOtp(auth.token, run.runId, otpCode.trim());
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

  // --- rút môn ------------------------------------------------------------------
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

  // --- derived view values -------------------------------------------------------
  const countdown = useMemo(() => {
    if (!run?.triggerAt) return null;
    const diff = new Date(run.triggerAt).getTime() - nowTick;
    if (Number.isNaN(diff)) return null;
    if (diff <= 0) return { text: 'Đã tới giờ — đang chờ server mở…', tone: 'now' };
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { text: `Còn ${hours > 0 ? `${hours} giờ ` : ''}${minutes} phút ${seconds} giây`, tone: 'wait' };
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

  return (
    <section id="tab-enrollment" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <h2 className="section-title">Tự Động Đăng Ký Môn Học</h2>
        <p className="section-desc">
          {catalog?.hocKyDangKy || 'Đang tải thông tin học kỳ…'}
          {' · '}
          <span className={`enroll-gate ${gateOpen ? 'enroll-gate--open' : 'enroll-gate--closed'}`}>
            {gateOpen ? 'ĐANG MỞ' : 'Chưa mở'}
          </span>
          {catalog?.dienGiaiEnableChung ? <span className="enroll-gate-note"> ({catalog.dienGiaiEnableChung})</span> : null}
        </p>
      </div>

      <div className="glass-panel enroll-panel">
        <div className="enroll-panel-head">
          <h3>Môn học đang mở</h3>
          <div className="enroll-filters">
            <select aria-label="Lọc điều kiện" value={loaiLoc} onChange={(event) => setLoaiLoc(Number(event.target.value))}>
              {FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              type="search"
              placeholder="Tìm mã hoặc tên môn…"
              aria-label="Tìm môn học"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={loadCatalog} disabled={loadingCatalog}>
              {loadingCatalog ? 'Đang tải…' : 'Làm mới'}
            </button>
          </div>
        </div>
        {catalogError ? <p className="enroll-error">{catalogError}</p> : null}
        {loadingCatalog && !catalog ? <p className="enroll-empty">Đang tải danh sách môn học…</p> : null}
        {catalog && visibleCatalog.length === 0 ? <p className="enroll-empty">Không có môn nào phù hợp bộ lọc.</p> : null}
        {catalog ? (
          <div className="table-scroll">
            <table className="enroll-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Mã MH</th>
                  <th>Tên môn học</th>
                  <th>Nhóm-Tổ</th>
                  <th>Lớp</th>
                  <th>TC</th>
                  <th>Còn lại</th>
                  <th>Thời khóa biểu</th>
                </tr>
              </thead>
              <tbody>
                {visibleCatalog.map((row) => {
                  const checked = selectedIds.has(row.idToHoc);
                  return (
                    <tr key={row.idToHoc} aria-disabled={!row.enable} className={row.enable ? '' : 'enroll-row-disabled'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${row.maMon} nhóm ${row.nhomTo}`}
                          checked={checked}
                          disabled={!row.enable}
                          title={row.enable ? '' : (row.gcEnable || 'Ngoài thời gian cho phép đăng ký')}
                          onChange={() => toggleGroup(row)}
                        />
                      </td>
                      <td>{row.maMon}</td>
                      <td>{row.tenMon}</td>
                      <td>{row.nhomTo}{row.to ? `-${row.to}` : ''}</td>
                      <td>{row.lop}</td>
                      <td>{row.soTc ?? ''}</td>
                      <td>{row.slCl}/{row.slCp}</td>
                      <td className="enroll-tkb">{row.tkb}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="glass-panel enroll-panel">
        <div className="enroll-panel-head">
          <h3>Danh sách ưu tiên của bạn ({selected.length})</h3>
          <button type="button" className="btn-primary" onClick={saveList} disabled={prioritySaving || selected.length === 0}>
            {prioritySaving ? 'Đang lưu…' : dirty ? 'Lưu danh sách *' : 'Đã lưu'}
          </button>
        </div>
        {priorityError ? <p className="enroll-error">{priorityError}</p> : null}
        {selected.length === 0 ? (
          <p className="enroll-empty">Chưa chọn môn nào. Tick checkbox ở bảng phía trên, xếp thứ tự ưu tiên rồi bấm “Lưu danh sách”.</p>
        ) : (
          <div className="enroll-priority-list">
            {grouped.map((group) => (
              <div key={group.maMon} className="enroll-subject">
                <div className="enroll-subject-head">
                  <strong>{group.maMon}</strong>
                  <span className="enroll-subject-name">{group.tenMon}</span>
                  {group.soTc != null ? <span className="enroll-tc">{group.soTc} TC</span> : null}
                </div>
                {[group.chinh, ...group.duPhong].filter(Boolean).map((item) => (
                  <div key={item.idToHoc} className={`enroll-priority-row${item.loai === 'chinh' ? ' is-chinh' : ' is-duphong'}`}>
                    <span className="enroll-loai">{item.loai === 'chinh' ? 'Chính' : 'Dự phòng'}</span>
                    <span className="enroll-nhom">Nhóm {item.nhomTo}{item.lop ? ` · ${item.lop}` : ''}</span>
                    <span className="enroll-order">#{item.thuTu}</span>
                    <span className="enroll-row-actions">
                      <button type="button" className="btn-icon" aria-label="Đưa lên trước" onClick={() => moveSelected(item.idToHoc, -1)}>↑</button>
                      <button type="button" className="btn-icon" aria-label="Đưa xuống sau" onClick={() => moveSelected(item.idToHoc, 1)}>↓</button>
                      {item.loai === 'du_phong' ? (
                        <button type="button" className="btn-secondary btn-xs" onClick={() => makeChinh(item)}>Đặt làm chính</button>
                      ) : null}
                      <button type="button" className="btn-icon btn-danger" aria-label="Bỏ khỏi danh sách" onClick={() => removeItemFromSelection(item.idToHoc)}>✕</button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {dirty ? <p className="enroll-dirty-note">Danh sách chưa lưu — bấm “Lưu danh sách” trước khi kích hoạt.</p> : null}
      </div>

      <div className="glass-panel enroll-panel">
        <div className="enroll-panel-head">
          <h3>Kích hoạt Auto đăng ký</h3>
          <label className="enroll-trigger">
            Giờ mở cổng dự kiến
            <input type="datetime-local" value={triggerInput} onChange={(event) => setTriggerInput(event.target.value)} disabled={activeRun} />
          </label>
        </div>
        <label className="enroll-check">
          <input type="checkbox" checked={autoFixScheduleConflict} onChange={(event) => setAutoFixScheduleConflict(event.target.checked)} disabled={activeRun} />
          Tự động dọn trùng TKB sau khi chạy (mặc định TẮT) — tự rút môn ưu tiên thấp hơn khi 2 môn đã đăng ký bị trùng lịch
        </label>
        <div className="enroll-activate-row">
          <button type="button" className="btn-primary btn-lg" onClick={handleStart} disabled={!canActivate}>
            {starting ? 'Đang khởi chạy…' : activeRun ? 'Đang chạy…' : 'Kích hoạt Auto'}
          </button>
          {activeRun ? (
            <button type="button" className="btn-secondary" onClick={handleStop}>Dừng</button>
          ) : (
            <button type="button" className="btn-secondary" onClick={refreshRunStatus} disabled={!run?.runId}>Làm mới trạng thái</button>
          )}
          {run ? <span className={`enroll-run-status is-${run.status}`}>{statusLabel[run.status] ?? run.status}</span> : null}
          {countdown ? <span className="enroll-countdown">{countdown.text}</span> : null}
        </div>
        {run ? (
          <div className="enroll-log-wrap">
            <div className="enroll-log-head">
              <span>Live log</span>
              {run.status === 'otp_required' ? <span className="enroll-otp-flag">Cần OTP — kiểm tra popup</span> : null}
            </div>
            <pre ref={logRef} className="enroll-log" aria-live="polite">
              {(run.logs ?? []).map((entry, index) => `[${entry.timestamp ?? ''}] ${entry.message ?? ''}`).join('\n') || 'Chưa có log…'}
            </pre>
            {run.summary?.thanh_cong?.length || run.summary?.that_bai?.length ? (
              <div className="enroll-summary">
                <h4>Kết quả</h4>
                <ul>
                  {(run.summary?.thanh_cong ?? []).map((item) => <li key={item.id_to_hoc} className="is-ok">✔ {item.ma_mon}</li>)}
                  {(run.summary?.that_bai ?? []).map((item) => <li key={item.id_to_hoc} className="is-fail">✖ {item.ma_mon} — {item.ly_do}</li>)}
                  {(run.summary?.rut ?? []).map((item) => <li key={item.id_to_hoc} className="is-warn">↩ {item.ma_mon} — {item.ly_do}</li>)}
                </ul>
              </div>
            ) : null}
            {run.error ? <p className="enroll-error">{run.error}</p> : null}
          </div>
        ) : null}
        <p className="enroll-note">Tool chỉ chạy trong khung giờ BDU cho phép đăng ký. Ngoài giờ, server từ chối và lượt chạy sẽ dừng an toàn.</p>
      </div>

      <div className="glass-panel enroll-panel">
        <div className="enroll-panel-head">
          <h3>Mô đã đăng ký</h3>
          <button type="button" className="btn-secondary" onClick={loadRegistered} disabled={loadingRegistered}>
            {loadingRegistered ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
        {registeredError ? <p className="enroll-error">{registeredError}</p> : null}
        {registered && registeredRows.length === 0 ? <p className="enroll-empty">Chưa đăng ký môn nào.</p> : null}
        {registeredRows.length > 0 ? (
          <div className="table-scroll">
            <table className="enroll-table enroll-table--registered">
              <thead>
                <tr>
                  <th>Mã MH</th>
                  <th>Tên môn học</th>
                  <th>Nhóm-Tổ</th>
                  <th>TC</th>
                  <th>Ngày đăng ký</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {registeredRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.maMon}</td>
                    <td>{row.tenMon}</td>
                    <td>{row.nhomTo}</td>
                    <td>{row.soTc}</td>
                    <td>{String(row.ngayDangKy).slice(0, 10)}</td>
                    <td>{row.trangThai}</td>
                    <td>
                      {row.idToHoc ? (
                        <button type="button" className="btn-danger btn-xs" onClick={() => setWithdrawTarget({ idToHoc: row.idToHoc, label: `${row.maMon} (${row.nhomTo})` })}>
                          Rút
                        </button>
                      ) : <span className="enroll-note">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {withdrawTarget ? (
        <ViewportModal id="enroll-withdraw-modal" title="Xác nhận rút môn" labelledBy="enroll-withdraw-title" onClose={() => setWithdrawTarget(null)} dialogRef={withdrawDialogRef}>
          <div id="enroll-withdraw-title" className="modal-title">Xác nhận rút môn</div>
          <p>Bạn có chắc muốn rút <strong>{withdrawTarget.label}</strong>?</p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setWithdrawTarget(null)} autoFocus>Hủy</button>
            <button type="button" className="btn-danger" onClick={handleWithdraw} disabled={withdrawing}>{withdrawing ? 'Đang rút…' : 'Rút môn'}</button>
          </div>
        </ViewportModal>
      ) : null}

      {otpOpen ? (
        <ViewportModal id="enroll-otp-modal" title="Xác thực OTP" labelledBy="enroll-otp-title" onClose={() => setOtpOpen(false)} dialogRef={otpDialogRef}>
          <div id="enroll-otp-title" className="modal-title">Nhập mã OTP</div>
          <p>Server yêu cầu xác thực trước khi đăng ký. Nhập mã OTP 6 chữ số:</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otpCode}
            onChange={(event) => { setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') handleSubmitOtp(); }}
            className="enroll-otp-input"
            autoFocus
            aria-label="Mã OTP"
          />
          {otpError ? <p className="enroll-error">{otpError}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setOtpOpen(false)}>Để sau</button>
            <button type="button" className="btn-primary" onClick={handleSubmitOtp} disabled={otpSending || otpCode.trim().length !== 6}>
              {otpSending ? 'Đang gửi…' : 'Xác nhận'}
            </button>
          </div>
        </ViewportModal>
      ) : null}
    </section>
  );
}
