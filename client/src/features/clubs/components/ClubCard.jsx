import { useNavigate } from 'react-router-dom';
import { cleanTag, safeNumber } from '../lib/format.js';
import { resolveRoleLabel } from '../lib/roles.js';
import { ClubAvatar } from './ClubPrimitives.jsx';

export default function ClubCard({ club, onJoin, onCancelJoin, joinPending, cancelPending }) {
  const navigate = useNavigate();
  const open = () => navigate(`/clans/${club.id}`);
  const isJoined = Boolean(club.is_joined);
  const isPending = Boolean(club.has_pending_request);
  const { name: myRoleName } = resolveRoleLabel(club.role_labels, club.my_role);

  return (
    <article className="clb-card" aria-label={club.name}>
      <div className="clb-card__head">
        <ClubAvatar src={club.avatar_url} name={club.name} />
        <div className="clb-card__meta">
          <span className="clb-card__tag">[{cleanTag(club.tag)}]</span>
          <span className="clb-card__level">
            Cấp {safeNumber(club.level, 1)}{Number.isFinite(Number(club.xp)) ? ` · ${Number(club.xp)} XP` : ''}
          </span>
        </div>
        {club.my_role === 'leader' && <span className="clb-chip clb-chip--accent">{myRoleName}</span>}
      </div>

      <div className="clb-card__body">
        <h2>
          <button type="button" className="clb-card__title" onClick={open}>
            {club.name}
          </button>
        </h2>
        <p className="clb-card__desc">
          {club.description || 'Không gian học tập, trao đổi kiến thức và tài liệu dành cho sinh viên BDU.'}
        </p>
      </div>

      <footer className="clb-card__foot">
        <span className="clb-card__count">{safeNumber(club.member_count)} thành viên</span>
        {isJoined ? (
          <button type="button" className="clb-btn clb-btn--secondary clb-btn--sm" onClick={open}>
            Mở CLB
          </button>
        ) : isPending ? (
          <div className="clb-card__pending">
            <span className="clb-chip clb-chip--warn">Đang chờ duyệt</span>
            <button
              type="button"
              className="clb-link-btn"
              onClick={() => onCancelJoin?.(club)}
              disabled={cancelPending}
            >
              Hủy yêu cầu
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="clb-btn clb-btn--primary clb-btn--sm"
            onClick={() => onJoin?.(club)}
            disabled={joinPending}
          >
            Tham gia
          </button>
        )}
      </footer>
    </article>
  );
}
