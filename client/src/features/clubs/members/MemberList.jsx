import { initials, safeNumber } from '../lib/format.js';
import { ROLE_ORDER } from '../lib/roles.js';
import RoleBadge from '../components/RoleBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';

const ORDER_INDEX = Object.fromEntries(ROLE_ORDER.map((role, index) => [role, index]));

export default function MemberList({
  members,
  roleLabels,
  isLoading,
  isError,
  error,
  onRetry,
  canAssignRoles,
  myMssv,
  actionPending,
  onRoleChange,
  onKick
}) {
  if (isLoading) return <div className="club-empty" role="status"><h2>Đang tải thành viên…</h2></div>;
  if (isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải thành viên</h2>
        <p>{error?.message || 'Vui lòng thử lại.'}</p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Thử lại</button>
      </div>
    );
  }
  if (!members?.length) return <EmptyState title="Chưa có thành viên nào" />;

  const sorted = [...members].sort((a, b) => (ORDER_INDEX[a.role] ?? 99) - (ORDER_INDEX[b.role] ?? 99));

  return (
    <div className="club-member-list">
      {sorted.map((member) => (
        <article className="club-member" key={member.mssv}>
          <div className="club-member__identity">
            <span className="club-avatar club-avatar--sm" aria-hidden="true">{initials(member.full_name || member.mssv)}</span>
            <div className="club-member__copy">
              <strong>{member.full_name || member.mssv}</strong>
              <span>{member.mssv}{member.contribution_points ? ` · ${member.contribution_points} điểm` : ''}</span>
            </div>
          </div>
          <div className="club-member__actions">
            <RoleBadge role={member.role} roleLabels={roleLabels} />
            <span className="club-muted">· {safeNumber(member.contribution_points)} điểm</span>
            {canAssignRoles && member.mssv !== myMssv && (
              <>
                <label className="club-visually-hidden" htmlFor={`club-role-${member.mssv}`}>Đổi vai trò của {member.full_name || member.mssv}</label>
                <select
                  id={`club-role-${member.mssv}`}
                  value={member.role}
                  disabled={actionPending}
                  onChange={(event) => {
                    if (event.target.value !== member.role) onRoleChange?.(member, event.target.value);
                  }}
                >
                  {ROLE_ORDER.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button type="button" className="club-text-action club-danger-text" disabled={actionPending} onClick={() => onKick?.(member)}>
                  Mời ra
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
