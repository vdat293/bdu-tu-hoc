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

const ACTIVE_STATUSES = new Set(['scheduled', 'running', 'otp_required']);
const MAX_LOGS = 300;
const OTP_WAIT_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RETRY_BACKOFF = [200, 500, 1200];
const GATE_LIMIT_AFTER_MS = 5 * 60 * 1000;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const clip = (value, max = 160) => String(value ?? '').slice(0, max);

export class EnrollmentRunManager {
  constructor({ service, store, sleep, now, retentionMs = 30 * 60 * 1000 } = {}) {
    this.service = service ?? new EnrollmentService();
    this.store = store ?? priorityStore;
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

  async start({ mssv, token, items, triggerAt, autoFixScheduleConflict = false, svNganh = 1 }) {
    this.prune();
    const studentId = String(mssv || '').trim();
    if (!studentId) throw httpError(401, 'Không xác định được sinh viên cho lượt đăng ký.');
    if (!token) throw httpError(401, 'Thiếu mã xác thực (Token).');
    const triggerAtMs = triggerAt instanceof Date ? triggerAt.getTime() : new Date(triggerAt).getTime();
    if (!Number.isFinite(triggerAtMs)) throw httpError(400, 'triggerAt không hợp lệ.');
    const snapshot = Array.isArray(items) ? [...items].sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0)) : [];
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
      lastIdRs: ''
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
    this.emit(run, { type: 'item_done', ...entry });
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
        if (attempt < RETRY_BACKOFF.length) {
          await this.sleep(RETRY_BACKOFF[attempt]);
          continue;
        }
        return { cls: 'transient', error };
      }
      if (res?.idRs) run.lastIdRs = res.idRs;
      const cls = classifyRegisterResult(res);
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
      this.appendLog(run, 'success', `Đăng ký ${item.maMon} (${item.idToHoc}) thành công.`);
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
          this.appendLog(run, 'success', `Đăng ký dự phòng ${fallback.maMon} (${fallback.idToHoc}) thành công.`);
          this.recordItem(run, fallback, 'success', undefined, item.idToHoc);
          run.summaryAcc.fallback.push({ ma_mon: fallback.maMon, tu_id_to_hoc: item.idToHoc, sang_id_to_hoc: fallback.idToHoc });
          return null;
        }
        if (['prereq', 'gate_closed', 'auth'].includes(fb.cls)) {
          this.appendLog(run, 'error', `Dự phòng ${fallback.idToHoc} thất bại: ${fb.cls}.`);
          break;
        }
        // seat_full / rejected / transient / schedule_conflict → try next backup
      }
      this.recordItem(run, item, 'failed', 'hết chỗ (kể cả dự phòng)');
      return null;
    }

    if (outcome.cls === 'prereq') {
      this.appendLog(run, 'error', `${item.maMon}: thiếu điều kiện tiên quyết — bỏ qua môn này.`);
      this.recordItem(run, item, 'failed', 'thiếu tiên quyết');
      return null;
    }
    if (outcome.cls === 'schedule_conflict') {
      this.appendLog(run, 'error', `${item.maMon}: trùng thời khóa biểu — không tự đăng ký lớp khác.`);
      this.recordItem(run, item, 'failed', 'trùng lịch');
      return null;
    }
    if (outcome.cls === 'gate_closed') {
      this.appendLog(run, 'error', 'Máy chủ từ chối: ngoài thời gian cho phép đăng ký.');
      this.recordItem(run, item, 'failed', 'ngoài thời gian');
      return 'Ngoài thời gian cho phép đăng ký';
    }
    if (outcome.cls === 'auth') {
      this.appendLog(run, 'error', 'Phiên đăng nhập hết hạn giữa chừng. Vui lòng đăng nhập lại.');
      this.recordItem(run, item, 'failed', 'phiên hết hạn');
      return 'Phiên đăng nhập hết hạn';
    }
    if (outcome.cls === 'rejected') {
      this.recordItem(run, item, 'failed', outcome.res?.rawMessage || 'BDU từ chối');
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
        run.summaryAcc.rut.push({ ma_mon: victim.maMon, id_to_hoc: victim.idToHoc, ly_do: 'trùng lịch (tự dọn)' });
        this.appendLog(run, 'info', `Đã rút ${victim.maMon}; giữ ${survivor.maMon}.`);
      }
    }
  }

  async execute(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'scheduled') return;

    const preTriggerMs = run.triggerAtMs - 30_000;
    while (!run.stopRequested && this.now() < preTriggerMs) {
      await this.sleep(1000);
    }

    let gateOpen = false;
    const deadline = run.triggerAtMs + GATE_LIMIT_AFTER_MS;
    let polls = 0;
    while (!run.stopRequested && this.now() <= deadline && polls < 20_000) {
      polls += 1;
      // eslint-disable-next-line no-await-in-loop
      gateOpen = await this.service.getGateStatus(run.token);
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

    const allItems = [...run.snapshot].sort((a, b) => (a.thuTu ?? 0) - (b.thuTu ?? 0));
    const chinhItems = allItems.filter((item) => item.loai === 'chinh');
    for (const item of chinhItems) {
      if (run.stopRequested) break;
      // eslint-disable-next-line no-await-in-loop
      const fatal = await this.registerSubject(run, item, allItems);
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
    const finishedAt = nowIso();
    this.updateRun(run, { status, summary, error: error ?? null, finishedAt });
    try {
      await this.store.updateRun(run.id, {
        status,
        summary,
        started_at: run.startedAt,
        finished_at: finishedAt
      });
    } catch (storeError) {
      this.appendLog(run, 'warning', `Không ghi được kết quả vào DB: ${clip(storeError?.message || storeError)}`);
    }
    this.activeRunByMssv.delete(run.mssv);
    run.token = null;
    this.emit(run, { type: 'done', run: this.serialize(run) });
  }
}

export const EnrollmentRunService = new EnrollmentRunManager();
