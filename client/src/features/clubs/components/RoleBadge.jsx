import { resolveRoleLabel } from '../lib/roles.js';

export default function RoleBadge({ role, roleLabels, className = '' }) {
  const { name, color } = resolveRoleLabel(roleLabels, role);
  return (
    <span
      className={`club-role-badge ${className}`.trim()}
      style={{ '--role-color': color, borderColor: color, color }}
      title={name}
    >
      {name}
    </span>
  );
}
