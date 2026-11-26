import { initials } from '../lib/format.js';
import { resolveRoleLabel } from '../lib/roles.js';

export function ClubAvatar({ src, name, size = 'md' }) {
  const sizeClass = size === 'sm' ? ' clb-avatar--sm' : size === 'lg' ? ' clb-avatar--lg' : '';
  return (
    <span className={`clb-avatar${sizeClass}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export function RoleBadge({ role, roleLabels }) {
  const { name, color } = resolveRoleLabel(roleLabels, role);
  return (
    <span className="clb-role-badge" style={{ '--role-color': color }}>
      {name}
    </span>
  );
}

export function ClubEmptyState({ title, hint, action }) {
  return (
    <div className="clb-empty">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function ClubCardSkeleton({ label = 'Đang tải CLB' } = {}) {
  return (
    <div className="clb-card" aria-busy="true" aria-label={label}>
      <div className="clb-card__head">
        <div className="clb-skeleton clb-skeleton--avatar" />
        <div className="clb-card__meta">
          <div className="clb-skeleton clb-skeleton--short" />
          <div className="clb-skeleton clb-skeleton--line" />
        </div>
      </div>
      <div className="clb-skeleton clb-skeleton--title" />
      <div className="clb-skeleton clb-skeleton--line" />
    </div>
  );
}

export function ClubPostSkeleton() {
  return (
    <div className="clb-post" aria-busy="true" aria-label="Đang tải bài viết">
      <div className="clb-skeleton clb-skeleton--title" />
      <div className="clb-skeleton clb-skeleton--line" />
      <div className="clb-skeleton clb-skeleton--short" />
    </div>
  );
}

export function ClubDocSkeleton() {
  return (
    <div className="clb-doc" aria-busy="true" aria-label="Đang tải tài liệu">
      <div className="clb-skeleton clb-skeleton--avatar" />
      <div className="clb-skeleton clb-skeleton--title" />
      <div className="clb-skeleton clb-skeleton--short" />
    </div>
  );
}

export function ClubIcon({ name, size = 16 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.9',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  };
  if (name === 'search') {
    return <svg {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
  }
  if (name === 'close') {
    return <svg {...props}><path d="M18 6 6 18M6 6l12 12" /></svg>;
  }
  if (name === 'folder') {
    return <svg {...props}><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
  }
  if (name === 'file') {
    return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>;
  }
  if (name === 'video') {
    return <svg {...props}><rect x="2" y="5" width="15" height="14" rx="2" /><path d="m17 10 5-3v10l-5-3Z" /></svg>;
  }
  if (name === 'link') {
    return <svg {...props}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
  }
  if (name === 'heart') {
    return <svg {...props}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" /></svg>;
  }
  if (name === 'comment') {
    return <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>;
  }
  return null;
}
