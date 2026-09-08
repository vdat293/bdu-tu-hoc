import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createCoursePost,
  deleteCoursePost,
  getCoursePosts,
  toggleCoursePostLike,
  getCoursePostComments,
  addCoursePostComment,
  getLearningResources
} from '../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../app/providers.jsx';
import {
  AvatarContent,
  TitleBadges,
  getInitials,
  getIdentityName
} from '../../components/identity/Identity.jsx';

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

function detectResourceSource(rawUrl) {
  let hostname = '';
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (hostname === 'drive.google.com') return 'drive';
  if (hostname === 'github.com' || hostname.endsWith('.github.com')) return 'github';
  return 'web';
}

const KIND_META = {
  request: { label: 'Luận bàn', icon: '💬', badgeClass: 'kind-request', filterLabel: 'Luận bàn' },
  document: { label: 'Tài liệu', icon: '📚', badgeClass: 'kind-document', filterLabel: 'Tài liệu' },
  video: { label: 'Video bài giảng', icon: '🎥', badgeClass: 'kind-video', filterLabel: 'Video' },
  link: { label: 'Tham khảo', icon: '🔗', badgeClass: 'kind-link', filterLabel: 'Liên kết' }
};

function memberTitle() {
  return { id: 'member:bdu', label: 'Sinh viên BDU', detail: 'Thành viên cộng đồng Đại học Bình Dương', tone: 'member' };
}

function authorTitles(post) {
  if (post.author?.is_anonymous) return [];
  const titles = Array.isArray(post.author?.titles) ? post.author.titles : [];
  if (titles.length) return titles;
  return [memberTitle()];
}

