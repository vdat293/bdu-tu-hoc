import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTtcdsAudit, getTtcdsPermissions, setTtcdsPermission } from '../../api/ttcds.js';
import { useAuth, useToasts } from '../../app/providers.jsx';

/**
 * Panel quản trị phân quyền TTCDS — chỉ system owner thấy được.
 * Không có cờ owner riêng trong capabilities nên panel tự dò
 * `GET /api/ttcds/permissions`: backend 403 cho người thường → trả null,
 * section không bao giờ render cho non-owner.
 */
export default function TtcdsAdminPanel({ enabled }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [draft, setDraft] = useState({ mssv: '', level: 'view', note: '' });

  const permissions = useQuery({
    queryKey: ['ttcds-admin-permissions'],
    queryFn: ({ signal }) => getTtcdsPermissions(auth.token, { signal }),
    enabled: Boolean(enabled && auth.token),
    retry: false
  });

  const audit = useQuery({
    queryKey: ['ttcds-admin-audit'],
    queryFn: ({ signal }) => getTtcdsAudit(auth.token, { limit: 50, signal }),
    enabled: Boolean(enabled && auth.token && permissions.isSuccess),
    retry: false
  });

  const grant = useMutation({
    mutationFn: () => setTtcdsPermission(auth.token, {
      mssv: draft.mssv.trim().toUpperCase(),
      level: draft.level,
      note: draft.note.trim() || undefined
    }),
    onSuccess: () => {
      setDraft({ mssv: '', level: 'view', note: '' });
      client.invalidateQueries({ queryKey: ['ttcds-admin-permissions'] });
      client.invalidateQueries({ queryKey: ['ttcds-admin-audit'] });
      notify('Đã cập nhật phân quyền.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  if (!permissions.isSuccess || !Array.isArray(permissions.data)) return null;

  const rows = Array.isArray(permissions.data) ? permissions.data : [];
  const logs = Array.isArray(audit.data) ? audit.data : [];

  const submit = (event) => {
    event.preventDefault();
    if (!draft.mssv.trim()) {
      notify('Vui lòng nhập MSSV được cấp quyền.', 'warning');
      return;
    }
    grant.mutate();
  };

  return (
    <section className="card glass-panel" aria-label="Quản trị phân quyền" style={{ marginTop: '24px', padding: '20px' }}>
      <h2>Quản trị phân quyền</h2>
      <p className="club-permission-note">Chỉ quản trị viên hệ thống thấy mục này. Cấp mức xem (view) hoặc tạo nhóm (create) theo MSSV.</p>

      <form className="club-form" onSubmit={submit} style={{ marginBottom: '16px' }}>
        <label htmlFor="ttcds-admin-mssv">MSSV
          <input
            id="ttcds-admin-mssv"
            className="form-input"
            value={draft.mssv}
            onChange={(event) => setDraft({ ...draft, mssv: event.target.value })}
            placeholder="Ví dụ: 22050006"
          />
        </label>
        <label htmlFor="ttcds-admin-level">Mức quyền
          <select
            id="ttcds-admin-level"
            className="form-input"
            value={draft.level}
            onChange={(event) => setDraft({ ...draft, level: event.target.value })}
          >
            <option value="view">view — chỉ xem</option>
            <option value="create">create — tạo nhóm</option>
          </select>
        </label>
        <label htmlFor="ttcds-admin-note">Ghi chú
          <input
            id="ttcds-admin-note"
            className="form-input"
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder="Lý do cấp quyền…"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={grant.isPending}>
          {grant.isPending ? 'Đang lưu…' : 'Lưu phân quyền'}
        </button>
      </form>

      <h3>Danh sách phân quyền ({rows.length})</h3>
      {permissions.isLoading ? (
        <p>Đang tải phân quyền…</p>
      ) : rows.length === 0 ? (
        <p className="club-permission-note">Chưa có dòng phân quyền nào.</p>
      ) : (
        <table>
          <thead><tr><th>MSSV</th><th>Mức</th><th>Cấp bởi</th><th>Cập nhật</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.mssv}>
                <td>{row.mssv}</td>
                <td>{row.level}</td>
                <td>{row.granted_by || '—'}</td>
                <td>{row.updated_at || row.granted_at || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: '16px' }}>Nhật ký thao tác mới nhất</h3>
      {audit.isLoading ? (
        <p>Đang tải nhật ký…</p>
      ) : audit.isError ? (
        <p className="club-permission-note">Chưa thể tải nhật ký thao tác.</p>
      ) : logs.length === 0 ? (
        <p className="club-permission-note">Chưa có thao tác nào được ghi nhận.</p>
      ) : (
        <table>
          <thead><tr><th>#</th><th>Người thao tác</th><th>Hành động</th><th>Nhóm</th><th>MSSV đích</th><th>Lúc</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.id}</td>
                <td>{log.actor_mssv}</td>
                <td>{log.action}</td>
                <td>{log.target_group_id || '—'}</td>
                <td>{log.target_mssv || '—'}</td>
                <td>{log.created_at || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
