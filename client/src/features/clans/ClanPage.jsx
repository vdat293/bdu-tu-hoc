import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  addCommunityPostComment,
  cancelClanJoinRequest,
  createCommunityPost,
  deleteCommunityPost,
  disbandClan,
  getClanDocuments,
  getClanJoinRequests,
  getClanMembers,
  getClanQuiz,
  getClans,
  getCommunityPostComments,
  getCommunityPosts,
  joinClan,
  kickClanMember,
  leaveClan,
  reviewClanJoinRequest,
  toggleCommunityPostLike,
  updateClan,
  updateClanMemberRole,
  updateClanQuiz,
  voteClanPoll
} from '../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import ClanJoinQuizModal from './ClanJoinQuizModal.jsx';
import { parseQuizText, QUIZ_IMPORT_SCHEMA } from './quiz.js';
import './clans.css';

const POSTS_PER_PAGE = 12;
const DOCS_PER_PAGE = 12;
const roleLabels = {
  leader: 'Bang chủ',
  vice_leader: 'Phó bang',
  elder: 'Trưởng lão',
  member: 'Thành viên',
  recruit: 'Tân thành viên'
};

function postsFrom(data) {
  return Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
}

function cleanTag(tag) {
  return String(tag || '').trim().replace(/^\[+|\]+$/g, '') || 'CLB';
}