function SingleAttachmentCard({ url, title, type, downloadUrl }) {
  if (!url) return null;
  const source = detectResourceSource(url);
  const isYoutube = source === 'youtube' || type === 'youtube' || type === 'video';
  const isDrive = source === 'drive' || (type && type.startsWith('drive_'));
  const isGithub = source === 'github';

  if (isYoutube) {
    let embedUrl = url;
    try {
      if (url.includes('watch?v=')) {
        embedUrl = `https://www.youtube-nocookie.com/embed/${new URL(url).searchParams.get('v')}`;
      } else if (url.includes('youtu.be/')) {
        embedUrl = `https://www.youtube-nocookie.com/embed/${url.split('youtu.be/')[1].split('?')[0]}`;
      }
    } catch { /* use url as-is */ }

    return (
      <div className="learning-media-card learning-youtube-card">
        <div className="learning-media-header">
          <div className="learning-media-title-wrap">
            <span className="learning-source-tag source-youtube">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              YouTube
            </span>
            <span className="learning-media-name">{title || 'Video bài giảng / hướng dẫn'}</span>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" className="learning-media-btn-link">
            Mở xem ↗
          </a>
        </div>
        <div className="learning-video-aspect">
          <iframe
            src={embedUrl}
            title={title || 'Video học tập'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (isDrive) {
    return (
      <div className="learning-media-card learning-drive-card">
        <div className="learning-drive-body">
          <div className="learning-drive-icon">
            <svg width="24" height="24" viewBox="0 0 87.3 78" fill="none">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
              <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47" />
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l9.25-16c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
              <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
              <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
            </svg>
          </div>
          <div className="learning-drive-text">
            <h5 className="learning-drive-title">{title || 'Tài liệu học tập trên Google Drive'}</h5>
            <span className="learning-drive-sub">drive.google.com · Nhấp để mở tài liệu</span>
          </div>
          <div className="learning-drive-actions">
            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                Tải về
              </a>
            )}
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
              Mở Drive ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (isGithub) {
    return (
      <div className="learning-media-card learning-github-card">
        <div className="learning-drive-body">
          <div className="learning-drive-icon github-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </div>
          <div className="learning-drive-text">
            <h5 className="learning-drive-title">{title || 'Mã nguồn / Dự án GitHub'}</h5>
            <span className="learning-drive-sub">github.com · Repository</span>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            Xem GitHub ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="learning-media-card learning-link-card">
      <a href={url} target="_blank" rel="noopener noreferrer" className="learning-link-body">
        <span className="learning-link-icon">🔗</span>
        <div className="learning-link-text">
          <strong className="learning-link-title">{title || 'Tài liệu / Liên kết tham khảo'}</strong>
          <span className="learning-link-url">{url}</span>
        </div>
        <span className="learning-link-arrow">Mở liên kết ↗</span>
      </a>
    </div>
  );
}

function PostAttachments({ post }) {
  const attachments = Array.isArray(post.attachments) && post.attachments.length
    ? post.attachments
    : post.url
    ? [{ url: post.url, title: post.title }]
    : [];

  if (!attachments.length) return null;

  return (
    <div className="learning-post-attachments-list">
      {attachments.map((att, idx) => (
        <SingleAttachmentCard
          key={att.id || att.url || idx}
          url={att.direct_url || att.url}
          title={att.title || post.title}
          type={att.type}
          downloadUrl={att.download_url}
        />
      ))}
    </div>
  );
}

function CommentsInline({ postId, courseCode, token, user }) {
  const [newComment, setNewComment] = useState('');
  const client = useQueryClient();
  const { notify } = useToasts();
  useRealtimeRoom(postId ? `course-post:${postId}` : null, Boolean(token && courseCode));

  const commentsQuery = useQuery({
    queryKey: ['post-comments', courseCode, String(postId)],
    queryFn: ({ signal }) => getCoursePostComments(token, courseCode, postId, { signal }),
    enabled: Boolean(token && courseCode && postId)
  });

  const commentMutation = useMutation({
    mutationFn: () => addCoursePostComment(token, courseCode, postId, { content: newComment.trim() }),
    onSuccess: () => {
      setNewComment('');
      client.invalidateQueries({ queryKey: ['post-comments', courseCode, String(postId)] });
      notify('Đã gửi phản hồi thảo luận.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const comments = Array.isArray(commentsQuery.data?.comments)
    ? commentsQuery.data.comments
    : Array.isArray(commentsQuery.data)
    ? commentsQuery.data
    : [];

  return (
    <div className="learning-comments-thread">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newComment.trim()) commentMutation.mutate();
        }}
        className="learning-comment-composer-box"
      >
        <div className="learning-comment-input-wrap">
          <input
            type="text"
            className="learning-comment-input"
            placeholder="Viết trao đổi, câu trả lời hoặc kinh nghiệm học tập..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            maxLength={2000}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm learning-comment-submit"
            disabled={commentMutation.isPending || !newComment.trim()}
          >
            {commentMutation.isPending ? 'Đang gửi...' : 'Gửi phản hồi'}
          </button>
        </div>
      </form>

      <div className="learning-comments-list">
        {commentsQuery.isLoading ? (
          <div className="learning-comment-loading">
            <span className="spinner-mini"></span> Đang tải các phản hồi...
          </div>
        ) : comments.length === 0 ? (
          <div className="learning-comment-empty">
            Chưa có phản hồi nào. Hãy là người đầu tiên trao đổi câu hỏi này!
          </div>
        ) : (
          comments.map((c) => {
            const isAnon = Boolean(c.author?.is_anonymous);
            const authorName = isAnon ? 'Sinh viên giấu tên' : c.author?.name || 'Sinh viên BDU';
            return (
              <div key={c.id} className="learning-comment-item">
                <div className={`learning-comment-avatar ${isAnon ? 'is-anonymous' : ''}`}>
                  {isAnon ? '?' : <AvatarContent user={c.author} alt={authorName} />}
                </div>
                <div className="learning-comment-content-box">
                  <div className="learning-comment-meta">
                    <strong className="learning-comment-author">{authorName}</strong>
                    <span className="learning-comment-time">{formatRelativeTime(c.created_at)}</span>
                  </div>
                  <p className="learning-comment-body">{c.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function CourseLearningPage() {
  const { courseCode } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();

  const [showComposer, setShowComposer] = useState(false);
  const [filterKind, setFilterKind] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedComments, setExpandedComments] = useState({});
  const [draft, setDraft] = useState({
    kind: 'request',
    title: '',
    content: '',
    url: '',
    isAnonymous: false
  });

  // Query posts
  const postsQuery = useQuery({
    queryKey: ['course-posts', auth.user?.mssv, courseCode],
    queryFn: ({ signal }) => getCoursePosts(auth.token, courseCode, { signal }),
    enabled: Boolean(auth.token && courseCode)
  });

  // Query resources to get real course metadata (name, semester, status)
  const resourcesQuery = useQuery({
    queryKey: ['learning-resources', auth.user?.mssv],
    queryFn: ({ signal }) => getLearningResources(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

  const allCourses = useMemo(() => {
    return Array.isArray(resourcesQuery.data?.courses)
      ? resourcesQuery.data.courses
      : Array.isArray(resourcesQuery.data)
      ? resourcesQuery.data
      : [];
  }, [resourcesQuery.data]);

  const activeCourse = useMemo(() => {
    return allCourses.find(
      (c) =>
        String(c.code).trim().toUpperCase() === String(courseCode).trim().toUpperCase() ||
        String(c.display_code || '').trim().toUpperCase() === String(courseCode).trim().toUpperCase()
    );
  }, [allCourses, courseCode]);

  const courseName = activeCourse?.name || `Học phần ${courseCode}`;
  const displayCode = activeCourse?.display_code || courseCode;
  const isStudying = Boolean(activeCourse?.is_studying);
  const semesters = activeCourse?.semesters || [];
  const semesterLabel = semesters[0]?.name || (isStudying ? 'Đang theo học' : 'Học phần đã hoàn thành');
  const normalizedCourseCode = String(courseCode || '').trim().toUpperCase().replace(/\s+/g, '');
  useRealtimeRoom(normalizedCourseCode ? `course:${normalizedCourseCode}` : null, Boolean(auth.token && courseCode));

  // Realtime updates
  useEffect(() => {
    const onEvent = (event) => {
      const detail = event.detail || {};
      const data = detail.data || {};
      const type = detail.type || '';
      const eventCourseCode = String(data.courseCode || data.scopeId || '').trim().toUpperCase().replace(/\s+/g, '');
      if (type.startsWith('community.') && data.scope === 'course' && eventCourseCode === normalizedCourseCode) {
        client.invalidateQueries({ queryKey: ['course-posts', auth.user?.mssv, courseCode] });
        if (type.startsWith('community.comment.') && data.postId != null) {
          client.invalidateQueries({ queryKey: ['post-comments', courseCode, String(data.postId)] });
        }
      }
    };
    window.addEventListener('bdu:realtime', onEvent);
    return () => window.removeEventListener('bdu:realtime', onEvent);
  }, [auth.user?.mssv, client, courseCode, normalizedCourseCode]);

  const create = useMutation({
    mutationFn: () =>
      createCoursePost(auth.token, courseCode, {
        title: draft.title.trim() || 'Thảo luận môn học',
        content: draft.content.trim(),
        url: draft.url.trim(),
        kind: draft.kind,
        isAnonymous: draft.isAnonymous
      }),
    onSuccess: () => {
      setDraft({ kind: 'request', title: '', content: '', url: '', isAnonymous: false });
      setShowComposer(false);
      client.invalidateQueries({ queryKey: ['course-posts', auth.user?.mssv, courseCode] });
      notify('Đã đăng bài vào không gian môn học thành công!', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const like = useMutation({
    mutationFn: (postId) => toggleCoursePostLike(auth.token, courseCode, postId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['course-posts', auth.user?.mssv, courseCode] }),
    onError: (error) => notify(error.message, 'error')
  });

  const remove = useMutation({
    mutationFn: (postId) => deleteCoursePost(auth.token, courseCode, postId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['course-posts', auth.user?.mssv, courseCode] });
      notify('Đã xóa bài viết thành công.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const rawPosts = postsFrom(postsQuery.data);

  // Filtered posts and counts
  const counts = useMemo(() => {
    const map = { all: rawPosts.length, request: 0, document: 0, video: 0, link: 0 };
    rawPosts.forEach((p) => {
      if (map[p.kind] !== undefined) map[p.kind]++;
    });
    return map;
  }, [rawPosts]);

  const filteredPosts = useMemo(() => {
    let list = rawPosts;
    if (filterKind !== 'all') {
      list = list.filter((p) => p.kind === filterKind);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (p) =>
          (p.title && p.title.toLowerCase().includes(q)) ||
          (p.content && p.content.toLowerCase().includes(q)) ||
          (p.author?.name && p.author.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [rawPosts, filterKind, searchTerm]);

  const openComposer = (kind) => {
    setDraft((prev) => ({ ...prev, kind }));
    setShowComposer(true);
  };

  const toggleComments = (postId) => {
    setExpandedComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const copyLink = (post) => {
    const url = `${window.location.origin}/learning/${encodeURIComponent(courseCode)}`;
    navigator.clipboard.writeText(url).then(() => {
      notify('Đã sao chép liên kết không gian môn học.', 'success');
    }).catch(() => {
      notify('Không thể sao chép liên kết.', 'warning');
    });
  };

  return (
    <section id="tab-learning" className="tab-pane active learning-section-wrapper">
      <div className="learning-course-space">
        {/* Sleek Breadcrumb Bar */}
        <nav className="learning-breadcrumb-bar" aria-label="Điều hướng môn học">
          <button
            type="button"
            className="learning-breadcrumb-back"
            onClick={() => navigate('/learning')}
            title="Quay lại danh bạ kho tài liệu"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Kho Tài Liệu</span>
          </button>
          <span className="learning-breadcrumb-separator">/</span>
          <span className="learning-breadcrumb-current">{displayCode}</span>
        </nav>

        {/* Premium Course Hero Banner */}
        <div className="learning-hero-banner glass-panel">
          <div className="learning-hero-decor-circle"></div>
          <div className="learning-hero-content">
            <div className="learning-hero-meta-row">
              <span className="learning-badge-code">{displayCode}</span>
              <span className={`learning-badge-status ${isStudying ? 'is-studying' : 'is-graded'}`}>
                {isStudying ? '● Đang theo học' : '✓ Đã có điểm'}
              </span>
              <span className="learning-badge-semester">{semesterLabel}</span>
            </div>

            <h1 className="learning-hero-title">{courseName}</h1>
            <p className="learning-hero-description">
              Không gian học tập số & trao đổi tài liệu ôn tập của sinh viên Đại học Bình Dương cùng học phần này.
            </p>

            <div className="learning-hero-stats-row">
              <div className="learning-hero-stat-pill">
                <span className="stat-icon">📚</span>
                <span><strong>{counts.document}</strong> tài liệu</span>
              </div>
              <div className="learning-hero-stat-pill">
                <span className="stat-icon">💬</span>
                <span><strong>{counts.request}</strong> luận bàn</span>
              </div>
              <div className="learning-hero-stat-pill">
                <span className="stat-icon">🎥</span>
                <span><strong>{counts.video}</strong> video</span>
              </div>
              <div className="learning-hero-stat-pill">
                <span className="stat-icon">👥</span>
                <span><strong>{rawPosts.length}</strong> bài đóng góp</span>
              </div>
            </div>
          </div>

          <div className="learning-hero-actions">
            <button
              type="button"
              className="btn btn-primary learning-hero-btn-primary"
              onClick={() => openComposer('document')}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Chia sẻ tài liệu</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary learning-hero-btn-secondary"
              onClick={() => openComposer('request')}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Mở cuộc luận bàn</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar & Live Search Bar */}
        <div className="learning-filter-toolbar glass-panel">
          <div className="learning-filter-tabs" role="tablist" aria-label="Lọc theo loại bài viết">
            <button
              type="button"
              role="tab"
              aria-selected={filterKind === 'all'}
              className={`learning-filter-tab ${filterKind === 'all' ? 'active' : ''}`}
              onClick={() => setFilterKind('all')}
            >
              Tất cả <span className="filter-count-badge">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterKind === 'document'}
              className={`learning-filter-tab ${filterKind === 'document' ? 'active' : ''}`}
              onClick={() => setFilterKind('document')}
            >
              📚 Tài liệu <span className="filter-count-badge">{counts.document}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterKind === 'request'}
              className={`learning-filter-tab ${filterKind === 'request' ? 'active' : ''}`}
              onClick={() => setFilterKind('request')}
            >
              💬 Luận bàn <span className="filter-count-badge">{counts.request}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterKind === 'video'}
              className={`learning-filter-tab ${filterKind === 'video' ? 'active' : ''}`}
              onClick={() => setFilterKind('video')}
            >
              🎥 Video <span className="filter-count-badge">{counts.video}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterKind === 'link'}
              className={`learning-filter-tab ${filterKind === 'link' ? 'active' : ''}`}
              onClick={() => setFilterKind('link')}
            >
              🔗 Tham khảo <span className="filter-count-badge">{counts.link}</span>
            </button>
          </div>

          <div className="learning-filter-search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="search-icon">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="learning-search-field"
              placeholder="Tìm kiếm nội dung, tài liệu trong môn..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Tìm kiếm bài viết"
            />
            {searchTerm && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchTerm('')}
                title="Xóa tìm kiếm"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Posts Feed Stream */}
        <div id="learning-course-feed" className="learning-course-feed">
          {postsQuery.isLoading ? (
            <div className="learning-empty-card glass-panel">
              <div className="spinner"></div>
              <p>Đang đồng bộ dữ liệu thảo luận và tài liệu...</p>
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="learning-empty-card glass-panel">
              <div className="learning-empty-icon">📂</div>
              <h3>
                {searchTerm || filterKind !== 'all'
                  ? 'Không tìm thấy nội dung phù hợp'
                  : 'Chưa có tài liệu hay bài viết nào cho môn này'}
              </h3>
              <p>
                {searchTerm || filterKind !== 'all'
                  ? 'Hãy thử xóa từ khóa tìm kiếm hoặc chuyển sang tab loại bài khác.'
                  : 'Hãy là người tiên phong chia sẻ slide bài giảng, đề thi cũ hoặc mở câu hỏi thảo luận!'}
              </p>
              <div className="learning-empty-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => openComposer('document')}
                >
                  + Chia sẻ tài liệu ngay
                </button>
              </div>
            </div>
          ) : (
            filteredPosts.map((post) => {
              const isAnon = Boolean(post.is_anonymous || post.author?.is_anonymous);
              const authorName = isAnon ? 'Sinh viên giấu tên' : post.author?.name || 'Sinh viên BDU';
              const isLiked = Boolean(post.is_liked);
              const showComments = Boolean(expandedComments[post.id]);
              const kindConfig = KIND_META[post.kind] || KIND_META.request;
              const postTitles = authorTitles(post);

              return (
                <article
                  key={post.id}
                  id={`post-${post.id}`}
                  className="learning-post-card glass-panel"
                >
                  {/* Card Header */}
                  <header className="learning-post-card-header">
                    <div className="learning-post-author-box">
                      <div className={`learning-author-avatar-wrap ${isAnon ? 'is-anonymous' : ''}`}>
                        {isAnon ? (
                          <div className="learning-avatar-anonymous-icon">?</div>
                        ) : (
                          <AvatarContent user={post.author} alt={authorName} />
                        )}
                      </div>
                      <div className="learning-author-text-group">
                        <div className="learning-author-first-line">
                          <strong className="learning-author-name">{authorName}</strong>
                          {isAnon && <span className="learning-author-anon-badge">Ẩn danh</span>}
                          {!isAnon && postTitles.length > 0 && (
                            <TitleBadges titles={postTitles} className="learning-inline-titles" />
                          )}
                        </div>
                        <span className="learning-post-time">
                          {formatRelativeTime(post.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="learning-post-header-meta">
                      <span className={`learning-kind-badge ${kindConfig.badgeClass}`}>
                        <span className="kind-icon">{kindConfig.icon}</span>
                        <span>{kindConfig.label}</span>
                      </span>

                      {post.is_mine && (
                        <button
                          type="button"
                          className="learning-post-delete-btn"
                          onClick={() => {
                            if (window.confirm('Bạn có chắc chắn muốn xóa bài viết này không?')) {
                              remove.mutate(post.id);
                            }
                          }}
                          disabled={remove.isPending}
                          title="Xóa bài viết của bạn"
                          aria-label="Xóa bài viết"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>Xóa</span>
                        </button>
                      )}
                    </div>
                  </header>

                  {/* Card Body */}
                  <div className="learning-post-card-body">
                    {post.title && <h3 className="learning-post-title">{post.title}</h3>}
                    {post.content && <div className="learning-post-content">{post.content}</div>}
                    <PostAttachments post={post} />
                  </div>

                  {/* Card Footer Engagement */}
                  <footer className="learning-post-card-footer">
                    <div className="learning-actions-group">
                      <button
                        type="button"
                        className={`learning-action-btn btn-like ${isLiked ? 'is-active' : ''}`}
                        onClick={() => like.mutate(post.id)}
                        disabled={like.isPending}
                        title={isLiked ? 'Bỏ thích' : 'Thích bài viết'}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill={isLiked ? '#ef4444' : 'none'}
                          stroke={isLiked ? '#ef4444' : 'currentColor'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="learning-action-icon heart-icon"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                        <span className="action-label">Thích</span>
                        <span className="action-count">{Number(post.like_count || 0)}</span>
                      </button>

                      <button
                        type="button"
                        className={`learning-action-btn btn-comment ${showComments ? 'is-active' : ''}`}
                        onClick={() => toggleComments(post.id)}
                        title="Xem và gửi phản hồi"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="learning-action-icon comment-icon"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="action-label">Thảo luận</span>
                        <span className="action-count">{Number(post.comment_count || 0)}</span>
                      </button>

                      <button
                        type="button"
                        className="learning-action-btn btn-share"
                        onClick={() => copyLink(post)}
                        title="Sao chép liên kết bài viết"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="learning-action-icon"
                        >
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                        <span className="action-label">Chia sẻ</span>
                      </button>
                    </div>
                  </footer>

                  {/* Inline Comments Thread */}
                  {showComments && (
                    <CommentsInline
                      postId={post.id}
                      courseCode={courseCode}
                      token={auth.token}
                      user={auth.user}
                    />
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Modern Composer Modal */}
      {showComposer && (
        <div
          id="learning-composer-modal"
          className="modal-backdrop learning-modal-backdrop"
          onClick={(e) => {
            if (e.target.id === 'learning-composer-modal') setShowComposer(false);
          }}
        >
          <div
            className="learning-composer-dialog glass-panel"
            role="dialog"
            aria-modal="true"
          >
            <form
              id="learning-post-form"
              className="learning-composer-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.title.trim() && !draft.content.trim()) {
                  notify('Vui lòng nhập tiêu đề hoặc nội dung cần chia sẻ.', 'warning');
                  return;
                }
                create.mutate();
              }}
            >
              <div className="learning-composer-header">
                <div>
                  <h3 className="composer-headline">
                    {draft.kind === 'request' ? '💬 Mở cuộc luận bàn / Hỏi đáp' : '📚 Chia sẻ tài liệu học tập'}
                  </h3>
                  <p className="composer-subline">
                    Đang đăng vào: <strong>{displayCode} · {courseName}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="composer-close-btn"
                  onClick={() => setShowComposer(false)}
                  title="Đóng cửa sổ"
                >
                  ×
                </button>
              </div>

              {/* Segmented Kind Selector */}
              <div className="composer-kind-selector" role="radiogroup" aria-label="Loại nội dung">
                <button
                  type="button"
                  className={`composer-kind-pill ${draft.kind === 'request' ? 'is-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: 'request' })}
                >
                  <span>💬</span> Luận bàn / Hỏi đáp
                </button>
                <button
                  type="button"
                  className={`composer-kind-pill ${draft.kind === 'document' ? 'is-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: 'document' })}
                >
                  <span>📚</span> Tài liệu / Slide / Đề
                </button>
                <button
                  type="button"
                  className={`composer-kind-pill ${draft.kind === 'video' ? 'is-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: 'video' })}
                >
                  <span>🎥</span> Video học tập
                </button>
                <button
                  type="button"
                  className={`composer-kind-pill ${draft.kind === 'link' ? 'is-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: 'link' })}
                >
                  <span>🔗</span> Liên kết ngoài
                </button>
              </div>

              <div className="composer-inputs-group">
                <div className="composer-field">
                  <label className="composer-label" htmlFor="learning-post-title">
                    Tiêu đề bài viết <span className="req">*</span>
                  </label>
                  <input
                    id="learning-post-title"
                    className="form-input composer-input"
                    type="text"
                    maxLength={180}
                    required
                    placeholder={
                      draft.kind === 'request'
                        ? 'VD: Thắc mắc về con trỏ và cấp phát động trong C/C++...'
                        : 'VD: Tổng hợp đề thi cuối kỳ và slide bài giảng 2025...'
                    }
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>

                {draft.kind === 'request' && (
                  <label className="composer-anonymous-toggle">
                    <input
                      type="checkbox"
                      checked={draft.isAnonymous}
                      onChange={(e) => setDraft({ ...draft, isAnonymous: e.target.checked })}
                    />
                    <span className="toggle-switch-ui"></span>
                    <span className="toggle-label-text">
                      <strong>Đăng luận bàn ẩn danh</strong>
                      <small>Tên, ảnh và danh hiệu sinh viên sẽ được ẩn đi.</small>
                    </span>
                  </label>
                )}

                <div className="composer-field">
                  <label className="composer-label" htmlFor="learning-post-content">
                    Nội dung chi tiết
                  </label>
                  <textarea
                    id="learning-post-content"
                    className="form-input composer-textarea"
                    rows={4}
                    maxLength={5000}
                    placeholder={
                      draft.kind === 'request'
                        ? 'Nêu rõ câu hỏi, bài tập hoặc chủ đề mà bạn muốn thảo luận cùng bạn học...'
                        : 'Mô tả ngắn gọn về tài liệu để mọi người dễ dàng tra cứu và ôn tập...'
                    }
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                </div>

                <div className="composer-field">
                  <label className="composer-label" htmlFor="learning-post-url">
                    Liên kết đính kèm {draft.kind !== 'request' && <span className="req">*</span>}
                  </label>
                  <div className="composer-url-input-wrap">
                    <input
                      id="learning-post-url"
                      className="form-input composer-input"
                      type="url"
                      maxLength={2048}
                      placeholder="Dán liên kết YouTube, Google Drive hoặc GitHub..."
                      value={draft.url}
                      onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                      required={draft.kind !== 'request'}
                    />
                    {draft.url && (
                      <span className="composer-detected-source">
                        {detectResourceSource(draft.url) === 'youtube' && '🎥 Video YouTube'}
                        {detectResourceSource(draft.url) === 'drive' && '📁 Google Drive'}
                        {detectResourceSource(draft.url) === 'github' && '🐙 GitHub Repo'}
                        {detectResourceSource(draft.url) === 'web' && '🔗 Web Link'}
                      </span>
                    )}
                  </div>
                  <span className="composer-hint">
                    Hệ thống chỉ lưu liên kết bảo mật, không tải trực tiếp tệp lên máy chủ.
                  </span>
                </div>
              </div>

              <div className="composer-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowComposer(false)}
                >
                  Hủy bỏ
                </button>
                <button
                  id="btn-learning-submit"
                  className="btn btn-primary btn-sm composer-btn-submit"
                  type="submit"
                  disabled={create.isPending}
                >
                  {create.isPending ? 'Đang lưu bài...' : 'Đăng bài viết'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
