/**
 * EnrollmentRunManager — server-side execution of an auto-enrollment run.
 *
 * The bearer token lives only in this object's RAM while a run is active and
 * is dropped the moment the run reaches a terminal state. Runs never survive
 * a process restart; stale rows are marked failed by failStaleRuns().
 */
import { randomUUID } from 'node:crypto';
import {
  classifyRegisterResult,
  EnrollmentService
} from './enrollment.service.js';
import { pickFallbacks } from './enrollment-priority.js';
import { parseTkb, groupsConflict } from './enrollment-tkb.js';
import { priorityStore } from './priority-store.js';
import { EnrollmentNotifyService } from './enrollment-notify.service.js';

const ACTIVE_STATUSES = new Set(['scheduled', 'running']);
// Rows in DB from before the OTP removal may still carry 'otp_required'. They
// are treated as recoverable so getLatestForStudent can close them as failed.
const RECOVERABLE_STATUSES = new Set(['scheduled', 'running', 'otp_required']);
const MAX_LOGS = 300;
// Server khởi động lại giữa lúc đang canh slot: vòng canh cần token chỉ sống
// trong RAM nên lượt này không thể tiếp tục — đánh failed thay vì resume.
const WATCHING_RESTART_ERROR = 'Server khởi động lại khi đang canh slot — lượt này không thể tiếp tục.';
const RETRY_BACKOFF = [200, 500, 1200];
const GATE_LIMIT_AFTER_MS = 5 * 60 * 1000;
// Kiểm tra token định kỳ trong lúc chờ cổng. Token BDU sống ~5h, nên mỗi 8h
// kiểm tra một lần: nếu đã hết hạn/sắp hết hạn thì refresh, refresh lỗi thì
// đăng nhập lại bằng mật khẩu đang giữ trong RAM.
const TOKEN_CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const LOGIN_LEAD_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 3;
const WATCH_INTERVAL_MS = 60_000;
const WATCH_GATE_PAUSE_MS = 15 * 60_000;
const WATCH_HEARTBEAT_MS = 5 * 60_000;
const WATCH_CATALOG_REFRESH_MS = 10 * 60_000;
// Trạng thái cổng là chung cho cả trường, nên mọi run đang chờ dùng chung một
// lần dò: thay vì mỗi run gọi BDU 2 lần/giây (mỗi lần tải cả catalog), chỉ một
// request mỗi GATE_TTL_MS cho toàn bộ process. 500ms giữ nguyên độ trễ phát
// hiện cổng mở như cách poll cũ, nhưng chi phí không còn tăng theo số run.
const GATE_TTL_MS = 500;
// Giới hạn số request đồng thời bắn sang BDU. Mỗi request w-locdsnhomto nặng
// ~500KB, nên 8 request cùng lúc đã đủ làm căng VPS 2 vCPU/4GB. Khoảng cách
// tối thiểu 25ms giữ trần ~40 request/giây để BDU không chặn IP.
const BDU_MAX_CONCURRENT = 8;
const BDU_MIN_INTERVAL_MS = 25;

const intEnv = (name, fallback, min) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value >= min ? value : fallback;
};

/**
 * FIFO limiter: `maxConcurrent` việc chạy song song, mỗi việc cách nhau ít nhất
 * `minIntervalMs`. Dùng `now`/`sleep` của manager để test bằng đồng hồ ảo.
 */
export const createBduLimiter = ({ maxConcurrent, minIntervalMs, now, sleep }) => {
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  const gap = Math.max(0, Number(minIntervalMs) || 0);
  let active = 0;
  let nextSlotAt = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit || queue.length === 0) return;
    const task = queue.shift();
    active += 1;
    // Đặt lịch ngay (không đợi await) để các việc kế tiếp nhận slot đúng thứ tự.
    const startAt = Math.max(now(), nextSlotAt);
    nextSlotAt = startAt + gap;
    (async () => {
      try {
        const waitMs = startAt - now();
        if (waitMs > 0) await sleep(waitMs);
        task.resolve(await task.fn());
      } catch (error) {
        task.reject(error);
      } finally {
        active -= 1;
        pump();
      }
    })();
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
};

const tokenExpiresAtFrom = (nowMs, expiresIn) => {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? nowMs + seconds * 1000 : null;
};

const httpError = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const clip = (value, max = 160) => String(value ?? '').slice(0, max);

// BDU regenerates `id_to_hoc` when a registration round opens, so a list saved
// before the gate opens points at ids the server no longer knows. The portal
// answers those with `is_thanh_cong: false, thong_bao_loi: "Warning"`.
const isStaleIdResponse = (res) => /^warning$/i.test(String(res?.thongBaoLoi || res?.rawMessage || '').trim());

const asIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Epoch-ms → ISO. Dùng cho `watchUntilMs` (null khi không bật canh slot).
const msToIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// Dựng payload giống `serialize()` từ row trong DB, để UI khôi phục được lượt
// chạy đã xong kể cả khi nó không còn trong RAM (F5, mở tab khác, restart).
const summaryToLogs = (summary) => {
  if (!summary) return [];
  const entries = [];
  for (const item of summary.thanh_cong ?? []) {
    entries.push({ type: 'success', message: `✔ ${item.ma_mon}` });
  }
  for (const item of summary.that_bai ?? []) {
    entries.push({ type: 'error', message: `✖ ${item.ma_mon}: ${item.ly_do ?? 'thất bại'}` });
  }
  for (const item of summary.rut ?? []) {
    entries.push({ type: 'warning', message: `↩ ${item.ma_mon}: ${item.ly_do ?? 'đã rút'}` });
  }
  return entries;
};

export function serializeStoredRun(row) {
  if (!row) return null;
  const summary = row.summary && typeof row.summary === 'object' ? row.summary : null;
  const storedLogs = Array.isArray(row.logs) ? row.logs : [];
  // `phase`/`watchSlots`/`watchUntilMs` nằm trong cột state JSON (không có
  // migration mới). Lượt cũ không có state → coi như đang ở pha đăng ký.
  const state = row.state && typeof row.state === 'object' ? row.state : {};
  return {
    runId: row.id,
    status: row.status,
    triggerAt: asIso(row.trigger_at),
    startedAt: asIso(row.started_at),
    updatedAt: asIso(row.finished_at) ?? asIso(row.started_at) ?? asIso(row.created_at),
    finishedAt: asIso(row.finished_at),
    snapshotCount: Array.isArray(row.snapshot) ? row.snapshot.length : 0,
    // Lượt cũ (trước migration 071) không có logs — dựng lại từ summary để
    // người dùng vẫn đọc được kết quả thay vì thấy "Chưa có log".
    logs: storedLogs.length ? storedLogs : summaryToLogs(summary),
    results: Array.isArray(row.results) ? row.results : [],
    summary: summary
      ? {
        ...summary,
        thanh_cong: [...(summary.thanh_cong ?? [])],
        that_bai: [...(summary.that_bai ?? [])],
        fallback: [...(summary.fallback ?? [])],
        rut: [...(summary.rut ?? [])],
        canh_slot: [...(summary.canh_slot ?? [])]
      }
      : null,
    phase: state.phase ?? 'registering',
    watchSlots: state.watchSlots === true,
    watchUntil: msToIso(state.watchUntilMs),
    error: row.error ?? (summary?.reason === 'server_restart'
      ? 'Server đã khởi động lại khi lượt chạy đang diễn ra. Lượt này không thể tiếp tục — hãy chạy lại.'
      : null)
  };
}

