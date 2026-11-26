import { ClubAvatar, ClubEmptyState, RoleBadge } from '../components/ClubPrimitives.jsx';
import { safeNumber } from '../lib/format.js';
import { ROLE_ORDER, roleDisplayName } from '../lib/roles.js';

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
  if (isLoading) return <div className="clb-empty" role="status"><h2>Đang tải thành viên…</h2></div>;
  if (isError) {
    return (
      <div className="clb-empty" role="alert">
        <h2>Chưa thể tải thành viên</h2>
        <p>{error?.message || 'Vui lòng thử lại.'}</p>
        <button type="button" className="clb-btn clb-btn--secondary" onClick={onRetry}>Thử lại</button>
      </div>
    );
  }
  if (!members?.length) return <ClubEmptyState title="Chưa có thành viên nào" />;

  const sorted = [...members].sort((a, b) => (ORDER_INDEX[a.role] ?? 99) - (ORDER_INDEX[b.role] ?? 99));

  return (
    <div className="clb-list">
      {sorted.map((member) => (
        <article className="clb-row" key={member.mssv}>
          <div className="clb-row__id">
            <ClubAvatar src={member.avatar_url} name={member.full_name || member.mssv} size="sm" />
            <div className="clb-row__copy">
              <strong>{member.full_name || member.mssv}</strong>
              <span>{member.mssv} · {safeNumber(member.contribution_points)} điểm đóng góp</span>
            </div>
          </div>

          <div className="clb-row__actions">
            <RoleBadge role={member.role} roleLabels={roleLabels} />
            {canAssignRoles && member.mssv !== myMssv && (
              <>
                <label className="clb-sr-only" htmlFor={`club-role-${member.mssv}`}>
                  Đổi vai trò của {member.full_name || member.mssv}
                </label>
                <select
                  id={`club-role-${member.mssv}`}
                  className="clb-select"
                  value={member.role}
                  disabled={actionPending}
                  onChange={(event) => {
                    if (event.target.value !== member.role) onRoleChange?.(member, event.target.value);
                  }}
                >
                  {ROLE_ORDER.map((role) => (
                    <option key={role} value={role}>{roleDisplayName(roleLabels, role)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="clb-btn clb-btn--danger-ghost clb-btn--sm"
                  disabled={actionPending}
                  onClick={() => onKick?.(member)}
                >
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
