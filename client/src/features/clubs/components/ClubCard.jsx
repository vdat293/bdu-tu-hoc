import { useNavigate } from 'react-router-dom';
import { cleanTag, initials, safeNumber } from '../lib/format.js';
import { resolveRoleLabel } from '../lib/roles.js';

// KHÔNG dùng cover-link absolute hack như ClansPage cũ.
// Card là <article>, tiêu đề là button navigate, footer có nút Mở CLB riêng.
export default function ClubCard({ club, onJoin, onCancelJoin, joinPending, cancelPending }) {
  const navigate = useNavigate();
  const open = () => navigate(`/clans/${club.id}`);
  const isJoined = Boolean(club.is_joined);
  const isPending = Boolean(club.has_pending_request);
  const { name: myRoleName } = resolveRoleLabel(club.role_labels, club.my_role);

  return (
    <article className="club-card" aria-label={club.name}>
      <div className="club-card__topline">
        <span className="club-avatar" aria-hidden="true">
          {club.avatar_url ? <img src={club.avatar_url} alt="" /> : initials(club.name)}
        </span>
        <div className="club-card__badges">
          <span className="club-tag">[{cleanTag(club.tag)}]</span>
          <span className="club-level">
            Cấp {safeNumber(club.level, 1)}{Number.isFinite(Number(club.xp)) ? ` · ${Number(club.xp)} XP` : ''}
          </span>
        </div>
        {club.my_role === 'leader' && <span className="club-chip">{myRoleName}</span>}
      </div>
      <div className="club-card__copy">
        <h2>
          <button type="button" className="club-card__title" onClick={open}>
            {club.name}
          </button>
        </h2>
        <p>{club.description || 'Không gian học tập, trao đổi kiến thức và tài liệu dành cho sinh viên BDU.'}</p>
      </div>
      <footer className="club-card__footer">
        <span className="club-member-count">{safeNumber(club.member_count)} thành viên</span>
        {isJoined ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={open}>Mở CLB</button>
        ) : isPending ? (
          <div className="club-pending-actions">
            <span className="club-chip">Đang chờ duyệt</span>
            <button type="button" className="club-text-action" onClick={() => onCancelJoin?.(club)} disabled={cancelPending}>
              Hủy yêu cầu
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onJoin?.(club)} disabled={joinPending}>
            Tham gia
          </button>
        )}
      </footer>
    </article>
  );
}
