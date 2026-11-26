import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cancelClanJoinRequest, createClan, getClanQuiz, joinClan } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';
import ClanJoinQuizModal from '../components/ClanJoinQuizModal.jsx';
import ClubCard from '../components/ClubCard.jsx';
import { ClubCardSkeleton, ClubEmptyState, ClubIcon } from '../components/ClubPrimitives.jsx';
import { useClubs } from '../hooks/useClubs.js';
import '../styles/clubs.css';

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
      const haystack = `${clan.name || ''} ${clan.code || ''} ${clan.tag || ''} ${clan.description || ''}`.toLocaleLowerCase('vi-VN');
      return (!needle || haystack.includes(needle)) && (filter === 'all' || Boolean(clan.is_joined));
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
    <section id="tab-clans" className="clb-root">
      <header className="clb-header">
        <div className="clb-header__copy">
          <h1>CLB &amp; Nhóm học tập</h1>
          <p>Khám phá, tham gia và sinh hoạt cùng các cộng đồng học tập tại BDU.</p>
        </div>
        <div className="clb-header__actions">
          <button
            type="button"
            className="clb-btn clb-btn--primary"
            onClick={openCreate}
            disabled={query.isSuccess && !canCreateClan}
            aria-describedby="club-create-permission"
          >
            Thành lập CLB
          </button>
          {query.isSuccess && !canCreateClan && (
            <p id="club-create-permission" className="clb-permission-note">
              Cần danh hiệu #TTCDS hoặc quyền quản trị để thành lập CLB.
            </p>
          )}
        </div>
      </header>

      <div className="clb-toolbar" aria-label="Lọc danh sách CLB">
        <div className="clb-segmented" role="group" aria-label="Phạm vi CLB">
          <button
            type="button"
            className={filter === 'all' ? 'is-active' : ''}
            aria-pressed={filter === 'all'}
            onClick={() => updateParams({ filter: null })}
          >
            Khám phá tất cả
          </button>
          <button
            type="button"
            className={filter === 'mine' ? 'is-active' : ''}
            aria-pressed={filter === 'mine'}
            onClick={() => updateParams({ filter: 'mine' })}
          >
            CLB của tôi
          </button>
        </div>

        <div className="clb-search">
          <label className="clb-sr-only" htmlFor="club-search-input">Tìm CLB hoặc nhóm học tập</label>
          <span className="clb-search__icon"><ClubIcon name="search" size={16} /></span>
          <input
            id="club-search-input"
            type="search"
            className="clb-search__input"
            value={search}
            onChange={(event) => updateParams({ q: event.target.value }, true)}
            placeholder="Tìm theo tên, mã hoặc tag CLB…"
          />
          {search && (
            <button
              type="button"
              className="clb-icon-btn clb-search__clear"
              onClick={() => updateParams({ q: null }, true)}
              aria-label="Xóa từ khóa tìm kiếm"
            >
              <ClubIcon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="clb-grid" aria-label="Đang tải danh sách CLB">
          {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
        </div>
      ) : query.isError ? (
        <div className="clb-empty" role="alert">
          <h2>Chưa thể tải danh sách CLB</h2>
          <p>{query.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
          <button type="button" className="clb-btn clb-btn--secondary" onClick={() => query.refetch()}>
            Thử lại
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <ClubEmptyState
          title={search ? 'Không tìm thấy CLB phù hợp' : filter === 'mine' ? 'Bạn chưa tham gia CLB nào' : 'Chưa có CLB nào'}
          hint={search ? 'Thử lại với tên đầy đủ, mã CLB hoặc tag khác.' : filter === 'mine' ? 'Khám phá các nhóm đang hoạt động để bắt đầu.' : 'Hãy là người tiên phong thành lập một cộng đồng học tập.'}
          action={(search || filter === 'mine') && (
            <button
              type="button"
              className="clb-btn clb-btn--secondary"
              onClick={() => updateParams({ q: null, filter: null })}
            >
              Xem tất cả CLB
            </button>
          )}
        />
      ) : (
        <div id="clans-list-grid" className="clb-grid">
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

      <ClanJoinQuizModal
        open={Boolean(joinTarget)}
        clanName={joinTarget?.name}
        quiz={joinQuizQuery.data}
        isLoading={joinQuizQuery.isLoading}
        isPending={join.isPending}
        result={joinResult}
        onClose={() => { if (!join.isPending) setJoinTarget(null); }}
        onViewClan={() => { if (joinTarget?.id) navigate(`/clans/${joinTarget.id}`); }}
        onSubmit={(answers) => join.mutate({ clanId: joinTarget.id, answers })}
      />

      {showCreateModal && (
        <ViewportModal
          id="modal-create-club"
          title="Thành lập CLB hoặc nhóm học tập"
          onClose={() => setShowCreateModal(false)}
          dialogRef={createDialogRef}
          className="clb-modal"
        >
          <div className="clb-modal__head">
            <div>
              <span className="clb-eyebrow">CỘNG ĐỒNG MỚI</span>
              <h2>Thành lập CLB</h2>
            </div>
            <button
              ref={createCloseRef}
              type="button"
              className="clb-icon-btn"
              onClick={() => setShowCreateModal(false)}
              aria-label="Đóng hộp thoại"
            >
              <ClubIcon name="close" size={18} />
            </button>
          </div>
          <p className="clb-modal__intro">
            Đặt tên rõ ràng để sinh viên dễ tìm đúng cộng đồng học tập của bạn.
          </p>
          <form
            className="clb-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.name.trim() || !draft.code.trim()) {
                notify('Vui lòng nhập tên và mã định danh của CLB.', 'warning');
                return;
              }
              create.mutate();
            }}
          >
            <label className="clb-field" htmlFor="new-club-name">
              <span>Tên CLB hoặc nhóm *</span>
              <input
                id="new-club-name"
                className="clb-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Ví dụ: CLB Trí tuệ nhân tạo BDU"
                required
              />
            </label>
            <div className="clb-form-row">
              <label className="clb-field" htmlFor="new-club-code">
                <span>Mã định danh *</span>
                <input
                  id="new-club-code"
                  className="clb-input"
                  value={draft.code}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                  placeholder="CLB_AI"
                  required
                />
              </label>
              <label className="clb-field" htmlFor="new-club-tag">
                <span>Tag ngắn</span>
                <input
                  id="new-club-tag"
                  className="clb-input"
                  value={draft.tag}
                  onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
                  placeholder="AI"
                />
              </label>
            </div>
            <label className="clb-field" htmlFor="new-club-desc">
              <span>Mục tiêu và hoạt động</span>
              <textarea
                id="new-club-desc"
                className="clb-textarea"
                rows={4}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Môn học trọng tâm, cách sinh hoạt hoặc tài liệu sẽ chia sẻ…"
              />
            </label>
            <div className="clb-modal__foot">
              <button type="button" className="clb-btn clb-btn--secondary" onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button type="submit" className="clb-btn clb-btn--primary" disabled={create.isPending}>
                {create.isPending ? 'Đang tạo…' : 'Tạo CLB'}
              </button>
            </div>
          </form>
        </ViewportModal>
      )}
    </section>
  );
}
