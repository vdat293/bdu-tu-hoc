import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createCommunityPost,
  deleteCommunityPost,
  disbandClan,
  getClanDocuments,
  getClanJoinRequests,
  getClanMembers,
  getClans,
  getCommunityPosts,
  joinClan,
  kickClanMember,
  leaveClan,
  reviewClanJoinRequest,
  toggleCommunityPostLike,
  updateClan,
  updateClanMemberRole,
  voteClanPoll,
  getCommunityPostComments,
  addCommunityPostComment
} from '../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../app/providers.jsx';

function postsFrom(data) {
  return Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
}

function getInitials(name) {
  const parts = String(name || 'SV').trim().split(/\s+/);
  return parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
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
            <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="attachment-action-link">
              Mở liên kết ↗
            </a>
          </div>
        </div>
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '8px' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📁</span>
            <div>
              <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{attachment.title || 'Tài liệu Google Drive'}</h5>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>drive.google.com</span>
            </div>
          </div>
          <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ padding: '4px 10px', fontSize: '12px' }}>
            Xem ↗
          </a>
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

function ClanCommentsInline({ postId, token }) {
  const [newComment, setNewComment] = useState('');
  const client = useQueryClient();
  const { notify } = useToasts();
  useRealtimeRoom(postId ? `community-post:${postId}` : null, Boolean(token));

  const commentsQuery = useQuery({
    queryKey: ['clan-post-comments', String(postId)],
    queryFn: ({ signal }) => getCommunityPostComments(token, postId, { signal }),
    enabled: Boolean(token && postId)
  });

  const commentMutation = useMutation({
    mutationFn: () => addCommunityPostComment(token, postId, { content: newComment.trim() }),
    onSuccess: () => {
      setNewComment('');
      client.invalidateQueries({ queryKey: ['clan-post-comments', String(postId)] });
      notify('Đã gửi trao đổi.', 'success');
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
        style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}
      >
        <input
          type="text"
          className="form-input"
          placeholder="Viết trao đổi trong nhóm..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          maxLength={2000}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={commentMutation.isPending || !newComment.trim()}
        >
          Gửi
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {commentsQuery.isLoading ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đang tải bình luận...</div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có thảo luận nào.</div>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                gap: '10px',
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div className="avatar-circle" style={{ width: '28px', height: '28px', fontSize: '11px', flexShrink: 0 }}>
                {getInitials(c.author?.name || 'SV')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                    {c.author?.name || 'Thành viên CLB'}
                  </strong>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {formatRelativeTime(c.created_at)}
                  </span>
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'pre-line' }}>
                  {c.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ClanPage() {
  const { clanId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();

  const tab = ['feed', 'docs', 'members', 'requests', 'settings'].includes(params.get('tab'))
    ? params.get('tab')
    : 'feed';

  const [feedFilter, setFeedFilter] = useState('all'); // all, discussion, poll, mine
  const [docFilter, setDocFilter] = useState('all');
  const [docSearch, setDocSearch] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState('discussion'); // discussion or poll
  const [expandedComments, setExpandedComments] = useState({});

  // Drafts
  const [postDraft, setPostDraft] = useState({ title: '', content: '', url: '' });
  const [pollDraft, setPollDraft] = useState({ question: '', options: ['', ''] });
  const [clanDraft, setClanDraft] = useState({ name: '', description: '', tag: '' });

  const clans = useQuery({
    queryKey: ['clans', auth.user?.mssv],
    queryFn: ({ signal }) => getClans(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const clan = useMemo(
    () => (Array.isArray(clans.data) ? clans.data : []).find((item) => String(item.id) === String(clanId)),
    [clans.data, clanId]
  );

  const isJoined = Boolean(clan?.is_joined);
  const isLeader = clan?.my_role === 'leader';
  const queryBase = useMemo(() => ['clan', auth.user?.mssv, clanId], [auth.user?.mssv, clanId]);
  useRealtimeRoom(isJoined ? `clan:${clanId}` : null, Boolean(auth.token && isJoined));

  const postsQuery = useQuery({
    queryKey: [...queryBase, 'posts'],
    queryFn: ({ signal }) =>
      getCommunityPosts(auth.token, { scope: 'clan', scopeId: clanId, limit: 50, signal }),
    enabled: Boolean(auth.token && isJoined && tab === 'feed')
  });

  const documentsQuery = useQuery({
    queryKey: [...queryBase, 'documents'],
    queryFn: ({ signal }) => getClanDocuments(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && isJoined && tab === 'docs')
  });

  const membersQuery = useQuery({
    queryKey: [...queryBase, 'members'],
    queryFn: ({ signal }) => getClanMembers(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && isJoined && tab === 'members')
  });

  const requestsQuery = useQuery({
    queryKey: [...queryBase, 'requests'],
    queryFn: ({ signal }) => getClanJoinRequests(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && isLeader && tab === 'requests')
  });

  useEffect(() => {
    if (clan) setClanDraft({ name: clan.name || '', description: clan.description || '', tag: clan.tag || '' });
  }, [clan]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['clans'] });
    client.invalidateQueries({ queryKey: [...queryBase] });
  };

  const join = useMutation({
    mutationFn: () => joinClan(auth.token, clanId),
    onSuccess: () => {
      notify('Đã gửi yêu cầu tham gia.', 'success');
      refresh();
    },
    onError: (error) => notify(error.message, 'error')
  });

  const leave = useMutation({
    mutationFn: () => leaveClan(auth.token, clanId),
    onSuccess: () => {
      notify('Đã rời CLB.', 'success');
      refresh();
    },
    onError: (error) => notify(error.message, 'error')
  });

  const createPost = useMutation({
    mutationFn: () => {
      if (composerMode === 'poll') {
        return createCommunityPost(auth.token, {
          title: pollDraft.question,
          content: postDraft.content,
          scope: 'clan',
          scopeId: clanId,
          category: 'poll',
          poll: {
            question: pollDraft.question,
            options: pollDraft.options.filter((opt) => opt.trim())
          }
        });
      }
      return createCommunityPost(auth.token, {
        title: postDraft.title,
        content: postDraft.content,
        scope: 'clan',
        scopeId: clanId,
        category: postDraft.url ? 'material' : 'discussion',
        attachments: postDraft.url ? [{ url: postDraft.url, title: postDraft.title }] : []
      });
    },
    onSuccess: () => {
      setPostDraft({ title: '', content: '', url: '' });
      setPollDraft({ question: '', options: ['', ''] });
      setShowComposer(false);
      client.invalidateQueries({ queryKey: [...queryBase, 'posts'] });
      notify('Đã đăng bài trong CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const like = useMutation({
    mutationFn: (postId) => toggleCommunityPostLike(auth.token, postId),
    onSuccess: () => client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }),
    onError: (error) => notify(error.message, 'error')
  });

  const removePost = useMutation({
    mutationFn: (postId) => deleteCommunityPost(auth.token, postId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'posts'] });
      notify('Đã xóa bài viết.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const vote = useMutation({
    mutationFn: ({ pollId, optionId }) => voteClanPoll(auth.token, pollId, optionId),
    onSuccess: () => client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }),
    onError: (error) => notify(error.message, 'error')
  });

  const review = useMutation({
    mutationFn: ({ requestId, action }) => reviewClanJoinRequest(auth.token, clanId, requestId, action),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'requests'] });
      refresh();
      notify('Đã cập nhật yêu cầu gia nhập.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const role = useMutation({
    mutationFn: ({ mssv, nextRole }) => updateClanMemberRole(auth.token, clanId, mssv, nextRole),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'members'] });
      refresh();
      notify('Đã cập nhật vai trò.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const kick = useMutation({
    mutationFn: (mssv) => kickClanMember(auth.token, clanId, mssv),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'members'] });
      refresh();
      notify('Đã xóa thành viên.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const saveClan = useMutation({
    mutationFn: () => updateClan(auth.token, clanId, clanDraft),
    onSuccess: () => {
      refresh();
      notify('Đã lưu thông tin CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const destroy = useMutation({
    mutationFn: () => disbandClan(auth.token, clanId),
    onSuccess: () => {
      notify('Đã giải tán CLB.', 'success');
      navigate('/clans');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const switchTab = (value) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: false });
  };

  const rawPosts = postsFrom(postsQuery.data);
  const posts = useMemo(() => {
    if (feedFilter === 'discussion') return rawPosts.filter((p) => p.category !== 'poll');
    if (feedFilter === 'poll') return rawPosts.filter((p) => p.category === 'poll' || p.poll);
    if (feedFilter === 'mine') return rawPosts.filter((p) => Boolean(p.is_mine));
    return rawPosts;
  }, [rawPosts, feedFilter]);

  const rawDocuments = Array.isArray(documentsQuery.data?.documents) ? documentsQuery.data.documents : [];
  const documents = useMemo(() => {
    return rawDocuments.filter((doc) => {
      const matchType = docFilter === 'all' || doc.type === docFilter;
      const matchSearch = !docSearch || `${doc.title} ${doc.author_name}`.toLowerCase().includes(docSearch.toLowerCase());
      return matchType && matchSearch;
    });
  }, [rawDocuments, docFilter, docSearch]);

  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const requests = Array.isArray(requestsQuery.data) ? requestsQuery.data : [];

  if (!clan && !clans.isLoading) {
    return (
      <section id="tab-clans" className="tab-pane active">
        <div className="section-header-box glass-panel">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/clans')}>
            ← Quay lại danh sách CLB
          </button>
          <div className="state-card error-state" style={{ marginTop: '20px' }}>
            Không tìm thấy CLB hoặc bạn không có quyền xem.
          </div>
        </div>
      </section>
    );
  }

  if (!clan) {
    return (
      <section id="tab-clans" className="tab-pane active">
        <div className="loading-spinner-box glass-panel" style={{ textAlign: 'center', padding: '60px' }}>
          <div className="spinner"></div>
          <p style={{ marginTop: '12px', color: 'var(--text-muted)' }}>Đang tải dữ liệu CLB...</p>
        </div>
      </section>
    );
  }

  const roleLabel =
    clan.my_role === 'leader'
      ? '👑 Bang Chủ'
      : clan.my_role === 'vice_leader'
        ? 'Phó Bang'
        : clan.my_role === 'elder'
          ? 'Trưởng Lão'
          : 'Thành viên';

  return (
    <section id="tab-clans" className="tab-pane active">
      <div id="clan-channel-view" className="clan-channel-view">
        {/* Hero Card faithful to production */}
        <div className="channel-hero-card glass-panel">
          <div className="channel-hero-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button
              type="button"
              id="btn-back-to-clans"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/clans')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Quay lại danh sách
            </button>
            <div id="channel-action-box">
              {isJoined ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (window.confirm('Bạn chắc chắn muốn rời CLB này?')) leave.mutate();
                  }}
                  disabled={leave.isPending}
                >
                  Rời CLB
                </button>
              ) : clan.has_pending_request ? (
                <span className="badge-pending" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                  Đang chờ duyệt
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => join.mutate()}
                  disabled={join.isPending}
                >
                  Xin tham gia
                </button>
              )}
            </div>
          </div>

          <div className="channel-hero-content">
            <div className="channel-badge-box" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <span id="channel-clan-tag" className="clan-tag-badge" style={{ fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--bdu-light)' }}>
                [{clan.tag || 'TAG'}]
              </span>
              <span id="channel-clan-level" className="clan-level-badge" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Cấp 1
              </span>
            </div>
            <h3 id="channel-clan-name" className="channel-title" style={{ margin: '0 0 8px 0', fontSize: '1.5rem', color: 'var(--text-main)' }}>
              {clan.name}
            </h3>
            <p id="channel-clan-desc" className="channel-desc" style={{ margin: '0 0 16px 0', color: 'var(--text-dim)', fontSize: '14px', lineHeight: 1.5 }}>
              {clan.description || 'Không gian học tập và sinh hoạt nội bộ của thành viên.'}
            </p>
            <div className="channel-meta-row" style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              <span id="channel-clan-members" className="meta-item">
                👥 {clan.member_count || members.length || 1} Thành viên
              </span>
              {isJoined && (
                <span id="channel-clan-role" className="meta-item role-item" style={{ color: 'var(--bdu-light)', fontWeight: 600 }}>
                  {roleLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Subtabs Nav */}
        <div className="channel-subtabs-nav" style={{ display: 'flex', gap: '10px', margin: '20px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', overflowX: 'auto' }}>
          <button
            type="button"
            className={`channel-subtab-btn ${tab === 'feed' ? 'active' : ''}`}
            onClick={() => switchTab('feed')}
          >
            📰 Bản Tin CLB
          </button>
          <button
            type="button"
            className={`channel-subtab-btn ${tab === 'docs' ? 'active' : ''}`}
            onClick={() => switchTab('docs')}
          >
            📚 Kho Tài Liệu ({rawDocuments.length})
          </button>
          <button
            type="button"
            className={`channel-subtab-btn ${tab === 'members' ? 'active' : ''}`}
            onClick={() => switchTab('members')}
          >
            👥 Thành Viên ({members.length})
          </button>
          {isLeader && (
            <button
              type="button"
              className={`channel-subtab-btn ${tab === 'requests' ? 'active' : ''}`}
              onClick={() => switchTab('requests')}
            >
              📥 Yêu Cầu Gia Nhập ({requests.length})
            </button>
          )}
          {isLeader && (
            <button
              type="button"
              className={`channel-subtab-btn ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => switchTab('settings')}
            >
              ⚙️ Quản Trị CLB
            </button>
          )}
        </div>

        {/* Guest alert if not joined */}
        {!isJoined && tab !== 'settings' && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', borderRadius: 'var(--radius-lg)' }}>
            <span style={{ fontSize: '32px', display: 'block', marginBottom: '10px' }}>🔒</span>
            <h4>Khu vực dành riêng cho thành viên CLB</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Hãy nhấn nút <strong>Xin tham gia</strong> ở góc trên để theo dõi bản tin, tài liệu và các cuộc thảo luận!
            </p>
          </div>
        )}

        {/* Panel 1: Bản Tin & Thảo Luận */}
        {isJoined && tab === 'feed' && (
          <div id="channel-panel-feed" className="channel-panel">
            {/* Quick Composer Trigger Bar */}
            <div className="clan-quick-composer glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-lg)', marginBottom: '16px' }}>
              <div
                className="quick-composer-row"
                id="clan-quick-composer-trigger"
                onClick={() => {
                  setComposerMode('discussion');
                  setShowComposer(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
              >
                <div id="clan-quick-composer-avatar" className="quick-composer-avatar avatar-circle" style={{ width: '40px', height: '40px', fontSize: '14px', flexShrink: 0 }}>
                  {getInitials(auth.user?.name || 'SV')}
                </div>
                <div className="quick-composer-fake-input" style={{ flex: 1, padding: '10px 16px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', borderRadius: '999px', color: 'var(--text-muted)', fontSize: '14px' }}>
                  <span id="clan-quick-composer-placeholder">Bạn ơi, bạn đang nghĩ gì thế?</span>
                </div>
              </div>

              <div className="quick-composer-tags" style={{ display: 'flex', gap: '10px', marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <button
                  type="button"
                  className="quick-tag-btn clan-tag-btn"
                  id="btn-clan-open-post-modal"
                  onClick={() => {
                    setComposerMode('discussion');
                    setShowComposer(true);
                  }}
                >
                  <span>📰 Bản tin</span>
                </button>
                <button
                  type="button"
                  className="quick-tag-btn clan-tag-btn"
                  id="btn-clan-open-poll-modal"
                  onClick={() => {
                    setComposerMode('poll');
                    setShowComposer(true);
                  }}
                >
                  <span>📊 Bình chọn</span>
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="clan-feed-filter-bar glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
              <div className="clan-feed-filter-tabs" style={{ display: 'flex', gap: '8px' }}>
                {[
                  ['all', 'Tất cả bài đăng'],
                  ['discussion', 'Bản tin'],
                  ['poll', 'Bình chọn'],
                  ['mine', 'Bài của tôi']
                ].map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    className={`clan-feed-pill ${feedFilter === f ? 'active' : ''}`}
                    onClick={() => setFeedFilter(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="clan-sort-box" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                <span className="clan-sort-label">Sắp xếp:</span>{' '}
                <span className="clan-sort-active" style={{ color: 'var(--bdu-light)', fontWeight: 600 }}>
                  Mới nhất
                </span>
              </div>
            </div>

            {/* Posts Stream */}
            <div id="clan-posts-feed" className="clan-feed-stream">
              {postsQuery.isLoading ? (
                <div className="loading-spinner-box glass-panel" style={{ textAlign: 'center', padding: '40px' }}>
                  <div className="spinner"></div>
                  <p style={{ marginTop: '12px', color: 'var(--text-muted)' }}>Đang tải bài viết...</p>
                </div>
              ) : posts.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', borderRadius: 'var(--radius-lg)' }}>
                  <h4>Chưa có bài viết nào</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Hãy bắt đầu chia sẻ tin tức hoặc tạo khảo sát cho CLB!</p>
                </div>
              ) : (
                posts.map((post) => {
                  const isLiked = Boolean(post.is_liked);
                  const showCommentThread = Boolean(expandedComments[post.id]);

                  return (
                    <div className="community-post-card glass-panel" key={post.id} style={{ marginBottom: '16px' }}>
                      <div className="post-header">
                        <div className="post-author-box">
                          <div className="post-avatar">
                            {getInitials(post.author?.name || 'SV')}
                          </div>
                          <div className="post-author-meta">
                            <span className="post-author-name">{post.author?.name || 'Thành viên CLB'}</span>
                            <span className="post-time">{formatRelativeTime(post.created_at)}</span>
                          </div>
                        </div>
                        {post.is_mine && (
                          <button
                            type="button"
                            className="btn-delete-post"
                            onClick={() => {
                              if (window.confirm('Bạn chắc chắn muốn xóa bài viết này?')) {
                                removePost.mutate(post.id);
                              }
                            }}
                            disabled={removePost.isPending}
                            title="Xóa bài viết"
                          >
                            <span>Xóa</span>
                          </button>
                        )}
                      </div>

                      <h4 className="post-title">{post.title || 'Bài viết'}</h4>
                      <p className="post-content" style={{ whiteSpace: 'pre-line' }}>{post.content}</p>

                      {Array.isArray(post.attachments) && post.attachments.length > 0 && (
                        <div className="post-attachments-list">
                          {post.attachments.map((att, idx) => (
                            <AttachmentRenderer key={idx} attachment={att} />
                          ))}
                        </div>
                      )}

                      {/* Poll Rendering */}
                      {post.poll && (
                        <div className="poll-box glass-panel" style={{ padding: '16px', borderRadius: '8px', margin: '14px 0', border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.02)' }}>
                          <strong style={{ display: 'block', marginBottom: '12px', fontSize: '14px' }}>
                            📊 {post.poll.question}
                          </strong>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {post.poll.options?.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                className={`poll-opt-btn ${opt.is_voted ? 'voted' : ''}`}
                                onClick={() => vote.mutate({ pollId: post.poll.id, optionId: opt.id })}
                                disabled={vote.isPending}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '10px 14px',
                                  background: opt.is_voted ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                                  border: `1px solid ${opt.is_voted ? 'var(--bdu-light)' : 'var(--border-color)'}`,
                                  borderRadius: '6px',
                                  color: 'var(--text-main)',
                                  cursor: 'pointer',
                                  textAlign: 'left'
                                }}
                              >
                                <span>{opt.text}</span>
                                <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--bdu-light)' }}>
                                  {opt.percentage || 0}% ({opt.vote_count || 0})
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="post-actions-bar" style={{ marginTop: '12px' }}>
                        <button
                          type="button"
                          className={`btn-post-action btn-toggle-like ${isLiked ? 'liked' : ''}`}
                          onClick={() => like.mutate(post.id)}
                          disabled={like.isPending}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill={isLiked ? '#ef4444' : 'none'} stroke={isLiked ? '#ef4444' : 'currentColor'} strokeWidth="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                          </svg>
                          <span className="like-count-num">{post.like_count || 0}</span> Thích
                        </button>

                        <button
                          type="button"
                          className={`btn-post-action btn-toggle-comments ${showCommentThread ? 'active' : ''}`}
                          onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                          </svg>
                          <span className="comment-count-num">{post.comment_count || 0}</span> Bình luận
                        </button>
                      </div>

                      {showCommentThread && (
                        <ClanCommentsInline postId={post.id} token={auth.token} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Panel 2: Kho Tài Liệu CLB */}
        {isJoined && tab === 'docs' && (
          <div id="channel-panel-docs" className="channel-panel">
            <div className="clan-docs-header-card glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px', borderRadius: 'var(--radius-lg)', marginBottom: '16px' }}>
              <div style={{ fontSize: '32px' }}>📚</div>
              <div>
                <h3 className="docs-header-title" style={{ margin: '0 0 4px 0', fontSize: '1.2rem' }}>
                  Kho Tài Liệu & Slide Bài Giảng
                </h3>
                <p className="docs-header-subtitle" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                  Tổng hợp toàn bộ tài liệu Google Drive, slide ôn thi và video học tập do thành viên chia sẻ.
                </p>
              </div>
            </div>

            <div className="clan-docs-toolbar glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
              <div className="clan-docs-type-filters" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  ['all', 'Tất cả'],
                  ['drive_folder', '📁 Thư mục Drive'],
                  ['drive_file', '📄 File & Đề thi'],
                  ['video', '🎥 Video bài giảng'],
                  ['link', '🔗 Liên kết']
                ].map(([dtype, label]) => (
                  <button
                    key={dtype}
                    type="button"
                    className={`clan-doc-pill ${docFilter === dtype ? 'active' : ''}`}
                    onClick={() => setDocFilter(dtype)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm tài liệu..."
                style={{ maxWidth: '240px' }}
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
            </div>

            <div id="clan-docs-grid" className="clan-docs-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
              {documentsQuery.isLoading ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>Đang tải tài liệu...</div>
              ) : documents.length === 0 ? (
                <div className="glass-panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
                  <p style={{ color: 'var(--text-muted)' }}>Chưa có tài liệu nào phù hợp.</p>
                </div>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--bdu-light)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                        {doc.type}
                      </span>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>{doc.title}</h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Người chia sẻ: {doc.author_name}</p>
                    </div>
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
                      <a href={doc.direct_url || doc.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                        Mở tài liệu ↗
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Panel 3: Thành Viên */}
        {isJoined && tab === 'members' && (
          <div id="channel-panel-members" className="channel-panel">
            <div className="clan-members-wrapper glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
              <div className="clan-members-header" style={{ marginBottom: '16px' }}>
                <h3 className="clan-members-title" style={{ margin: '0 0 4px 0' }}>Danh Sách Thành Viên CLB</h3>
                <p className="clan-members-subtitle" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                  Tổng cộng: {members.length} thành viên đã tham gia.
                </p>
              </div>

              <div className="table-responsive">
                <table className="clan-members-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '10px 12px' }}>Thành Viên</th>
                      <th style={{ padding: '10px 12px' }}>MSSV</th>
                      <th style={{ padding: '10px 12px' }}>Chức Vụ</th>
                      {isLeader && <th style={{ padding: '10px 12px' }}>Thao Tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.mssv} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '12px' }}>
                          <strong>{member.full_name || 'Sinh viên BDU'}</strong>
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-muted)' }}>{member.mssv}</td>
                        <td style={{ padding: '12px' }}>
                          {isLeader && member.mssv !== auth.user?.mssv ? (
                            <select
                              className="custom-select"
                              value={member.role}
                              onChange={(e) => role.mutate({ mssv: member.mssv, nextRole: e.target.value })}
                              disabled={role.isPending}
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                            >
                              <option value="member">Thành viên</option>
                              <option value="elder">Trưởng lão</option>
                              <option value="vice_leader">Phó bang</option>
                              <option value="leader">Bang chủ</option>
                            </select>
                          ) : (
                            <span style={{ color: member.role === 'leader' ? '#fbbf24' : 'inherit' }}>
                              {member.role === 'leader' ? '👑 Bang Chủ' : member.role}
                            </span>
                          )}
                        </td>
                        {isLeader && (
                          <td style={{ padding: '12px' }}>
                            {member.mssv !== auth.user?.mssv && (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  if (window.confirm(`Xóa sinh viên ${member.full_name || member.mssv} khỏi nhóm?`)) {
                                    kick.mutate(member.mssv);
                                  }
                                }}
                                disabled={kick.isPending}
                              >
                                Xóa
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Panel 4: Yêu Cầu Gia Nhập (Leader Only) */}
        {isLeader && tab === 'requests' && (
          <div id="channel-panel-requests" className="channel-panel">
            <div className="clan-members-wrapper glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
              <h3 style={{ margin: '0 0 16px 0' }}>Yêu Cầu Gia Nhập Chờ Duyệt ({requests.length})</h3>
              {requests.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Hiện không có yêu cầu nào đang chờ duyệt.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {requests.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div>
                        <strong style={{ display: 'block' }}>{req.full_name || req.mssv}</strong>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>MSSV: {req.mssv} · {formatRelativeTime(req.created_at)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => review.mutate({ requestId: req.id, action: 'approve' })}
                          disabled={review.isPending}
                        >
                          Duyệt
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => review.mutate({ requestId: req.id, action: 'reject' })}
                          disabled={review.isPending}
                        >
                          Từ chối
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Panel 5: Cài Đặt CLB (Leader Only) */}
        {isLeader && tab === 'settings' && (
          <div className="clan-settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <form
              className="clan-settings-box glass-panel"
              style={{ padding: '24px', borderRadius: 'var(--radius-lg)' }}
              onSubmit={(e) => {
                e.preventDefault();
                saveClan.mutate();
              }}
            >
              <h3 style={{ margin: '0 0 16px 0' }}>⚙️ Cài Đặt Thông Tin CLB</h3>
              <div style={{ display: 'flex', gap: '14px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>Tên CLB</label>
                  <input
                    className="form-input"
                    value={clanDraft.name}
                    onChange={(e) => setClanDraft({ ...clanDraft, name: e.target.value })}
                  />
                </div>
                <div style={{ width: '160px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>Tag Viết Tắt</label>
                  <input
                    className="form-input"
                    value={clanDraft.tag}
                    onChange={(e) => setClanDraft({ ...clanDraft, tag: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>Mô Tả CLB</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={clanDraft.description}
                  onChange={(e) => setClanDraft({ ...clanDraft, description: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={saveClan.isPending}>
                {saveClan.isPending ? 'Đang lưu...' : 'Lưu Thay Đổi'}
              </button>
            </form>

            <div className="glass-panel" style={{ padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
              <h4 style={{ color: '#ef4444', margin: '0 0 6px 0' }}>Vùng Nguy Hiểm: Giải Tán CLB</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 14px 0' }}>
                Hành động này sẽ xóa toàn bộ dữ liệu, bài viết và quyền thành viên của tất cả mọi người trong CLB.
              </p>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm('CẢNH BÁO: Bạn chắc chắn muốn giải tán CLB này vĩnh viễn?')) {
                    destroy.mutate();
                  }
                }}
                disabled={destroy.isPending}
              >
                {destroy.isPending ? 'Đang giải tán...' : 'Giải Tán CLB'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Facebook Style Composer Modal faithful to #modal-clan-post-composer */}
      {showComposer && (
        <div id="modal-clan-post-composer" className="modal-backdrop" onClick={(e) => { if (e.target.id === 'modal-clan-post-composer') setShowComposer(false); }}>
          <div className="modal-dialog fb-composer-dialog glass-panel" role="dialog" aria-modal="true" style={{ maxWidth: '560px', width: '92vw', margin: 'auto', padding: '24px', borderRadius: 'var(--radius-lg)' }}>
            <div className="fb-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`clan-feed-pill ${composerMode === 'discussion' ? 'active' : ''}`}
                  onClick={() => setComposerMode('discussion')}
                >
                  📰 Bản tin
                </button>
                <button
                  type="button"
                  className={`clan-feed-pill ${composerMode === 'poll' ? 'active' : ''}`}
                  onClick={() => setComposerMode('poll')}
                >
                  📊 Bình chọn
                </button>
              </div>
              <button
                type="button"
                id="btn-close-clan-composer-modal"
                className="fb-modal-close-btn"
                title="Đóng"
                onClick={() => setShowComposer(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="fb-modal-body">
              {composerMode === 'discussion' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Tiêu đề bài viết..."
                    maxLength={180}
                    value={postDraft.title}
                    onChange={(e) => setPostDraft({ ...postDraft, title: e.target.value })}
                  />
                  <textarea
                    className="form-input"
                    rows={4}
                    maxLength={5000}
                    placeholder="Bạn đang nghĩ gì thế? Chia sẻ thảo luận hoặc tài liệu cho nhóm..."
                    value={postDraft.content}
                    onChange={(e) => setPostDraft({ ...postDraft, content: e.target.value })}
                  />
                  <input
                    type="url"
                    className="form-input"
                    placeholder="Link Google Drive / YouTube (không bắt buộc)"
                    value={postDraft.url}
                    onChange={(e) => setPostDraft({ ...postDraft, url: e.target.value })}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Chủ đề / Câu hỏi bình chọn..."
                    value={pollDraft.question}
                    onChange={(e) => setPollDraft({ ...pollDraft, question: e.target.value })}
                  />
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Lưu ý cho cuộc biểu quyết này (tùy chọn)..."
                    value={postDraft.content}
                    onChange={(e) => setPostDraft({ ...postDraft, content: e.target.value })}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Các phương án bình chọn:</label>
                    {pollDraft.options.map((opt, idx) => (
                      <input
                        key={idx}
                        type="text"
                        className="form-input"
                        placeholder={`Lựa chọn ${idx + 1}...`}
                        value={opt}
                        onChange={(e) => {
                          const nextOpts = [...pollDraft.options];
                          nextOpts[idx] = e.target.value;
                          setPollDraft({ ...pollDraft, options: nextOpts });
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPollDraft({ ...pollDraft, options: [...pollDraft.options, ''] })}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      + Thêm lựa chọn
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="fb-modal-footer" style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowComposer(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (composerMode === 'poll' && !pollDraft.question.trim()) {
                    notify('Vui lòng nhập câu hỏi bình chọn.', 'warning');
                    return;
                  }
                  if (composerMode === 'discussion' && !postDraft.title.trim() && !postDraft.content.trim()) {
                    notify('Vui lòng nhập nội dung bài viết.', 'warning');
                    return;
                  }
                  createPost.mutate();
                }}
                disabled={createPost.isPending}
              >
                {createPost.isPending ? 'Đang đăng...' : composerMode === 'poll' ? 'Tạo Bình Chọn' : 'Đăng Bài'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
