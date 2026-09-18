import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createCommunityPost,
  deleteCommunityPost,
  getCommunityPosts,
  toggleCommunityPostLike,
  getCommunityPostComments,
  addCommunityPostComment,
  updateCommunityPost
} from '../../api/community.js';
import { getMyIdentityPresentation, updateMyEquippedFrame, updateMyIdentityPresentation } from '../../api/identity.js';
import { getMyAcademicRanking, getProfile } from '../../api/academics.js';
import { useAuth, useRealtimeRoom, useRealtimeStatus, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import {
  AvatarContent,
  FrameArtwork,
  getAutomaticFrame,
  getEquippedFrame,
  getFrameOptions,
  getFrameCinematicMetadata,
  getIdentityName,
  getIdentityPhoto,
  getInitials,
  TitleBadges
} from '../../components/identity/Identity.jsx';
import { useFrameCinematic } from '../../components/identity/useFrameCinematic.js';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import MentionAutocomplete from './MentionAutocomplete.jsx';
import { renderContentWithMentions } from './renderMentions.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import {
  ChevronDownIcon,
  CommentIcon,
  DotsIcon,
  EditIcon,
  EmojiIcon,
  GifIcon,
  GlobeIcon,
  PhotoIcon,
  SendIcon,
  ShareIcon,
  StickerIcon,
  ThumbIcon,
  TrashIcon
} from './facebook-icons.jsx';

function postsFrom(data) {
  return Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
}

export const FORUM_FALLBACK_BURST_ATTEMPTS = 3;
const FORUM_FALLBACK_DELAY_MS = 8_000;
const FORUM_FALLBACK_INTERVAL_MS = 15_000;
const FORUM_FALLBACK_DEGRADED_INTERVAL_MS = 60_000;

export function shouldUseForumFallback(status) {
  return status !== 'ready' && status !== 'auth-invalid';
}

export function isForumCommentsQuery(query) {
  const key = query?.queryKey;
  // Forum comments use [post-comments, postId]; course comments carry the
  // course code too, so a forum fallback must not refetch another route.
  return Array.isArray(key) && key[0] === 'post-comments' && key.length === 2;
}

export function invalidateForumFallbackQueries(client, queryKey) {
  return Promise.all([
    client.invalidateQueries({ queryKey, exact: true, refetchType: 'active' }),
    client.invalidateQueries({ refetchType: 'active', predicate: isForumCommentsQuery })
  ]);
}

/**
 * Nghe sự kiện realtime của server (`bdu:realtime`) để cập nhật bảng tin.
 *
 * Trước đây client có mở socket nhưng không ai dùng event, nên khi socket khoẻ
 * thì feed lại đứng im (polling dự phòng chỉ chạy khi socket hỏng). Ở đây chỉ
 * làm mới những gì thật sự liên quan: bài mới/xoá thì làm mới feed; bình luận và
 * cảm xúc thì làm mới đúng thread đang mở, và chỉ làm mới feed khi bài đó đang
 * nằm trong danh sách hiển thị.
 */
function useCommunityRealtimeSync(client) {
  useEffect(() => {
    const handle = (event) => {
      const message = event?.detail;
      const type = String(message?.type || '');
      if (!type.startsWith('community.')) return;
      const data = message?.data || {};

      if (type === 'community.post.created' || type === 'community.post.deleted') {
        client.invalidateQueries({ queryKey: ['confession'] });
        return;
      }

      if (!data.postId) return;
      const postId = String(data.postId);

      if (type.startsWith('community.comment.')) {
        client.invalidateQueries({ queryKey: ['post-comments', postId] });
      }

      const isVisibleInFeed = client
        .getQueriesData({ queryKey: ['confession'] })
        .some(([, data2]) => postsFrom(data2).some((post) => String(post.id) === postId));
      if (isVisibleInFeed) client.invalidateQueries({ queryKey: ['confession'] });
    };

    window.addEventListener('bdu:realtime', handle);
    return () => window.removeEventListener('bdu:realtime', handle);
  }, [client]);
}

function realtimeStatusMeta(status) {
  if (status === 'ready') return { label: 'Cập nhật trực tiếp', tone: 'ready' };
  if (status === 'connecting') return { label: 'Đang kết nối cập nhật', tone: 'connecting' };
  if (status === 'reconnecting') return { label: 'Đang kết nối lại', tone: 'reconnecting' };
  if (status === 'unavailable') return { label: 'Cập nhật trực tiếp tạm gián đoạn', tone: 'unavailable' };
  if (status === 'auth-invalid') return { label: 'Phiên cập nhật đã hết hạn', tone: 'unavailable' };
  return { label: 'Cập nhật trực tiếp chưa sẵn sàng', tone: 'unavailable' };
}

