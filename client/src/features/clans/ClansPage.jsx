import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { cancelClanJoinRequest, createClan, getClanQuiz, getClans, joinClan } from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import ClanJoinQuizModal from './ClanJoinQuizModal.jsx';
import './clans.css';

function cleanTag(tag) {
  return String(tag || '').trim().replace(/^\[+|\]+$/g, '') || 'CLB';
}

function initials(name) {
  const words = String(name || 'CLB').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}`.toUpperCase() : words[0].slice(0, 2).toUpperCase();
}

function clanLevel(clan) {
  const level = Number(clan?.level);
  return Number.isFinite(level) && level > 0 ? level : 1;
}

function memberCount(clan) {
  const count = Number(clan?.member_count);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function ClanAvatar({ clan, size = 'card' }) {
  return (
    <span className={`clan-avatar clan-avatar--${size}`} aria-hidden="true">
      {clan.avatar_url ? <img src={clan.avatar_url} alt="" /> : initials(clan.name)}
    </span>
  );
}

export default function ClansPage() {
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

  const query = useQuery({
    queryKey: ['clans', auth.user?.mssv],
    queryFn: ({ signal }) => getClans(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });

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
    <section id="tab-clans" className="tab-pane clan-experience">
      <header className="clan-directory-hero">
        <div className="clan-directory-hero__copy">
          <h1>CLB & Nhóm học tập</h1>
          <p>Khám phá, tham gia hoặc quản lý cộng đồng học tập của bạn.</p>
        </div>
        <div className="clan-directory-hero__action">
          <button type="button" className="btn btn-primary clan-primary-action" onClick={openCreate} disabled={query.isSuccess && !canCreateClan} aria-describedby="clan-create-permission">
            Thành lập CLB
          </button>
          {query.isSuccess && !canCreateClan && <p id="clan-create-permission" className="clan-permission-note">Cần danh hiệu #TTCDS hoặc quyền quản trị để thành lập CLB.</p>}
        </div>
      </header>

      <div className="clan-directory-toolbar" aria-label="Lọc danh sách CLB">
        <div className="clan-segmented" role="group" aria-label="Phạm vi CLB">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => updateParams({ filter: null })}>Khám phá tất cả</button>
          <button type="button" className={filter === 'mine' ? 'is-active' : ''} aria-pressed={filter === 'mine'} onClick={() => updateParams({ filter: 'mine' })}>CLB của tôi</button>
        </div>
        <div className="clan-search-field">
          <label className="clan-visually-hidden" htmlFor="clan-search-input">Tìm CLB hoặc nhóm học tập</label>
          <div className="clan-search-field__control">
            <input id="clan-search-input" type="search" value={search} onChange={(event) => updateParams({ q: event.target.value }, true)} placeholder="Tên, mã hoặc tag CLB" />
            {search && <button type="button" className="clan-icon-button" onClick={() => updateParams({ q: null }, true)} aria-label="Xóa từ khóa tìm kiếm">×</button>}
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <div className="clan-directory-grid" aria-label="Đang tải danh sách CLB">
          {[1, 2, 3].map((item) => <div className="clan-card clan-card--skeleton" key={item}><SkeletonBlock className="skeleton-avatar" /><SkeletonBlock className="skeleton-line heading" /><SkeletonBlock className="skeleton-line wide" /><SkeletonBlock className="skeleton-line short" /></div>)}
        </div>
      ) : query.isError ? (
        <div className="clan-state-card" role="alert"><h2>Chưa thể tải danh sách CLB</h2><p>{query.error?.message || 'Vui lòng thử lại sau ít phút.'}</p><button type="button" className="btn btn-secondary" onClick={() => query.refetch()}>Thử lại</button></div>
      ) : filtered.length === 0 ? (
        <div className="clan-state-card"><h2>{search ? 'Không tìm thấy CLB phù hợp' : filter === 'mine' ? 'Bạn chưa tham gia CLB nào' : 'Chưa có CLB nào'}</h2><p>{search ? 'Thử lại với tên đầy đủ, mã CLB hoặc tag khác.' : filter === 'mine' ? 'Khám phá các nhóm đang hoạt động để bắt đầu.' : 'Hãy là người tiên phong thành lập một cộng đồng học tập.'}</p>{(search || filter === 'mine') && <button type="button" className="btn btn-secondary" onClick={() => updateParams({ q: null, filter: null })}>Xem tất cả CLB</button>}</div>
      ) : (
        <div id="clans-list-grid" className="clan-directory-grid">
          {filtered.map((clan) => {
            const isPending = Boolean(clan.has_pending_request);
            const isJoined = Boolean(clan.is_joined);
            return (
              <article key={clan.id} className="clan-card">
                <div className="clan-card__topline"><ClanAvatar clan={clan} /><div className="clan-card__badges"><span className="clan-tag">[{cleanTag(clan.tag)}]</span><span className="clan-level">Cấp {clanLevel(clan)}{Number.isFinite(Number(clan.xp)) ? ` · ${Number(clan.xp)} XP` : ''}</span></div>{clan.my_role === 'leader' && <span className="clan-role-chip">Bang chủ</span>}</div>
                <div className="clan-card__copy"><h2>{clan.name}</h2><p>{clan.description || 'Không gian học tập, trao đổi kiến thức và tài liệu dành cho sinh viên BDU.'}</p></div>
                <footer className="clan-card__footer"><span className="clan-member-count">{memberCount(clan)} thành viên</span>{isJoined ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/clans/${clan.id}`)}>Mở CLB</button> : isPending ? <div className="clan-pending-actions"><span className="clan-status-chip">Đang chờ duyệt</span><button type="button" className="clan-text-action" onClick={() => cancelJoin.mutate(clan.id)} disabled={cancelJoin.isPending}>Hủy yêu cầu</button></div> : <button type="button" className="btn btn-primary btn-sm" onClick={() => { setJoinResult(null); setJoinTarget(clan); }} disabled={join.isPending}>Tham gia</button>}</footer>
                <Link className="clan-card__cover" to={`/clans/${clan.id}`} aria-label={`Xem CLB ${clan.name}`} />
              </article>
            );
          })}
        </div>
      )}

      <ClanJoinQuizModal open={Boolean(joinTarget)} clanName={joinTarget?.name} quiz={joinQuizQuery.data} isLoading={joinQuizQuery.isLoading} isPending={join.isPending} result={joinResult} onClose={() => { if (!join.isPending) setJoinTarget(null); }} onViewClan={() => { if (joinTarget?.id) navigate(`/clans/${joinTarget.id}`); }} onSubmit={(answers) => join.mutate({ clanId: joinTarget.id, answers })} />

      {showCreateModal && <ViewportModal id="modal-create-clan" title="Thành lập CLB hoặc nhóm học tập" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="clan-modal">
        <div className="clan-modal__header"><div><span className="clan-eyebrow">CỘNG ĐỒNG MỚI</span><h2>Thành lập CLB</h2></div><button ref={createCloseRef} type="button" className="clan-icon-button" onClick={() => setShowCreateModal(false)} aria-label="Đóng hộp thoại">×</button></div>
        <p className="clan-modal__intro">Hãy đặt tên rõ ràng để sinh viên dễ tìm đúng cộng đồng học tập của bạn.</p>
        <form className="clan-form" onSubmit={(event) => { event.preventDefault(); if (!draft.name.trim() || !draft.code.trim()) { notify('Vui lòng nhập tên và mã định danh của CLB.', 'warning'); return; } create.mutate(); }}>
          <label htmlFor="new-clan-name">Tên CLB hoặc nhóm <span aria-hidden="true">*</span><input id="new-clan-name" className="form-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: CLB Trí tuệ nhân tạo BDU" required /></label>
          <div className="clan-form__two-columns"><label htmlFor="new-clan-code">Mã định danh <span aria-hidden="true">*</span><input id="new-clan-code" className="form-input" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="CLB_AI" required /></label><label htmlFor="new-clan-tag">Tag ngắn<input id="new-clan-tag" className="form-input" value={draft.tag} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} placeholder="AI" /></label></div>
          <label htmlFor="new-clan-desc">Mục tiêu và hoạt động<textarea id="new-clan-desc" className="form-input" rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Môn học trọng tâm, cách sinh hoạt hoặc tài liệu sẽ chia sẻ…" /></label>
          <div className="clan-modal__footer"><button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Hủy</button><button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Đang tạo…' : 'Tạo CLB'}</button></div>
        </form>
      </ViewportModal>}
    </section>
  );
}
