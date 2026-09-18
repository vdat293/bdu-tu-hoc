import { useState } from 'react';
import { formatRelativeTime, initials, safeNumber } from '../lib/format.js';
import RoleBadge from './RoleBadge.jsx';

function postKind(post) {
  if (post.category === 'poll' || post.poll) return 'Bình chọn';
  if (post.category === 'material') return 'Tài liệu';
  return 'Thảo luận';
}

function AttachmentRow({ attachment, postId, index }) {
  if (!attachment) return null;
  const target = attachment.direct_url || attachment.url || '#';
  const isVideo = ['youtube', 'video', 'drive_video'].includes(attachment.type);
  const typeLabel = attachment.type === 'drive_folder' ? 'Thư mục Drive' : attachment.type === 'drive_file' ? 'Tệp Drive' : isVideo ? 'Video' : 'Liên kết';
  return (
    <div>
      <div className="club-attachment">
        <div className="club-attachment__copy"><strong>{attachment.title || 'Tài liệu đính kèm'}</strong><span>{typeLabel}</span></div>
        <a href={target} target="_blank" rel="noopener noreferrer">Mở ↗</a>
      </div>
      {isVideo && attachment.embed_url && (
        <div className="club-video"><iframe src={attachment.embed_url} title={attachment.title || `Video đính kèm ${postId}-${index}`} allowFullScreen loading="lazy" /></div>
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
    <article className="club-post">
      <div className="club-post__meta">
        <div className="club-post__author">
          <span className="club-avatar club-avatar--sm" aria-hidden="true">
            {post.author?.avatar_url ? <img src={post.author.avatar_url} alt="" /> : initials(post.author?.name)}
          </span>
          <div className="club-post__author-copy">
            <strong>{post.author?.name || 'Thành viên CLB'}</strong>
            <span>
              <RoleBadge role={post.author?.clan_role || post.author?.role} roleLabels={roleLabels} /> ·{' '}
              <time dateTime={post.created_at}>{formatRelativeTime(post.created_at)}</time>
            </span>
          </div>
        </div>
        <div className="club-post__badges">
          {post.is_pinned && <span className="club-post__badge club-post__badge--pinned">Đã ghim</span>}
          <span className="club-post__badge">{postKind(post)}</span>
        </div>
      </div>

      <h3>{post.title || poll?.question || 'Bài đăng CLB'}</h3>
      {post.content && (
        <div>
          <p className={`club-post__content ${!expanded && longContent ? 'is-clamped' : ''}`}>{post.content}</p>
          {longContent && (
            <button type="button" className="club-text-action" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Thu gọn' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}

      {Array.isArray(post.attachments) && post.attachments.length > 0 && (
        <div className="club-attachments">
          {post.attachments.map((attachment, index) => (
            <AttachmentRow key={`${post.id}-${index}`} attachment={attachment} postId={post.id} index={index} />
          ))}
        </div>
      )}

      {poll && (
        <div className="club-poll">
          <p className="club-poll__question">{poll.question || post.title}</p>
          {(poll.options || []).map((option) => (
            <button
              key={option.id}
              type="button"
              className={`club-poll__option ${option.is_voted ? 'is-voted' : ''}`}
              style={{ '--vote': `${safeNumber(option.percentage)}%` }}
              onClick={() => onVote?.(poll.id, option.id)}
              disabled={votePending}
            >
              <span><span>{option.text || option.option_text}</span><span>{safeNumber(option.percentage)}%</span></span>
              <small className="club-poll__meta">{safeNumber(option.vote_count)} lượt chọn</small>
            </button>
          ))}
        </div>
      )}

      <footer className="club-post__footer">
        <div className="club-post__actions">
          <button type="button" className={post.is_liked ? 'is-active' : ''} onClick={() => onLike?.(post)} disabled={likePending}>
            ♥ {safeNumber(post.like_count)}
          </button>
          <button type="button" onClick={() => onToggleComments?.(post)}>
            💬 {safeNumber(commentCount ?? post.comment_count)}
          </button>
          {canDelete && (
            <button type="button" className="club-danger-text" onClick={() => onDelete?.(post)}>Xóa</button>
          )}
        </div>
      </footer>
      {commentsOpen && comments}
    </article>
  );
}
