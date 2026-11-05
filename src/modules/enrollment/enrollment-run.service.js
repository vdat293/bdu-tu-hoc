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
  OtpUnavailableError,
  EnrollmentService
} from './enrollment.service.js';
import { pickFallbacks } from './enrollment-priority.js';
import { parseTkb, groupsConflict } from './enrollment-tkb.js';
import { priorityStore } from './priority-store.js';
import { EnrollmentNotifyService } from './enrollment-notify.service.js';

const ACTIVE_STATUSES = new Set(['scheduled', 'running', 'otp_required']);
const MAX_LOGS = 300;
const OTP_WAIT_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RETRY_BACKOFF = [200, 500, 1200];
const GATE_LIMIT_AFTER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

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

// Dựng payload giống `serialize()` từ row trong DB, để UI khôi phục được lượt
// chạy đã xong kể cả khi nó không còn trong RAM (F5, mở tab khác, restart).
export function serializeStoredRun(row) {
  if (!row) return null;
  const summary = row.summary && typeof row.summary === 'object' ? row.summary : null;
  return {
    runId: row.id,
    status: row.status,
    triggerAt: asIso(row.trigger_at),
    startedAt: asIso(row.started_at),
    updatedAt: asIso(row.finished_at) ?? asIso(row.started_at) ?? asIso(row.created_at),
    finishedAt: asIso(row.finished_at),
    snapshotCount: Array.isArray(row.snapshot) ? row.snapshot.length : 0,
    logs: Array.isArray(row.logs) ? row.logs : [],
    results: [],
    summary: summary
      ? {
        ...summary,
        thanh_cong: [...(summary.thanh_cong ?? [])],
        that_bai: [...(summary.that_bai ?? [])],
        fallback: [...(summary.fallback ?? [])],
        rut: [...(summary.rut ?? [])]
      }
      : null,
    error: row.error ?? (summary?.reason === 'server_restart'
      ? 'Server đã khởi động lại khi lượt chạy đang diễn ra. Lượt này không thể tiếp tục — hãy chạy lại.'
      : null)
  };
}

export class EnrollmentRunManager {
  constructor({ service, store, sleep, now, notify, retentionMs = 30 * 60 * 1000 } = {}) {
    this.service = service ?? new EnrollmentService();
    this.store = store ?? priorityStore;
    this.notify = notify ?? EnrollmentNotifyService;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = now ?? (() => Date.now());
    this.retentionMs = retentionMs;
    this.runs = new Map();
    this.activeRunByMssv = new Map();
    this.listeners = new Map();
    // Best-effort: a crashed process left rows in 'scheduled/running'; close
    // them out. Skipped under NODE_ENV=test to avoid touching the local DB.
    if (process.env.NODE_ENV !== 'test') {
      try {
        Promise.resolve(this.store?.failStaleRuns?.(15)).catch(() => {});
      } catch {
        /* stale cleanup is non-critical */
      }
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
      summary: run.summary ? { ...run.summary, thanh_cong: [...run.summary.thanh_cong], that_bai: [...run.summary.that_bai], fallback: [...run.summary.fallback], rut: [...run.summary.rut] } : null,
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
    if (ACTIVE_STATUSES.has(row.status)) {
      const summary = { ...(row.summary && typeof row.summary === 'object' ? row.summary : {}), reason: 'server_restart' };
      const finishedAt = nowIso();
      try {
        await this.store.updateRun(row.id, { status: 'failed', summary, finished_at: finishedAt, logs: row.logs ?? [] });
      } catch { /* hiển thị trạng thái suy ra vẫn đúng dù ghi DB lỗi */ }
      return serializeStoredRun({ ...row, status: 'failed', summary, finished_at: finishedAt });
    }
    return serializeStoredRun(row);
  }

  async start({ mssv, token, refreshToken = '', items, triggerAt, autoFixScheduleConflict = false, svNganh = 1 }) {
    this.prune();
    const studentId = String(mssv || '').trim();
    if (!studentId) throw httpError(401, 'Không xác định được sinh viên cho lượt đăng ký.');
    if (!token) throw httpError(401, 'Thiếu mã xác thực (Token).');
    const triggerAtMs = triggerAt instanceof Date ? triggerAt.getTime() : new Date(triggerAt).getTime();
    if (!Number.isFinite(triggerAtMs)) throw httpError(400, 'triggerAt không hợp lệ.');
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
      summaryAcc: { thanh_cong: [], that_bai: [], fallback: [], rut: [] },
      summary: null,
      error: null,
      stopRequested: false,
      pendingItem: null,
      otpAttempts: 0,
      otpResult: null,
      lastIdRs: '',
      refreshCount: 0,
      lastRefreshAt: this.now(),
      authExpired: false,
      staleIdRetried: false
    };

    // Persist before running anything: the run row doubles as the audit log.
    await this.store.insertRun({ id, mssv: studentId, status: 'scheduled', triggerAt: new Date(triggerAtMs), snapshot });

    this.runs.set(id, run);
    this.activeRunByMssv.set(studentId, id);
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
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

  async submitOtp(runId, mssv, code) {
    const digits = String(code ?? '').trim();
    if (!/^\d{6}$/.test(digits)) throw httpError(400, 'Mã OTP phải gồm đúng 6 chữ số.');
    const run = this.runs.get(String(runId));
    if (!run || run.mssv !== String(mssv)) return null;
    if (run.status !== 'otp_required') throw httpError(409, 'Phiên đăng ký không ở trạng thái chờ OTP.');
    if (run.otpAttempts >= MAX_OTP_ATTEMPTS) throw httpError(409, 'Đã vượt số lần nhập OTP cho phép.');

    let result;
    try {
      result = await this.service.verifyOtp(run.token, digits);
    } catch (error) {
      if (error?.code === 'OTP_NOT_CONFIGURED' || error instanceof OtpUnavailableError) throw error;
      throw httpError(502, 'Không xác thực được OTP với máy chủ BDU.');
    }
    if (result?.ok) {
      run.otpResult = { ok: true };
      this.appendLog(run, 'success', 'OTP hợp lệ. Tiếp tục đăng ký.');
      return { ok: true, attemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - run.otpAttempts) };
    }
    run.otpAttempts += 1;
    this.appendLog(run, 'warning', `OTP không hợp lệ (lần ${run.otpAttempts}/${MAX_OTP_ATTEMPTS}).`);
    if (run.otpAttempts >= MAX_OTP_ATTEMPTS) run.otpResult = { ok: false, fatal: true };
    return { ok: false, attemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - run.otpAttempts) };
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