export class EnrollmentRunManager {
  constructor({ service, store, sleep, now, notify, retentionMs = 30 * 60 * 1000, gateTtlMs, bduMaxConcurrent, bduMinIntervalMs, watchIntervalMs } = {}) {
    this.service = service ?? new EnrollmentService();
    this.store = store ?? priorityStore;
    this.notify = notify ?? EnrollmentNotifyService;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = now ?? (() => Date.now());
    this.retentionMs = retentionMs;
    this.watchIntervalMs = Number.isSafeInteger(watchIntervalMs) && watchIntervalMs >= 1000
      ? watchIntervalMs
      : intEnv('ENROLLMENT_WATCH_INTERVAL_MS', WATCH_INTERVAL_MS, 1000);
    this.runs = new Map();
    this.activeRunByMssv = new Map();
    this.listeners = new Map();
    // Cổng dùng chung: cache kết quả dò + promise đang bay để gộp mọi run.
    this.gateTtlMs = Number.isSafeInteger(gateTtlMs) && gateTtlMs > 0
      ? gateTtlMs
      : intEnv('ENROLLMENT_GATE_TTL_MS', GATE_TTL_MS, 100);
    this.gateCache = { value: null, expiresAt: 0 };
    this.gateInflight = null;
    this.gateInflightToken = '';
    // Hàng đợi nội bộ cho request ra BDU (login, catalog, đăng ký, rút).
    this.bduLimiter = createBduLimiter({
      maxConcurrent: Number.isSafeInteger(bduMaxConcurrent) && bduMaxConcurrent > 0
        ? bduMaxConcurrent
        : intEnv('ENROLLMENT_BDU_MAX_CONCURRENT', BDU_MAX_CONCURRENT, 1),
      minIntervalMs: Number.isSafeInteger(bduMinIntervalMs) && bduMinIntervalMs >= 0
        ? bduMinIntervalMs
        : intEnv('ENROLLMENT_BDU_MIN_INTERVAL_MS', BDU_MIN_INTERVAL_MS, 0),
      now: this.now,
      sleep: this.sleep
    });
    // Việc phục hồi run active được gọi từ startJobs() (chỉ worker chính),
    // không tự chạy trong constructor để tránh mỗi worker cùng resume.
    this.resumeStarted = false;
    this.resumePromise = null;
  }

  bduCall(fn) {
    return this.bduLimiter(fn);
  }

  /**
   * Đọc trạng thái cổng qua cache dùng chung. Trước đây mỗi run gọi BDU
   * 2 lần/giây; gộp lại còn ~2 request/giây cho cả process, và một request
   * lỗi chỉ ảnh hưởng run sở hữu token đó.
   */
  async checkGate(token) {
    if (this.gateCache.value !== null && this.now() < this.gateCache.expiresAt) {
      return this.gateCache.value;
    }
    if (!this.gateInflight) {
      this.gateInflightToken = token;
      this.gateInflight = (async () => {
        try {
          const open = (await this.bduCall(() => this.service.getGateStatus(token))) === true;
          this.gateCache = { value: open, expiresAt: this.now() + this.gateTtlMs };
          return open;
        } finally {
          this.gateInflight = null;
        }
      })();
    }
    try {
      return await this.gateInflight;
    } catch (error) {
      // Lỗi (401/5xx) không được gán cho mọi run: chỉ run dùng token vừa gọi
      // phải xử lý (refresh), các run khác coi như cổng còn đóng và thử lại.
      if (this.gateInflightToken === token) throw error;
      return false;
    }
  }

  serialize(run) {
    if (!run) return null;
    return {
      runId: run.id,
      status: run.status,
      triggerAt: new Date(run.triggerAtMs).toISOString(),
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      snapshotCount: run.snapshot.length,
      logs: run.logs.map((entry) => ({ ...entry })),
      results: run.results.map((entry) => ({ ...entry })),
      summary: run.summary ? { ...run.summary, thanh_cong: [...run.summary.thanh_cong], that_bai: [...run.summary.that_bai], fallback: [...run.summary.fallback], rut: [...run.summary.rut], canh_slot: [...(run.summary.canh_slot ?? [])] } : null,
      // Pha hiện tại của lượt chạy: 'registering' (đang đăng ký) hoặc 'watching'
      // (đang canh slot). UI dùng để đổi nhãn trạng thái.
      phase: run.phase ?? 'registering',
      watchSlots: run.watchSlots === true,
      watchUntil: msToIso(run.watchUntilMs),
      error: run.error || null
    };
  }

  prune() {
    const cutoff = this.now() - this.retentionMs;
    for (const [runId, run] of this.runs) {
      if (ACTIVE_STATUSES.has(run.status)) continue;
      if (new Date(run.updatedAt).getTime() > cutoff) continue;
      this.runs.delete(runId);
      this.listeners.delete(runId);
    }
  }

  getForStudent(runId, mssv) {
    this.prune();
    const run = this.runs.get(String(runId));
    if (!run || run.mssv !== String(mssv)) return null;
    return this.serialize(run);
  }

  hasRun(runId) {
    this.prune();
    return this.runs.has(String(runId));
  }

  /**
   * Khôi phục lượt gần nhất của sinh viên từ DB. Run đang ở trạng thái active
   * nhưng không còn trong RAM nghĩa là process đã restart — token chỉ sống
   * trong RAM nên lượt đó không thể tiếp tục; đánh dấu failed thay vì hiển thị
   * một trạng thái "đang chạy" giả.
   */
  async getLatestForStudent(mssv) {
    if (typeof this.store.getLatestRun !== 'function') return null;
    const row = await this.store.getLatestRun(String(mssv));
    if (!row) return null;
    const live = this.runs.get(String(row.id));
    if (live) return this.serialize(live);
    if (RECOVERABLE_STATUSES.has(row.status)) {
      // Lượt đang ở pha canh slot không phục hồi được sau restart (token chỉ
      // sống trong RAM) — đánh dấu failed, không resume.
      const phase = row.state && typeof row.state === 'object' ? row.state.phase : null;
      const watching = phase === 'watching';
      if (!watching) {
        // Nếu startup resume chưa chạy hoặc row này chưa được nạp, thử phục hồi
        // ngay tại đây. Thành công thì trả run live; thất bại mới đánh dấu failed.
        try {
          const resumed = await this.resumeRun(row);
          if (resumed) return resumed;
        } catch {
          /* fall through to mark failed */
        }
      }
      const summary = { ...(row.summary && typeof row.summary === 'object' ? row.summary : {}), reason: 'server_restart' };
      const finishedAt = nowIso();
      // Lượt bị restart cắt ngang lúc đang canh slot: ghi đúng lý do đó (không
      // phải lỗi chung của restart) để người dùng hiểu vì sao lượt này dừng.
      const error = watching ? WATCHING_RESTART_ERROR : row.error;
      try {
        await this.store.updateRun(row.id, { status: 'failed', summary, finished_at: finishedAt, logs: row.logs ?? [], error });
        await this.store.deleteCredential?.(row.id);
      } catch { /* hiển thị trạng thái suy ra vẫn đúng dù ghi DB lỗi */ }
      return serializeStoredRun({ ...row, status: 'failed', summary, finished_at: finishedAt, error });
    }
    return serializeStoredRun(row);
  }

