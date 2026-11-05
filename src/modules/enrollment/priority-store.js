/**
 * Persistence layer for enrollment priorities and runs.
 * Only place that talks SQL; column names mirror migrations/069_enrollment.sql.
 */
import { query, transaction } from '../../db/database.js';
import { decryptPassword, encryptPassword } from './enrollment-credential.service.js';

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function rowToItem(row) {
  return {
    maMon: String(row.ma_mon ?? ''),
    tenMon: String(row.ten_mon ?? ''),
    soTc: toNumber(row.so_tc),
    idToHoc: String(row.id_to_hoc ?? ''),
    nhomTo: row.nhom_to === null ? null : String(row.nhom_to),
    lop: row.lop === null ? null : String(row.lop),
    loai: String(row.loai ?? 'chinh'),
    thuTu: Number(row.thu_tu) || 0
  };
}

function itemsFromParams(mssv, items) {
  const rows = items.map((item, index) => ({
    mssv: String(mssv),
    ma_mon: String(item.maMon ?? '').slice(0, 32),
    ten_mon: String(item.tenMon ?? '').slice(0, 200),
    so_tc: item.soTc === null || item.soTc === undefined ? null : Number(item.soTc),
    id_to_hoc: String(item.idToHoc ?? '').slice(0, 40),
    nhom_to: item.nhomTo === null || item.nhomTo === undefined ? null : String(item.nhomTo).slice(0, 16),
    lop: item.lop === null || item.lop === undefined ? null : String(item.lop).slice(0, 200),
    thu_tu: index + 1,
    loai: item.loai === 'du_phong' ? 'du_phong' : 'chinh'
  }));
  return rows;
}