  recordItem(run, item, status, reason, fallbackFrom) {
    const entry = {
      maMon: item.maMon,
      tenMon: item.tenMon,
      idToHoc: item.idToHoc,
      nhomTo: item.nhomTo ?? null,
      thuTu: item.thuTu,
      status,
      reason: reason ? clip(reason) : undefined,
      fallbackFrom: fallbackFrom ?? undefined
    };
    run.results.push(entry);
    if (status === 'success') {
      run.summaryAcc.thanh_cong.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc });
    } else {
      run.summaryAcc.that_bai.push({ ma_mon: item.maMon, id_to_hoc: item.idToHoc, ly_do: clip(reason || 'thất bại') });
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

  // A run can outlive the 5-hour access token (e.g. scheduled today for
  // tomorrow). Refresh once per auth failure using the RAM-only refresh token.
  async tryRefresh(run) {
    if (!run.refreshToken || (run.refreshCount ?? 0) >= 3) return false;
    run.refreshCount = (run.refreshCount ?? 0) + 1;
    try {
      const next = await this.service.refreshSession(run.refreshToken);
      if (!next?.token) return false;
      run.token = next.token;
      if (next.refreshToken) run.refreshToken = next.refreshToken;
      run.lastRefreshAt = this.now();
      this.appendLog(run, 'info', 'Đã gia hạn phiên BDU để tiếp tục chờ/đăng ký.');
      return true;
    } catch {
      return false;
    }
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
      catalog = await this.service.getCatalog(run.token, { forceRefresh: true });
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
        res = await this.service.registerGroup(run.token, {
          idToHoc: item.idToHoc,
          isChecked,
          svNganh: run.svNganh,
          idRs: run.lastIdRs
        });
      } catch (error) {
        const isAuth = error?.status === 401 || error?.code === 'AUTH_EXPIRED';
        if (isAuth && await this.tryRefresh(run)) {
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
        if (await this.tryRefresh(run)) continue;
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
      this.updateRun(run, { status: 'otp_required' });
      run.pendingItem = item;
      run.otpAttempts = 0;
      run.otpResult = null;
      this.emit(run, { type: 'otp_required', pendingIdToHoc: item.idToHoc });
      const otpDeadline = this.now() + OTP_WAIT_MS;
      while (!run.otpResult && !run.stopRequested && this.now() < otpDeadline) {
        await this.sleep(500);
      }
      if (run.stopRequested) { this.appendLog(run, 'warning', 'Đã dừng khi đang chờ OTP.'); return 'stopped'; }
      if (!run.otpResult?.ok) {
        this.recordItem(run, item, 'failed', 'Xác thực OTP thất bại');
        return 'Xác thực OTP thất bại';
      }
      outcome = await this.attemptRegister(run, item, true);
      if (outcome.cls === 'otp') {
        // OTP accepted but the action still demands OTP — do not loop forever.
        this.recordItem(run, item, 'failed', 'Máy chủ vẫn yêu cầu OTP sau khi xác thực');
        return 'Máy chủ vẫn yêu cầu OTP';
      }
    }

    if (outcome.cls === 'thanh_cong') {
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
        if (['prereq', 'gate_closed', 'auth'].includes(fb.cls)) {
          this.appendLog(run, 'error', `Dự phòng ${fallback.idToHoc} thất bại: ${fb.cls}.`);
          break;
        }
        if (fb.cls === 'otp') {
          this.appendLog(run, 'error', 'Máy chủ yêu cầu OTP khi thử nhóm dự phòng — dừng lượt chạy để bạn xác thực thủ công.');
          return 'Máy chủ yêu cầu OTP khi thử dự phòng';
        }
        // seat_full / rejected / transient / schedule_conflict → try next backup
      }
      this.recordItem(run, item, 'failed', 'hết chỗ (kể cả dự phòng)');
      return null;
    }

    if (outcome.cls === 'prereq') {
      const detail = outcome.res?.rawMessage || outcome.res?.thongBaoTienQuyet || 'thiếu tiên quyết';
      this.recordItem(run, item, 'failed', detail);
      return null;
    }
    if (outcome.cls === 'schedule_conflict') {
      this.recordItem(run, item, 'failed', 'trùng lịch');
      return null;
    }
    if (outcome.cls === 'gate_closed') {
      this.recordItem(run, item, 'failed', 'ngoài thời gian');
      return 'Ngoài thời gian cho phép đăng ký';
    }
    if (outcome.cls === 'auth') {
      this.appendLog(run, 'error', 'Phiên đăng nhập hết hạn giữa chừng. Vui lòng đăng nhập lại.');
      this.recordItem(run, item, 'failed', 'phiên hết hạn');
      return 'Phiên đăng nhập hết hạn';
    }
    if (outcome.cls === 'rejected') {
      const reason = isStaleIdResponse(outcome.res)
        ? 'mã lớp đã đổi trên cổng BDU — hãy tải lại danh sách rồi chạy lại'
        : (outcome.res?.rawMessage || 'BDU từ chối');
      this.recordItem(run, item, 'failed', reason);
      return null;
    }
    this.recordItem(run, item, 'failed', 'lỗi tạm thời');
    return null;
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
        const victim = a.thuTu > b.thuTu ? a : b;
        const survivor = victim === a ? b : a;
        this.appendLog(run, 'warning', `${a.maMon} và ${b.maMon} trùng lịch — tự rút ${victim.maMon} (ưu tiên thấp hơn).`);
        // eslint-disable-next-line no-await-in-loop
        const res = await this.service.registerGroup(run.token, {
          idToHoc: victim.idToHoc,
          isChecked: false,
          svNganh: run.svNganh,
          idRs: run.lastIdRs
        }).catch(() => null);
        if (res?.idRs) run.lastIdRs = res.idRs;
        if (res?.isThanhCong !== true) {
          this.appendLog(run, 'warning', `Tự rút ${victim.maMon} thất bại (${res?.rawMessage || 'BDU từ chối'}). Vui lòng rút thủ công.`);
          continue;
        }
        run.summaryAcc.rut.push({ ma_mon: victim.maMon, id_to_hoc: victim.idToHoc, ly_do: 'trùng lịch (tự dọn)' });
        this.appendLog(run, 'info', `Đã rút ${victim.maMon}; giữ ${survivor.maMon}.`);
      }
    }
  }

  async execute(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'scheduled') return;

    // Before the scheduled time: do NOT touch the gate. Only keep the BDU
    // session warm (refresh the 5h access token) so a next-day schedule can
    // still fire at the chosen time.
    while (!run.stopRequested && this.now() < run.triggerAtMs) {
      if (run.refreshToken && this.now() - run.lastRefreshAt >= TOKEN_REFRESH_INTERVAL_MS) {
        // eslint-disable-next-line no-await-in-loop
        await this.tryRefresh(run);
      }
      const remainingMs = run.triggerAtMs - this.now();
      // Sleep in short chunks so "Dừng" is honoured within ~5s even when the
      // schedule is a day away.
      await this.sleep(Math.min(Math.max(remainingMs, 0), 5_000));
    }

    let gateOpen = false;
    const deadline = run.triggerAtMs + GATE_LIMIT_AFTER_MS;
    let polls = 0;
    // From the scheduled time: poll the gate and fire as soon as it is open.
    while (!run.stopRequested && this.now() <= deadline && polls < 20_000) {
      polls += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        gateOpen = await this.service.getGateStatus(run.token);
      } catch (error) {
        if ((error?.status === 401 || error?.code === 'AUTH_EXPIRED') && await this.tryRefresh(run)) {
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
      this.appendLog(run, 'error', 'Đã quá 5 phút kể từ giờ mở dự kiến mà cổng vẫn chưa mở. Không bắn request nào.');
      await this.finishRun(run, 'failed', { error: 'Cổng chưa mở' });
      return;
    }

    this.updateRun(run, { status: 'running', startedAt: nowIso() });
    this.emit(run, { type: 'snapshot', run: this.serialize(run) });
    this.appendLog(run, 'success', 'Cổng đã mở. Bắt đầu đăng ký theo thứ tự ưu tiên.');

    // BDU rebuilds the class catalog when the round opens, so ids saved before
    // today point at groups the server no longer has. Re-map them first.
    await this.refreshCatalogIds(run);

    const allItems = [...run.snapshot].sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0));
    const chinhItems = allItems.filter((item) => item.loai === 'chinh');
    for (const item of chinhItems) {
      if (run.stopRequested) break;
      // eslint-disable-next-line no-await-in-loop
      const fatal = await this.registerSubject(run, item, allItems);
      if (fatal === 'stopped') { await this.finishRun(run, 'stopped'); return; }
      if (fatal) { await this.finishRun(run, 'failed', { error: fatal }); return; }
      await this.sleep(100);
    }

    if (run.stopRequested) { await this.finishRun(run, 'stopped'); return; }
    if (run.autoFixScheduleConflict) {
      await this.autoFixConflicts(run);
    }
    await this.finishRun(run, 'done');
  }

  async finishRun(run, status, { error } = {}) {
    const summary = {
      thanh_cong: [...run.summaryAcc.thanh_cong],
      that_bai: [...run.summaryAcc.that_bai],
      fallback: [...run.summaryAcc.fallback],
      rut: [...run.summaryAcc.rut]
    };
    const finalError = status === 'failed' && run.authExpired
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại và kích hoạt lại.'
      : (error ?? null);
    const finishedAt = nowIso();
    this.updateRun(run, { status, summary, error: finalError, finishedAt });
    try {
      await this.store.updateRun(run.id, {
        status,
        summary,
        started_at: run.startedAt,
        finished_at: finishedAt,
        logs: run.logs,
        error: finalError
      });
    } catch (storeError) {
      this.appendLog(run, 'warning', `Không ghi được kết quả vào DB: ${clip(storeError?.message || storeError)}`);
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
          + ` (run ${run.id})`;
        this.appendLog(run, 'success', 'Đã gửi thông báo Discord (nếu tài khoản đã liên kết).');
        Promise.resolve(this.notify.notifyRunDone?.({ mssv: run.mssv, runId: run.id, message })).catch(() => {});
      } else if (status === 'failed') {
        const message = `⚠️ Auto đăng ký thất bại cho ${run.mssv}: ${finalError}. (run ${run.id})`;
        this.appendLog(run, 'error', 'Đã gửi cảnh báo Discord (nếu tài khoản đã liên kết).');
        Promise.resolve(this.notify.notifyRunFailed?.({ mssv: run.mssv, runId: run.id, message })).catch(() => {});
      }
    }
    this.emit(run, { type: 'done', run: this.serialize(run) });
  }
}

export const EnrollmentRunService = new EnrollmentRunManager();
