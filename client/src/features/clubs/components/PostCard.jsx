import { useState } from 'react';
import { formatRelativeTime, safeNumber } from '../lib/format.js';
import { ClubAvatar, ClubIcon, RoleBadge } from './ClubPrimitives.jsx';

function postKind(post) {
  if (post.category === 'poll' || post.poll) return 'Bình chọn';
  if (post.category === 'material') return 'Tài liệu';
  return 'Thảo luận';
}

function AttachmentRow({ attachment, postId, index }) {
  if (!attachment) return null;
  const target = attachment.direct_url || attachment.url || '#';
  const isVideo = ['youtube', 'video', 'drive_video'].includes(attachment.type);
  const typeLabel = attachment.type === 'drive_folder'
    ? 'Thư mục Drive'
    : attachment.type === 'drive_file'
      ? 'Tệp Drive'
      : isVideo
        ? 'Video'
        : 'Liên kết';

  return (
    <div>
      <div className="clb-attachment">
        <div className="clb-attachment__copy">
          <strong>{attachment.title || 'Tài liệu đính kèm'}</strong>
          <span>{typeLabel}</span>
        </div>
        <a className="clb-link-btn" href={target} target="_blank" rel="noopener noreferrer">
          Mở ↗
        </a>
      </div>
      {isVideo && attachment.embed_url && (
        <div className="clb-video">
          <iframe
            src={attachment.embed_url}
            title={attachment.title || `Video đính kèm ${postId}-${index}`}
            allowFullScreen
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}

export default function PostCard({
  post,
  roleLabels,
  likePending,
  votePending,
  commentsOpen,
  commentCount,
  onLike,
  onToggleComments,
  onVote,
  onDelete,
  canDelete,
  comments
}) {
  const [expanded, setExpanded] = useState(false);
  const poll = post.poll;
  const longContent = String(post.content || '').length > 280;

  return (
    <article className="clb-post">
      <div className="clb-post__meta">
        <div className="clb-post__author">
          <ClubAvatar src={post.author?.avatar_url} name={post.author?.name} size="sm" />
          <div className="clb-post__author-info">
            <strong>{post.author?.name || 'Thành viên CLB'}</strong>
            <div className="clb-post__author-sub">
              <RoleBadge role={post.author?.clan_role || post.author?.role} roleLabels={roleLabels} />
              <span>·</span>
              <time dateTime={post.created_at}>{formatRelativeTime(post.created_at)}</time>
            </div>
          </div>
        </div>
        <div className="clb-post__badges">
          {post.is_pinned && <span className="clb-chip clb-chip--warn">Đã ghim</span>}
          <span className="clb-chip">{postKind(post)}</span>
        </div>
      </div>

      <h3>{post.title || poll?.question || 'Bài đăng CLB'}</h3>

      {post.content && (
        <div>
          <p className={`clb-post__content${!expanded && longContent ? ' is-clamped' : ''}`}>
            {post.content}
          </p>
          {longContent && (
            <button type="button" className="clb-link-btn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Thu gọn' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}

      {Array.isArray(post.attachments) && post.attachments.length > 0 && (
        <div className="clb-attachments">
          {post.attachments.map((attachment, index) => (
            <AttachmentRow key={`${post.id}-${index}`} attachment={attachment} postId={post.id} index={index} />
          ))}
        </div>
      )}

      {poll && (
        <div className="clb-poll">
          <p className="clb-poll__question">{poll.question || post.title}</p>
          {(poll.options || []).map((option) => (
            <button
              key={option.id}
              type="button"
              className={`clb-poll__option${option.is_voted ? ' is-voted' : ''}`}
              style={{ '--vote': `${safeNumber(option.percentage)}%` }}
              onClick={() => onVote?.(poll.id, option.id)}
              disabled={votePending}
            >
              <span className="clb-poll__row">
                <span>{option.text || option.option_text}</span>
                <span>{safeNumber(option.percentage)}%</span>
              </span>
              <small className="clb-poll__meta">{safeNumber(option.vote_count)} lượt chọn</small>
            </button>
          ))}
        </div>
      )}

      <footer className="clb-post__footer">
        <button
          type="button"
          className={`clb-post__action${post.is_liked ? ' is-active' : ''}`}
          onClick={() => onLike?.(post)}
          disabled={likePending}
        >
          <ClubIcon name="heart" size={15} />
          <span>{safeNumber(post.like_count)}</span>
        </button>
        <button
          type="button"
          className={`clb-post__action${commentsOpen ? ' is-active' : ''}`}
          onClick={() => onToggleComments?.(post)}
        >
          <ClubIcon name="comment" size={15} />
          <span>{safeNumber(commentCount ?? post.comment_count)}</span>
        </button>
        {canDelete && (
          <button
            type="button"
            className="clb-post__action clb-post__action--danger"
            onClick={() => onDelete?.(post)}
          >
            Xóa
          </button>
        )}
      </footer>

      {commentsOpen && comments}
    </article>
  );
}
