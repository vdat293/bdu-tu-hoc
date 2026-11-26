import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  cancelClanJoinRequest,
  disbandClan,
  getClanJoinRequests,
  getClanMembers,
  getClanQuiz,
  joinClan,
  kickClanMember,
  leaveClan,
  reviewClanJoinRequest,
  updateClanMemberRole
} from '../../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';
import ClanJoinQuizModal from '../components/ClanJoinQuizModal.jsx';
import { ClubAvatar, RoleBadge } from '../components/ClubPrimitives.jsx';
import FeedList from '../discussion/FeedList.jsx';
import DocLibrary from '../documents/DocLibrary.jsx';
import { feedKey, useClub } from '../hooks/useClubs.js';
import { cleanTag, safeNumber } from '../lib/format.js';
import { rolePermissions } from '../lib/roles.js';
import MemberList from '../members/MemberList.jsx';
import RequestsQueue from '../members/RequestsQueue.jsx';
import ClubSettingsForm from '../settings/ClubSettingsForm.jsx';
import QuizSettings from '../settings/QuizSettings.jsx';
import RoleLabelEditor from '../settings/RoleLabelEditor.jsx';
import '../styles/clubs.css';

const TAB_IDS = ['feed', 'docs', 'members', 'requests', 'settings'];
const TAB_LABELS = {
  feed: 'Thảo luận',
  docs: 'Tài liệu',
  members: 'Thành viên',
  requests: 'Yêu cầu',
  settings: 'Cài đặt'
};

