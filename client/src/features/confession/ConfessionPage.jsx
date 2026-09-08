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
  addCommunityPostComment
} from '../../api/community.js';
import { getMyIdentityPresentation, updateMyEquippedFrame, updateMyIdentityPresentation } from '../../api/identity.js';
import { getMyAcademicRanking, getProfile } from '../../api/academics.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../app/providers.jsx';
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

function postsFrom(data) {
  return Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
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

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

/* These pickers are rendered in a portal because the page shell is scrollable.
   Keeping them at document.body makes fixed positioning truly viewport-relative
   and prevents a scrolled Confession feed from taking the dialog with it. */
function useViewportDialog(isOpen, onClose, dialogRef, initialFocusRef, returnFocusRef) {
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;

    restoreFocusRef.current = returnFocusRef.current || (typeof document.activeElement?.focus === 'function' ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      (initialFocusRef.current || focusableElements(dialogRef.current)[0] || dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [dialogRef, initialFocusRef, isOpen, returnFocusRef]);
}

function AttachmentRenderer({ attachment }) {
  if (!attachment) return null;
  const targetUrl = attachment.direct_url || attachment.url || '#';
  const isVideo = attachment.type === 'youtube' || attachment.type === 'video';
  const isDrive = attachment.type === 'drive_file' || attachment.type === 'drive_folder';

  if (isVideo && attachment.embed_url) {
    return (
      <div className="attachment-preview-box" style={{ marginTop: '12px' }}>
        <div className="attachment-preview-header">
          <span className="attachment-type-badge">{attachment.type === 'youtube' ? 'Video YouTube' : 'Video Drive'}</span>
          <span className="attachment-title">{attachment.title || 'Video đính kèm'}</span>
          <div className="attachment-actions">
            {attachment.download_url && (
              <a href={attachment.download_url} target="_blank" rel="noopener noreferrer" className="attachment-action-link">
                Tải về
              </a>
            )}
            <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="attachment-action-link">
              Mở liên kết ↗
            </a>
          </div>
        </div>
        <div className="embed-iframe-wrapper" style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '8px' }}>
          <iframe
            src={attachment.embed_url}
            title={attachment.title || 'Video'}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (isDrive) {
    return (
      <div className="classroom-attachment-card" style={{ marginTop: '10px' }}>
        <div className="classroom-card-main-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📁</span>
            <div>
              <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{attachment.title || 'Tài liệu Google Drive'}</h5>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>drive.google.com</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {attachment.download_url && (
              <a href={attachment.download_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: '12px' }}>
                Tải về
              </a>
            )}
            <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ padding: '4px 10px', fontSize: '12px' }}>
              Xem ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="classroom-attachment-card" style={{ marginTop: '10px' }}>
      <a
        href={targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid var(--border-color)', textDecoration: 'none', color: 'var(--text-main)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🔗</span>
          <div>
            <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{attachment.title || 'Liên kết tham khảo'}</h5>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Liên kết ngoài</span>
          </div>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--bdu-light)' }}>Mở ↗</span>
      </a>
    </div>
  );
}