function useForumRealtimeFallback({ token, status, client, queryKey }) {
  const fallbackRef = useRef({ timer: null, attempts: 0, requestKey: '', config: null, schedule: null });
  const requestKey = `${token || ''}:${queryKey.join('|')}`;

  useEffect(() => {
    const fallback = fallbackRef.current;
    fallback.config = { token, status, client, queryKey };
    if (fallback.requestKey !== requestKey) {
      window.clearTimeout(fallback.timer);
      fallback.timer = null;
      fallback.attempts = 0;
      fallback.requestKey = requestKey;
    }
    if (!token || !shouldUseForumFallback(status)) {
      window.clearTimeout(fallback.timer);
      fallback.timer = null;
      fallback.attempts = 0;
      return undefined;
    }
    if (fallback.timer !== null) return undefined;

    const schedule = (delay) => {
      fallback.timer = window.setTimeout(() => {
        fallback.timer = null;
        const current = fallback.config;
        if (!current?.token || !shouldUseForumFallback(current.status)) return;
        fallback.attempts += 1;
        invalidateForumFallbackQueries(current.client, current.queryKey).catch(() => { });
        schedule(fallback.attempts < FORUM_FALLBACK_BURST_ATTEMPTS
          ? FORUM_FALLBACK_INTERVAL_MS
          : FORUM_FALLBACK_DEGRADED_INTERVAL_MS);
      }, delay);
    };
    fallback.schedule = schedule;
    schedule(fallback.attempts === 0 ? FORUM_FALLBACK_DELAY_MS
      : (fallback.attempts < FORUM_FALLBACK_BURST_ATTEMPTS ? FORUM_FALLBACK_INTERVAL_MS : FORUM_FALLBACK_DEGRADED_INTERVAL_MS));
    return undefined;
  }, [client, queryKey, requestKey, status, token]);

  useEffect(() => () => {
    window.clearTimeout(fallbackRef.current.timer);
    fallbackRef.current.timer = null;
  }, []);
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Vừa xong';
  const now = new Date();
  const past = new Date(dateStr);
  const diffSec = Math.floor((now - past) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return past.toLocaleDateString('vi-VN');
}

function memberTitle() {
  return { id: 'member:bdu', label: 'Sinh viên BDU', detail: 'Thành viên cộng đồng Đại học Bình Dương', tone: 'member' };
}

function titlesForPost(post, user, presentation) {
  if (post.author?.is_anonymous) return [];
  const postTitles = Array.isArray(post.author?.titles) ? post.author.titles : [];
  const isCurrentAuthor = Boolean(post.is_mine || (user?.mssv && String(post.author?.mssv) === String(user.mssv)));
  if (postTitles.length) return postTitles;
  if (isCurrentAuthor && Array.isArray(presentation?.selected_titles) && presentation.selected_titles.length) {
    return presentation.selected_titles;
  }
  return [memberTitle()];
}

function postAvatarUser(post, user, presentation) {
  const isCurrentAuthor = Boolean(post.is_mine || (user?.mssv && String(post.author?.mssv) === String(user.mssv)));
  if (!isCurrentAuthor) return post.author;
  return {
    ...post.author,
    name: getIdentityName(user, presentation),
    photo_url: getIdentityPhoto(user, presentation)
  };
}

function profilePhotoFrom(response) {
  const raw = response?.data || response || {};
  const profile = Array.isArray(raw)
    ? raw[0]
    : raw?.ds_thong_tin_sinh_vien?.[0]
    || raw?.thong_tin_sinh_vien?.[0]
    || raw?.student
    || raw;
  return response?.student_image
    || raw?.student_image
    || profile?.student_image
    || profile?.hinh_anh
    || profile?.url_hinh_anh
    || profile?.image
    || profile?.anh_the
    || '';
}

/** Facebook hiển thị thời gian kiểu "6 giờ", "51 phút", không kèm chữ "trước". */function formatFacebookTime(dateStr) {
  return formatRelativeTime(dateStr).replace(' trước', '');
}

function attachmentHost(url) {
  try {
    return new URL(String(url || ''), window.location.origin).hostname.replace(/^www\./, '') || 'liên kết';
  } catch {
    return 'liên kết';
  }
}

/**
 * Link preview kiểu Facebook: nền xám, domain in hoa, tiêu đề đậm.
 */
function FacebookLinkPreview({ attachment }) {
  const targetUrl = attachment.direct_url || attachment.url || '#';
  return (
    <a className="fbc-link-card" href={targetUrl} target="_blank" rel="noopener noreferrer">
      <span className="fbc-link-host">{attachmentHost(targetUrl)}</span>
      <span className="fbc-link-title">{attachment.title || 'Liên kết tham khảo'}</span>
      <span className="fbc-link-cta">Mở liên kết</span>
    </a>
  );
}

function AttachmentRenderer({ attachment }) {
  if (!attachment) return null;
  const targetUrl = attachment.direct_url || attachment.url || '#';
  const isVideo = attachment.type === 'youtube' || attachment.type === 'video';
  const isDrive = attachment.type === 'drive_file' || attachment.type === 'drive_folder';

  if (isVideo && attachment.embed_url) {
    return (
      <div className="fbc-embed">
        <div className="fbc-embed-bar">
          <span className="fbc-embed-badge">{attachment.type === 'youtube' ? 'YouTube' : 'Video Drive'}</span>
          <span className="fbc-embed-title">{attachment.title || 'Video đính kèm'}</span>
          {attachment.download_url && (
            <a href={attachment.download_url} target="_blank" rel="noopener noreferrer">Tải về</a>
          )}
          <a href={targetUrl} target="_blank" rel="noopener noreferrer">Mở ↗</a>
        </div>
        <div className="fbc-embed-frame">
          <iframe
            src={attachment.embed_url}
            title={attachment.title || 'Video'}
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (isDrive) {
    return (
      <a className="fbc-link-card" href={targetUrl} target="_blank" rel="noopener noreferrer">
        <span className="fbc-link-host">{attachmentHost(targetUrl)}</span>
        <span className="fbc-link-title">{attachment.title || 'Tài liệu Google Drive'}</span>
        <span className="fbc-link-cta">
          {attachment.download_url ? 'Xem · Tải về' : 'Mở liên kết'}
        </span>
      </a>
    );
  }

  return <FacebookLinkPreview attachment={attachment} />;
}

/**
 * Ảnh gom thành lưới như Facebook; các đính kèm khác render riêng.
 * Link bài gốc Facebook không hiện thành thẻ nữa — nó nằm ở tên tác giả.
 */
function PostAttachments({ attachments, sourceUrl = null }) {
  const list = (Array.isArray(attachments) ? attachments : [])
    .filter(Boolean)
    .filter((item) => !(sourceUrl && item.url === sourceUrl));
  if (!list.length) return null;

  const photos = list.filter((item) => item.type === 'image' && item.url);
  const others = list.filter((item) => !(item.type === 'image' && item.url));

  return (
    <>
      {photos.length > 0 && (
        <div className={`fbc-photo-grid is-count-${Math.min(photos.length, 4)}`}>
          {photos.map((photo, index) => (
            <a
              key={`${photo.url}-${index}`}
              className="fbc-photo"
              href={photo.direct_url || photo.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={photo.url} alt={photo.title || 'Ảnh bài viết'} loading="lazy" decoding="async" />
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="fbc-attachments">
          {others.map((item, index) => <AttachmentRenderer key={`${item.url}-${index}`} attachment={item} />)}
        </div>
      )}
    </>
  );
}

function commentAuthorName(comment) {
  if (comment?.author?.is_anonymous) return 'Sinh viên giấu tên';
  return comment?.author?.name || 'Sinh viên BDU';
}

function CommentAvatar({ comment }) {
  const name = commentAuthorName(comment);
  if (comment?.author?.is_anonymous) {
    return <span className="fbc-avatar fbc-avatar-anon" aria-hidden="true">?</span>;
  }
  return (
    <span className="fbc-avatar">
      <AvatarContent user={comment?.author} alt={`Ảnh của ${name}`} />
    </span>
  );
}

function CommentItem({ comment, isReply = false, onReply }) {
  const name = commentAuthorName(comment);
  return (
    <div className={`fbc-comment ${isReply ? 'is-reply' : ''} ${comment.is_deleted ? 'is-deleted' : ''}`}>
      <CommentAvatar comment={comment} />
      <div className="fbc-comment-body">
        <div className="fbc-bubble">
          <span className="fbc-bubble-name">{name}</span>
          <span className="fbc-bubble-text">{renderContentWithMentions(comment.content, comment.mentions)}</span>
        </div>
        <div className="fbc-comment-meta">
          {onReply && !comment.is_deleted ? (
            <>
              <button type="button" className="fbc-meta-action" onClick={() => onReply(comment)}>Trả lời</button>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="fbc-meta-time">{formatFacebookTime(comment.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function PostCommentsInline({ postId, token, viewer, presentation, composerInputRef = null }) {
  const [newComment, setNewComment] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [expandedThreads, setExpandedThreads] = useState({});
  const mentionInputRef = useRef(null);
  const client = useQueryClient();
  const { notify } = useToasts();
  useRealtimeRoom(postId ? `community-post:${postId}` : null, Boolean(token));

  // Giữ khả năng focus từ popup chi tiết bài viết (composerInputRef) đồng thời
  // cho MentionAutocomplete theo dõi caret để gợi ý @MSSV.
  const mergeCommentInputRefs = (node) => {
    mentionInputRef.current = node;
    if (typeof composerInputRef === 'function') composerInputRef(node);
    else if (composerInputRef && typeof composerInputRef === 'object') composerInputRef.current = node;
  };

  const commentsQuery = useQuery({
    queryKey: ['post-comments', String(postId)],
    queryFn: ({ signal }) => getCommunityPostComments(token, postId, { signal }),
    enabled: Boolean(token && postId)
  });

  const commentMutation = useMutation({
    mutationFn: () => addCommunityPostComment(token, postId, {
      content: newComment.trim(),
      ...(replyTarget ? { parentId: replyTarget.id } : {}),
      isAnonymous
    }),
    onSuccess: () => {
      setNewComment('');
      setReplyTarget(null);
      client.invalidateQueries({ queryKey: ['post-comments', String(postId)] });
      client.invalidateQueries({ queryKey: ['confession'] });
      notify('Đã gửi bình luận.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  // API trả về danh sách phẳng; gom reply về đúng bình luận gốc như Facebook.
  const threads = useMemo(() => {
    const data = commentsQuery.data;
    const list = Array.isArray(data?.comments) ? data.comments : Array.isArray(data) ? data : [];
    const roots = list.filter((comment) => !comment.parent_id);
    const repliesByRoot = new Map();
    list.forEach((comment) => {
      if (!comment.parent_id) return;
      const key = String(comment.parent_id);
      if (!repliesByRoot.has(key)) repliesByRoot.set(key, []);
      repliesByRoot.get(key).push(comment);
    });
    return roots.map((root) => ({ root, replies: repliesByRoot.get(String(root.id)) || [] }));
  }, [commentsQuery.data]);

  const toggleThread = (rootId) => setExpandedThreads((current) => ({ ...current, [rootId]: !current[rootId] }));
  const replyLabel = replyTarget ? commentAuthorName(replyTarget) : '';

  return (
    <div className="fbc-comments">
      {commentsQuery.isLoading ? (
        <div className="fbc-comments-empty">Đang tải bình luận...</div>
      ) : threads.length === 0 ? (
        <div className="fbc-comments-empty">Chưa có bình luận nào. Hãy là người đầu tiên!</div>
      ) : (
        threads.map(({ root, replies }) => {
          const expanded = Boolean(expandedThreads[root.id]);
          const visibleReplies = expanded ? replies : replies.slice(0, 2);
          return (
            <div className="fbc-thread" key={root.id}>
              <CommentItem comment={root} onReply={setReplyTarget} />

              {replies.length > 2 && (
                <button
                  type="button"
                  className="fbc-replies-toggle"
                  onClick={() => toggleThread(root.id)}
                  aria-expanded={expanded}
                >
                  <ChevronDownIcon className={expanded ? 'is-open' : ''} />
                  {expanded ? 'Ẩn câu trả lời' : `Xem ${replies.length} câu trả lời`}
                </button>
              )}

              {visibleReplies.length > 0 && (
                <div className="fbc-replies">
                  {visibleReplies.map((reply) => (
                    <CommentItem key={reply.id} comment={reply} isReply onReply={setReplyTarget} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      <form
        className="fbc-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (newComment.trim()) commentMutation.mutate();
        }}
      >
        <span className={`fbc-avatar ${isAnonymous ? 'fbc-avatar-anon' : ''}`.trim()}>
          {isAnonymous ? '?' : <AvatarContent user={viewer} presentation={presentation} alt="Ảnh của bạn" />}
        </span>
        <div className="fbc-composer-field">
          {replyTarget && (
            <div className="fbc-reply-chip">
              <span>Đang trả lời <strong>{replyLabel}</strong></span>
              <button type="button" onClick={() => setReplyTarget(null)} aria-label="Huỷ trả lời">×</button>
            </div>
          )}
          <div className="fbc-composer-row">
            <MentionAutocomplete value={newComment} onChange={setNewComment} token={token} inputRef={mergeCommentInputRefs} dropUp>
              <input
                type="text"
                className="fbc-composer-input"
                placeholder={replyTarget ? `Trả lời ${replyLabel}...` : 'Viết bình luận...'}
                maxLength={2000}
                aria-label="Nội dung bình luận"
              />
            </MentionAutocomplete>
            <button
              type="button"
              className={`fbc-anon-toggle ${isAnonymous ? 'is-on' : ''}`}
              onClick={() => setIsAnonymous((current) => !current)}
              aria-pressed={isAnonymous}
              title="Bình luận dưới tên Sinh viên giấu tên"
            >
              <span className="fbc-anon-mark" aria-hidden="true">{isAnonymous ? '✓' : ''}</span>
              Ẩn danh
            </button>
            <span className="fbc-composer-tools" aria-hidden="true">
              <EmojiIcon size={19} />
              <PhotoIcon size={19} />
              <GifIcon size={19} />
              <StickerIcon size={19} />
            </span>
            <button
              type="submit"
              className="fbc-send"
              disabled={commentMutation.isPending || !newComment.trim()}
              aria-label="Gửi bình luận"
            >
              <SendIcon size={17} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function facebookSourceUrl(post) {
  const list = Array.isArray(post?.attachments) ? post.attachments : [];
  const source = list.find(
    (item) => item?.type === 'link' && /^https?:\/\/(www\.)?facebook\.com\//i.test(String(item.url || ''))
  );
  return source?.url || null;
}

/**
 * Tên tác giả: với bài nhập từ Facebook thì bấm vào tên là mở bài gốc, thay cho
 * thẻ link "Bài gốc trên Facebook" trông như hyperlink của Word.
 */
function PostAuthorName({ post, name, isAnon }) {
  const source = isAnon ? null : facebookSourceUrl(post);
  if (!source) return <strong className="fbc-post-name">{name}</strong>;
  return (
    <a
      className="fbc-post-name fbc-name-link"
      href={source}
      target="_blank"
      rel="noopener noreferrer"
      title="Mở bài gốc trên Facebook"
    >
      {name}
    </a>
  );
}

function PostHeaderBlock({ post, authorName, isAnon, author, postFrame, authorTitles, children }) {
  // Giữ class `forum-avatar` vì toàn bộ hình học khung (Sukuna, artwork, hiệu
  // ứng toả sáng) được CSS legacy bám vào `.forum-avatar.has-inline-frame`.
  // `fbc-avatar` chỉ lo phần giao diện kiểu Facebook.
  return (
    <div className="fbc-post-head">
      <div className={`forum-avatar fbc-avatar fbc-avatar-post ${isAnon ? 'fbc-avatar-anon' : ''} ${postFrame ? `has-inline-frame has-frame-${postFrame.tier} has-frame-scope-${postFrame.scope} ${postFrame.family ? `has-frame-${postFrame.family}` : ''}` : ''}`.trim()}>
        {isAnon ? '?' : <AvatarContent user={author} alt={`Ảnh của ${authorName}`} />}
        {postFrame && <FrameArtwork frame={postFrame} />}
      </div>

      <div className="fbc-post-who">
        <div className="fbc-post-name-line">
          <PostAuthorName post={post} name={authorName} isAnon={isAnon} />
          {isAnon
            ? <span className="fbc-tag is-anon">Ẩn danh</span>
            : <TitleBadges titles={authorTitles} className="identity-title-forum" />}
        </div>
        <div className="fbc-post-meta">
          <span>{formatFacebookTime(post.created_at)}</span>
          {post.edited_at && (
            <>
              <span className="fbc-meta-dot" aria-hidden="true">·</span>
              <span>Đã chỉnh sửa</span>
            </>
          )}
          <span className="fbc-meta-dot" aria-hidden="true">·</span>
          <GlobeIcon size={12} />
          <span className="fbc-sr-only">Công khai trong trường</span>
        </div>
      </div>

      <div className="fbc-post-head-right">{children}</div>
    </div>
  );
}

/**
 * Menu "..." của bài viết. Tác giả thấy nút với bài của mình; quản trị viên
 * (capability `community:post_update_any` / `community:post_delete_any`) thấy
 * nút trên toàn bộ bài viết.
 */
function PostOptionsMenu({ post, open, onToggle, onEdit, onDelete, pending }) {
  const canEdit = Boolean(post.is_mine || post.can_edit);
  const canDelete = Boolean(post.is_mine || post.can_delete);
  if (!canEdit && !canDelete) return null;

  return (
    <div className="fbc-menu-wrap">
      <button
        type="button"
        className={`fbc-icon-btn ${open ? 'is-open' : ''}`}
        onClick={onToggle}
        title="Tuỳ chọn bài viết"
        aria-label="Tuỳ chọn bài viết"
        aria-expanded={open}
      >
        <DotsIcon size={18} />
      </button>
      {open && (
        <div className="fbc-menu" role="menu">
          {canEdit && (
            <button
              type="button"
              role="menuitem"
              className="fbc-menu-item"
              onClick={onEdit}
            >
              <EditIcon size={16} />
              Chỉnh sửa bài viết
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className="fbc-menu-item is-danger"
              onClick={onDelete}
              disabled={pending}
            >
              <TrashIcon size={16} />
              Xóa bài viết
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PostContent({ post }) {
  return (
    <>
      {post.title && post.title !== 'BDU Confession' && (
        <h4 className="fbc-post-title">{post.title}</h4>
      )}
      {post.content && <p className="fbc-post-text">{renderContentWithMentions(post.content, post.mentions)}</p>}
      <PostAttachments attachments={post.attachments} sourceUrl={facebookSourceUrl(post)} />
    </>
  );
}

function PostStats({ post, onOpenComments }) {
  const likeCount = Number(post.like_count || 0);
  const commentCount = Number(post.comment_count || 0);
  return (
    <div className="fbc-counts">
      <span className="fbc-counts-like">
        {likeCount > 0 && (
          <>
            <span className="fbc-reaction-bubble"><ThumbIcon size={12} filled /></span>
            <span>{likeCount}</span>
          </>
        )}
      </span>
      <span className="fbc-counts-right">
        {commentCount > 0 && (
          <button type="button" className="fbc-count-btn" onClick={onOpenComments}>
            {commentCount} bình luận
          </button>
        )}
      </span>
    </div>
  );
}

function PostActionBar({ post, isLiked, likePending, onLike, onOpenComments, onShare, commentsOpen = false }) {
  return (
    <div className="fbc-action-bar">
      <button
        type="button"
        className={`fbc-action ${isLiked ? 'is-liked' : ''}`}
        onClick={onLike}
        disabled={likePending}
        aria-pressed={isLiked}
      >
        <ThumbIcon size={19} filled={isLiked} />
        <span>{isLiked ? 'Đã thích' : 'Thích'}</span>
      </button>

      <button
        type="button"
        className={`fbc-action ${commentsOpen ? 'is-active' : ''}`}
        onClick={onOpenComments}
      >
        <CommentIcon size={19} />
        <span>Bình luận</span>
      </button>

      <button type="button" className="fbc-action" onClick={onShare}>
        <ShareIcon size={19} />
        <span>Chia sẻ</span>
      </button>
    </div>
  );
}

/**
 * Popup chi tiết bài viết kiểu Facebook: tiêu đề "Bài viết của ...", nội dung
 * cuộn được, bình luận ở dưới và ô soạn bình luận dính đáy popup.
 */
function PostDetailModal({
  post,
  token,
  viewer,
  presentation,
  onClose,
  onLike,
  onShare,
  likePending,
  dialogRef,
  closeButtonRef,
  composerInputRef,
  optionsMenu = null
}) {
  if (!post) return null;

  const isAnon = Boolean(post.author?.is_anonymous);
  const authorName = isAnon ? 'Sinh viên giấu tên' : post.author?.name || 'Sinh viên BDU';
  const author = postAvatarUser(post, viewer, presentation);
  const postFrame = !isAnon && getEquippedFrame(post.author?.equipped_frame_id)?.family === 'anime-sukuna'
    ? getEquippedFrame(post.author?.equipped_frame_id)
    : null;
  const scopeLabel = post.scope === 'faculty' ? 'Viện / Khoa' : post.scope === 'institute' ? 'Viện' : post.scope === 'clan' ? 'CLB / Nhóm' : 'Toàn trường';
  const focusComposer = () => composerInputRef.current?.focus();

  return (
    <ViewportModal
      id="fbc-post-modal"
      title={`Bài viết của ${authorName}`}
      labelledBy="fbc-post-modal-title"
      onClose={onClose}
      dialogRef={dialogRef}
      className="fbc-modal"
    >
      <div className="fbc-modal-head">
        <h4 className="fbc-modal-title" id="fbc-post-modal-title">Bài viết của {authorName}</h4>
        <button
          ref={closeButtonRef}
          type="button"
          className="fbc-icon-btn fbc-modal-close"
          onClick={onClose}
          aria-label="Đóng bài viết"
        >
          ×
        </button>
      </div>

      <div className="fbc-modal-body">
        <PostHeaderBlock
          post={post}
          authorName={authorName}
          isAnon={isAnon}
          author={author}
          postFrame={postFrame}
          authorTitles={titlesForPost(post, viewer, presentation)}
        >
          <span className="fbc-scope-pill">{scopeLabel}</span>
          {optionsMenu}
        </PostHeaderBlock>

        <PostContent post={post} />
        <PostStats post={post} onOpenComments={focusComposer} />
        <PostActionBar
          post={post}
          isLiked={Boolean(post.is_liked)}
          likePending={likePending}
          onLike={onLike}
          onOpenComments={focusComposer}
          onShare={onShare}
          commentsOpen
        />

        <div className="fbc-comments-wrapper">
          <PostCommentsInline
            postId={post.id}
            token={token}
            viewer={viewer}
            presentation={presentation}
            composerInputRef={composerInputRef}
          />
        </div>
      </div>
    </ViewportModal>
  );
}

export default function ConfessionPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const realtimeStatus = useRealtimeStatus();
  const [params, setParams] = useSearchParams();

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);  const [showFrameModal, setShowFrameModal] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [postMenuId, setPostMenuId] = useState(null);
  const [confirmUI, askConfirm] = useConfirm();

  const confirmDeletePost = async (postId) => {
    setPostMenuId(null);
    const ok = await askConfirm({
      title: 'Xóa bài viết?',
      message: 'Bài viết sẽ bị xóa khỏi bảng tin và không thể khôi phục.',
      confirmText: 'Xóa bài viết',
      danger: true
    });
    if (ok) remove.mutate(postId);
  };
  const [openPostId, setOpenPostId] = useState(null);
  const [editPostId, setEditPostId] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: '', content: '', isAnonymous: true });
  const editDialogRef = useRef(null);
  const editCloseButtonRef = useRef(null);
  const editOpenerRef = useRef(null);
  const postDialogRef = useRef(null);
  const postCloseButtonRef = useRef(null);
  const postOpenerRef = useRef(null);
  const postComposerInputRef = useRef(null);
  const composerTextareaRef = useRef(null);
  const editTextareaRef = useRef(null);
  const [titleSelection, setTitleSelection] = useState([]);
  const titleDialogRef = useRef(null);
  const titleCloseButtonRef = useRef(null);
  const titleOpenerRef = useRef(null);
  const frameDialogRef = useRef(null);
  const frameCloseButtonRef = useRef(null);
  const frameOpenerRef = useRef(null);
  const createDialogRef = useRef(null);
  const createCloseButtonRef = useRef(null);
  const createOpenerRef = useRef(null);
  const heroBannerRef = useRef(null);
  const heroAvatarRef = useRef(null);
  const frameAnnouncementRef = useRef(null);
  const frameParticleFieldRef = useRef(null);

  const closeTitleCustomizer = useCallback(() => setShowTitleModal(false), []);
  const closeFramePicker = useCallback(() => setShowFrameModal(false), []);
  const closeEditPost = useCallback(() => setEditPostId(null), []);
  const openFramePicker = useCallback((event) => {
    frameOpenerRef.current = event?.currentTarget || null;
    setShowFrameModal(true);
  }, []);

  useViewportDialog(showTitleModal, closeTitleCustomizer, titleDialogRef, titleCloseButtonRef, titleOpenerRef);
  useViewportDialog(showFrameModal, closeFramePicker, frameDialogRef, frameCloseButtonRef, frameOpenerRef);
  useViewportDialog(showCreateModal, () => setShowCreateModal(false), createDialogRef, createCloseButtonRef, createOpenerRef);
  useViewportDialog(editPostId !== null, closeEditPost, editDialogRef, editCloseButtonRef, editOpenerRef);

  // Composer draft
  const [draft, setDraft] = useState({
    title: '',
    content: '',
    url: '',
    urlTitle: '',
    scope: 'school',
    isAnonymous: true,
    category: 'confession'
  });

  const filter = ['all', 'mine', 'anon'].includes(params.get('filter')) ? params.get('filter') : 'all';
  const queryKey = useMemo(() => ['confession', auth.user?.mssv, filter], [auth.user?.mssv, filter]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      getCommunityPosts(auth.token, {
        // The server's forum scope aggregates school, faculty, and institute
        // posts. Using `school` here made those latter posts disappear.
        scope: 'forum',
        scopeId: null,
        filter,
        category: filter === 'anon' ? 'confession' : undefined,
        limit: 50,
        signal
      }),
    enabled: Boolean(auth.token)
  });

  useRealtimeRoom('forum', Boolean(auth.token));
  useCommunityRealtimeSync(client);
  // The primary query owns the first snapshot. This only supplies a bounded
  // cadence while the live gateway remains unavailable.
  useForumRealtimeFallback({ token: auth.token, status: realtimeStatus, client, queryKey });

  const presentationQuery = useQuery({
    queryKey: ['identity-presentation', auth.user?.mssv],
    queryFn: ({ signal }) => getMyIdentityPresentation(auth.token, { signal }),
    enabled: Boolean(auth.token),
    staleTime: 5 * 60 * 1000
  });

  const profileQuery = useQuery({
    queryKey: ['profile', auth.user?.mssv],
    queryFn: ({ signal }) => getProfile(auth.token, { idsv: auth.user?.idsv, mssv: auth.user?.mssv, signal }),
    enabled: Boolean(auth.token),
    staleTime: 5 * 60 * 1000
  });

  const rankingQuery = useQuery({
    queryKey: ['academic-ranking', auth.user?.mssv],
    queryFn: ({ signal }) => getMyAcademicRanking(auth.token, { signal }),
    enabled: Boolean(auth.token && !presentationQuery.data?.equipped_frame_id),
    staleTime: 5 * 60 * 1000
  });

  const saveTitles = useMutation({
    mutationFn: (selectedTitleIds) => updateMyIdentityPresentation(auth.token, selectedTitleIds),
    onSuccess: (nextPresentation) => {
      client.setQueryData(['identity-presentation', auth.user?.mssv], nextPresentation);
      client.invalidateQueries({ queryKey: ['confession'] });
      closeTitleCustomizer();
      notify('Đã cập nhật danh hiệu hiển thị.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const equipFrame = useMutation({
    mutationFn: (frameId) => updateMyEquippedFrame(auth.token, frameId),
    onSuccess: (nextPresentation) => {
      client.setQueryData(['identity-presentation', auth.user?.mssv], nextPresentation);
      closeFramePicker();
      notify('Đã cập nhật khung đại diện.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const create = useMutation({
    mutationFn: () =>
      createCommunityPost(auth.token, {
        title: draft.title.trim() || 'BDU Confession',
        content: draft.content.trim(),
        scope: draft.scope,
        scopeId: null,
        category: draft.category,
        isAnonymous: draft.isAnonymous,
        attachments: draft.url.trim() ? [{ url: draft.url.trim(), title: draft.urlTitle.trim() || draft.title.trim() || 'Tài liệu đính kèm' }] : []
      }),
    onSuccess: () => {
      setDraft({
        title: '',
        content: '',
        url: '',
        urlTitle: '',
        scope: 'school',
        isAnonymous: true,
        category: 'confession'
      });
      setShowCreateModal(false);
      client.invalidateQueries({ queryKey: ['confession'] });
      notify('Đã đăng bài viết thành công.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const like = useMutation({
    mutationFn: (postId) => toggleCommunityPostLike(auth.token, postId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['confession'] }),
    onError: (error) => notify(error.message, 'error')
  });

  const remove = useMutation({
    mutationFn: (postId) => deleteCommunityPost(auth.token, postId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['confession'] });
      notify('Đã xóa bài viết.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const update = useMutation({
    mutationFn: ({ postId, changes }) => updateCommunityPost(auth.token, postId, changes),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['confession'] });
      notify('Đã cập nhật bài viết.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const openEditPost = useCallback((post, event = null) => {
    editOpenerRef.current = event?.currentTarget || document.activeElement;
    setEditDraft({
      title: post.title && post.title !== 'BDU Confession' ? post.title : '',
      content: post.content || '',
      isAnonymous: Boolean(post.is_anonymous ?? post.author?.is_anonymous)
    });
    setPostMenuId(null);
    setEditPostId(post.id);
  }, []);

  const submitEditPost = () => {
    if (editPostId === null) return;
    const content = editDraft.content.trim();
    if (!content) {
      notify('Vui lòng nhập nội dung bài viết.', 'warning');
      return;
    }
    update.mutate({
      postId: editPostId,
      changes: {
        title: editDraft.title.trim() || 'BDU Confession',
        content,
        isAnonymous: editDraft.isAnonymous
      }
    }, { onSuccess: () => setEditPostId(null) });
  };

  const rawPosts = useMemo(() => postsFrom(query.data), [query.data]);
  const posts = useMemo(() => {
    if (filter === 'mine') return rawPosts.filter((p) => Boolean(p.is_mine));
    if (filter === 'anon') return rawPosts.filter((p) => Boolean(p.author?.is_anonymous));
    return rawPosts;
  }, [rawPosts, filter]);

  const updateFilter = (value) => {
    const next = new URLSearchParams(params);
    next.set('filter', value);
    setParams(next, { replace: false });
  };

  // Deep-link từ chuông thông báo: /confession?postId=...&commentId=...
  // (giữ tương thích link chia sẻ cũ ?post=...). Đợi feed load rồi mới
  // scroll tới bài, highlight tạm; có commentId thì mở luôn popup chi tiết.
  const deepPostId = params.get('postId') || params.get('post');
  const deepCommentId = params.get('commentId');
  useEffect(() => {
    if (!deepPostId || query.isLoading || posts.length === 0) return undefined;
    if (deepCommentId) setOpenPostId(deepPostId);
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`cfs-post-${deepPostId}`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('is-highlighted');
      window.setTimeout(() => target.classList.remove('is-highlighted'), 2600);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [deepPostId, deepCommentId, posts.length, query.isLoading]);

  const presentation = presentationQuery.data;
  const displayName = getIdentityName(auth.user, presentation);
  const selectedTitles = presentation?.selected_titles?.length ? presentation.selected_titles : [memberTitle()];
  const equippedFrame = getEquippedFrame(presentation?.equipped_frame_id) || getAutomaticFrame(rankingQuery.data);
  const frameOptions = getFrameOptions(presentation?.frame_access);
  const identityUser = { ...auth.user, name: displayName, photoUrl: getIdentityPhoto(auth.user, presentation) || profilePhotoFrom(profileQuery.data) };
  const frameCinematic = getFrameCinematicMetadata(equippedFrame);
  const identityReady = presentationQuery.isFetched && profileQuery.isFetched;
  useFrameCinematic({
    frame: identityReady ? equippedFrame : null,
    avatarRef: heroAvatarRef,
    bannerRef: heroBannerRef,
    announcementRef: frameAnnouncementRef,
    particleFieldRef: frameParticleFieldRef
  });

  const openTitleCustomizer = (event) => {
    titleOpenerRef.current = event?.currentTarget || null;
    setTitleSelection(presentation?.selected_title_ids || presentation?.selected_titles?.map((title) => title.id) || []);
    setShowTitleModal(true);
  };

  const toggleTitle = (titleId) => {
    setTitleSelection((current) => {
      if (current.includes(titleId)) return current.filter((id) => id !== titleId);
      if (current.length >= (presentation?.max_titles || 4)) {
        notify(`Chỉ có thể hiển thị tối đa ${presentation?.max_titles || 4} danh hiệu.`, 'warning');
        return current;
      }
      return [...current, titleId];
    });
  };

  const openComposer = (focusField = 'content', forceAnon = true, event) => {
    createOpenerRef.current = event?.currentTarget || document.activeElement;
    // Bài từ trang Confession luôn là category 'confession'; ẩn danh hay không
    // do riêng cờ isAnonymous quyết định (backend chỉ xử lý tag khi confession).
    setDraft((prev) => ({ ...prev, isAnonymous: forceAnon, category: 'confession' }));
    setShowCreateModal(true);
  };

  const closePostModal = useCallback(() => setOpenPostId(null), []);
  const openPostComments = useCallback((postId, event) => {
    postOpenerRef.current = event?.currentTarget || document.activeElement;
    setOpenPostId(postId);
  }, []);

  const sharePost = async (postId) => {
    const url = `${window.location.origin}/confession?post=${postId}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('Đã sao chép liên kết bài viết.', 'success');
    } catch {
      notify(url, 'info');
    }
  };

  // Menu "..." của bài viết đóng khi bấm ra ngoài, giống Facebook.
  // Bỏ qua click phát sinh bên trong menu: cùng một cú click mở menu còn lan
  // tới `document` sau khi React gắn listener, nếu không chặn sẽ đóng menu vừa
  // mở (MutationObserver trong trình duyệt thật thấy menu-added rồi menu-removed).
  useEffect(() => {
    if (!postMenuId) return undefined;
    const close = (event) => {
      if (event.target?.closest?.('.fbc-menu-wrap')) return;
      setPostMenuId(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [postMenuId]);

  const openPost = openPostId === null
    ? null
    : posts.find((item) => String(item.id) === String(openPostId)) || null;

  const editingPost = editPostId === null
    ? null
    : posts.find((item) => String(item.id) === String(editPostId))
    || (openPost && String(openPost.id) === String(editPostId) ? openPost : null);
  const editAuthor = editingPost ? postAvatarUser(editingPost, identityUser, presentation) : identityUser;
  const editAuthorName = editDraft.isAnonymous
    ? 'Sinh viên giấu tên (Confession)'
    : (editingPost?.author?.name || displayName);

  // Popup bài viết khoá cuộn trang, trả focus về nút đã mở, đóng bằng Escape.
  useViewportDialog(openPost, closePostModal, postDialogRef, postCloseButtonRef, postOpenerRef);

  const realtimeMeta = realtimeStatusMeta(realtimeStatus);

  return (
    <section id="tab-confession" className="tab-pane active">
      {/* Hero Full-width Banner faithful to production */}
      <div
        ref={heroBannerRef}
        className={`forum-hero-banner glass-panel ${equippedFrame?.family ? `hero-frame-family-${equippedFrame.family}` : ''}`.trim()}
        data-frame-family={equippedFrame?.family || 'automatic'}
      >
        <button
          type="button"
          className="btn-hero-frame-customizer"
          onClick={openFramePicker}
          title="Mở bộ sưu tập khung vinh danh"
          aria-label="Mở bộ sưu tập khung vinh danh"
        >
          <span className="hero-frame-icon" aria-hidden="true">✦</span>
          <span className="hero-frame-label">Bộ Sưu Tập Khung</span>
          <span className="hero-frame-short-label" aria-hidden="true">Khung</span>
        </button>
        <img className="brand-watermark hero-brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="forum-banner-bg"></div>
        <div id="frame-cinematic-backdrop" className="frame-cinematic-backdrop" aria-hidden="true"></div>
        {equippedFrame?.family === 'anime-sukuna' && <div className="sukuna-hero-layer-stack" aria-hidden="true">
          <img className="sukuna-hero-layer sukuna-hero-layer-01" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-01-ground.png" alt="" />
          <img className="sukuna-hero-layer sukuna-hero-layer-02" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-02-mid.png" alt="" />
          <img className="sukuna-hero-layer sukuna-hero-layer-03" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-03-upper.png" alt="" />
          <img className="sukuna-hero-layer sukuna-hero-layer-04" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-04-top.png" alt="" />
        </div>}

        <div className="forum-hero-content">
          <button
            type="button"
            className={`forum-hero-avatar-wrap ${equippedFrame ? `has-frame-${equippedFrame.tier} has-frame-scope-${equippedFrame.scope} ${equippedFrame.family ? `has-frame-${equippedFrame.family}` : ''}` : ''}`.trim()}
            id="cfs-hero-avatar-wrap"
            ref={heroAvatarRef}
            onClick={openFramePicker}
            title="Nhấn để xem các mẫu khung avatar vinh danh động"
            aria-label="Mở bộ sưu tập khung đại diện"
          >
            <div className="frame-cinematic-layer" aria-hidden="true">
              <div className="frame-portal-glow"></div>
              <div className="frame-rune-ring frame-rune-ring-outer"></div>
              <div className="frame-rune-ring frame-rune-ring-inner"></div>
              <div className="frame-light-beams">
                <i></i><i></i><i></i><i></i>
              </div>
              <div id="frame-particle-field" ref={frameParticleFieldRef} className="frame-particle-field"></div>
            </div>
            <div className="frame-signature-fx" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i><i></i>
              <span className="frame-fx-sigil"></span>
              <span className="frame-fx-scanner"></span>
              <span className="frame-fx-slash frame-fx-slash-a"></span>
              <span className="frame-fx-slash frame-fx-slash-b"></span>
            </div>
            <div className="frame-intro-flash"></div>
            <div className="frame-intro-shockwave"></div>
            <div className="avatar-energy-ring"></div>
            <div id="cfs-hero-avatar" className="forum-hero-avatar">
              <AvatarContent user={identityUser} presentation={presentation} alt={`Ảnh của ${displayName}`} />
            </div>
            <div id="cfs-hero-frame-container" className="avatar-frame-container"><FrameArtwork frame={equippedFrame} /></div>
            <div className="avatar-frame-sheen"></div>
          </button>

          <div ref={frameAnnouncementRef} id="frame-unlock-announcement" className="frame-unlock-announcement" aria-hidden="true">
            <span className="frame-unlock-kicker">{frameCinematic ? `${frameCinematic.theme.rarity} • ${equippedFrame?.scope === 'anime' ? 'DOMAIN SIGNATURE' : 'VINH DANH HỌC THUẬT'}` : 'VINH DANH HỌC THUẬT'}</span>
            <strong id="frame-unlock-title">{equippedFrame?.title || 'KHUNG HUYỀN THOẠI'}</strong>
            <span id="frame-unlock-rank">{frameCinematic?.rankLabel || 'TOP 1 TOÀN TRƯỜNG'}</span>
          </div>

          <h3 id="cfs-hero-username" className="forum-hero-username">{displayName}</h3>
          <TitleBadges titles={selectedTitles} className="identity-title-hero" />
          <p id="cfs-hero-sub" className="forum-hero-sub">
            {equippedFrame
              ? `MSSV: ${auth.user?.mssv || '---'} • ${equippedFrame.title} • Đại học Bình Dương`
              : `MSSV: ${auth.user?.mssv || '---'} • Thành viên Diễn Đàn & Tự Học Số`}
          </p>
        </div>
      </div>

      {/* Forum Two-Column Layout */}
      <div className="forum-two-column-layout">
        {/* Left Column: Main Forum Feed */}
        <div className="forum-main-column">
          {/* Quick Composer Trigger ("Bạn đang nghĩ gì? Chia sẻ ngay...") */}
          <div className="forum-quick-composer glass-panel">
            <button
              type="button"
              className="quick-composer-row"
              id="quick-composer-trigger"
              title="Nhấn để tạo bài viết / Confession mới"
              onClick={(event) => openComposer('content', true, event)}
              aria-label="Tạo bài viết hoặc confession mới"
            >
              <div id="cfs-composer-avatar" className="quick-composer-avatar">
                <AvatarContent user={identityUser} presentation={presentation} alt={`Ảnh của ${displayName}`} />
              </div>
              <div className="quick-composer-fake-input">
                <span id="cfs-composer-placeholder-text">{displayName} ơi, bạn đang nghĩ gì thế?</span>
              </div>
            </button>

            <div className="quick-composer-tags">
              <button
                type="button"
                className="quick-tag-btn"
                id="btn-quick-attach-drive"
                onClick={(event) => openComposer('drive', false, event)}
              >
                <span>Google Drive / Video</span>
              </button>
              <button
                type="button"
                className="quick-tag-btn"
                id="btn-quick-anon-toggle"
                onClick={(event) => openComposer('content', true, event)}
              >
                <span>Đăng ẩn danh</span>
              </button>
              <button
                type="button"
                className="quick-tag-btn"
                id="btn-quick-scope-toggle"
                onClick={() => openComposer('content', false)}
              >
                <span>Toàn trường / Khoa</span>
              </button>
            </div>
          </div>

          {/* Secondary Filter Bar */}
          <div className="forum-filter-bar glass-panel">
            <div className="forum-filter-tabs">
              <button
                type="button"
                className={`forum-filter-pill ${filter === 'all' ? 'active' : ''}`}
                onClick={() => updateFilter('all')}
                aria-pressed={filter === 'all'}
              >
                Tất cả bài đăng
              </button>
              <button
                type="button"
                className={`forum-filter-pill ${filter === 'mine' ? 'active' : ''}`}
                onClick={() => updateFilter('mine')}
                aria-pressed={filter === 'mine'}
              >
                Bài của tôi
              </button>
              <button
                type="button"
                className={`forum-filter-pill ${filter === 'anon' ? 'active' : ''}`}
                onClick={() => updateFilter('anon')}
                aria-pressed={filter === 'anon'}
              >
                Confession ẩn danh
              </button>
            </div>
            <div className="forum-sort-box">
              <span className={`forum-realtime-status is-${realtimeMeta.tone}`} role="status" aria-live="polite">
                <i aria-hidden="true"></i>{realtimeMeta.label}
              </span>
              <span className="forum-sort-label">Sắp xếp:</span>
              <span className="forum-sort-active">Mới nhất</span>
            </div>
          </div>

          {/* Posts Feed Stream */}
          <div id="confession-feed-stream" className="forum-posts-stream">
            {query.isLoading ? (
              [1, 2, 3].map((post) => (
                <article className="forum-post-card glass-panel skeleton-forum-post" key={post} aria-hidden="true">
                  <div className="forum-post-header">
                    <SkeletonBlock className="skeleton-avatar" />
                    <div className="skeleton-copy">
                      <SkeletonBlock className="skeleton-line heading" />
                      <SkeletonBlock className="skeleton-line short" />
                    </div>
                  </div>
                  <div className="skeleton-copy skeleton-forum-post-copy">
                    <SkeletonBlock className="skeleton-line wide" />
                    <SkeletonBlock className="skeleton-line wide" />
                    <SkeletonBlock className="skeleton-line medium" />
                  </div>
                </article>
              ))
            ) : posts.length === 0 ? (
              <div className="empty-state-box glass-panel" style={{ textAlign: 'center', padding: '48px 24px', borderRadius: 'var(--radius-lg)' }}>
                <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>💬</span>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '16px' }}>Chưa có bài viết nào</h4>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                  Hãy là người đầu tiên chia sẻ tâm sự, câu hỏi ôn thi hoặc tài liệu học tập!
                </p>
              </div>
            ) : (
              posts.map((post) => {
                const isAnon = Boolean(post.author?.is_anonymous);
                const authorName = isAnon ? 'Sinh viên giấu tên' : post.author?.name || 'Sinh viên BDU';
                const isLiked = Boolean(post.is_liked);
                const author = postAvatarUser(post, identityUser, presentation);
                const equippedPostFrame = !isAnon ? getEquippedFrame(post.author?.equipped_frame_id) : null;
                // Only the Sukuna signature is allowed on forum avatars for now;
                // every other equipped frame stays on the hero/identity surfaces.
                const postFrame = equippedPostFrame?.family === 'anime-sukuna' ? equippedPostFrame : null;
                const authorTitles = titlesForPost(post, auth.user, presentation);
                const scopeLabel = post.scope === 'faculty' ? 'Viện / Khoa' : post.scope === 'institute' ? 'Viện' : post.scope === 'clan' ? 'CLB / Nhóm' : 'Toàn trường';

                return (
                  <article id={`cfs-post-${post.id}`} className="forum-post-card fbc-post" key={post.id} data-post-id={post.id}>
                    <PostHeaderBlock
                      post={post}
                      authorName={authorName}
                      isAnon={isAnon}
                      author={author}
                      postFrame={postFrame}
                      authorTitles={authorTitles}
                    >
                      <span className="fbc-scope-pill">{scopeLabel}</span>
                      <PostOptionsMenu
                        post={post}
                        open={postMenuId === post.id}
                        onToggle={() => setPostMenuId((current) => (current === post.id ? null : post.id))}
                        onEdit={(event) => openEditPost(post, event)}
                        onDelete={() => confirmDeletePost(post.id)}
                        pending={remove.isPending}
                      />
                    </PostHeaderBlock>

                    <PostContent post={post} />
                    <PostStats post={post} onOpenComments={(event) => openPostComments(post.id, event)} />
                    <PostActionBar
                      post={post}
                      isLiked={isLiked}
                      likePending={like.isPending}
                      onLike={() => like.mutate(post.id)}
                      onOpenComments={(event) => openPostComments(post.id, event)}
                      onShare={() => sharePost(post.id)}
                    />
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Popup chi tiết bài viết kiểu Facebook */}
        {openPost && (
          <PostDetailModal
            post={openPost}
            token={auth.token}
            viewer={identityUser}
            presentation={presentation}
            onClose={closePostModal}
            onLike={() => like.mutate(openPost.id)}
            onShare={() => sharePost(openPost.id)}
            likePending={like.isPending}
            dialogRef={postDialogRef}
            closeButtonRef={postCloseButtonRef}
            composerInputRef={postComposerInputRef}
            optionsMenu={(
              <PostOptionsMenu
                post={openPost}
                open={postMenuId === openPost.id}
                onToggle={() => setPostMenuId((current) => (current === openPost.id ? null : openPost.id))}
                onEdit={(event) => openEditPost(openPost, event)}
                onDelete={() => confirmDeletePost(openPost.id)}
                pending={remove.isPending}
              />
            )}
          />
        )}

        {/* Right Column: Sidebar Widgets */}        <div className="forum-sidebar-column">
          {/* Widget 1: Student Profile Card */}
          <div className="forum-widget glass-panel">
            <div className="forum-widget-header widget-header-primary">
              <h4>THÔNG TIN SINH VIÊN</h4>
            </div>
            <div className="forum-widget-body">
              <div className="widget-user-preview">
                <div id="widget-user-avatar" className="widget-user-avatar">
                  <AvatarContent user={identityUser} presentation={presentation} alt={`Ảnh của ${displayName}`} />
                </div>
                <div className="widget-user-meta">
                  <h4 id="widget-user-name" className="widget-user-name">{displayName}</h4>
                  <p id="widget-user-mssv" className="widget-user-mssv">MSSV: {auth.user?.mssv || '---'}</p>
                  <TitleBadges titles={selectedTitles} className="identity-title-widget" />
                  <button
                    id="btn-title-customizer"
                    className="btn-title-customizer"
                    type="button"
                    onClick={openTitleCustomizer}
                  >
                    Chọn danh hiệu
                  </button>
                </div>
              </div>
              <div className="widget-user-actions">
                <button
                  type="button"
                  className="btn-widget-action btn-widget-view-grades"
                  onClick={() => navigate('/gpa')}
                >
                  Bảng Điểm & GPA
                </button>
                <button
                  type="button"
                  className="btn-widget-action btn-widget-my-clan"
                  onClick={() => navigate('/clans')}
                >
                  CLB & Nhóm Học Tập
                </button>
              </div>
            </div>
          </div>

          {/* Widget 2: Fast Utilities & Tools (Dragon Boy styled buttons) */}
          <div className="forum-widget glass-panel">
            <div className="forum-widget-header widget-header-emerald">
              <h4>TIỆN ÍCH</h4>
            </div>
            <div className="forum-widget-body">
              <div className="widget-tool-buttons">
                <button
                  type="button"
                  className="btn-platform btn-tool-word"
                  onClick={() => navigate('/wordfmt')}
                >
                  <div className="platform-text">
                    <strong>Chuẩn Hóa Word BDU</strong>
                    <small>Căn lề, heading, font chuẩn BDU</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-platform btn-tool-survey"
                  onClick={() => navigate('/survey')}
                >
                  <div className="platform-text">
                    <strong>Auto Khảo Sát Môn Học</strong>
                    <small>Hoàn thành đánh giá 1 chạm</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-platform btn-tool-english"
                  onClick={() => navigate('/english')}
                >
                  <div className="platform-text">
                    <strong>Auto Tiếng Anh Empower</strong>
                    <small>Học liệu Moodle LMS</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-platform btn-tool-clans"
                  onClick={() => navigate('/clans')}
                >
                  <div className="platform-text">
                    <strong>CLB & Nhóm Học Tập</strong>
                    <small>Kho tài liệu & slide nội bộ</small>
                  </div>
                </button>

                <a
                  className="btn-platform btn-tool-games"
                  href="/games"
                >
                  <div className="platform-text">
                    <strong>Giải trí</strong>
                    <small>Phòng cờ online & xem realtime</small>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showTitleModal && createPortal(
        <div className="modal-backdrop identity-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTitleCustomizer(); }}>
          <section
            ref={titleDialogRef}
            className="identity-title-dialog glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="title-customizer-heading"
            aria-describedby="title-customizer-description"
            tabIndex={-1}
          >
            <header className="identity-title-dialog-header">
              <div>
                <span className="identity-title-eyebrow">HỒ SƠ CÁ NHÂN</span>
                <h3 id="title-customizer-heading">Chọn danh hiệu hiển thị</h3>
                <p id="title-customizer-description">Danh hiệu sẽ xuất hiện ở banner, hồ sơ và các bài đăng của bạn.</p>
              </div>
              <button ref={titleCloseButtonRef} type="button" className="identity-dialog-close" title="Đóng" aria-label="Đóng chọn danh hiệu" onClick={closeTitleCustomizer}>✕</button>
            </header>
            <div className="identity-title-selection-meta">
              <span aria-live="polite">Đã chọn <strong>{titleSelection.length}/{presentation?.max_titles || 4}</strong> danh hiệu</span>
              <button
                type="button"
                className="identity-title-clear"
                onClick={() => setTitleSelection([])}
                disabled={!titleSelection.length || saveTitles.isPending}
              >
                Bỏ chọn tất cả
              </button>
            </div>
            <div className="identity-title-options" role="group" aria-label="Danh sách danh hiệu có thể hiển thị">
              {(presentation?.available_titles || []).length ? (presentation.available_titles || []).map((title) => {
                const checked = titleSelection.includes(title.id);
                const inputId = `identity-title-${String(title.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                const detailId = `${inputId}-detail`;
                return (
                  <label className={`identity-title-option ${checked ? 'is-selected' : ''}`} htmlFor={inputId} key={title.id}>
                    <input
                      id={inputId}
                      className="identity-title-checkbox"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTitle(title.id)}
                      aria-describedby={detailId}
                    />
                    <span className="identity-title-option-copy">
                      <TitleBadges titles={[title]} />
                      <small id={detailId}>{title.detail || 'Danh hiệu của sinh viên BDU'}</small>
                    </span>
                    <span className="identity-title-option-status" aria-hidden="true">{checked ? 'Đang hiển thị' : 'Chọn hiển thị'}</span>
                  </label>
                );
              }) : (
                <p className="identity-title-empty-state">Bạn chưa có danh hiệu nào có thể hiển thị.</p>
              )}
            </div>
            <footer className="identity-title-dialog-footer">
              <button type="button" className="btn btn-secondary" onClick={closeTitleCustomizer}>Hủy</button>
              <button type="button" className="btn btn-primary" onClick={() => saveTitles.mutate(titleSelection)} disabled={saveTitles.isPending}>
                {saveTitles.isPending ? 'Đang lưu...' : 'Lưu danh hiệu'}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      )}

      {/* Modal: Facebook Style Create Confession Modal */}
      {showCreateModal && (
        <ViewportModal id="modal-create-confession" title="Tạo bài viết" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="fb-composer-dialog">
          <div className="fb-modal-header">
            <h3 id="confession-composer-title" className="fb-modal-title">Tạo bài viết</h3>
            <button
              ref={createCloseButtonRef}
              type="button"
              id="btn-close-cfs-modal"
              className="fb-modal-close-btn"
              title="Đóng"
              aria-label="Đóng hộp thoại tạo bài viết"
              onClick={() => setShowCreateModal(false)}
            >
              ✕
            </button>
          </div>

          <div className="fb-modal-body">
            <div className="fb-composer-author-row">
              <div id="fb-modal-avatar" className="fb-author-avatar">
                {draft.isAnonymous ? '?' : getInitials(displayName)}
              </div>
              <div className="fb-author-info">
                <div id="fb-modal-author-name" className="fb-author-name">
                  {draft.isAnonymous ? 'Sinh viên giấu tên (Confession)' : displayName}
                </div>
                <div className="fb-author-pills">
                  <div className="fb-pill-selector">
                    <select
                      id="cfs-post-scope"
                      className="fb-pill-select"
                      value={draft.scope}
                      onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                    >
                      <option value="school">Toàn trường</option>
                      <option value="faculty">Chủ đề Viện / Khoa (công khai)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    id="fb-btn-toggle-anon"
                    className={`fb-pill-btn ${draft.isAnonymous ? 'active' : ''}`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        isAnonymous: !prev.isAnonymous,
                        category: 'confession'
                      }))
                    }
                    title="Bật/Tắt chế độ Confession ẩn danh"
                  >
                    <span id="fb-anon-label">Ẩn danh: {draft.isAnonymous ? 'Bật' : 'Tắt'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="fb-inputs-area">
              <input
                type="text"
                id="cfs-post-title"
                className="fb-title-input"
                maxLength={180}
                placeholder="Tiêu đề bài viết (tùy chọn)..."
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <MentionAutocomplete
                value={draft.content}
                onChange={(next) => setDraft((prev) => ({ ...prev, content: next }))}
                token={auth.token}
                inputRef={composerTextareaRef}
              >
                <textarea
                  id="cfs-post-content"
                  className="fb-content-textarea"
                  rows={4}
                  maxLength={10000}
                  placeholder="Bạn đang nghĩ gì thế? Chia sẻ tài liệu, câu hỏi ôn tập, review môn học hoặc tâm sự... (gõ @ để tag bạn bè)"
                  required
                />
              </MentionAutocomplete>
            </div>

            <div id="fb-attachment-card" className="fb-attachment-card" style={{ marginTop: '12px' }}>
              <div className="fb-attachment-input-row" style={{ marginBottom: '8px' }}>
                <input
                  type="url"
                  id="cfs-post-drive-url"
                  className="fb-attachment-url-input form-input"
                  maxLength={2048}
                  placeholder="Dán link Google Drive (File/Folder/Video) hoặc YouTube..."
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
              {draft.url && (
                <div className="fb-attachment-title-row">
                  <input
                    type="text"
                    id="cfs-post-drive-title"
                    className="fb-attachment-title-input form-input"
                    maxLength={180}
                    placeholder="Tên tài liệu / video hiển thị (tùy chọn)..."
                    value={draft.urlTitle}
                    onChange={(e) => setDraft({ ...draft, urlTitle: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="fb-add-to-post-box">
              <span className="fb-add-to-post-label">Thêm vào bài viết của bạn</span>
              <div className="fb-add-actions">
                <button
                  type="button"
                  className="fb-add-btn"
                  id="fb-tool-drive"
                  title="Nhúng Google Drive"
                  onClick={() => {
                    const input = document.getElementById('cfs-post-drive-url');
                    input?.focus();
                  }}
                >
                  📁 Drive
                </button>
                <button
                  type="button"
                  className="fb-add-btn"
                  id="fb-tool-youtube"
                  title="Nhúng Video YouTube"
                  onClick={() => {
                    const input = document.getElementById('cfs-post-drive-url');
                    input?.focus();
                  }}
                >
                  🎥 YouTube
                </button>
                <button
                  type="button"
                  className="fb-add-btn"
                  id="fb-tool-anon"
                  title="Chuyển chế độ Ẩn danh"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      isAnonymous: !prev.isAnonymous,
                      category: 'confession'
                    }))
                  }
                >
                  🎭 Ẩn danh
                </button>
              </div>
            </div>
          </div>

          <div className="fb-modal-footer">
            <button
              type="button"
              id="btn-submit-cfs"
              className="btn btn-primary fb-submit-post-btn"
              onClick={() => {
                if (!draft.content.trim()) {
                  notify('Vui lòng nhập nội dung bài viết.', 'warning');
                  return;
                }
                create.mutate();
              }}
              disabled={create.isPending || !draft.content.trim()}
            >
              {create.isPending ? 'Đang đăng...' : 'Đăng'}
            </button>
          </div>
        </ViewportModal>
      )}

      {/* Modal: Chỉnh sửa bài viết (tác giả hoặc quản trị viên) */}
      {editPostId !== null && (
        <ViewportModal id="modal-edit-confession" title="Chỉnh sửa bài viết" onClose={closeEditPost} dialogRef={editDialogRef} className="fb-composer-dialog">
          <div className="fb-modal-header">
            <h3 id="confession-editor-title" className="fb-modal-title">Chỉnh sửa bài viết</h3>
            <button
              ref={editCloseButtonRef}
              type="button"
              id="btn-close-cfs-edit-modal"
              className="fb-modal-close-btn"
              title="Đóng"
              aria-label="Đóng hộp thoại chỉnh sửa bài viết"
              onClick={closeEditPost}
            >
              ✕
            </button>
          </div>

          <div className="fb-modal-body">
            <div className="fb-composer-author-row">
              <div id="fb-modal-edit-avatar" className="fb-author-avatar">
                {editDraft.isAnonymous ? '?' : <AvatarContent user={editAuthor} alt={`Ảnh của ${editAuthorName}`} />}
              </div>
              <div className="fb-author-info">
                <div id="fb-modal-edit-author-name" className="fb-author-name">
                  {editAuthorName}
                </div>
                <div className="fb-author-pills">
                  <button
                    type="button"
                    id="fb-btn-edit-toggle-anon"
                    className={`fb-pill-btn ${editDraft.isAnonymous ? 'active' : ''}`}
                    onClick={() => setEditDraft((prev) => ({ ...prev, isAnonymous: !prev.isAnonymous }))}
                    aria-pressed={editDraft.isAnonymous}
                    title="Bật/Tắt chế độ Confession ẩn danh"
                  >
                    <span>Ẩn danh: {editDraft.isAnonymous ? 'Bật' : 'Tắt'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="fb-inputs-area">
              <input
                type="text"
                id="cfs-edit-title"
                className="fb-title-input"
                maxLength={180}
                placeholder="Tiêu đề bài viết (tùy chọn)..."
                value={editDraft.title}
                onChange={(e) => setEditDraft((prev) => ({ ...prev, title: e.target.value }))}
              />
              <MentionAutocomplete
                value={editDraft.content}
                onChange={(next) => setEditDraft((prev) => ({ ...prev, content: next }))}
                token={auth.token}
                inputRef={editTextareaRef}
              >
                <textarea
                  id="cfs-edit-content"
                  className="fb-content-textarea"
                  rows={4}
                  maxLength={10000}
                  placeholder="Nội dung bài viết... (gõ @ để tag bạn bè)"
                  required
                />
              </MentionAutocomplete>
            </div>
          </div>

          <div className="fb-modal-footer">
            <button
              type="button"
              id="btn-submit-cfs-edit"
              className="btn btn-primary fb-submit-post-btn"
              onClick={submitEditPost}
              disabled={update.isPending || !editDraft.content.trim()}
            >
              {update.isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </ViewportModal>
      )}

      {/* Modal: Frame Collection Preview */}
      {showFrameModal && createPortal(
        <div id="modal-frame-preview" className="modal-backdrop identity-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeFramePicker(); }}>
          <section
            ref={frameDialogRef}
            className="glass-panel frame-picker-modal-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="frame-picker-heading"
            aria-describedby="frame-picker-description"
            tabIndex={-1}
          >
            <header className="frame-picker-header">
              <div className="frame-picker-heading-copy">
                <h3 id="frame-picker-heading" className="frame-picker-title" aria-label="Bộ Sưu Tập Khung Avatar Vinh Danh">
                  <span className="frame-picker-title-full" aria-hidden="true">Bộ Sưu Tập Khung Avatar Vinh Danh</span>
                  <span className="frame-picker-title-short" aria-hidden="true">Khung đại diện</span>
                </h3>
                <p id="frame-picker-description">Chỉ hiển thị các khung đã được hệ thống mở khóa cho bạn.</p>
              </div>
              <button ref={frameCloseButtonRef} type="button" className="identity-dialog-close" onClick={closeFramePicker} title="Đóng" aria-label="Đóng bộ sưu tập khung">✕</button>
            </header>

            <div className="frame-picker-body">
              <p className="frame-picker-desc">MSSV: <strong>{auth.user?.mssv || '---'}</strong> · khung theo thành tích thật luôn sẵn sàng.</p>
              <div className="frame-picker-grid">
                <article className={`frame-option-card is-unlocked ${!presentation?.equipped_frame_id ? 'is-active' : ''}`}>
                  <div className="frame-mini-preview"><div className="mini-avatar-wrap"><div className="mini-avatar-circle"><AvatarContent user={identityUser} presentation={presentation} /></div></div></div>
                  <div className="frame-option-info">
                    <span className="frame-tag tier-member">TỰ ĐỘNG</span>
                    <h4>Khung theo thành tích thật</h4>
                    <p>{presentation?.equipped_frame_id ? 'Dùng khung cao nhất từ bảng xếp hạng của bạn.' : 'Đang dùng khung cao nhất từ bảng xếp hạng của bạn.'}</p>
                    <div className="frame-option-action-row">
                      {!presentation?.equipped_frame_id && <span className="frame-equipped-state">Đang trang bị</span>}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm frame-option-action"
                        onClick={() => equipFrame.mutate('real')}
                        disabled={equipFrame.isPending || !presentation?.equipped_frame_id}
                      >
                        {!presentation?.equipped_frame_id ? 'Đang dùng tự động' : 'Dùng tự động'}
                      </button>
                    </div>
                  </div>
                </article>
                {frameOptions.map((frame) => {
                  const isActive = presentation?.equipped_frame_id === `frame:${frame.key}`;
                  return (
                    <article className={`frame-option-card is-unlocked ${isActive ? 'is-active' : ''}`} key={frame.key}>
                      <div className="frame-mini-preview">
                        <div className={`mini-avatar-wrap has-frame-${frame.tier} has-frame-scope-${frame.scope} ${frame.family ? `has-frame-${frame.family}` : ''}`.trim()}>
                          <div className="avatar-energy-ring" />
                          <div className="mini-avatar-circle"><AvatarContent user={identityUser} presentation={presentation} /></div>
                          <FrameArtwork frame={frame} />
                        </div>
                      </div>
                      <div className="frame-option-info">
                        <span className={`frame-tag tier-${frame.tier}`}>{frame.scope === 'anime' ? 'SIGNATURE' : 'ĐÃ MỞ KHÓA'}</span>
                        <h4>{frame.title}</h4>
                        <p>{isActive ? 'Khung này đang hiển thị trên hồ sơ và bài đăng của bạn.' : 'Có thể trang bị ngay.'}</p>
                        <div className="frame-option-action-row">
                          {isActive && <span className="frame-equipped-state">Đang trang bị</span>}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm frame-option-action"
                            onClick={() => equipFrame.mutate(frame.key)}
                            disabled={equipFrame.isPending || isActive}
                          >
                            {isActive ? 'Đang dùng' : 'Trang bị'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!frameOptions.length && <p className="frame-picker-empty">Bạn chưa mở khóa khung riêng nào. Khung tự động sẽ cập nhật theo thành tích của bạn.</p>}
            </div>

            <footer className="frame-picker-footer">
              <span>Thành tích mới sẽ tự mở khóa khung tương ứng.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeFramePicker}>
                Đóng
              </button>
            </footer>
          </section>
        </div>,
        document.body
      )}
      {confirmUI}
    </section>
  );
}