export default function ClubDetailPage() {
  const { clanId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const [showJoinQuiz, setShowJoinQuiz] = useState(false);
  const [joinResult, setJoinResult] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const tabRefs = useRef({});
  const confirmDialogRef = useRef(null);
  const confirmCloseRef = useRef(null);
  const confirmOpenerRef = useRef(null);
  useViewportDialog(Boolean(confirmation), () => setConfirmation(null), confirmDialogRef, confirmCloseRef, confirmOpenerRef);

  const { club: clan, isLoading: clansLoading } = useClub(clanId);
  const memberCount = safeNumber(clan?.member_count);
  const level = Math.max(1, safeNumber(clan?.level, 1));
  const permissions = rolePermissions(clan?.role_labels, clan?.my_role);
  const isJoined = Boolean(clan?.is_joined);
  const queryBase = useMemo(() => ['clan', auth.user?.mssv, String(clanId)], [auth.user?.mssv, clanId]);

  const tabItems = useMemo(() => {
    const tabs = [
      { id: 'feed', label: TAB_LABELS.feed },
      { id: 'docs', label: TAB_LABELS.docs },
      { id: 'members', label: TAB_LABELS.members, count: memberCount }
    ];
    if (permissions.canReview) {
      tabs.push({ id: 'requests', label: TAB_LABELS.requests, count: safeNumber(clan?.pending_request_count) });
    }
    if (permissions.canSettings) tabs.push({ id: 'settings', label: TAB_LABELS.settings });
    return tabs;
  }, [clan?.pending_request_count, memberCount, permissions.canReview, permissions.canSettings]);
  const tab = tabItems.some((item) => item.id === requestedTab) ? requestedTab : 'feed';

  useRealtimeRoom(isJoined ? `clan:${clanId}` : null, Boolean(auth.token && isJoined));

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail;
      if (!detail || String(detail?.data?.scopeId) !== String(clanId)) return;
      const type = String(detail.type || '');
      if (!type.startsWith('community.')) return;
      const incoming = detail.data?.post;
      const key = feedKey(auth.user?.mssv, clanId);
      if (incoming?.id) {
        client.setQueryData(key, (old) => {
          if (!old?.pages) return old;
          const exists = old.pages.some((page) =>
            (Array.isArray(page?.posts) ? page.posts : Array.isArray(page) ? page : []).some((p) => String(p.id) === String(incoming.id))
          );
          if (exists) return old;
          const [first, ...rest] = old.pages;
          if (Array.isArray(first?.posts)) return { ...old, pages: [{ ...first, posts: [incoming, ...first.posts] }, ...rest] };
          if (Array.isArray(first)) return { ...old, pages: [[incoming, ...first], ...rest] };
          return old;
        });
      } else {
        client.invalidateQueries({ queryKey: key, refetchType: 'active' });
      }
    };
    window.addEventListener('bdu:realtime', handler);
    return () => window.removeEventListener('bdu:realtime', handler);
  }, [auth.user?.mssv, clanId, client]);

  const quizQuery = useQuery({
    queryKey: [...queryBase, 'quiz'],
    queryFn: ({ signal }) => getClanQuiz(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && clanId && (showJoinQuiz || (permissions.canSettings && tab === 'settings')))
  });
  const membersQuery = useQuery({
    queryKey: [...queryBase, 'members'],
    queryFn: ({ signal }) => getClanMembers(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && isJoined && tab === 'members')
  });
  const requestsQuery = useQuery({
    queryKey: [...queryBase, 'requests'],
    queryFn: ({ signal }) => getClanJoinRequests(auth.token, clanId, { signal }),
    enabled: Boolean(auth.token && permissions.canReview && tab === 'requests')
  });

  const refreshScoped = () => {
    client.invalidateQueries({ queryKey: ['clans'] });
    client.invalidateQueries({ queryKey: queryBase });
  };

  const join = useMutation({
    mutationFn: ({ answers } = {}) => joinClan(auth.token, clanId, null, answers),
    onSuccess: (data) => {
      setJoinResult(data);
      refreshScoped();
      notify(data?.status === 'approved' ? 'Bạn đã vào CLB.' : 'Yêu cầu tham gia đang chờ duyệt.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const cancelJoin = useMutation({
    mutationFn: () => cancelClanJoinRequest(auth.token, clanId),
    onSuccess: () => {
      refreshScoped();
      notify('Đã hủy yêu cầu tham gia.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const leave = useMutation({
    mutationFn: () => leaveClan(auth.token, clanId),
    onSuccess: () => {
      notify('Đã rời CLB.', 'success');
      refreshScoped();
    },
    onError: (error) => notify(error.message, 'error')
  });
  const review = useMutation({
    mutationFn: ({ requestId, action }) => reviewClanJoinRequest(auth.token, clanId, requestId, action),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'requests'] });
      refreshScoped();
      notify('Đã cập nhật yêu cầu gia nhập.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const changeRole = useMutation({
    mutationFn: ({ mssv, nextRole }) => updateClanMemberRole(auth.token, clanId, mssv, nextRole),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'members'] });
      refreshScoped();
      notify('Đã cập nhật vai trò.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const kick = useMutation({
    mutationFn: (mssv) => kickClanMember(auth.token, clanId, mssv),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [...queryBase, 'members'] });
      refreshScoped();
      notify('Đã mời thành viên ra khỏi CLB.', 'success');
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

  const switchTab = (nextTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', nextTab);
    setParams(next, { replace: false });
  };

  const onTablistKeyDown = (event) => {
    const currentIndex = tabItems.findIndex((item) => item.id === tab);
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabItems.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabItems.length) % tabItems.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabItems.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const targetId = tabItems[nextIndex].id;
    switchTab(targetId);
    tabRefs.current[targetId]?.focus();
  };

  const confirmAction = () => {
    const action = confirmation;
    setConfirmation(null);
    if (action?.kind === 'leave') leave.mutate();
    if (action?.kind === 'kick') kick.mutate(action.mssv);
    if (action?.kind === 'transfer-role') changeRole.mutate({ mssv: action.mssv, nextRole: action.nextRole });
    if (action?.kind === 'disband') destroy.mutate();
  };
  const confirmationPending = Boolean(leave.isPending || kick.isPending || changeRole.isPending || destroy.isPending);

  if (!clan && !clansLoading) {
    return (
      <section id="tab-clans" className="clb-root">
        <div className="clb-empty" role="alert">
          <h2>Không tìm thấy CLB này</h2>
          <p>CLB có thể không tồn tại hoặc bạn không có quyền xem.</p>
          <button type="button" className="clb-btn clb-btn--secondary" onClick={() => navigate('/clans')}>
            Quay lại danh sách
          </button>
        </div>
      </section>
    );
  }

  if (!clan) {
    return (
      <section id="tab-clans" className="clb-root">
        <div className="clb-empty" role="status"><h2>Đang tải CLB…</h2></div>
      </section>
    );
  }

  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const requests = Array.isArray(requestsQuery.data) ? requestsQuery.data : [];

  return (
    <section id="tab-clans" className="clb-root">
      <div>
        <button type="button" className="clb-link-btn clb-link-btn--muted" onClick={() => navigate('/clans')}>
          ← Tất cả CLB &amp; nhóm học tập
        </button>
      </div>

      <header className="clb-detail-hero">
        <div className="clb-detail-hero__main">
          <ClubAvatar src={clan.avatar_url} name={clan.name} size="lg" />
          <div className="clb-detail-hero__copy">
            <span className="clb-eyebrow">[{cleanTag(clan.tag)}] · Cấp {level}</span>
            <h1>{clan.name}</h1>
            <p>{clan.description || 'Không gian học tập và sinh hoạt nội bộ dành cho thành viên CLB.'}</p>
            <div className="clb-detail-hero__facts">
              <span><strong>{memberCount}</strong> thành viên</span>
              <span><strong>{safeNumber(clan.xp)}</strong> XP</span>
              {isJoined && <span>Vai trò: <RoleBadge role={clan.my_role} roleLabels={clan.role_labels} /></span>}
            </div>
          </div>
        </div>

        <div className="clb-detail-hero__actions">
          {isJoined ? (
            clan.my_role === 'leader' ? (
              <p className="clb-permission-note">
                Bạn là Bang chủ. Hãy chuyển quyền trong mục Thành viên trước khi rời CLB, hoặc giải tán CLB trong phần Cài đặt.
              </p>
            ) : (
              <button
                type="button"
                className="clb-btn clb-btn--secondary"
                onClick={(event) => {
                  confirmOpenerRef.current = event.currentTarget;
                  setConfirmation({
                    kind: 'leave',
                    title: 'Rời CLB?',
                    message: 'Bạn sẽ không còn xem được bản tin, tài liệu và khu vực nội bộ của CLB này.',
                    confirmLabel: 'Rời CLB',
                    danger: true
                  });
                }}
              >
                Rời CLB
              </button>
            )
          ) : clan.has_pending_request ? (
            <>
              <span className="clb-chip clb-chip--warn">Đang chờ duyệt</span>
              <button
                type="button"
                className="clb-link-btn"
                onClick={() => cancelJoin.mutate()}
                disabled={cancelJoin.isPending}
              >
                {cancelJoin.isPending ? 'Đang hủy…' : 'Hủy yêu cầu'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="clb-btn clb-btn--primary"
              onClick={() => { setJoinResult(null); setShowJoinQuiz(true); }}
            >
              Xin tham gia CLB
            </button>
          )}
        </div>
      </header>

      <div className="clb-detail-layout">
        <div className="clb-detail-main">
          <div className="clb-tabs" role="tablist" aria-label="Khu vực CLB" onKeyDown={onTablistKeyDown}>
            {tabItems.map((item) => (
              <button
                key={item.id}
                id={`club-tab-${item.id}`}
                ref={(el) => { tabRefs.current[item.id] = el; }}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`club-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => switchTab(item.id)}
              >
                <span>{item.label}</span>
                {item.count !== undefined && <span className="clb-tab-count">{item.count}</span>}
              </button>
            ))}
          </div>

          {!isJoined ? (
            <div id={`club-panel-${tab}`} role="tabpanel" aria-labelledby={`club-tab-${tab}`} className="clb-empty">
              <h2>Nội dung dành cho thành viên</h2>
              <p>Bản tin, tài liệu và trao đổi của {memberCount} thành viên sẽ mở sau khi bạn được chấp thuận.</p>
            </div>
          ) : (
            <>
              {tab === 'feed' && (
                <div id="club-panel-feed" role="tabpanel" aria-labelledby="club-tab-feed">
                  <FeedList
                    clanId={clanId}
                    roleLabels={clan.role_labels}
                    canPost={permissions.canPost}
                    canPoll={permissions.canPoll}
                    canDeleteAny={permissions.canDeleteAny}
                    myRole={clan.my_role}
                  />
                </div>
              )}

              {tab === 'docs' && (
                <div id="club-panel-docs" role="tabpanel" aria-labelledby="club-tab-docs">
                  <DocLibrary clanId={clanId} canPost={permissions.canPost} />
                </div>
              )}

              {tab === 'members' && (
                <div id="club-panel-members" role="tabpanel" aria-labelledby="club-tab-members" className="clb-surface">
                  <div className="clb-panel-head">
                    <div>
                      <h2>Thành viên</h2>
                      <p>Danh sách được sắp theo vai trò và đóng góp trong CLB.</p>
                    </div>
                    <span className="clb-chip">{memberCount} thành viên</span>
                  </div>
                  <MemberList
                    members={members}
                    roleLabels={clan.role_labels}
                    isLoading={membersQuery.isLoading}
                    isError={membersQuery.isError}
                    error={membersQuery.error}
                    onRetry={() => membersQuery.refetch()}
                    canAssignRoles={permissions.canAssignRoles}
                    myMssv={auth.user?.mssv}
                    actionPending={changeRole.isPending || kick.isPending}
                    onRoleChange={(member, nextRole) => {
                      if (nextRole === 'leader') {
                        setConfirmation({
                          kind: 'transfer-role',
                          mssv: member.mssv,
                          nextRole,
                          title: 'Chuyển quyền Bang chủ?',
                          message: 'Bạn sẽ trở thành thành viên thường và không còn quyền quản trị CLB sau khi chuyển quyền.',
                          confirmLabel: 'Xác nhận thay đổi'
                        });
                      } else {
                        changeRole.mutate({ mssv: member.mssv, nextRole });
                      }
                    }}
                    onKick={(member) => setConfirmation({
                      kind: 'kick',
                      mssv: member.mssv,
                      title: 'Mời thành viên ra khỏi CLB?',
                      message: `${member.full_name || member.mssv} sẽ không còn xem được nội dung nội bộ.`,
                      confirmLabel: 'Mời ra',
                      danger: true
                    })}
                  />
                </div>
              )}

              {tab === 'requests' && permissions.canReview && (
                <div id="club-panel-requests" role="tabpanel" aria-labelledby="club-tab-requests" className="clb-surface">
                  <div className="clb-panel-head">
                    <div>
                      <h2>Yêu cầu gia nhập</h2>
                      <p>Xét duyệt các yêu cầu đang chờ của sinh viên.</p>
                    </div>
                    <span className="clb-chip">{safeNumber(clan.pending_request_count)} chờ duyệt</span>
                  </div>
                  <RequestsQueue
                    requests={requests}
                    isLoading={requestsQuery.isLoading}
                    isError={requestsQuery.isError}
                    error={requestsQuery.error}
                    onRetry={() => requestsQuery.refetch()}
                    actionPending={review.isPending}
                    onApprove={(request) => review.mutate({ requestId: request.id, action: 'approve' })}
                    onReject={(request) => review.mutate({ requestId: request.id, action: 'reject' })}
                  />
                </div>
              )}

              {tab === 'settings' && permissions.canSettings && (
                <div id="club-panel-settings" role="tabpanel" aria-labelledby="club-tab-settings" className="clb-stack">
                  <ClubSettingsForm club={clan} />
                  <RoleLabelEditor clanId={clanId} initialLabels={clan.role_labels} />
                  <QuizSettings clanId={clanId} queryBase={queryBase} />
                  <details className="clb-danger-box">
                    <summary>Vùng nguy hiểm</summary>
                    <div className="clb-danger-box__body">
                      <p>Giải tán CLB sẽ xóa vĩnh viễn toàn bộ bài viết, tài liệu và thành viên.</p>
                      <button
                        type="button"
                        className="clb-btn clb-btn--danger clb-btn--sm"
                        onClick={() => setConfirmation({
                          kind: 'disband',
                          title: 'Giải tán CLB?',
                          message: 'Toàn bộ bài viết, tài liệu, thành viên và dữ liệu CLB sẽ bị xóa vĩnh viễn.',
                          confirmLabel: 'Giải tán CLB',
                          danger: true
                        })}
                      >
                        Giải tán CLB
                      </button>
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="clb-detail-sidebar" aria-label="Thông tin CLB">
          <div className="clb-surface">
            <div className="clb-panel-head" style={{ marginBottom: 0 }}>
              <h2>Về CLB</h2>
            </div>
            <dl className="clb-about-list">
              <div><dt>Mã CLB</dt><dd>{clan.code || '—'}</dd></div>
              <div><dt>Cấp độ</dt><dd>Cấp {level} · {safeNumber(clan.xp)} XP</dd></div>
              <div><dt>Thành viên</dt><dd>{memberCount}</dd></div>
            </dl>
            {TAB_IDS.filter((id) => !tabItems.some((t) => t.id === id)).length > 0 && (
              <p className="clb-muted" style={{ marginTop: 12, marginBottom: 0 }}>
                Một số mục quản trị chỉ hiển thị theo vai trò của bạn.
              </p>
            )}
          </div>
        </aside>
      </div>

      <ClanJoinQuizModal
        open={showJoinQuiz}
        clanName={clan.name}
        quiz={quizQuery.data}
        isLoading={quizQuery.isLoading}
        isPending={join.isPending}
        result={joinResult}
        onClose={() => { if (!join.isPending) setShowJoinQuiz(false); }}
        onViewClan={() => { setShowJoinQuiz(false); refreshScoped(); }}
        onSubmit={(answers) => join.mutate({ answers })}
      />

      {confirmation && (
        <ViewportModal
          id="modal-club-confirmation"
          title={confirmation.title}
          onClose={() => setConfirmation(null)}
          dialogRef={confirmDialogRef}
          className="clb-modal clb-modal--sm"
        >
          <div className="clb-modal__head">
            <h2>{confirmation.title}</h2>
          </div>
          <p className="clb-modal__intro">{confirmation.message}</p>
          <div className="clb-modal__foot">
            <button ref={confirmCloseRef} type="button" className="clb-btn clb-btn--secondary" onClick={() => setConfirmation(null)}>
              Quay lại
            </button>
            <button
              type="button"
              className={confirmation.danger ? 'clb-btn clb-btn--danger' : 'clb-btn clb-btn--primary'}
              onClick={confirmAction}
              disabled={confirmationPending}
            >
              {confirmationPending ? 'Đang xử lý…' : confirmation.confirmLabel || 'Xác nhận'}
            </button>
          </div>
        </ViewportModal>
      )}
    </section>
  );
}
