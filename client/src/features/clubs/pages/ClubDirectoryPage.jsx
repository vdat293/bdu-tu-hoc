import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelClanJoinRequest, createClan, getClanQuiz, joinClan } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';
import ClanJoinQuizModal from '../components/ClanJoinQuizModal.jsx';
import ClubCard from '../components/ClubCard.jsx';
import { ClubCardSkeleton } from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useClubs } from '../hooks/useClubs.js';
import '../clubs.css';
import '../motion.css';

export default function ClubDirectoryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const filter = params.get('filter') === 'mine' ? 'mine' : 'all';
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [joinTarget, setJoinTarget] = useState(null);
  const [joinResult, setJoinResult] = useState(null);
  const [draft, setDraft] = useState({ name: '', code: '', tag: '', description: '' });
  const createDialogRef = useRef(null);
  const createCloseRef = useRef(null);
  const createOpenerRef = useRef(null);
  useViewportDialog(showCreateModal, () => setShowCreateModal(false), createDialogRef, createCloseRef, createOpenerRef);

  const query = useClubs();

  const joinQuizQuery = useQuery({
    queryKey: ['clan-quiz', joinTarget?.id],
    queryFn: ({ signal }) => getClanQuiz(auth.token, joinTarget.id, { signal }),
    enabled: Boolean(auth.token && joinTarget?.id)
  });

  const refreshClans = () => client.invalidateQueries({ queryKey: ['clans'] });
  const create = useMutation({
    mutationFn: () => createClan(auth.token, draft),
    onSuccess: (data) => {
      setDraft({ name: '', code: '', tag: '', description: '' });
      setShowCreateModal(false);
      refreshClans();
      notify('Đã thành lập CLB mới.', 'success');
      if (data?.id) navigate(`/clans/${data.id}`);
    },
    onError: (error) => notify(error.message, 'error')
  });

  const join = useMutation({
    mutationFn: ({ clanId, answers }) => joinClan(auth.token, clanId, null, answers),
    onSuccess: (data) => {
      setJoinResult(data);
      refreshClans();
      notify(data?.status === 'approved' ? 'Bạn đã vào CLB.' : 'Yêu cầu tham gia đang chờ duyệt.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const cancelJoin = useMutation({
    mutationFn: (clanId) => cancelClanJoinRequest(auth.token, clanId),
    onSuccess: () => {
      refreshClans();
      notify('Đã hủy yêu cầu tham gia CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const rawList = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const canCreateClan = Boolean(query.data?.can_create_clan);
  const filtered = useMemo(() => {
    const needle = search.toLocaleLowerCase('vi-VN').trim();
    return rawList.filter((clan) => {
      const text = `${clan.name || ''} ${clan.code || ''} ${clan.tag || ''} ${clan.description || ''}`.toLocaleLowerCase('vi-VN');
      return (!needle || text.includes(needle)) && (filter === 'all' || Boolean(clan.is_joined));
    });
  }, [filter, rawList, search]);

  const updateParams = (changes, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next, { replace });
  };

  const openCreate = (event) => {
    if (!canCreateClan) return;
    createOpenerRef.current = event.currentTarget;
    setShowCreateModal(true);
  };

  return (
    <section id="tab-clans" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <h1>CLB & Nhóm học tập</h1>
          <p>Khám phá, tham gia hoặc quản lý cộng đồng học tập của bạn.</p>
        </div>
        <div className="club-directory-hero__action">
          <button type="button" className="btn btn-primary club-primary-action" onClick={openCreate} disabled={query.isSuccess && !canCreateClan} aria-describedby="club-create-permission">
            Thành lập CLB
          </button>
          {query.isSuccess && !canCreateClan && <p id="club-create-permission" className="club-permission-note">Cần danh hiệu #TTCDS hoặc quyền quản trị để thành lập CLB.</p>}
        </div>
      </header>

      <div className="club-directory-toolbar" aria-label="Lọc danh sách CLB">
        <div className="club-segmented" role="group" aria-label="Phạm vi CLB">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => updateParams({ filter: null })}>Khám phá tất cả</button>
          <button type="button" className={filter === 'mine' ? 'is-active' : ''} aria-pressed={filter === 'mine'} onClick={() => updateParams({ filter: 'mine' })}>CLB của tôi</button>
        </div>
        <div className="club-search-field">
          <label className="club-visually-hidden" htmlFor="club-search-input">Tìm CLB hoặc nhóm học tập</label>
          <div className="club-search-field__control">
            <input id="club-search-input" type="search" value={search} onChange={(event) => updateParams({ q: event.target.value }, true)} placeholder="Tên, mã hoặc tag CLB" />
            {search && <button type="button" className="club-icon-button" onClick={() => updateParams({ q: null }, true)} aria-label="Xóa từ khóa tìm kiếm">×</button>}
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <div className="club-directory-grid" aria-label="Đang tải danh sách CLB">
          {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
        </div>
      ) : query.isError ? (
        <div className="club-empty" role="alert"><h2>Chưa thể tải danh sách CLB</h2><p>{query.error?.message || 'Vui lòng thử lại sau ít phút.'}</p><button type="button" className="btn btn-secondary" onClick={() => query.refetch()}>Thử lại</button></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? 'Không tìm thấy CLB phù hợp' : filter === 'mine' ? 'Bạn chưa tham gia CLB nào' : 'Chưa có CLB nào'}
          hint={search ? 'Thử lại với tên đầy đủ, mã CLB hoặc tag khác.' : filter === 'mine' ? 'Khám phá các nhóm đang hoạt động để bắt đầu.' : 'Hãy là người tiên phong thành lập một cộng đồng học tập.'}
          action={(search || filter === 'mine') && <button type="button" className="btn btn-secondary" onClick={() => updateParams({ q: null, filter: null })}>Xem tất cả CLB</button>}
        />
      ) : (
        <div id="clans-list-grid" className="club-directory-grid">
          {filtered.map((clan) => (
            <ClubCard
              key={clan.id}
              club={clan}
              joinPending={join.isPending}
              cancelPending={cancelJoin.isPending}
              onJoin={(target) => { setJoinResult(null); setJoinTarget(target); }}
              onCancelJoin={(target) => cancelJoin.mutate(target.id)}
            />
          ))}
        </div>
      )}

      <ClanJoinQuizModal open={Boolean(joinTarget)} clanName={joinTarget?.name} quiz={joinQuizQuery.data} isLoading={joinQuizQuery.isLoading} isPending={join.isPending} result={joinResult} onClose={() => { if (!join.isPending) setJoinTarget(null); }} onViewClan={() => { if (joinTarget?.id) navigate(`/clans/${joinTarget.id}`); }} onSubmit={(answers) => join.mutate({ clanId: joinTarget.id, answers })} />

      {showCreateModal && (
        <ViewportModal id="modal-create-club" title="Thành lập CLB hoặc nhóm học tập" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="club-modal club-modal-anim">
          <div className="club-modal__header">
            <div><span className="club-eyebrow">CỘNG ĐỒNG MỚI</span><h2>Thành lập CLB</h2></div>
            <button ref={createCloseRef} type="button" className="club-icon-button" onClick={() => setShowCreateModal(false)} aria-label="Đóng hộp thoại">×</button>
          </div>
          <p className="club-modal__intro">Hãy đặt tên rõ ràng để sinh viên dễ tìm đúng cộng đồng học tập của bạn.</p>
          <form className="club-form" onSubmit={(event) => { event.preventDefault(); if (!draft.name.trim() || !draft.code.trim()) { notify('Vui lòng nhập tên và mã định danh của CLB.', 'warning'); return; } create.mutate(); }}>
            <label htmlFor="new-club-name">Tên CLB hoặc nhóm <span aria-hidden="true">*</span><input id="new-club-name" className="form-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: CLB Trí tuệ nhân tạo BDU" required /></label>
            <div className="club-form__two-columns">
              <label htmlFor="new-club-code">Mã định danh <span aria-hidden="true">*</span><input id="new-club-code" className="form-input" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="CLB_AI" required /></label>
              <label htmlFor="new-club-tag">Tag ngắn<input id="new-club-tag" className="form-input" value={draft.tag} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} placeholder="AI" /></label>
            </div>
            <label htmlFor="new-club-desc">Mục tiêu và hoạt động<textarea id="new-club-desc" className="form-input" rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Môn học trọng tâm, cách sinh hoạt hoặc tài liệu sẽ chia sẻ…" /></label>
            <div className="club-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Đang tạo…' : 'Tạo CLB'}</button>
            </div>
          </form>
        </ViewportModal>
      )}
    </section>
  );
}