function initials(name) {
  const words = String(name || 'SV').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}`.toUpperCase() : words[0].slice(0, 2).toUpperCase();
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Không rõ thời điểm';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Vừa xong';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}

function roleInfo(role) {
  const value = String(role || 'member');
  return {
    label: roleLabels[value] || 'Thành viên',
    canPost: ['leader', 'vice_leader', 'elder', 'member'].includes(value),
    canPoll: ['leader', 'vice_leader', 'elder'].includes(value),
    canReview: ['leader', 'vice_leader'].includes(value),
    canManageMembers: ['leader', 'vice_leader'].includes(value),
    canAssignRoles: value === 'leader',
    canSettings: value === 'leader',
    canDeleteAny: ['leader', 'vice_leader'].includes(value)
  };
}

function Avatar({ name, url, size = 'member' }) {
  return <span className={`clan-avatar clan-avatar--${size}`} aria-hidden="true">{url ? <img src={url} alt="" /> : initials(name)}</span>;
}

function PanelError({ message, onRetry }) {
  return <div className="clan-state-card" role="alert"><h2>Chưa thể tải dữ liệu</h2><p>{message || 'Vui lòng kiểm tra kết nối rồi thử lại.'}</p><button type="button" className="btn btn-secondary" onClick={onRetry}>Thử lại</button></div>;
}

function AttachmentRenderer({ attachment }) {
  if (!attachment) return null;
  const target = attachment.direct_url || attachment.url || '#';
  const isVideo = ['youtube', 'video', 'drive_video'].includes(attachment.type);
  const typeLabel = attachment.type === 'drive_folder' ? 'Thư mục Drive' : attachment.type === 'drive_file' ? 'Tệp Drive' : isVideo ? 'Video' : 'Liên kết';
  return (
    <div>
      <div className="clan-attachment">
        <div className="clan-attachment__copy"><strong>{attachment.title || 'Tài liệu đính kèm'}</strong><span>{typeLabel}</span></div>
        <a href={target} target="_blank" rel="noopener noreferrer">Mở ↗</a>
      </div>
      {isVideo && attachment.embed_url && <div className="clan-video"><iframe src={attachment.embed_url} title={attachment.title || 'Video đính kèm'} allowFullScreen loading="lazy" /></div>}
    </div>
  );
}

function ClanComments({ postId, token }) {
  const client = useQueryClient();
  const { notify } = useToasts();
  const [draft, setDraft] = useState('');
  useRealtimeRoom(postId ? `community-post:${postId}` : null, Boolean(token));
  const query = useQuery({
    queryKey: ['clan-post-comments', String(postId)],
    queryFn: ({ signal }) => getCommunityPostComments(token, postId, { signal }),
    enabled: Boolean(token && postId)
  });
  const create = useMutation({
    mutationFn: () => addCommunityPostComment(token, postId, { content: draft.trim() }),
    onSuccess: () => {
      setDraft('');
      client.invalidateQueries({ queryKey: ['clan-post-comments', String(postId)] });
      notify('Đã gửi trao đổi.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const comments = Array.isArray(query.data?.comments) ? query.data.comments : Array.isArray(query.data) ? query.data : [];
  return <section className="clan-comments" aria-label="Bình luận bài đăng">
    <form className="clan-comment-form" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) create.mutate(); }}>
      <label className="sr-only" htmlFor={`clan-comment-${postId}`}>Viết bình luận</label>
      <input id={`clan-comment-${postId}`} className="form-input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Viết trao đổi trong nhóm…" />
      <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim() || create.isPending}>{create.isPending ? 'Đang gửi…' : 'Gửi'}</button>
    </form>
    {query.isLoading ? <span className="clan-panel-heading"><p>Đang tải bình luận…</p></span> : query.isError ? <button type="button" className="clan-text-action" onClick={() => query.refetch()}>Tải lại bình luận</button> : comments.length === 0 ? <span className="clan-panel-heading"><p>Chưa có trao đổi nào.</p></span> : <div className="clan-comment-list">{comments.map((comment) => <article className="clan-comment" key={comment.id}><Avatar name={comment.author?.name} size="member" /><div className="clan-comment__copy"><header><strong>{comment.author?.name || 'Thành viên CLB'}</strong><time dateTime={comment.created_at}>{formatRelativeTime(comment.created_at)}</time></header><p>{comment.content}</p></div></article>)}</div>}
  </section>;
}

function ConfirmationDialog({ confirmation, onClose, onConfirm, isPending }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  useViewportDialog(Boolean(confirmation), onClose, dialogRef, closeRef, openerRef);
  if (!confirmation) return null;
  return <ViewportModal id="modal-clan-confirmation" title={confirmation.title} onClose={onClose} dialogRef={dialogRef} className="clan-confirm">
    <h2>{confirmation.title}</h2><p>{confirmation.message}</p>
    <div className="clan-confirm__actions"><button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>Quay lại</button><button type="button" className={confirmation.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={isPending}>{isPending ? 'Đang xử lý…' : confirmation.confirmLabel || 'Xác nhận'}</button></div>
  </ViewportModal>;
}

export default function ClanPage() {
  const { clanId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initialTab = ['feed', 'docs', 'members', 'requests', 'settings'].includes(params.get('tab')) ? params.get('tab') : 'feed';
  const [feedFilter, setFeedFilter] = useState('all');
  const [docFilter, setDocFilter] = useState('all');
  const [docSearch, setDocSearch] = useState('');
  const [docOffset, setDocOffset] = useState(0);
  const [showComposer, setShowComposer] = useState(false);
  const [showJoinQuiz, setShowJoinQuiz] = useState(false);
  const [joinResult, setJoinResult] = useState(null);
  const [composerMode, setComposerMode] = useState('discussion');
  const [expandedComments, setExpandedComments] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const [postDraft, setPostDraft] = useState({ title: '', content: '', url: '' });
  const [pollDraft, setPollDraft] = useState({ question: '', options: ['', ''] });
  const [clanDraft, setClanDraft] = useState({ name: '', description: '', tag: '' });
  const [quizEnabled, setQuizEnabled] = useState(false);
  const [quizMinCorrect, setQuizMinCorrect] = useState(0);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizImportText, setQuizImportText] = useState('');
  const [quizImportFormat, setQuizImportFormat] = useState('json');
  const [manualQuizDraft, setManualQuizDraft] = useState({ prompt: '', options: ['', ''], correctIndex: 0, explanation: '' });
  const composerDialogRef = useRef(null);
  const composerCloseRef = useRef(null);
  const composerOpenerRef = useRef(null);
  useViewportDialog(showComposer, () => setShowComposer(false), composerDialogRef, composerCloseRef, composerOpenerRef);

  const clansQuery = useQuery({ queryKey: ['clans', auth.user?.mssv], queryFn: ({ signal }) => getClans(auth.token, { signal }), enabled: Boolean(auth.token) });
  const clan = useMemo(() => (Array.isArray(clansQuery.data) ? clansQuery.data : []).find((item) => String(item.id) === String(clanId)), [clanId, clansQuery.data]);
  const memberCount = safeNumber(clan?.member_count);
  const level = Math.max(1, safeNumber(clan?.level, 1));
  const permissions = roleInfo(clan?.my_role);
  const isJoined = Boolean(clan?.is_joined);
  const queryBase = useMemo(() => ['clan', auth.user?.mssv, clanId], [auth.user?.mssv, clanId]);
  const tabItems = useMemo(() => {
    const tabs = [{ id: 'feed', label: 'Bản tin' }, { id: 'docs', label: 'Tài liệu' }, { id: 'members', label: 'Thành viên', count: memberCount }];
    if (permissions.canReview) tabs.push({ id: 'requests', label: 'Yêu cầu', count: safeNumber(clan?.pending_request_count) });
    if (permissions.canSettings) tabs.push({ id: 'settings', label: 'Quản trị' });
    return tabs;
  }, [clan?.pending_request_count, memberCount, permissions.canReview, permissions.canSettings]);
  const tab = tabItems.some((item) => item.id === initialTab) ? initialTab : 'feed';

  useRealtimeRoom(isJoined ? `clan:${clanId}` : null, Boolean(auth.token && isJoined));
  const quizQuery = useQuery({ queryKey: [...queryBase, 'quiz'], queryFn: ({ signal }) => getClanQuiz(auth.token, clanId, { signal }), enabled: Boolean(auth.token && clanId && (showJoinQuiz || (permissions.canSettings && tab === 'settings'))) });
  const postsQuery = useInfiniteQuery({
    queryKey: [...queryBase, 'posts'],
    queryFn: ({ pageParam = 0, signal }) => getCommunityPosts(auth.token, { scope: 'clan', scopeId: clanId, limit: POSTS_PER_PAGE, offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = safeNumber(lastPage?.offset) + postsFrom(lastPage).length;
      return nextOffset < safeNumber(lastPage?.total) ? nextOffset : undefined;
    },
    enabled: Boolean(auth.token && isJoined && tab === 'feed')
  });
  const documentsQuery = useQuery({
    queryKey: [...queryBase, 'documents', docFilter, docSearch, docOffset],
    queryFn: ({ signal }) => getClanDocuments(auth.token, clanId, { type: docFilter, search: docSearch, limit: DOCS_PER_PAGE, offset: docOffset, signal }),
    enabled: Boolean(auth.token && isJoined && tab === 'docs')
  });
  const membersQuery = useQuery({ queryKey: [...queryBase, 'members'], queryFn: ({ signal }) => getClanMembers(auth.token, clanId, { signal }), enabled: Boolean(auth.token && isJoined && tab === 'members') });
  const requestsQuery = useQuery({ queryKey: [...queryBase, 'requests'], queryFn: ({ signal }) => getClanJoinRequests(auth.token, clanId, { signal }), enabled: Boolean(auth.token && permissions.canReview && tab === 'requests') });

  useEffect(() => {
    if (clan) setClanDraft({ name: clan.name || '', description: clan.description || '', tag: cleanTag(clan.tag) });
  }, [clan]);
  useEffect(() => {
    if (quizQuery.data) {
      setQuizEnabled(Boolean(quizQuery.data.enabled));
      setQuizMinCorrect(safeNumber(quizQuery.data.min_correct));
    }
  }, [quizQuery.data]);
  useEffect(() => {
    if (initialTab !== tab) {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    }
  }, [initialTab, params, setParams, tab]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['clans'] });
    client.invalidateQueries({ queryKey: queryBase });
  };
  const join = useMutation({ mutationFn: ({ answers } = {}) => joinClan(auth.token, clanId, null, answers), onSuccess: (data) => { setJoinResult(data); refresh(); notify(data?.status === 'approved' ? 'Bạn đã vào CLB.' : 'Yêu cầu tham gia đang chờ duyệt.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const cancelJoin = useMutation({ mutationFn: () => cancelClanJoinRequest(auth.token, clanId), onSuccess: () => { refresh(); notify('Đã hủy yêu cầu tham gia.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const leave = useMutation({ mutationFn: () => leaveClan(auth.token, clanId), onSuccess: () => { notify('Đã rời CLB.', 'success'); refresh(); }, onError: (error) => notify(error.message, 'error') });
  const createPost = useMutation({
    mutationFn: () => composerMode === 'poll' ? createCommunityPost(auth.token, { title: pollDraft.question, content: postDraft.content, scope: 'clan', scopeId: clanId, category: 'poll', poll: { question: pollDraft.question, options: pollDraft.options.map((option) => option.trim()).filter(Boolean) } }) : createCommunityPost(auth.token, { title: postDraft.title, content: postDraft.content, scope: 'clan', scopeId: clanId, category: postDraft.url ? 'material' : 'discussion', attachments: postDraft.url ? [{ url: postDraft.url, title: postDraft.title || 'Tài liệu CLB' }] : [] }),
    onSuccess: () => { setPostDraft({ title: '', content: '', url: '' }); setPollDraft({ question: '', options: ['', ''] }); setShowComposer(false); client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }); notify('Đã đăng bài trong CLB.', 'success'); },
    onError: (error) => notify(error.message, 'error')
  });
  const like = useMutation({ mutationFn: (postId) => toggleCommunityPostLike(auth.token, postId), onSuccess: () => client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }), onError: (error) => notify(error.message, 'error') });
  const removePost = useMutation({ mutationFn: (postId) => deleteCommunityPost(auth.token, postId), onSuccess: () => { client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }); notify('Đã xóa bài viết.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const vote = useMutation({ mutationFn: ({ pollId, optionId }) => voteClanPoll(auth.token, pollId, optionId), onSuccess: () => client.invalidateQueries({ queryKey: [...queryBase, 'posts'] }), onError: (error) => notify(error.message, 'error') });
  const review = useMutation({ mutationFn: ({ requestId, action }) => reviewClanJoinRequest(auth.token, clanId, requestId, action), onSuccess: () => { client.invalidateQueries({ queryKey: [...queryBase, 'requests'] }); refresh(); notify('Đã cập nhật yêu cầu gia nhập.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const role = useMutation({ mutationFn: ({ mssv, nextRole }) => updateClanMemberRole(auth.token, clanId, mssv, nextRole), onSuccess: () => { client.invalidateQueries({ queryKey: [...queryBase, 'members'] }); refresh(); notify('Đã cập nhật vai trò.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const kick = useMutation({ mutationFn: (mssv) => kickClanMember(auth.token, clanId, mssv), onSuccess: () => { client.invalidateQueries({ queryKey: [...queryBase, 'members'] }); refresh(); notify('Đã mời thành viên ra khỏi CLB.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const saveClan = useMutation({ mutationFn: () => updateClan(auth.token, clanId, clanDraft), onSuccess: () => { refresh(); notify('Đã lưu thông tin CLB.', 'success'); }, onError: (error) => notify(error.message, 'error') });
  const saveQuiz = useMutation({ mutationFn: () => updateClanQuiz(auth.token, clanId, { enabled: quizEnabled, minCorrect: quizMinCorrect, ...(quizQuestions.length ? { questions: quizQuestions } : {}) }), onSuccess: (data) => { quizQuery.refetch(); setQuizQuestions([]); notify('Đã lưu cấu hình quiz gia nhập.', 'success'); if (data?.total) setQuizMinCorrect((current) => Math.min(current, data.total)); }, onError: (error) => notify(error.message, 'error') });
  const destroy = useMutation({ mutationFn: () => disbandClan(auth.token, clanId), onSuccess: () => { notify('Đã giải tán CLB.', 'success'); navigate('/clans'); }, onError: (error) => notify(error.message, 'error') });

  const addManualQuizQuestion = () => {
    const prompt = manualQuizDraft.prompt.trim();
    const options = manualQuizDraft.options.map((option) => option.trim()).filter(Boolean);
    const correctIndex = Number(manualQuizDraft.correctIndex);
    if (!prompt) return notify('Vui lòng nhập nội dung câu hỏi.', 'warning');
    if (options.length < 2) return notify('Mỗi câu hỏi cần ít nhất 2 lựa chọn.', 'warning');
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return notify('Hãy chọn một đáp án đúng hợp lệ.', 'warning');
    if (quizQuestions.length >= 30) return notify('Quiz chỉ được tối đa 30 câu hỏi.', 'warning');
    setQuizQuestions((current) => [...current, { question: prompt, options, correctIndex, explanation: manualQuizDraft.explanation.trim() }]);
    setQuizMinCorrect((current) => Math.min(current, quizQuestions.length + 1));
    setManualQuizDraft({ prompt: '', options: ['', ''], correctIndex: 0, explanation: '' });
    notify('Đã thêm câu hỏi thủ công.', 'success');
  };

  const rawPosts = useMemo(() => postsQuery.data?.pages?.flatMap(postsFrom) || [], [postsQuery.data]);
  const posts = useMemo(() => {
    if (feedFilter === 'discussion') return rawPosts.filter((post) => post.category !== 'poll' && !post.poll);
    if (feedFilter === 'poll') return rawPosts.filter((post) => post.category === 'poll' || post.poll);
    if (feedFilter === 'mine') return rawPosts.filter((post) => Boolean(post.is_mine));
    return rawPosts;
  }, [feedFilter, rawPosts]);
  const postTotal = safeNumber(postsQuery.data?.pages?.[0]?.total);
  const documents = Array.isArray(documentsQuery.data?.documents) ? documentsQuery.data.documents : [];
  const documentTotal = safeNumber(documentsQuery.data?.total);
  const documentStats = documentsQuery.data?.stats || {};
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const requests = Array.isArray(requestsQuery.data) ? requestsQuery.data : [];

  const switchTab = (nextTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', nextTab);
    setParams(next, { replace: false });
  };
  const onTabsKeyDown = (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabItems.findIndex((item) => item.id === tab);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabItems.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabItems.length) % tabItems.length;
    switchTab(tabItems[target].id);
    document.getElementById(`clan-tab-${tabItems[target].id}`)?.focus();
  };
  const setDocumentFilter = (nextFilter) => { setDocFilter(nextFilter); setDocOffset(0); };
  const openComposer = (mode, event) => { setComposerMode(mode); composerOpenerRef.current = event.currentTarget; setShowComposer(true); };
  const submitPost = () => {
    if (composerMode === 'poll') {
      if (!pollDraft.question.trim()) return notify('Vui lòng nhập câu hỏi bình chọn.', 'warning');
      if (pollDraft.options.filter((option) => option.trim()).length < 2) return notify('Bình chọn cần ít nhất hai phương án.', 'warning');
    } else if (!postDraft.title.trim() && !postDraft.content.trim()) return notify('Vui lòng nhập tiêu đề hoặc nội dung bài viết.', 'warning');
    createPost.mutate();
  };
  const confirmAction = () => {
    const action = confirmation;
    setConfirmation(null);
    if (action?.kind === 'leave') leave.mutate();
    if (action?.kind === 'delete-post') removePost.mutate(action.postId);
    if (action?.kind === 'kick') kick.mutate(action.mssv);
    if (action?.kind === 'transfer-role') role.mutate({ mssv: action.mssv, nextRole: action.nextRole });
    if (action?.kind === 'disband') destroy.mutate();
  };
  const confirmationPending = Boolean(leave.isPending || removePost.isPending || kick.isPending || role.isPending || destroy.isPending);

  if (!clan && !clansQuery.isLoading) return <section id="tab-clans" className="tab-pane clan-experience"><div className="clan-state-card" role="alert"><h2>Không tìm thấy CLB này</h2><p>CLB có thể không tồn tại hoặc bạn không có quyền xem.</p><button type="button" className="btn btn-secondary" onClick={() => navigate('/clans')}>Quay lại danh sách</button></div></section>;
  if (!clan) return <section id="tab-clans" className="tab-pane clan-experience"><div className="clan-state-card" role="status"><h2>Đang tải CLB…</h2></div></section>;

  const guestPreview = <div className="clan-guest-preview">
    <div className="clan-guest-preview__copy"><h2>Nội dung dành cho thành viên</h2><p>Bản tin, tài liệu và trao đổi của {memberCount} thành viên sẽ mở sau khi bạn được chấp thuận.</p></div>
    <div className="clan-guest-preview__cta"><p>{clan.has_pending_request ? 'Yêu cầu của bạn đang chờ quản trị CLB xét duyệt.' : 'Gửi yêu cầu tham gia để mở không gian nội bộ.'}</p>{clan.has_pending_request ? <button type="button" className="btn btn-secondary" onClick={() => cancelJoin.mutate()} disabled={cancelJoin.isPending}>{cancelJoin.isPending ? 'Đang hủy…' : 'Hủy yêu cầu'}</button> : <button type="button" className="btn btn-primary" onClick={() => { setJoinResult(null); setShowJoinQuiz(true); }}>Tham gia CLB</button>}</div>
  </div>;

  return <section id="tab-clans" className="tab-pane clan-experience">
    <div className="clan-detail-page">
      <button type="button" className="clan-back-link" onClick={() => navigate('/clans')}>← Tất cả CLB & nhóm học tập</button>
      <header className="clan-detail-hero">
        <div className="clan-detail-hero__main"><Avatar name={clan.name} url={clan.avatar_url} size="hero" /><div className="clan-detail-hero__copy"><span className="clan-eyebrow">[{cleanTag(clan.tag)}] · Cấp {level}</span><h1>{clan.name}</h1><p>{clan.description || 'Không gian học tập và sinh hoạt nội bộ dành cho thành viên CLB.'}</p><div className="clan-detail-hero__facts"><span><strong>{memberCount}</strong> thành viên</span><span><strong>{safeNumber(clan.xp)}</strong> XP</span>{isJoined && <span>Vai trò: <strong>{permissions.label}</strong></span>}</div></div></div>
        <div className="clan-detail-hero__actions">{isJoined ? clan.my_role === 'leader' ? <p className="clan-leader-note">Bạn là Bang chủ. Hãy chuyển quyền trong mục Thành viên trước khi rời CLB, hoặc giải tán CLB trong phần Quản trị.</p> : <button type="button" className="btn btn-secondary" onClick={() => setConfirmation({ kind: 'leave', title: 'Rời CLB?', message: 'Bạn sẽ không còn xem được bản tin, tài liệu và khu vực nội bộ của CLB này.', confirmLabel: 'Rời CLB', danger: true })}>Rời CLB</button> : clan.has_pending_request ? <><span className="clan-status-chip">Đang chờ duyệt</span><button type="button" className="clan-text-action" onClick={() => cancelJoin.mutate()} disabled={cancelJoin.isPending}>{cancelJoin.isPending ? 'Đang hủy…' : 'Hủy yêu cầu'}</button></> : <button type="button" className="btn btn-primary" onClick={() => { setJoinResult(null); setShowJoinQuiz(true); }}>Xin tham gia CLB</button>}</div>
      </header>

      <div className="clan-tabs" role="tablist" aria-label="Khu vực CLB" onKeyDown={onTabsKeyDown}>{tabItems.map((item) => <button key={item.id} id={`clan-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`clan-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => switchTab(item.id)}>{item.label}{item.count !== undefined && <span className="clan-count-badge">{item.count}</span>}</button>)}</div>

      {!isJoined ? <div id={`clan-panel-${tab}`} role="tabpanel" aria-labelledby={`clan-tab-${tab}`} className="clan-panel clan-panel-card">{guestPreview}</div> : <>
        {tab === 'feed' && <div id="clan-panel-feed" role="tabpanel" aria-labelledby="clan-tab-feed" className="clan-panel">
          {permissions.canPost && <div className="clan-panel-card"><button type="button" className="clan-composer-trigger" onClick={(event) => openComposer('discussion', event)}><Avatar name={auth.user?.name} size="member" /><span className="clan-composer-trigger__copy"><strong>Chia sẻ với CLB</strong><span>Đăng câu hỏi, cập nhật hoặc tài liệu học tập</span></span></button><div className="clan-composer-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={(event) => openComposer('discussion', event)}>Viết bài</button>{permissions.canPoll && <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => openComposer('poll', event)}>Tạo bình chọn</button>}</div></div>}
          <div className="clan-feed-filter"><div className="clan-doc-filter" role="group" aria-label="Lọc bản tin">{[['all', 'Tất cả'], ['discussion', 'Thảo luận'], ['poll', 'Bình chọn'], ['mine', 'Của tôi']].map(([value, label]) => <button type="button" key={value} className={feedFilter === value ? 'is-active' : ''} aria-pressed={feedFilter === value} onClick={() => setFeedFilter(value)}>{label}</button>)}</div>{postsQuery.isSuccess && <span className="clan-feed-filter__summary">Đã tải {rawPosts.length}/{postTotal} bài</span>}</div>
          {postsQuery.isLoading ? <div className="clan-state-card" role="status"><h2>Đang tải bản tin…</h2></div> : postsQuery.isError ? <PanelError message={postsQuery.error?.message} onRetry={() => postsQuery.refetch()} /> : posts.length === 0 ? <div className="clan-state-card"><h2>Chưa có bài đăng phù hợp</h2><p>{feedFilter === 'all' ? 'Hãy bắt đầu cuộc trao đổi đầu tiên của CLB.' : 'Hãy thử bộ lọc khác hoặc đăng một nội dung mới.'}</p></div> : <div className="clan-feed-list">{posts.map((post) => {
            const poll = post.poll;
            const postLabel = post.category === 'poll' || poll ? 'Bình chọn' : post.category === 'material' ? 'Tài liệu' : 'Thảo luận';
            const canDelete = Boolean(post.is_mine || permissions.canDeleteAny);
            return <article className="clan-post" key={post.id}><div className="clan-post__meta"><div className="clan-post__author"><Avatar name={post.author?.name} url={post.author?.avatar_url} size="member" /><div className="clan-post__author-copy"><strong>{post.author?.name || 'Thành viên CLB'}</strong><span>{post.author?.clan_role ? roleLabels[post.author.clan_role] || 'Thành viên' : 'Thành viên'} · <time dateTime={post.created_at}>{formatRelativeTime(post.created_at)}</time></span></div></div><div className="clan-post__badges">{post.is_pinned && <span className="clan-post__badge clan-post__badge--pinned">Đã ghim</span>}<span className="clan-post__badge">{postLabel}</span></div></div><h3>{post.title || (poll?.question || 'Bài đăng CLB')}</h3>{post.content && <p className="clan-post__content">{post.content}</p>}{Array.isArray(post.attachments) && post.attachments.length > 0 && <div className="clan-attachments">{post.attachments.map((attachment, index) => <AttachmentRenderer attachment={attachment} key={`${post.id}-${index}`} />)}</div>}{poll && <div className="clan-poll"><p className="clan-poll__question">{poll.question || post.title}</p>{(poll.options || []).map((option) => <button type="button" key={option.id} className={`clan-poll__option ${option.is_voted ? 'is-voted' : ''}`} style={{ '--vote': `${safeNumber(option.percentage)}%` }} onClick={() => vote.mutate({ pollId: poll.id, optionId: option.id })} disabled={vote.isPending}><span><span>{option.text || option.option_text}</span><span>{safeNumber(option.percentage)}%</span></span><small className="clan-poll__meta">{safeNumber(option.vote_count)} lượt chọn</small></button>)}</div>}<footer className="clan-post__footer"><div className="clan-post__actions"><button type="button" className={post.is_liked ? 'is-active' : ''} onClick={() => like.mutate(post.id)} disabled={like.isPending}>♥ {safeNumber(post.like_count)}</button><button type="button" onClick={() => setExpandedComments((current) => ({ ...current, [post.id]: !current[post.id] }))}>◌ {safeNumber(post.comment_count)} bình luận</button>{canDelete && <button type="button" className="clan-danger-text" onClick={() => setConfirmation({ kind: 'delete-post', postId: post.id, title: 'Xóa bài đăng?', message: 'Bài đăng và các tương tác liên quan sẽ không còn hiển thị trong CLB.', confirmLabel: 'Xóa bài', danger: true })}>Xóa</button>}</div></footer>{expandedComments[post.id] && <ClanComments postId={post.id} token={auth.token} />}</article>;
          })}</div>}
          {postsQuery.hasNextPage && <div className="clan-load-more"><button type="button" className="btn btn-secondary" onClick={() => postsQuery.fetchNextPage()} disabled={postsQuery.isFetchingNextPage}>{postsQuery.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm bài đăng'}</button></div>}
        </div>}

        {tab === 'docs' && <div id="clan-panel-docs" role="tabpanel" aria-labelledby="clan-tab-docs" className="clan-panel clan-panel-card"><div className="clan-panel-heading"><div><h2>Kho tài liệu</h2><p>Tài liệu được tổng hợp từ các bài viết có đính kèm trong CLB.</p></div>{documentsQuery.isSuccess && <span className="clan-count-badge">{documentTotal} mục</span>}</div><div className="clan-doc-toolbar"><div className="clan-doc-filter" role="group" aria-label="Loại tài liệu">{[['all', 'Tất cả'], ['drive_folder', 'Thư mục'], ['drive_file', 'Tệp'], ['video', 'Video'], ['link', 'Liên kết']].map(([value, label]) => <button type="button" key={value} className={docFilter === value ? 'is-active' : ''} aria-pressed={docFilter === value} onClick={() => setDocumentFilter(value)}>{label}</button>)}</div><label className="clan-search-field clan-doc-search" htmlFor="clan-doc-search">Tìm tài liệu<div className="clan-search-field__control"><span aria-hidden="true">⌕</span><input id="clan-doc-search" type="search" value={docSearch} onChange={(event) => { setDocSearch(event.target.value); setDocOffset(0); }} placeholder="Tên tài liệu hoặc người chia sẻ" /></div></label></div>{documentsQuery.isLoading ? <div className="clan-state-card" role="status"><h2>Đang tải tài liệu…</h2></div> : documentsQuery.isError ? <PanelError message={documentsQuery.error?.message} onRetry={() => documentsQuery.refetch()} /> : <>{<div className="clan-doc-stats"><div className="clan-doc-stat"><strong>{safeNumber(documentStats.total_files)}</strong><span>Tổng tài liệu</span></div><div className="clan-doc-stat"><strong>{safeNumber(documentStats.folders)}</strong><span>Thư mục</span></div><div className="clan-doc-stat"><strong>{safeNumber(documentStats.files)}</strong><span>Tệp</span></div><div className="clan-doc-stat"><strong>{safeNumber(documentStats.videos)}</strong><span>Video</span></div></div>}{documents.length === 0 ? <div className="clan-state-card"><h2>Chưa có tài liệu phù hợp</h2><p>Hãy thử đổi bộ lọc hoặc chia sẻ tài liệu qua một bài đăng.</p></div> : <div className="clan-doc-grid">{documents.map((doc) => <article className="clan-document" key={doc.id}><span className="clan-document__type">{doc.type === 'drive_folder' ? 'Thư mục' : doc.type === 'drive_file' ? 'Tệp Drive' : ['youtube', 'drive_video', 'video'].includes(doc.type) ? 'Video' : 'Liên kết'}</span><h3>{doc.title || 'Tài liệu học tập'}</h3><p>{doc.author_name || 'Thành viên CLB'} · {formatRelativeTime(doc.created_at)}</p><a href={doc.direct_url || doc.url} target="_blank" rel="noopener noreferrer">Mở tài liệu ↗</a></article>)}</div>}{docOffset + documents.length < documentTotal && <div className="clan-load-more"><button type="button" className="btn btn-secondary" onClick={() => setDocOffset((current) => current + DOCS_PER_PAGE)}>Tải thêm tài liệu</button></div>}</>}</div>}

        {tab === 'members' && <div id="clan-panel-members" role="tabpanel" aria-labelledby="clan-tab-members" className="clan-panel clan-panel-card"><div className="clan-panel-heading"><div><h2>Thành viên</h2><p>Danh sách được sắp theo vai trò và đóng góp trong CLB.</p></div><span className="clan-count-badge">{memberCount} thành viên</span></div>{membersQuery.isLoading ? <div className="clan-state-card" role="status"><h2>Đang tải thành viên…</h2></div> : membersQuery.isError ? <PanelError message={membersQuery.error?.message} onRetry={() => membersQuery.refetch()} /> : members.length === 0 ? <div className="clan-state-card"><h2>Chưa có thành viên nào</h2></div> : <div className="clan-member-list">{members.map((member) => <article className="clan-member" key={member.mssv}><div className="clan-member__identity"><Avatar name={member.full_name || member.mssv} size="member" /><div className="clan-member__copy"><strong>{member.full_name || member.mssv}</strong><span>{member.mssv} · {roleLabels[member.role] || 'Thành viên'}{member.contribution_points ? ` · ${member.contribution_points} điểm` : ''}</span></div></div><div className="clan-member__actions"><span className="clan-role-label">{roleLabels[member.role] || 'Thành viên'}</span>{permissions.canAssignRoles && member.mssv !== auth.user?.mssv && <select value={member.role} aria-label={`Đổi vai trò của ${member.full_name || member.mssv}`} onChange={(event) => { if (event.target.value !== member.role) setConfirmation({ kind: 'transfer-role', mssv: member.mssv, nextRole: event.target.value, title: event.target.value === 'leader' ? 'Chuyển quyền Bang chủ?' : 'Đổi vai trò thành viên?', message: event.target.value === 'leader' ? 'Bạn sẽ trở thành thành viên thường và không còn quyền quản trị CLB sau khi chuyển quyền.' : `Vai trò của ${member.full_name || member.mssv} sẽ được cập nhật.`, confirmLabel: 'Xác nhận thay đổi' }); }}><option value="leader">Bang chủ</option><option value="vice_leader">Phó bang</option><option value="elder">Trưởng lão</option><option value="member">Thành viên</option></select>}{permissions.canManageMembers && member.role !== 'leader' && member.mssv !== auth.user?.mssv && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmation({ kind: 'kick', mssv: member.mssv, title: 'Mời thành viên ra khỏi CLB?', message: `${member.full_name || member.mssv} sẽ mất quyền truy cập không gian nội bộ của CLB.`, confirmLabel: 'Mời ra khỏi CLB', danger: true })}>Mời rời CLB</button>}</div></article>)}</div>}</div>}

        {tab === 'requests' && permissions.canReview && <div id="clan-panel-requests" role="tabpanel" aria-labelledby="clan-tab-requests" className="clan-panel clan-panel-card"><div className="clan-panel-heading"><div><h2>Yêu cầu gia nhập</h2><p>Xét duyệt các yêu cầu đang chờ của sinh viên.</p></div><span className="clan-count-badge">{safeNumber(clan.pending_request_count)} chờ duyệt</span></div>{requestsQuery.isLoading ? <div className="clan-state-card" role="status"><h2>Đang tải yêu cầu…</h2></div> : requestsQuery.isError ? <PanelError message={requestsQuery.error?.message} onRetry={() => requestsQuery.refetch()} /> : requests.length === 0 ? <div className="clan-state-card"><h2>Không có yêu cầu chờ duyệt</h2><p>Các yêu cầu mới sẽ xuất hiện tại đây.</p></div> : <div className="clan-request-list">{requests.map((request) => <article className="clan-request" key={request.id}><div className="clan-request__identity"><Avatar name={request.full_name || request.mssv} url={request.avatar_url} size="member" /><div className="clan-request__copy"><strong>{request.full_name || request.mssv}</strong><span>{request.mssv} · {formatRelativeTime(request.created_at)}</span>{request.message && <span>Lời nhắn: {request.message}</span>}{request.quiz_score !== null && request.quiz_score !== undefined && <span>Quiz: {request.quiz_score}/{request.quiz_total} · {request.quiz_passed ? 'Đạt ngưỡng' : 'Chờ xét duyệt'}</span>}</div></div><div className="clan-request__actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => review.mutate({ requestId: request.id, action: 'approve' })} disabled={review.isPending}>Duyệt</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => review.mutate({ requestId: request.id, action: 'reject' })} disabled={review.isPending}>Từ chối</button></div></article>)}</div>}</div>}

        {tab === 'settings' && permissions.canSettings && <div id="clan-panel-settings" role="tabpanel" aria-labelledby="clan-tab-settings" className="clan-panel clan-settings">
          <form className="clan-panel-card clan-settings-form" onSubmit={(event) => { event.preventDefault(); saveClan.mutate(); }}>
            <div className="clan-panel-heading"><div><h2>Thông tin công khai</h2><p>Những gì sinh viên thấy trước khi tham gia.</p></div></div>
            <div className="clan-settings-form__two-columns"><label htmlFor="clan-name">Tên CLB<input id="clan-name" className="form-input" value={clanDraft.name} onChange={(event) => setClanDraft({ ...clanDraft, name: event.target.value })} required /></label><label htmlFor="clan-tag">Tag<input id="clan-tag" className="form-input" value={clanDraft.tag} onChange={(event) => setClanDraft({ ...clanDraft, tag: event.target.value })} /></label></div>
            <label htmlFor="clan-description">Mô tả<textarea id="clan-description" className="form-input" rows={3} value={clanDraft.description} onChange={(event) => setClanDraft({ ...clanDraft, description: event.target.value })} /></label>
            <div className="clan-settings-actionbar"><button type="submit" className="btn btn-primary" disabled={saveClan.isPending}>{saveClan.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
          </form>

          <form className="clan-panel-card clan-quiz-form" onSubmit={(event) => { event.preventDefault(); saveQuiz.mutate(); }}>
            <div className="clan-settings-row"><div><h2>Quiz gia nhập</h2><p>{quizQuestions.length || quizQuery.data?.total || 0}/30 câu hỏi</p></div><label className="clan-quiz-form__toggle"><input type="checkbox" checked={quizEnabled} onChange={(event) => setQuizEnabled(event.target.checked)} /><span>Bật quiz</span></label></div>
            {quizEnabled && <label className="clan-quiz-threshold" htmlFor="quiz-min-correct">Số câu đúng tối thiểu<input id="quiz-min-correct" className="form-input" type="number" min="0" max={quizQuestions.length || quizQuery.data?.total || 30} value={quizMinCorrect} onChange={(event) => setQuizMinCorrect(Number(event.target.value))} /></label>}
            <details className="clan-disclosure">
              <summary>Soạn hoặc nhập câu hỏi</summary>
              <div className="clan-disclosure__body">
                <div className="clan-quiz-import-grid"><label htmlFor="quiz-format">Định dạng<select id="quiz-format" className="form-input" value={quizImportFormat} onChange={(event) => setQuizImportFormat(event.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select></label><label htmlFor="quiz-import">Nội dung câu hỏi<textarea id="quiz-import" className="form-input quiz-import-textarea" rows={5} value={quizImportText} onChange={(event) => setQuizImportText(event.target.value)} placeholder={QUIZ_IMPORT_SCHEMA} /></label></div>
                <div className="clan-quiz-import-actions"><label>Chọn file {quizImportFormat.toUpperCase()}<input type="file" accept={quizImportFormat === 'json' ? '.json,application/json' : '.csv,text/csv'} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setQuizImportText).catch(() => notify('Không thể đọc file quiz.', 'error')); }} /></label><button type="button" className="btn btn-secondary btn-sm" onClick={() => { try { const parsed = parseQuizText(quizImportText, quizImportFormat); setQuizQuestions(parsed); setQuizMinCorrect((current) => Math.min(current, parsed.length)); notify(`Đã nạp ${parsed.length} câu hỏi.`, 'success'); } catch (error) { notify(error.message, 'error'); } }}>Nạp câu hỏi</button></div>
                <details className="clan-disclosure clan-disclosure--nested"><summary>Thêm câu hỏi thủ công</summary><div className="clan-disclosure__body clan-quiz-manual"><label htmlFor="manual-quiz-prompt">Nội dung câu hỏi<input id="manual-quiz-prompt" className="form-input" value={manualQuizDraft.prompt} onChange={(event) => setManualQuizDraft({ ...manualQuizDraft, prompt: event.target.value })} placeholder="Nội dung câu hỏi…" /></label><div className="clan-quiz-options">{manualQuizDraft.options.map((option, index) => <label htmlFor={`manual-quiz-option-${index}`} key={index}>Lựa chọn {index + 1}<input id={`manual-quiz-option-${index}`} className="form-input" value={option} onChange={(event) => setManualQuizDraft((current) => ({ ...current, options: current.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /></label>)}</div><div className="clan-quiz-manual__actions"><label htmlFor="manual-quiz-answer">Đáp án đúng<select id="manual-quiz-answer" className="form-input" value={manualQuizDraft.correctIndex} onChange={(event) => setManualQuizDraft({ ...manualQuizDraft, correctIndex: Number(event.target.value) })}>{manualQuizDraft.options.map((_, index) => <option key={index} value={index}>Lựa chọn {index + 1}</option>)}</select></label><label htmlFor="manual-quiz-explanation">Giải thích (tùy chọn)<input id="manual-quiz-explanation" className="form-input" value={manualQuizDraft.explanation} onChange={(event) => setManualQuizDraft({ ...manualQuizDraft, explanation: event.target.value })} /></label></div><button type="button" className="btn btn-secondary btn-sm" onClick={addManualQuizQuestion} disabled={quizQuestions.length >= 30}>Thêm câu hỏi</button></div></details>
                {quizQuestions.length > 0 && <div className="clan-quiz-draft-list" aria-live="polite"><strong>Câu hỏi sẽ lưu ({quizQuestions.length}/30)</strong>{quizQuestions.map((question, index) => <div className="clan-quiz-draft" key={`${question.question}-${index}`}><span>{index + 1}. {question.question}</span><button type="button" className="clan-text-action" onClick={() => setQuizQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Bỏ</button></div>)}</div>}
              </div>
            </details>
            <div className="clan-settings-actionbar"><button type="submit" className="btn btn-primary" disabled={saveQuiz.isPending || quizQuery.isLoading}>{saveQuiz.isPending ? 'Đang lưu…' : 'Lưu cấu hình quiz'}</button></div>
          </form>

          <details className="clan-danger-zone"><summary>Vùng nguy hiểm</summary><div><p>Giải tán CLB sẽ xóa toàn bộ bài viết, tài liệu và thành viên.</p><button type="button" className="btn btn-danger" onClick={() => setConfirmation({ kind: 'disband', title: 'Giải tán CLB?', message: 'Toàn bộ bài viết, tài liệu, thành viên và dữ liệu CLB sẽ bị xóa vĩnh viễn.', confirmLabel: 'Giải tán CLB', danger: true })}>Giải tán CLB</button></div></details>
        </div>}
      </>}
    </div>

    <ClanJoinQuizModal open={showJoinQuiz} clanName={clan.name} quiz={quizQuery.data} isLoading={quizQuery.isLoading} isPending={join.isPending} result={joinResult} onClose={() => { if (!join.isPending) setShowJoinQuiz(false); }} onViewClan={() => { setShowJoinQuiz(false); refresh(); }} onSubmit={(answers) => join.mutate({ answers })} />
    {showComposer && <ViewportModal id="modal-clan-post-composer" title="Tạo bài đăng trong CLB" onClose={() => setShowComposer(false)} dialogRef={composerDialogRef} className="clan-modal"><div className="clan-modal__header"><div><span className="clan-eyebrow">BẢN TIN CLB</span><h2>{composerMode === 'poll' ? 'Tạo bình chọn' : 'Viết bài đăng'}</h2></div><button ref={composerCloseRef} type="button" className="clan-icon-button" onClick={() => setShowComposer(false)} aria-label="Đóng hộp thoại">×</button></div><div className="clan-composer-actions" role="group" aria-label="Loại bài đăng"><button type="button" className={`btn btn-sm ${composerMode === 'discussion' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setComposerMode('discussion')}>Bài viết</button>{permissions.canPoll && <button type="button" className={`btn btn-sm ${composerMode === 'poll' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setComposerMode('poll')}>Bình chọn</button>}</div><div className="clan-modal__intro">Nội dung sẽ chỉ hiển thị cho thành viên CLB.</div><div className="clan-composer-form">{composerMode === 'discussion' ? <><label htmlFor="clan-post-title">Tiêu đề<input id="clan-post-title" className="form-input" maxLength={180} value={postDraft.title} onChange={(event) => setPostDraft({ ...postDraft, title: event.target.value })} placeholder="Ví dụ: Tìm bạn ôn thi cuối kỳ" /></label><label htmlFor="clan-post-content">Nội dung<textarea id="clan-post-content" className="form-input" rows={5} maxLength={5000} value={postDraft.content} onChange={(event) => setPostDraft({ ...postDraft, content: event.target.value })} placeholder="Chia sẻ câu hỏi, cập nhật hoặc lời mời học nhóm…" /></label><label htmlFor="clan-post-link">Liên kết tài liệu (tùy chọn)<input id="clan-post-link" className="form-input" type="url" value={postDraft.url} onChange={(event) => setPostDraft({ ...postDraft, url: event.target.value })} placeholder="Google Drive hoặc YouTube" /></label></> : <><label htmlFor="clan-poll-question">Câu hỏi bình chọn<input id="clan-poll-question" className="form-input" value={pollDraft.question} onChange={(event) => setPollDraft({ ...pollDraft, question: event.target.value })} /></label><label htmlFor="clan-poll-note">Ghi chú (tùy chọn)<textarea id="clan-poll-note" className="form-input" rows={3} value={postDraft.content} onChange={(event) => setPostDraft({ ...postDraft, content: event.target.value })} /></label>{pollDraft.options.map((option, index) => <label htmlFor={`clan-poll-option-${index}`} key={index}>Phương án {index + 1}<input id={`clan-poll-option-${index}`} className="form-input" value={option} onChange={(event) => { const options = [...pollDraft.options]; options[index] = event.target.value; setPollDraft({ ...pollDraft, options }); }} /></label>)}<button type="button" className="btn btn-secondary btn-sm" onClick={() => setPollDraft({ ...pollDraft, options: [...pollDraft.options, ''] })}>Thêm phương án</button></>}</div><div className="clan-modal__footer"><button type="button" className="btn btn-secondary" onClick={() => setShowComposer(false)}>Hủy</button><button type="button" className="btn btn-primary" onClick={submitPost} disabled={createPost.isPending}>{createPost.isPending ? 'Đang đăng…' : composerMode === 'poll' ? 'Tạo bình chọn' : 'Đăng bài'}</button></div></ViewportModal>}
    <ConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} onConfirm={confirmAction} isPending={confirmationPending} />
  </section>;
}