  async start({ mssv, token, refreshToken = '', password = '', items, triggerAt, autoFixScheduleConflict = false, svNganh = 1, tokenExpiresIn = null, watchSlots = false, watchUntil = null }) {
    this.prune();
    const studentId = String(mssv || '').trim();
    if (!studentId) throw httpError(401, 'Không xác định được sinh viên cho lượt đăng ký.');
    if (!token) throw httpError(401, 'Thiếu mã xác thực (Token).');
    const secret = String(password || '').trim();
    if (!secret) throw httpError(400, 'Thiếu mật khẩu BDU để đăng nhập lại trước giờ mở.');
    const triggerAtMs = triggerAt instanceof Date ? triggerAt.getTime() : new Date(triggerAt).getTime();
    if (!Number.isFinite(triggerAtMs)) throw httpError(400, 'triggerAt không hợp lệ.');
    // Bật canh slot thì bắt buộc có mốc đóng đợt — không có mốc thì vòng canh
    // không bao giờ kết thúc được.
    const watchUntilMs = watchUntil ? new Date(watchUntil).getTime() : null;
    if (watchSlots === true && !Number.isFinite(watchUntilMs)) {
      throw httpError(400, 'Thiếu thời điểm đóng đợt cho canh slot.');
    }
    // Copy each item so re-mapping ids on the snapshot never mutates the
    // caller's array (the controller may still hold it).
    const snapshot = Array.isArray(items) ? items.map((item) => ({ ...item })).sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0)) : [];
    if (snapshot.length === 0) throw httpError(400, 'Danh sách ưu tiên đang trống. Hãy lưu danh sách trước khi kích hoạt.');

    const currentId = this.activeRunByMssv.get(studentId);
    const current = currentId ? this.runs.get(currentId) : null;
    if (current && ACTIVE_STATUSES.has(current.status)) {
      return { run: this.serialize(current), reused: true };
    }

    const id = randomUUID();
    const startedAt = null;
    const run = {
      id,
      mssv: studentId,
      token,
      refreshToken: String(refreshToken || ''),
      password: secret,
      loginAtMs: triggerAtMs - LOGIN_LEAD_MS,
      loginAttempts: 0,
      loginDone: false,
      loginRetryAtMs: null,
      passwordInvalid: false,
      snapshot,
      autoFixScheduleConflict: autoFixScheduleConflict === true,
      svNganh: Number(svNganh) || 1,
      triggerAtMs,
      status: 'scheduled',
      startedAt,
      updatedAt: nowIso(),
      finishedAt: null,
      logs: [],
      results: [],
      summaryAcc: { thanh_cong: [], that_bai: [], fallback: [], rut: [], canh_slot: [] },
      summary: null,
      error: null,
      // Pha hiện tại: 'registering' khi đang đăng ký, 'watching' khi đang canh
      // slot. Nằm trong state JSON để còn đọc được sau khi server restart.
      phase: 'registering',
      watchSlots: watchSlots === true,
      watchUntilMs: Number.isFinite(watchUntilMs) ? watchUntilMs : null,
      // Môn đã gỡ khỏi danh sách ưu tiên — chặn gọi lặp khi finishRun chạy nhiều lần.
      cleanedMaMons: new Set(),
      // Bộ nhớ tạm của vòng canh slot (chỉ trong RAM, không ghi DB).
      watchDropped: new Set(),
      watchGaveUp: new Set(),
      watchAttempts: new Map(),
      watchCatalogRefreshAtMs: 0,
      lastWatchLogAtMs: 0,
      stopRequested: false,
      lastIdRs: '',
      refreshCount: 0,
      lastRefreshAt: this.now(),
      lastTokenCheckAt: this.now(),
      tokenExpiresAtMs: tokenExpiresAtFrom(this.now(), tokenExpiresIn),
      authExpired: false,
      staleIdRetried: false,
      restartCount: 0
    };

    // Persist run + encrypted credential before running anything. The run row
    // doubles as the audit log; the credential row is what lets a restart
    // resume the run without asking the user to type the password again.
    if (typeof this.store.insertRunWithCredential === 'function') {
      await this.store.insertRunWithCredential({
        id,
        mssv: studentId,
        status: 'scheduled',
        triggerAt: new Date(triggerAtMs),
        snapshot,
        password: secret
      });
    } else {
      // Tương thích store cũ/test cũ chưa có credential vault.
      await this.store.insertRun({ id, mssv: studentId, status: 'scheduled', triggerAt: new Date(triggerAtMs), snapshot });
    }

    this.runs.set(id, run);
    this.activeRunByMssv.set(studentId, id);
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    await this.persistRun(run);
    queueMicrotask(() => {
      this.execute(id).catch((error) => {
        const target = this.runs.get(id);
        if (!target) return;
        this.finishRun(target, 'failed', { error: clip(error?.message || error || 'Lỗi không xác định') });
      });
    });
    return { run: this.serialize(run), reused: false };
  }

  stop(runId, mssv) {
    const run = this.runs.get(String(runId));
    if (!run || run.mssv !== String(mssv)) return null;
    run.stopRequested = true;
    this.appendLog(run, 'warning', 'Bạn đã yêu cầu dừng lượt chạy. Các môn chưa xử lý sẽ không được đăng ký.');
    this.updateRun(run, {});
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    return this.serialize(run);
  }

  summaryOf(run) {
    return {
      thanh_cong: [...(run.summaryAcc?.thanh_cong ?? [])],
      that_bai: [...(run.summaryAcc?.that_bai ?? [])],
      fallback: [...(run.summaryAcc?.fallback ?? [])],
      rut: [...(run.summaryAcc?.rut ?? [])],
      // Thống kê canh slot: mỗi môn đã canh được ghi { ma_mon, id_to_hoc, so_lan_thu }.
      canh_slot: [...(run.summaryAcc?.canh_slot ?? [])]
    };
  }

  stateOf(run) {
    return {
      lastIdRs: run.lastIdRs ?? '',
      loginDone: run.loginDone === true,
      passwordInvalid: run.passwordInvalid === true,
      tokenExpiresAtMs: run.tokenExpiresAtMs ?? null,
      refreshCount: run.refreshCount ?? 0,
      lastRefreshAt: run.lastRefreshAt ?? null,
      lastTokenCheckAt: run.lastTokenCheckAt ?? null,
      staleIdRetried: run.staleIdRetried === true,
      svNganh: Number(run.svNganh) || 1,
      autoFixScheduleConflict: run.autoFixScheduleConflict === true,
      phase: run.phase ?? 'registering',
      watchSlots: run.watchSlots === true,
      watchUntilMs: Number.isFinite(run.watchUntilMs) ? run.watchUntilMs : null,
      summaryAcc: this.summaryOf(run)
    };
  }

  summaryAccFromResults(results = []) {
    // KHÔNG thêm `canh_slot` vào đây: resumeRun() hợp nhất bằng Object.assign,
    // thêm key rỗng sẽ xoá mất các môn đã canh slot của lượt chạy bị khôi phục.
    const acc = { thanh_cong: [], that_bai: [], fallback: [], rut: [] };
    for (const item of Array.isArray(results) ? results : []) {
      if (item?.status === 'success') {
        acc.thanh_cong.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc });
      } else if (item?.status === 'failed') {
        // Giữ luôn mã lý do máy đọc được khi dựng lại summary từ results
        // (run được khôi phục sau restart).
        acc.that_bai.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc, ly_do: item.reason ?? 'thất bại', code: item.code ?? 'failed' });
      }
    }
    return acc;
  }

  // Ghi tiến độ thật xuống DB sau mỗi môn/trạng thái để restart không mất lượt.
  async persistRun(run) {
    if (!run || typeof this.store?.updateRun !== 'function') return;
    try {
      await this.store.updateRun(run.id, {
        status: run.status,
        summary: this.summaryOf(run),
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        logs: run.logs,
        error: run.error,
        results: run.results,
        state: this.stateOf(run),
        restart_count: run.restartCount ?? 0
      });
    } catch (error) {
      this.appendLog(run, 'warning', `Không ghi được tiến độ vào DB: ${clip(error?.message || error)}`);
    }
  }

  /**
   * Quét các run đang active trong DB và phục hồi. Chỉ gọi từ worker chính
   * (startJobs) để tránh nhiều process cùng resume một run.
   */
  async resumeActiveRuns() {
    if (this.resumeStarted) return this.resumePromise;
    this.resumeStarted = true;
    this.resumePromise = (async () => {
      if (typeof this.store?.listActiveRuns !== 'function') return;
      let rows = [];
      try {
        rows = await this.store.listActiveRuns();
      } catch (error) {
        console.warn('[enrollment] Không quét được run active:', error.message);
        return;
      }
      for (const row of rows) {
        try {
          // Lượt đang ở pha canh slot không thể phục hồi sau restart: token
          // chỉ sống trong RAM và vòng canh cần token đó để dò chỗ. Đánh dấu
          // failed thay vì resume để không bắn request sai.
          if (row?.state?.phase === 'watching') {
            await this.markRunFailed(row, new Error(WATCHING_RESTART_ERROR));
            continue;
          }
          await this.resumeRun(row);
        } catch (error) {
          await this.markRunFailed(row, error);
        }
      }
      if (typeof this.store?.deleteOrphanCredentials === 'function') {
        await this.store.deleteOrphanCredentials(7).catch(() => {});
      }
    })();
    return this.resumePromise;
  }

  async resumeRun(row) {
    const id = String(row?.id || '');
    if (!id) throw new Error('Row run không hợp lệ.');
    if (this.runs.has(id)) return this.serialize(this.runs.get(id));

    const password = await this.store.getRunPassword?.(id);
    if (!password) throw new Error('Không tìm thấy mật khẩu đã lưu cho lượt chạy.');

    const triggerAtMs = row.trigger_at ? new Date(row.trigger_at).getTime() : NaN;
    if (!Number.isFinite(triggerAtMs)) throw new Error('Lượt chạy thiếu giờ mở hợp lệ.');

    const state = row.state && typeof row.state === 'object' ? row.state : {};
    const results = Array.isArray(row.results) ? row.results : [];
    const summaryAcc = {
      thanh_cong: Array.isArray(state.summaryAcc?.thanh_cong) ? state.summaryAcc.thanh_cong : [],
      that_bai: Array.isArray(state.summaryAcc?.that_bai) ? state.summaryAcc.that_bai : [],
      fallback: Array.isArray(state.summaryAcc?.fallback) ? state.summaryAcc.fallback : [],
      rut: Array.isArray(state.summaryAcc?.rut) ? state.summaryAcc.rut : [],
      canh_slot: Array.isArray(state.summaryAcc?.canh_slot) ? state.summaryAcc.canh_slot : []
    };
    if (!summaryAcc.thanh_cong.length && !summaryAcc.that_bai.length && results.length) {
      Object.assign(summaryAcc, this.summaryAccFromResults(results));
    }

    const run = {
      id,
      mssv: String(row.mssv),
      token: null,
      refreshToken: '',
      password,
      loginAtMs: triggerAtMs - LOGIN_LEAD_MS,
      loginAttempts: 0,
      loginDone: false,
      loginRetryAtMs: null,
      passwordInvalid: false,
      snapshot: Array.isArray(row.snapshot) ? row.snapshot : [],
      autoFixScheduleConflict: state.autoFixScheduleConflict === true,
      svNganh: Number(state.svNganh) || 1,
      triggerAtMs,
      status: row.status,
      startedAt: asIso(row.started_at),
      updatedAt: nowIso(),
      finishedAt: asIso(row.finished_at),
      logs: Array.isArray(row.logs) ? row.logs : [],
      results,
      summaryAcc,
      summary: row.summary && typeof row.summary === 'object' ? row.summary : null,
      error: row.error ?? null,
      stopRequested: false,
      lastIdRs: state.lastIdRs || '',
      refreshCount: 0,
      lastRefreshAt: this.now(),
      lastTokenCheckAt: this.now(),
      tokenExpiresAtMs: null,
      authExpired: false,
      staleIdRetried: false,
      // Pha + cấu hình canh slot đọc lại từ state (không có migration mới).
      phase: state.phase ?? 'registering',
      watchSlots: state.watchSlots === true,
      watchUntilMs: Number.isFinite(state.watchUntilMs) ? state.watchUntilMs : null,
      cleanedMaMons: new Set(),
      watchDropped: new Set(),
      watchGaveUp: new Set(),
      watchAttempts: new Map(),
      watchCatalogRefreshAtMs: 0,
      lastWatchLogAtMs: 0,
      restartCount: Number(row.restart_count || 0) + 1
    };

    this.runs.set(id, run);
    this.activeRunByMssv.set(run.mssv, id);
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    this.appendLog(run, 'warning', 'Server khởi động lại — đã khôi phục lượt chạy từ DB.');
    await this.persistRun(run);

    if (run.status === 'scheduled') {
      queueMicrotask(() => {
        this.execute(id).catch((error) => {
          const target = this.runs.get(id);
          if (target) this.finishRun(target, 'failed', { error: clip(error?.message || error) });
        });
      });
    } else if (run.status === 'running') {
      queueMicrotask(() => {
        this.resumeRunning(run).catch((error) => {
          this.finishRun(run, 'failed', { error: clip(error?.message || error) });
        });
      });
    }
    return this.serialize(run);
  }

  async resumeRunning(run) {
    this.appendLog(run, 'info', 'Tiếp tục lượt đăng ký sau khi server khởi động lại.');
    let login = await this.loginWithPassword(run);
    let retries = 0;
    while (login === 'transient' && retries < 2 && !run.stopRequested) {
      retries += 1;
      await this.sleep(1_000);
      login = await this.loginWithPassword(run);
    }
    if (login !== 'ok') {
      await this.finishRun(run, 'failed', { error: 'Không đăng nhập lại được sau khi server khởi động lại.' });
      return;
    }
    run.loginDone = true;

    let gateOpen = false;
    try {
      gateOpen = await this.checkGate(run.token);
    } catch (error) {
      if ((error?.status === 401 || error?.code === 'AUTH_EXPIRED') && await this.tryRefresh(run, { allowPassword: true })) {
        gateOpen = await this.checkGate(run.token).catch(() => false);
      }
    }
    if (!gateOpen) {
      await this.finishRun(run, 'failed', { error: 'Cổng đã đóng khi server khởi động lại — không thể tiếp tục.' });
      return;
    }

    this.updateRun(run, { status: 'running', startedAt: run.startedAt ?? nowIso() });
    await this.persistRun(run);
    await this.refreshCatalogIds(run);
    await this.persistRun(run);

    const processed = new Set();
    const markProcessed = (entry) => {
      if (entry?.ma_mon) processed.add(`mon:${entry.ma_mon}`);
      if (entry?.id_to_hoc) processed.add(`id:${entry.id_to_hoc}`);
    };
    for (const item of run.summaryAcc.thanh_cong) markProcessed(item);
    for (const item of run.summaryAcc.that_bai) markProcessed(item);
    for (const item of run.summaryAcc.fallback) {
      markProcessed(item);
      if (item.tu_id_to_hoc) processed.add(`id:${item.tu_id_to_hoc}`);
      if (item.sang_id_to_hoc) processed.add(`id:${item.sang_id_to_hoc}`);
    }

    const allItems = [...run.snapshot].sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0));
    const chinhItems = allItems.filter((item) => item.loai === 'chinh');
    for (const item of chinhItems) {
      if (run.stopRequested) break;
      if (processed.has(`mon:${item.maMon}`) || processed.has(`id:${item.idToHoc}`)) {
        this.appendLog(run, 'info', `${item.maMon}: đã xử lý trước khi restart — bỏ qua.`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const fatal = await this.registerSubject(run, item, allItems);
      await this.persistRun(run);
      if (fatal === 'stopped') { await this.finishRun(run, 'stopped'); return; }
      if (fatal) { await this.finishRun(run, 'failed', { error: fatal }); return; }
      await this.sleep(100);
    }

    await this.finishRegistrationPhase(run);
  }

  async markRunFailed(row, error) {
    const id = String(row?.id || '');
    const message = clip(error?.message || error || 'Không phục hồi được lượt chạy.');
    this.runs.delete(id);
    if (this.activeRunByMssv.get(String(row?.mssv)) === id) {
      this.activeRunByMssv.delete(String(row?.mssv));
    }
    try {
      await this.store.updateRun(id, {
        status: 'failed',
        error: message,
        summary: {
          ...(row.summary && typeof row.summary === 'object' ? row.summary : {}),
          reason: 'resume_failed'
        },
        finished_at: nowIso(),
        logs: Array.isArray(row.logs) ? row.logs : [],
        results: Array.isArray(row.results) ? row.results : [],
        state: row.state && typeof row.state === 'object' ? row.state : {}
      });
      await this.store.deleteCredential?.(id);
      Promise.resolve(this.notify?.notifyRunFailed?.({
        mssv: row?.mssv,
        runId: id,
        message: `⚠️ Không phục hồi được lượt auto đăng ký: ${message}`
      })).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  /**
   * Thông tin an toàn về lượt đang chạy (không trả password/token) — dùng cho
   * API nội bộ của bot Discord.
   */
  getActiveRunInfo(mssv) {
    const id = this.activeRunByMssv.get(String(mssv));
    const run = id ? this.runs.get(id) : null;
    if (!run || !ACTIVE_STATUSES.has(run.status)) return null;
    return {
      runId: run.id,
      status: run.status,
      triggerAt: new Date(run.triggerAtMs).toISOString(),
      hasPassword: Boolean(run.password)
    };
  }

  /**
   * Test login bằng mật khẩu đang giữ trong RAM cho lượt active. Chỉ dùng cho
   * API nội bộ có secret; token trả về chỉ để controller đọc danh sách môn,
   * không được đưa ra ngoài.
   */
  async testActiveCredentials(mssv) {
    const id = this.activeRunByMssv.get(String(mssv));
    const run = id ? this.runs.get(id) : null;
    if (!run || !ACTIVE_STATUSES.has(run.status)) return { active: false };

    const base = {
      active: true,
      runId: run.id,
      runStatus: run.status,
      triggerAt: new Date(run.triggerAtMs).toISOString()
    };

    // Đang đăng ký: không login lại để tránh đổi token giữa chừng.
    if (run.status === 'running') {
      return { ...base, status: 'running', token: run.token };
    }
    if (!run.password) return { ...base, status: 'no_password' };

    try {
      const next = await this.bduCall(() => this.service.login(run.mssv, run.password));
      run.token = next.token;
      if (next.refreshToken) run.refreshToken = next.refreshToken;
      run.tokenExpiresAtMs = tokenExpiresAtFrom(this.now(), next.expiresIn);
      run.lastRefreshAt = this.now();
      run.lastTokenCheckAt = this.now();
      run.loginAttempts = 0;
      run.refreshCount = 0;
      return { ...base, status: 'active', token: next.token };
    } catch (error) {
      if (error?.status === 401) {
        return { ...base, status: 'inactive', message: error.message || 'Mật khẩu BDU không đúng.' };
      }
      return { ...base, status: 'unavailable', message: error?.message || 'Không đăng nhập thử được.' };
    }
  }

  subscribe(runId, listener) {
    const key = String(runId);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    const run = this.runs.get(key);
    if (run) { try { listener({ type: 'snapshot', run: this.serialize(run) }); } catch { /* listener of a dead SSE is harmless */ } }
    return () => this.listeners.get(key)?.delete(listener);
  }

  emit(run, event) {
    this.listeners.get(run.id)?.forEach((listener) => {
      try { listener(event); } catch { /* closed SSE response is harmless */ }
    });
  }

  appendLog(run, type, message) {
    const entry = { type, message: clip(message, 300), timestamp: new Date().toLocaleTimeString('vi-VN') };
    run.logs = [...run.logs, entry].slice(-MAX_LOGS);
    this.updateRun(run, {});
    this.emit(run, { type: 'log', ...entry });
  }

  updateRun(run, fields) {
    Object.assign(run, fields, { updatedAt: nowIso() });
  }

  recordItem(run, item, status, reason, fallbackFrom, reasonCode) {
    const entry = {
      maMon: item.maMon,
      tenMon: item.tenMon,
      idToHoc: item.idToHoc,
      nhomTo: item.nhomTo ?? null,
      thuTu: item.thuTu,
      status,
      reason: reason ? clip(reason) : undefined,
      fallbackFrom: fallbackFrom ?? undefined,
      // Mã lý do máy đọc được (seat_full, prereq, otp...). Watcher dùng nó để
      // biết môn nào hết chỗ mà không phải đoán lại từ chuỗi tiếng Việt.
      code: reasonCode
    };
    run.results.push(entry);
    if (status === 'success') {
      run.summaryAcc.thanh_cong.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc });
    } else {
      run.summaryAcc.that_bai.push({
        ma_mon: item.maMon,
        id_to_hoc: item.idToHoc,
        ly_do: clip(reason || 'thất bại'),
        code: reasonCode ?? 'failed'
      });
    }
    // Ghi log ngay tại đây để log trong DB có đủ kết quả từng môn — UI không
    // phải tự sinh lại dòng log từ sự kiện item_done nữa.
    this.appendLog(
      run,
      status === 'success' ? 'success' : 'error',
      status === 'success'
        ? `✔ ${item.maMon}${fallbackFrom ? ` (dự phòng, thay cho ${fallbackFrom})` : ''}`
        : `✖ ${item.maMon}: ${reason || 'thất bại'}`
    );
    this.emit(run, { type: 'item_done', ...entry });
  }

  // Đăng nhập lại bằng MSSV + mật khẩu (chỉ RAM). Trả:
  // - 'ok'        token mới đã thay vào run
  // - 'fatal'     mật khẩu sai (401) — run phải dừng
  // - 'transient' lỗi mạng/5xx hoặc đã chạm MAX_LOGIN_ATTEMPTS — thử lại sau
  async loginWithPassword(run) {
    if (!run.password) return 'fatal';
    if ((run.loginAttempts ?? 0) >= MAX_LOGIN_ATTEMPTS) return 'transient';
    try {
      const next = await this.bduCall(() => this.service.login(run.mssv, run.password));
      if (!next?.token) return 'transient';
      run.token = next.token;
      if (next.refreshToken) run.refreshToken = next.refreshToken;
      run.tokenExpiresAtMs = tokenExpiresAtFrom(this.now(), next.expiresIn);
      run.lastRefreshAt = this.now();
      run.lastTokenCheckAt = this.now();
      run.loginAttempts = 0;
      run.refreshCount = 0;
      run.passwordInvalid = false;
      run.loginRetryAtMs = null;
      this.appendLog(run, 'success', 'Đã kiểm tra và đăng nhập lại BDU trước giờ mở.');
      return 'ok';
    } catch (error) {
      // Chỉ lỗi mới tiêu ngân sách; login thành công không chặn lần login T−5.
      run.loginAttempts = (run.loginAttempts ?? 0) + 1;
      if (error?.status === 401) {
        run.passwordInvalid = true;
        this.appendLog(run, 'error', 'Mật khẩu BDU không đúng.');
        return 'fatal';
      }
      run.loginRetryAtMs = run.triggerAtMs;
      this.appendLog(run, 'warning', 'Không đăng nhập lại được BDU (lỗi tạm thời) — sẽ thử lại đúng giờ mở.');
      return 'transient';
    }
  }

  // A run can outlive the 5-hour access token (e.g. scheduled today for
  // tomorrow). Try the RAM-only refresh token first. Password login is only a
  // fallback on a real auth failure (`allowPassword`), never for the periodic
  // hourly refresh — otherwise a long wait would burn the login budget.
  async tryRefresh(run, { allowPassword = false } = {}) {
    if (run.refreshToken && (run.refreshCount ?? 0) < 3) {
      run.refreshCount = (run.refreshCount ?? 0) + 1;
      try {
        const next = await this.bduCall(() => this.service.refreshSession(run.refreshToken));
        if (next?.token) {
          run.token = next.token;
          if (next.refreshToken) run.refreshToken = next.refreshToken;
          run.tokenExpiresAtMs = tokenExpiresAtFrom(this.now(), next.expiresIn);
          run.lastRefreshAt = this.now();
          run.lastTokenCheckAt = this.now();
          run.refreshCount = 0;
          run.loginAttempts = 0;
          this.appendLog(run, 'info', 'Đã gia hạn phiên BDU để tiếp tục chờ/đăng ký.');
          return true;
        }
      } catch {
        /* fall through to a password login when allowed */
      }
    }
    if (!allowPassword || !run.password) return false;
    return (await this.loginWithPassword(run)) === 'ok';
  }

  /**
   * Re-map the saved priority list onto the ids the portal is serving right
   * now. Matching goes by mã môn + nhóm tổ (the class code may shift), with
   * TKB as a tie-breaker, so a list saved before the round opened still
   * registers the same class instead of failing with "Warning".
   *
   * Returns the number of changed items, or -1 when the catalog is unavailable.
   */
  async refreshCatalogIds(run) {
    if (typeof this.service.getCatalog !== 'function') return 0;
    let catalog;
    try {
      catalog = await this.bduCall(() => this.service.getCatalog(run.token, { forceRefresh: true }));
    } catch {
      return -1;
    }
    const byMaNhom = new Map();
    for (const group of catalog?.dsNhomTo ?? []) {
      const key = `${group.maMon}|${group.nhomTo}`;
      if (!byMaNhom.has(key)) byMaNhom.set(key, []);
      byMaNhom.get(key).push(group);
    }
    let changed = 0;
    for (const item of run.snapshot) {
      const candidates = byMaNhom.get(`${item.maMon}|${item.nhomTo}`) ?? [];
      // TKB is the strongest signal (nhóm tổ duplicates share maMon+nhóm but
      // differ by tổ/lịch); lớp is only trusted when it is unambiguous.
      const byTkb = candidates.find((group) => group.tkb && group.tkb === item.tkb);
      const byLop = candidates.filter((group) => group.lop && group.lop === item.lop);
      const match = byTkb
        ?? (byLop.length === 1 ? byLop[0] : null)
        ?? (candidates.length === 1 ? candidates[0] : null);
      if (!match?.idToHoc) continue;
      if (item.idToHoc !== match.idToHoc) changed += 1;
      item.idToHoc = match.idToHoc;
      if (match.lop) item.lop = match.lop;
      if (match.tkb) item.tkb = match.tkb;
    }
    if (changed > 0) {
      this.appendLog(run, 'info', `BDU đã cấp lại mã lớp khi mở cổng — đã cập nhật ${changed} môn trong danh sách ưu tiên.`);
    }
    return changed;
  }

  // One attempt + up to 3 retries, only for transient/rate-limit classes.
  async attemptRegister(run, item, isChecked) {
    for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt += 1) {
      let res;
      try {
        res = await this.bduCall(() => this.service.registerGroup(run.token, {
          idToHoc: item.idToHoc,
          isChecked,
          svNganh: run.svNganh,
          idRs: run.lastIdRs
        }));
      } catch (error) {
        const isAuth = error?.status === 401 || error?.code === 'AUTH_EXPIRED';
        if (isAuth && await this.tryRefresh(run, { allowPassword: true })) {
          continue;
        }
        if (isAuth) {
          run.authExpired = true;
          return { cls: 'auth', error };
        }
        if (attempt < RETRY_BACKOFF.length) {
          await this.sleep(RETRY_BACKOFF[attempt]);
          continue;
        }
        return { cls: 'transient', error };
      }
      if (res?.idRs) run.lastIdRs = res.idRs;
      const cls = classifyRegisterResult(res);
      if (cls === 'auth') {
        if (await this.tryRefresh(run, { allowPassword: true })) continue;
        run.authExpired = true;
        return { cls, res };
      }
      if ((cls === 'transient' || cls === 'rate_limit') && attempt < RETRY_BACKOFF.length) {
        await this.sleep(RETRY_BACKOFF[attempt]);
        continue;
      }
      return { cls, res };
    }
    return { cls: 'transient' };
  }

  async registerSubject(run, item, allItems) {
    let outcome = await this.attemptRegister(run, item, true);

    // Safety net: if the portal still says "Warning" (id no longer valid),
    // refresh the catalog once and retry the same item with the new id.
    if (outcome.cls === 'rejected' && isStaleIdResponse(outcome.res) && !run.staleIdRetried) {
      run.staleIdRetried = true;
      const changed = await this.refreshCatalogIds(run);
      if (changed > 0) outcome = await this.attemptRegister(run, item, true);
    }

    if (outcome.cls === 'otp') {
      const login = await this.loginWithPassword(run);
      if (login === 'ok') outcome = await this.attemptRegister(run, item, true);
    }

    if (outcome.cls === 'thanh_cong') {
      this.recordItem(run, item, 'success');
      return null;
    }

    if (outcome.cls === 'already_registered') {
      this.recordItem(run, item, 'success');
      return null;
    }

    if (outcome.cls === 'seat_full') {
      const fallbacks = pickFallbacks(allItems, item.maMon);
      for (const fallback of fallbacks) {
        this.appendLog(run, 'info', `${item.maMon} hết chỗ — thử dự phòng ${fallback.idToHoc}.`);
        // eslint-disable-next-line no-await-in-loop
        const fb = await this.attemptRegister(run, fallback, true);
        if (fb.cls === 'thanh_cong') {
          this.recordItem(run, fallback, 'success', undefined, item.idToHoc);
          run.summaryAcc.fallback.push({ ma_mon: fallback.maMon, tu_id_to_hoc: item.idToHoc, sang_id_to_hoc: fallback.idToHoc });
          return null;
        }
        if (['prereq', 'gate_closed', 'auth', 'over_credit'].includes(fb.cls)) {
          this.appendLog(run, 'error', `Dự phòng ${fallback.idToHoc} thất bại: ${fb.cls}.`);
          break;
        }
        if (fb.cls === 'otp') {
          this.appendLog(run, 'error', 'Nhóm dự phòng bị yêu cầu OTP — thử nhóm dự phòng kế tiếp.');
          continue;
        }
        // seat_full / rejected / transient / schedule_conflict → try next backup
      }
      this.recordItem(run, item, 'failed', 'hết chỗ (kể cả dự phòng)', undefined, 'seat_full');
      return null;
    }

    if (outcome.cls === 'otp') {
      this.recordItem(run, item, 'failed', 'BDU yêu cầu OTP — không thể tự xử lý, vui lòng đăng ký thủ công', undefined, 'otp');
      return null;
    }

    if (outcome.cls === 'prereq') {
      const detail = outcome.res?.rawMessage || outcome.res?.thongBaoTienQuyet || 'thiếu tiên quyết';
      this.recordItem(run, item, 'failed', detail, undefined, 'prereq');
      return null;
    }
    if (outcome.cls === 'schedule_conflict') {
      this.recordItem(run, item, 'failed', 'trùng lịch', undefined, 'schedule_conflict');
      return null;
    }
    if (outcome.cls === 'over_credit') {
      const reason = outcome.res?.rawMessage || outcome.res?.thongBaoLoi || 'vượt quá số tín chỉ tối đa';
      this.recordItem(run, item, 'failed', reason, undefined, 'over_credit');
      return null;
    }
    if (outcome.cls === 'gate_closed') {
      this.recordItem(run, item, 'failed', 'ngoài thời gian', undefined, 'gate_closed');
      return 'Ngoài thời gian cho phép đăng ký';
    }
    if (outcome.cls === 'auth') {
      this.appendLog(run, 'error', 'Phiên đăng nhập hết hạn giữa chừng. Vui lòng đăng nhập lại.');
      this.recordItem(run, item, 'failed', 'phiên hết hạn', undefined, 'auth');
      return 'Phiên đăng nhập hết hạn';
    }
    if (outcome.cls === 'rejected') {
      const reason = isStaleIdResponse(outcome.res)
        ? 'mã lớp đã đổi trên cổng BDU — hãy tải lại danh sách rồi chạy lại'
        : (outcome.res?.rawMessage || 'BDU từ chối');
      this.recordItem(run, item, 'failed', reason, undefined, 'rejected');
      return null;
    }
    this.recordItem(run, item, 'failed', 'lỗi tạm thời', undefined, 'transient');
    return null;
  }

  /**
   * Danh sách mã môn bị hết chỗ (kể cả khi đã thử hết nhóm dự phòng).
   * Watcher dùng hàm này để biết cần canh chỗ cho môn nào.
   */
  seatFullSubjects(run) {
    const subjects = (run.summaryAcc?.that_bai ?? [])
      .filter((entry) => entry?.code === 'seat_full')
      .map((entry) => entry.ma_mon)
      .filter(Boolean);
    return [...new Set(subjects)];
  }

  watchSubjects(run) {
    return this.seatFullSubjects(run).filter((maMon) => !run.watchGaveUp?.has(maMon));
  }

  async recordWatchSuccess(run, item) {
    const main = run.snapshot.find((entry) => entry.maMon === item.maMon && entry.loai === 'chinh');
    const fallbackFrom = item.loai === 'du_phong' ? main?.idToHoc : undefined;
    this.recordItem(run, item, 'success', undefined, fallbackFrom);
    if (fallbackFrom) {
      run.summaryAcc.fallback.push({ ma_mon: item.maMon, tu_id_to_hoc: fallbackFrom, sang_id_to_hoc: item.idToHoc });
    }
    run.summaryAcc.that_bai = run.summaryAcc.that_bai.filter((entry) => entry.ma_mon !== item.maMon);
    const attempts = run.watchAttempts.get(item.maMon) ?? 1;
    run.summaryAcc.canh_slot.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc, so_lan_thu: attempts });
    await this.cleanupSuccessfulPriorities(run);
    const message = `Canh được slot ${item.maMon} (${item.nhomTo ?? item.idToHoc}) sau ${attempts} lần thử.`;
    Promise.resolve().then(() => this.notify?.notifyWatchSuccess?.({ mssv: run.mssv, runId: run.id, maMon: item.maMon, message })).catch(() => {});
    this.appendLog(run, 'success', message);
  }

  async watchTick(run) {
    let pauseMs = 0;
    for (const maMon of this.watchSubjects(run)) {
      if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs };
      const items = [...run.snapshot]
        .filter((item) => item.maMon === maMon)
        .sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0));
      for (const item of items) {
        if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs };
        const key = String(item.idToHoc ?? `${item.maMon}:${item.thuTu}`);
        if (run.watchDropped.has(key)) continue;

        let res;
        let cls;
        if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs };
        try {
          // Exactly one BDU register request per item in a tick. Sau khi khôi
          // phục phiên thành công, lớp này chỉ được thử lại ở tick kế tiếp.
          // eslint-disable-next-line no-await-in-loop
          res = await this.bduCall(() => this.service.registerGroup(run.token, {
            idToHoc: item.idToHoc,
            isChecked: true,
            svNganh: run.svNganh,
            idRs: run.lastIdRs
          }));
          if (res?.idRs) run.lastIdRs = res.idRs;
          cls = classifyRegisterResult(res);
        } catch (error) {
          cls = error?.status === 429
            ? 'rate_limit'
            : error?.status === 401 || error?.status === 426 || error?.code === 'AUTH_EXPIRED'
              ? 'auth'
              : 'transient';
          res = error;
        }

        run.watchAttempts.set(maMon, (run.watchAttempts.get(maMon) ?? 0) + 1);
        if (cls === 'auth') {
          if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs: 0 };
          const refreshed = await this.tryRefresh(run, { allowPassword: true });
          if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs: 0 };
          if (!refreshed) {
            run.authExpired = true;
            return { pauseMs, failed: 'Phiên đăng nhập đã hết hạn' };
          }
          continue;
        }
        if (cls === 'thanh_cong' || cls === 'already_registered') {
          await this.recordWatchSuccess(run, item);
          break;
        }
        if (cls === 'seat_full' || cls === 'transient' || cls === 'rate_limit') continue;
        if (cls === 'gate_closed') {
          pauseMs = WATCH_GATE_PAUSE_MS;
          this.appendLog(run, 'warning', 'Cổng đăng ký đã đóng — tạm dừng canh slot 15 phút.');
          break;
        }
        if (cls === 'rejected' && isStaleIdResponse(res)) {
          const now = this.now();
          if (!run.watchCatalogRefreshAtMs || now - run.watchCatalogRefreshAtMs >= WATCH_CATALOG_REFRESH_MS) {
            if (run.stopRequested || now >= run.watchUntilMs) return { pauseMs };
            run.watchCatalogRefreshAtMs = now;
            await this.refreshCatalogIds(run);
            if (run.stopRequested || this.now() >= run.watchUntilMs) return { pauseMs };
          }
          continue;
        }

        run.watchDropped.add(key);
        if (items.every((entry) => run.watchDropped.has(String(entry.idToHoc ?? `${entry.maMon}:${entry.thuTu}`)))) {
          run.watchGaveUp.add(maMon);
          this.appendLog(run, 'warning', `Không còn lớp khả dụng cho ${maMon}.`);
          break;
        }
      }
      if (pauseMs) break;
    }
    return { pauseMs };
  }

  async runWatcher(run) {
    let nextTickAt = this.now() + this.watchIntervalMs;
    run.lastWatchLogAtMs = this.now();
    while (true) {
      if (run.stopRequested) return { status: 'stopped' };
      if (this.watchSubjects(run).length === 0) return { status: 'done' };
      if (this.now() >= run.watchUntilMs) {
        this.appendLog(run, 'info', 'Đợt đăng ký đã đóng — kết thúc canh slot.');
        return { status: 'done' };
      }

      while (!run.stopRequested && this.now() < nextTickAt && this.now() < run.watchUntilMs) {
        const wakeAt = Math.min(nextTickAt, run.watchUntilMs);
        const sleepMs = Math.min(wakeAt - this.now(), 5_000);
        if (sleepMs > 0) await this.sleep(sleepMs);
        if (this.now() - run.lastWatchLogAtMs >= WATCH_HEARTBEAT_MS) {
          const remaining = Math.max(0, Math.ceil((nextTickAt - this.now()) / 60_000));
          this.appendLog(run, 'info', `Đang canh ${this.watchSubjects(run).length} môn · lần thử tiếp theo sau ${remaining} phút.`);
          run.lastWatchLogAtMs = this.now();
          await this.persistRun(run);
        }
      }
      if (run.stopRequested) return { status: 'stopped' };
      if (this.now() >= run.watchUntilMs) continue;

      const expiresAt = run.tokenExpiresAtMs;
      if (expiresAt && this.now() >= expiresAt - TOKEN_EXPIRY_MARGIN_MS) {
        const refreshed = await this.tryRefresh(run, { allowPassword: true });
        if (!refreshed && run.passwordInvalid) {
          return { status: 'failed', error: 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.' };
        }
      }
      if (run.stopRequested) return { status: 'stopped' };
      if (this.now() >= run.watchUntilMs) continue;

      const outcome = await this.watchTick(run);
      if (outcome.failed) return { status: 'failed', error: outcome.failed };
      await this.persistRun(run);
      nextTickAt = this.now() + (outcome.pauseMs || this.watchIntervalMs);
    }
  }

  /**
   * Gỡ khỏi danh sách ưu tiên những môn đã đăng ký thành công. Xoá theo cả
   * nhóm `ma_mon` (chính + dự phòng) nên danh sách không còn môn đã có.
   * Lỗi ở đây không được làm hỏng run — chỉ ghi cảnh báo.
   */
  async cleanupSuccessfulPriorities(run) {
    const done = [...new Set((run.summaryAcc?.thanh_cong ?? []).map((e) => e.ma_mon).filter(Boolean))];
    run.cleanedMaMons ??= new Set();
    const pending = done.filter((maMon) => !run.cleanedMaMons.has(maMon));
    if (!pending.length || typeof this.store.deletePrioritiesBySubjects !== 'function') return;
    try {
      await this.store.deletePrioritiesBySubjects(run.mssv, pending);
      pending.forEach((maMon) => run.cleanedMaMons.add(maMon));
      this.appendLog(run, 'info', `Đã gỡ ${pending.length} môn đã đăng ký khỏi danh sách ưu tiên.`);
      this.emit(run, { type: 'priority_updated', removedMaMons: pending });
    } catch (error) {
      this.appendLog(run, 'warning', `Không gỡ được môn đã đăng ký khỏi danh sách ưu tiên: ${clip(error?.message || error)}`);
    }
  }

  async autoFixConflicts(run) {
    const succeeded = run.results.filter((r) => r.status === 'success');
    if (succeeded.length < 2) return;
    const withTkb = succeeded.map((r) => ({ ...r, tkb: run.snapshot.find((s) => s.idToHoc === r.idToHoc)?.tkb ?? '' }));
    const parsed = withTkb.map((r) => ({ ...r, segments: parseTkb(r.tkb) }));
    for (let i = 0; i < parsed.length; i += 1) {
      for (let j = i + 1; j < parsed.length; j += 1) {
        const a = parsed[i];
        const b = parsed[j];
        if (a.segments.length === 0 || b.segments.length === 0) {
          this.appendLog(run, 'info', `Không tự dọn cặp ${a.maMon}–${b.maMon}: thời khóa biểu không đọc được.`);
          continue;
        }
        if (!groupsConflict(a.segments, b.segments)) continue;
        if (run.stopRequested) return 'stopped';
        const victim = a.thuTu > b.thuTu ? a : b;
        const survivor = victim === a ? b : a;
        this.appendLog(run, 'warning', `${a.maMon} và ${b.maMon} trùng lịch — tự rút ${victim.maMon} (ưu tiên thấp hơn).`);
        // eslint-disable-next-line no-await-in-loop
        const res = await this.bduCall(() => this.service.registerGroup(run.token, {
          idToHoc: victim.idToHoc,
          isChecked: false,
          svNganh: run.svNganh,
          idRs: run.lastIdRs
        })).catch(() => null);
        if (res?.idRs) run.lastIdRs = res.idRs;
        if (res?.isThanhCong !== true) {
          this.appendLog(run, 'warning', `Tự rút ${victim.maMon} thất bại (${res?.rawMessage || 'BDU từ chối'}). Vui lòng rút thủ công.`);
        } else {
          run.summaryAcc.rut.push({ ma_mon: victim.maMon, id_to_hoc: victim.idToHoc, ly_do: 'trùng lịch (tự dọn)' });
          this.appendLog(run, 'info', `Đã rút ${victim.maMon}; giữ ${survivor.maMon}.`);
        }
        if (run.stopRequested) return 'stopped';
      }
    }
  }

  async execute(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'scheduled') return;

    // Before the scheduled time: do NOT touch the gate. Keep the BDU session
    // warm (check every 8 hours) and re-login with the password 5 minutes
    // before the trigger so the credentials are proven and the token is fresh.
    while (!run.stopRequested && this.now() < run.triggerAtMs) {
      const loginDueMs = run.loginRetryAtMs ?? run.loginAtMs;
      if (!run.loginDone && this.now() >= loginDueMs) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await this.loginWithPassword(run);
        if (outcome === 'fatal') {
          await this.finishRun(run, 'failed', { error: 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.' });
          return;
        }
        if (outcome === 'ok') run.loginDone = true;
        await this.persistRun(run);
      }
      if (this.now() - (run.lastTokenCheckAt ?? 0) >= TOKEN_CHECK_INTERVAL_MS) {
        run.lastTokenCheckAt = this.now();
        const expiresAt = run.tokenExpiresAtMs;
        const needsRefresh = !expiresAt || this.now() >= expiresAt - TOKEN_EXPIRY_MARGIN_MS;
        if (needsRefresh) {
          // eslint-disable-next-line no-await-in-loop
          const refreshed = await this.tryRefresh(run, { allowPassword: true });
          if (!refreshed && run.passwordInvalid) {
            await this.finishRun(run, 'failed', { error: 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.' });
            return;
          }
          await this.persistRun(run);
        }
      }
      const remainingMs = run.triggerAtMs - this.now();
      // Sleep in short chunks so "Dừng" is honoured within ~5s even when the
      // schedule is a day away.
      await this.sleep(Math.min(Math.max(remainingMs, 0), 5_000));
    }

    // Bắt đầu muộn hơn mốc T−5 (hoặc lần login ở T−5 lỗi tạm thời): thử lại
    // đúng một lần ngay trước khi poll cổng.
    if (!run.loginDone && !run.stopRequested && this.now() >= (run.loginRetryAtMs ?? run.loginAtMs)) {
      const outcome = await this.loginWithPassword(run);
      if (outcome === 'fatal') {
        await this.finishRun(run, 'failed', { error: 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.' });
        return;
      }
      if (outcome === 'ok') run.loginDone = true;
      await this.persistRun(run);
    }

    let gateOpen = false;
    // Người dùng có thể bấm Auto sau giờ mở (ví dụ 10:00 cho đợt mở 09:00).
    // Cửa sổ canh cổng phải tính từ lúc bắt đầu chạy, không phải từ triggerAt,
    // nếu không deadline đã trôi qua và run fail ngay dù cổng đang mở.
    const pollFromMs = Math.max(run.triggerAtMs, this.now());
    const deadline = pollFromMs + GATE_LIMIT_AFTER_MS;
    let polls = 0;
    // From the scheduled time (or from now, when started late): poll the gate
    // and fire as soon as it is open.
    while (!run.stopRequested && this.now() <= deadline && polls < 20_000) {
      polls += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        gateOpen = await this.checkGate(run.token);
      } catch (error) {
        if ((error?.status === 401 || error?.code === 'AUTH_EXPIRED') && await this.tryRefresh(run, { allowPassword: true })) {
          continue;
        }
        if (error?.status === 401 || error?.code === 'AUTH_EXPIRED') run.authExpired = true;
        throw error;
      }
      if (gateOpen) break;
      await this.sleep(500);
    }

    if (run.stopRequested) { await this.finishRun(run, 'stopped'); return; }
    if (!gateOpen) {
      this.appendLog(run, 'error', 'Đã canh cổng 5 phút nhưng cổng vẫn chưa mở. Không bắn request nào.');
      await this.finishRun(run, 'failed', { error: 'Cổng chưa mở' });
      return;
    }

    this.updateRun(run, { status: 'running', startedAt: nowIso() });
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    this.appendLog(run, 'success', 'Cổng đã mở. Bắt đầu đăng ký theo thứ tự ưu tiên.');
    await this.persistRun(run);

    // BDU rebuilds the class catalog when the round opens, so ids saved before
    // today point at groups the server no longer has. Re-map them first.
    await this.refreshCatalogIds(run);
    await this.persistRun(run);

    const allItems = [...run.snapshot].sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0));
    const chinhItems = allItems.filter((item) => item.loai === 'chinh');
    for (const item of chinhItems) {
      if (run.stopRequested) break;
      // eslint-disable-next-line no-await-in-loop
      const fatal = await this.registerSubject(run, item, allItems);
      await this.persistRun(run);
      if (fatal === 'stopped') { await this.finishRun(run, 'stopped'); return; }
      if (fatal) { await this.finishRun(run, 'failed', { error: fatal }); return; }
      await this.sleep(100);
    }

    await this.finishRegistrationPhase(run);
  }

  async finishRegistrationPhase(run) {
    if (run.stopRequested) { await this.finishRun(run, 'stopped'); return; }
    await this.cleanupSuccessfulPriorities(run);
    const canWatch = run.watchSlots === true && this.watchSubjects(run).length > 0 && this.now() < run.watchUntilMs;
    if (!canWatch) {
      let autoFixStatus;
      if (run.autoFixScheduleConflict) {
        autoFixStatus = await this.autoFixConflicts(run);
        await this.persistRun(run);
      }
      const status = autoFixStatus === 'stopped' || run.stopRequested ? 'stopped' : 'done';
      await this.finishRun(run, status);
      return;
    }

    run.phase = 'watching';
    this.appendLog(run, 'info', `Bắt đầu canh slot ${this.watchSubjects(run).length} môn tới ${new Date(run.watchUntilMs).toLocaleTimeString('vi-VN')}. Thử lại mỗi ${this.watchIntervalMs / 1000}s.`);
    // Pha watching không được resume sau restart, nên credential chỉ cần tồn
    // tại trong RAM cho refresh/login; bản persist không còn cần thiết nữa.
    try {
      await this.store.deleteCredential?.(run.id);
    } catch { /* best-effort: vòng canh vẫn tiếp tục với credential trong RAM */ }
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    await this.persistRun(run);
    const outcome = await this.runWatcher(run);
    let finalStatus = outcome.status;
    if (outcome.status === 'done' && run.autoFixScheduleConflict) {
      const autoFixStatus = await this.autoFixConflicts(run);
      await this.persistRun(run);
      if (autoFixStatus === 'stopped') finalStatus = 'stopped';
    }
    if (run.stopRequested) finalStatus = 'stopped';
    await this.finishRun(run, finalStatus, { error: outcome.error });
  }

  async finishRun(run, status, { error } = {}) {
    // Dọn môn đã đăng ký khỏi danh sách ưu tiên trước khi chốt kết quả.
    await this.cleanupSuccessfulPriorities(run);
    const summary = {
      thanh_cong: [...run.summaryAcc.thanh_cong],
      that_bai: [...run.summaryAcc.that_bai],
      fallback: [...run.summaryAcc.fallback],
      rut: [...run.summaryAcc.rut],
      canh_slot: [...(run.summaryAcc.canh_slot ?? [])]
    };
    const finalError = status === 'failed' && run.passwordInvalid
      ? 'Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại.'
      : status === 'failed' && run.authExpired
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại và kích hoạt lại.'
        : (error ?? null);
    // Xoá mật khẩu khỏi RAM trước khi ghi DB/phát sự kiện cuối.
    run.password = null;
    const finishedAt = nowIso();
    this.updateRun(run, { status, summary, error: finalError, finishedAt });
    await this.persistRun(run);
    // Run đã kết thúc: không cần giữ mật khẩu trong DB nữa.
    try {
      await this.store.deleteCredential?.(run.id);
    } catch (storeError) {
      this.appendLog(run, 'warning', `Không xoá được mật khẩu tạm: ${clip(storeError?.message || storeError)}`);
    }
    this.activeRunByMssv.delete(run.mssv);
    run.token = null;
    run.refreshToken = '';
    if (this.notify) {
      if (status === 'done') {
        const okCount = summary.thanh_cong.length;
        const failCount = summary.that_bai.length;
        const details = summary.that_bai.slice(0, 5).map((item) => `${item.ma_mon}: ${item.ly_do}`).join('; ');
        const message = `✅ Auto đăng ký hoàn tất (${okCount} thành công${failCount ? `, ${failCount} thất bại` : ''})${details ? ` — ${details}` : ''}.`
          + (summary.rut.length ? ` Đã tự rút ${summary.rut.length} môn trùng lịch.` : '')
          + (summary.canh_slot.length ? ` Canh slot: ${summary.canh_slot.length} môn được đăng ký.` : '')
          + ` (run ${run.id})`;
        this.appendLog(run, 'success', 'Đã gửi thông báo Discord (nếu tài khoản đã liên kết).');
        Promise.resolve(this.notify.notifyRunDone?.({ mssv: run.mssv, runId: run.id, message })).catch(() => {});
      } else if (status === 'failed') {
        const message = `⚠️ Auto đăng ký thất bại cho ${run.mssv}: ${finalError}. (run ${run.id})`;
        this.appendLog(run, 'error', 'Đã gửi cảnh báo Discord (nếu tài khoản đã liên kết).');
        Promise.resolve(this.notify.notifyRunFailed?.({ mssv: run.mssv, runId: run.id, message })).catch(() => {});
      }
    }
    // Ghi lại lần cuối để log thông báo cũng nằm trong DB.
    await this.persistRun(run);
    this.emit(run, { type: 'done', run: this.serialize(run) });
  }
}

export const EnrollmentRunService = new EnrollmentRunManager();