function PostCommentsInline({ postId, token }) {
  const [newComment, setNewComment] = useState('');
  const client = useQueryClient();
  const { notify } = useToasts();
  useRealtimeRoom(postId ? `community-post:${postId}` : null, Boolean(token));

  const commentsQuery = useQuery({
    queryKey: ['post-comments', String(postId)],
    queryFn: ({ signal }) => getCommunityPostComments(token, postId, { signal }),
    enabled: Boolean(token && postId)
  });

  const commentMutation = useMutation({
    mutationFn: () => addCommunityPostComment(token, postId, { content: newComment.trim() }),
    onSuccess: () => {
      setNewComment('');
      client.invalidateQueries({ queryKey: ['post-comments', String(postId)] });
      client.invalidateQueries({ queryKey: ['confession'] });
      notify('Đã gửi bình luận.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const comments = Array.isArray(commentsQuery.data?.comments) ? commentsQuery.data.comments : Array.isArray(commentsQuery.data) ? commentsQuery.data : [];

  return (
    <div className="post-comments-section" style={{ display: 'block', marginTop: '14px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newComment.trim()) commentMutation.mutate();
        }}
        className="comment-input-row"
        style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}
      >
        <input
          type="text"
          className="form-input comment-text-input"
          placeholder="Viết bình luận hoặc trao đổi..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          maxLength={2000}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm btn-submit-comment"
          disabled={commentMutation.isPending || !newComment.trim()}
        >
          Gửi
        </button>
      </form>

      <div className="comments-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {commentsQuery.isLoading ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đang tải bình luận...</div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có bình luận nào. Hãy là người đầu tiên!</div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                display: 'flex',
                gap: '10px',
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div
                className="avatar-circle"
                style={{ width: '28px', height: '28px', fontSize: '11px', flexShrink: 0 }}
              >
                {comment.author?.is_anonymous ? '?' : getInitials(comment.author?.name || 'SV')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                    {comment.author?.is_anonymous ? 'Sinh viên giấu tên' : comment.author?.name || 'Sinh viên BDU'}
                  </strong>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {formatRelativeTime(comment.created_at)}
                  </span>
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'pre-line' }}>
                  {comment.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ConfessionPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFrameModal, setShowFrameModal] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [expandedComments, setExpandedComments] = useState({});
  const [titleSelection, setTitleSelection] = useState([]);
  const titleDialogRef = useRef(null);
  const titleCloseButtonRef = useRef(null);
  const titleOpenerRef = useRef(null);
  const frameDialogRef = useRef(null);
  const frameCloseButtonRef = useRef(null);
  const frameOpenerRef = useRef(null);
  const heroBannerRef = useRef(null);
  const heroAvatarRef = useRef(null);
  const frameAnnouncementRef = useRef(null);
  const frameParticleFieldRef = useRef(null);

  const closeTitleCustomizer = useCallback(() => setShowTitleModal(false), []);
  const closeFramePicker = useCallback(() => setShowFrameModal(false), []);
  const openFramePicker = useCallback((event) => {
    frameOpenerRef.current = event?.currentTarget || null;
    setShowFrameModal(true);
  }, []);

  useViewportDialog(showTitleModal, closeTitleCustomizer, titleDialogRef, titleCloseButtonRef, titleOpenerRef);
  useViewportDialog(showFrameModal, closeFramePicker, frameDialogRef, frameCloseButtonRef, frameOpenerRef);

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
        scope: 'school',
        scopeId: null,
        category: filter === 'anon' ? 'confession' : undefined,
        limit: 50,
        signal
      }),
    enabled: Boolean(auth.token)
  });

  useRealtimeRoom('forum', Boolean(auth.token));

  useEffect(() => {
    const onEvent = (event) => {
      const detail = event.detail || {};
      const data = detail.data || {};
      const type = detail.type || '';
      if (!type.startsWith('community.')) return;
      const postKey = data.postId == null ? null : String(data.postId);
      const commentKey = postKey ? ['post-comments', postKey] : null;
      if (type.startsWith('community.comment.') && commentKey) {
        client.invalidateQueries({ queryKey: commentKey });
      }
      if (data.scope === 'school' || data.scope === 'faculty' || data.scope === 'institute' || !data.scope) {
        client.invalidateQueries({ queryKey: ['confession'] });
      }
    };
    window.addEventListener('bdu:realtime', onEvent);
    return () => window.removeEventListener('bdu:realtime', onEvent);
  }, [client]);

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

  const presentation = presentationQuery.data;
  const displayName = getIdentityName(auth.user, presentation);
  const selectedTitles = presentation?.selected_titles?.length ? presentation.selected_titles : [memberTitle()];
  const equippedFrame = getEquippedFrame(presentation?.equipped_frame_id) || getAutomaticFrame(rankingQuery.data);
  const frameOptions = getFrameOptions(presentation?.frame_access);
  const identityUser = { ...auth.user, name: displayName, photoUrl: getIdentityPhoto(auth.user, presentation) || profilePhotoFrom(profileQuery.data) };
  const frameCinematic = getFrameCinematicMetadata(equippedFrame);
  useFrameCinematic({
    frame: equippedFrame,
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

  const openComposer = (focusField = 'content', forceAnon = true) => {
    setDraft((prev) => ({ ...prev, isAnonymous: forceAnon, category: forceAnon ? 'confession' : 'discussion' }));
    setShowCreateModal(true);
  };

  const toggleComments = (postId) => {
    setExpandedComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  return (
    <section id="tab-confession" className="tab-pane active">
      {/* Hero Full-width Banner faithful to production */}
      <div ref={heroBannerRef} className="forum-hero-banner glass-panel">
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
            <span className="frame-unlock-kicker">{frameCinematic ? `${frameCinematic.theme.rarity} • VINH DANH HỌC THUẬT` : 'VINH DANH HỌC THUẬT'}</span>
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
              onClick={() => openComposer('content', true)}
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
                onClick={() => openComposer('drive', false)}
              >
                <span>Google Drive / Video</span>
              </button>
              <button
                type="button"
                className="quick-tag-btn"
                id="btn-quick-anon-toggle"
                onClick={() => openComposer('content', true)}
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
                const showCommentThread = Boolean(expandedComments[post.id]);
                const author = postAvatarUser(post, identityUser, presentation);
                const authorTitles = titlesForPost(post, auth.user, presentation);
                const scopeLabel = post.scope === 'faculty' ? 'Viện / Khoa' : post.scope === 'institute' ? 'Viện' : post.scope === 'clan' ? 'CLB / Nhóm' : 'Toàn trường';

                return (
                  <article className="forum-post-card glass-panel" key={post.id} data-post-id={post.id}>
                    <div className="forum-post-header">
                      <div className="forum-user-col">
                        <div className={`forum-avatar ${isAnon ? 'anon' : ''}`}>
                          {isAnon ? '?' : <AvatarContent user={author} alt={`Ảnh của ${authorName}`} />}
                        </div>
                        <div className="forum-user-details">
                          <div className="forum-author-name-line">
                            <strong className="forum-author-name">{authorName}</strong>
                            {isAnon ? <span className="forum-post-rank-tag is-anon">Ẩn danh</span> : <TitleBadges titles={authorTitles} className="identity-title-forum" />}
                          </div>
                          <span className="forum-post-time">{formatRelativeTime(post.created_at)}</span>
                        </div>
                      </div>
                      <div className="forum-post-header-actions">
                        <span className="forum-post-scope-pill">{scopeLabel}</span>
                        {post.is_mine && (
                          <button
                            type="button"
                            className="btn-delete-post"
                            onClick={() => {
                              if (window.confirm('Bạn chắc chắn muốn xóa bài viết này?')) remove.mutate(post.id);
                            }}
                            disabled={remove.isPending}
                            title="Xóa bài viết"
                            aria-label="Xóa bài viết"
                          >
                            <span>Xóa</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <h4 className="forum-post-title">{post.title || 'Nội dung bài viết'}</h4>
                    <p className="forum-post-body">{post.content}</p>

                    {Array.isArray(post.attachments) && post.attachments.length > 0 && (
                      <div className="post-attachments-list">
                        {post.attachments.map((att, idx) => (
                          <AttachmentRenderer key={idx} attachment={att} />
                        ))}
                      </div>
                    )}

                    <div className="forum-post-bottom-bar">
                      <div className="forum-actions-left">
                        <button
                          type="button"
                          className={`forum-action-btn btn-toggle-like ${isLiked ? 'liked' : ''}`}
                          onClick={() => like.mutate(post.id)}
                          disabled={like.isPending}
                        >
                          <span>{isLiked ? 'Đã thích' : 'Thích'}</span>
                        </button>

                        <button
                          type="button"
                          className={`forum-action-btn btn-toggle-comments ${showCommentThread ? 'active' : ''}`}
                          onClick={() => toggleComments(post.id)}
                        >
                          <span>Bình luận</span>
                        </button>
                      </div>
                      <div className="forum-counts-right">
                        <span className="like-count-num">{post.like_count || 0}</span> lượt thích • <span className="comment-count-num">{post.comment_count || 0}</span> bình luận
                      </div>
                    </div>

                    {showCommentThread && (
                      <div className="forum-comments-wrapper"><PostCommentsInline postId={post.id} token={auth.token} /></div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Sidebar Widgets */}
        <div className="forum-sidebar-column">
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
              <h4>TIỆN ÍCH HỌC TẬP BDU</h4>
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
        <div id="modal-create-confession" className="modal-backdrop" onClick={(e) => { if (e.target.id === 'modal-create-confession') setShowCreateModal(false); }}>
          <div className="modal-dialog fb-composer-dialog glass-panel" role="dialog" aria-modal="true">
            <div className="fb-modal-header">
              <h3 className="fb-modal-title">Tạo bài viết</h3>
              <button
                type="button"
                id="btn-close-cfs-modal"
                className="fb-modal-close-btn"
                title="Đóng"
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
                          category: !prev.isAnonymous ? 'confession' : 'discussion'
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
                <textarea
                  id="cfs-post-content"
                  className="fb-content-textarea"
                  rows={4}
                  maxLength={10000}
                  placeholder="Bạn đang nghĩ gì thế? Chia sẻ tài liệu, câu hỏi ôn tập, review môn học hoặc tâm sự..."
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  required
                />
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
                        category: !prev.isAnonymous ? 'confession' : 'discussion'
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
          </div>
        </div>
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
    </section>
  );
}