export const priorityStore = {
  async listPriorities(mssv) {
    const result = await query(
      'SELECT mssv, ma_mon, ten_mon, so_tc, id_to_hoc, nhom_to, lop, thu_tu, loai, created_at, updated_at FROM enrollment_priorities WHERE mssv = $1 ORDER BY thu_tu ASC',
      [String(mssv)]
    );
    return result.rows.map(rowToItem);
  },

  async replacePriorities(mssv, items) {
    const rows = itemsFromParams(mssv, items);
    await transaction(async (client) => {
      await client.query('DELETE FROM enrollment_priorities WHERE mssv = $1', [String(mssv)]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO enrollment_priorities
             (mssv, ma_mon, ten_mon, so_tc, id_to_hoc, nhom_to, lop, thu_tu, loai)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [row.mssv, row.ma_mon, row.ten_mon, row.so_tc, row.id_to_hoc, row.nhom_to, row.lop, row.thu_tu, row.loai]
        );
      }
    });
    return this.listPriorities(mssv);
  },

  // Xoá ưu tiên theo nhóm môn: trả về số dòng đã xoá; danh sách rỗng không gọi DB.
  async deletePrioritiesBySubjects(mssv, maMons) {
    const subjects = [...new Set((maMons ?? []).filter(Boolean))];
    if (!subjects.length) return 0;
    const result = await query(
      'DELETE FROM enrollment_priorities WHERE mssv = $1 AND ma_mon = ANY($2::text[])',
      [String(mssv), subjects]
    );
    return result.rowCount ?? 0;
  },

  async insertRun({ id, mssv, status, triggerAt, snapshot }) {
    await query(
      `INSERT INTO enrollment_runs (id, mssv, status, trigger_at, snapshot, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        String(mssv),
        status,
        triggerAt ? new Date(triggerAt).toISOString() : null,
        JSON.stringify(snapshot ?? []),
        status === 'running' ? new Date().toISOString() : null
      ]
    );
  },

  /**
   * Tạo run + credential trong cùng một transaction. Nếu mã hoá mật khẩu lỗi
   * (thiếu/sai key) thì không có row nào được tạo — fail-closed.
   */
  async insertRunWithCredential({ id, mssv, status, triggerAt, snapshot, password }) {
    const credential = encryptPassword(id, password);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO enrollment_runs (id, mssv, status, trigger_at, snapshot, started_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          String(mssv),
          status,
          triggerAt ? new Date(triggerAt).toISOString() : null,
          JSON.stringify(snapshot ?? []),
          status === 'running' ? new Date().toISOString() : null
        ]
      );
      await client.query(
        `INSERT INTO enrollment_run_credentials (run_id, mssv, enc_password, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, String(mssv), credential.enc_password, credential.iv, credential.auth_tag]
      );
    });
  },

  async getRunPassword(runId) {
    const result = await query(
      'SELECT run_id, enc_password, iv, auth_tag FROM enrollment_run_credentials WHERE run_id = $1 LIMIT 1',
      [String(runId)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return decryptPassword(String(row.run_id), row);
  },

  async deleteCredential(runId) {
    const result = await query('DELETE FROM enrollment_run_credentials WHERE run_id = $1', [String(runId)]);
    return (result.rowCount ?? 0) > 0;
  },

  // Dọn credential mồ côi: run đã kết thúc hoặc credential quá cũ.
  async deleteOrphanCredentials(olderThanDays = 7) {
    const days = Math.max(1, Number(olderThanDays) || 7);
    const result = await query(
      `DELETE FROM enrollment_run_credentials c
       USING enrollment_runs r
       WHERE c.run_id = r.id
         AND (r.status IN ('done', 'failed', 'stopped')
              OR c.created_at < NOW() - ($1 || ' days')::interval)`,
      [String(days)]
    );
    return result.rowCount ?? 0;
  },

  async listActiveRuns() {
    const result = await query(
      `SELECT id, mssv, status, trigger_at, snapshot, summary, logs, error,
              results, state, restart_count, started_at, finished_at, created_at
       FROM enrollment_runs
       WHERE status IN ('scheduled', 'running')
       ORDER BY created_at ASC`
    );
    return result.rows;
  },

  async updateRun(id, fields = {}) {
    const sets = [];
    const params = [id];
    const push = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (fields.status !== undefined) push('status', fields.status);
    if (fields.summary !== undefined) push('summary', JSON.stringify(fields.summary));
    if (fields.started_at !== undefined) push('started_at', fields.started_at);
    else if (fields.startedAt !== undefined) push('started_at', fields.startedAt);
    if (fields.finished_at !== undefined) push('finished_at', fields.finished_at);
    else if (fields.finishedAt !== undefined) push('finished_at', fields.finishedAt);
    if (fields.trigger_at !== undefined) push('trigger_at', fields.trigger_at);
    if (fields.logs !== undefined) push('logs', JSON.stringify(fields.logs ?? []));
    if (fields.error !== undefined) push('error', fields.error);
    if (fields.results !== undefined) push('results', JSON.stringify(fields.results ?? []));
    if (fields.state !== undefined) push('state', JSON.stringify(fields.state ?? {}));
    if (fields.restart_count !== undefined) push('restart_count', Number(fields.restart_count) || 0);
    else if (fields.restartCount !== undefined) push('restart_count', Number(fields.restartCount) || 0);
    if (sets.length === 0) return;
    await query(`UPDATE enrollment_runs SET ${sets.join(', ')} WHERE id = $1`, params);
  },

  async getRun(id, mssv) {
    const result = await query(
      'SELECT id, mssv, status, trigger_at, snapshot, summary, logs, error, results, state, restart_count, started_at, finished_at, created_at FROM enrollment_runs WHERE id = $1 AND mssv = $2 LIMIT 1',
      [id, String(mssv)]
    );
    return result.rows[0] ?? null;
  },

  // Lượt gần nhất của sinh viên — dùng để khôi phục UI sau F5/mở tab khác khi
  // run không còn trong RAM.
  async getLatestRun(mssv) {
    const result = await query(
      'SELECT id, mssv, status, trigger_at, snapshot, summary, logs, error, results, state, restart_count, started_at, finished_at, created_at FROM enrollment_runs WHERE mssv = $1 ORDER BY created_at DESC LIMIT 1',
      [String(mssv)]
    );
    return result.rows[0] ?? null;
  },

  // Enrollment runs that were "running" when the process died can never finish
  // (their token lived only in RAM). Mark them failed so the UI stops showing
  // a run as active after a restart.
  async failStaleRuns(staleMinutes = 15) {
    const result = await query(
      `UPDATE enrollment_runs
         SET status = 'failed',
             summary = COALESCE(summary, '{}'::jsonb) || '{"reason":"server_restart"}'::jsonb,
             finished_at = NOW()
       WHERE status IN ('scheduled', 'running', 'otp_required')
         AND COALESCE(started_at, created_at) < NOW() - ($1 || ' minutes')::interval`,
      [String(staleMinutes)]
    );
    return result.rowCount ?? 0;
  }
};
