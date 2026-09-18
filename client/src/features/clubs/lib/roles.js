export const ROLE_ORDER = ['leader', 'vice_leader', 'elder', 'member', 'recruit'];

export const DEFAULT_LABELS = {
  leader: { name: 'Bang chủ', color: '#b45309' },
  vice_leader: { name: 'Phó bang', color: '#2563eb' },
  elder: { name: 'Trưởng lão', color: '#6d28d9' },
  member: { name: 'Thành viên', color: '#475569' },
  recruit: { name: 'Tân thành viên', color: '#78716c' }
};

function normalizeEntry(entry, fallback) {
  if (typeof entry === 'string' && entry.trim()) {
    return { name: entry.trim(), color: fallback.color };
  }
  if (entry && typeof entry === 'object') {
    // Backend map dùng { display_name, color }; editor dùng { name, color }.
    const name = String(entry.display_name ?? entry.name ?? entry.label ?? '').trim() || fallback.name;
    const color = String(entry.color ?? '').trim() || fallback.color;
    return { name, color };
  }
  return { ...fallback };
}

function entryFromArray(roleLabels, key) {
  if (!Array.isArray(roleLabels)) return undefined;
  // GET /api/community/clans/:id/roles trả về mảng [{ role_key, display_name, color }].
  return roleLabels.find((item) => String(item?.role_key ?? item?.role ?? item?.key ?? '') === key);
}

// roleLabels có thể là undefined (backend chưa migrate),
// map { role_key: string | { display_name|name|label, color } } (GET /clans attach),
// hoặc mảng [{ role_key, display_name, color }] (GET /roles).
// Luôn fallback về DEFAULT_LABELS nên UI không bao giờ gãy.
export function resolveRoleLabel(roleLabels, roleKey) {
  const key = String(roleKey || 'member');
  const fallback = DEFAULT_LABELS[key] || { name: key, color: '#64748b' };
  if (!roleLabels || typeof roleLabels !== 'object') return { ...fallback };
  const entry = Array.isArray(roleLabels) ? entryFromArray(roleLabels, key) : roleLabels[key];
  return normalizeEntry(entry, fallback);
}

export function roleDisplayName(roleLabels, roleKey) {
  return resolveRoleLabel(roleLabels, roleKey).name;
}

const PERMISSIONS = {
  leader: { canPost: true, canPoll: true, canReview: true, canManageMembers: true, canAssignRoles: true, canSettings: true, canDeleteAny: true },
  vice_leader: { canPost: true, canPoll: true, canReview: true, canManageMembers: true, canAssignRoles: false, canSettings: false, canDeleteAny: true },
  elder: { canPost: true, canPoll: true, canReview: false, canManageMembers: false, canAssignRoles: false, canSettings: false, canDeleteAny: false },
  member: { canPost: true, canPoll: false, canReview: false, canManageMembers: false, canAssignRoles: false, canSettings: false, canDeleteAny: false },
  recruit: { canPost: false, canPoll: false, canReview: false, canManageMembers: false, canAssignRoles: false, canSettings: false, canDeleteAny: false }
};

export function rolePermissions(roleLabels, roleKey) {
  const key = String(roleKey || 'member');
  const { name } = resolveRoleLabel(roleLabels, key);
  const base = PERMISSIONS[key] || PERMISSIONS.member;
  return { label: name, ...base };
}
