import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createClan, getClanQuiz, getClans, joinClan } from '../../api/community.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import ClanJoinQuizModal from './ClanJoinQuizModal.jsx';

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

  const create = useMutation({
    mutationFn: () => createClan(auth.token, draft),
    onSuccess: (data) => {
      setDraft({ name: '', code: '', tag: '', description: '' });
      setShowCreateModal(false);
      client.invalidateQueries({ queryKey: ['clans'] });
      notify('Đã thành lập CLB mới.', 'success');
      if (data?.id) navigate(`/clans/${data.id}`);
    },
    onError: (error) => notify(error.message, 'error')
  });

  const join = useMutation({
    mutationFn: ({ clanId, answers }) => joinClan(auth.token, clanId, null, answers),
    onSuccess: (data) => {
      setJoinResult(data);
      client.invalidateQueries({ queryKey: ['clans'] });
      notify(data?.status === 'approved' ? 'Đã tự động duyệt bạn vào CLB.' : 'Đã gửi yêu cầu tham gia CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const rawList = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);

  const filtered = useMemo(() => {
    const needle = search.toLocaleLowerCase('vi-VN').trim();
    return rawList.filter((item) => {
      const matchText =
        !needle ||
        `${item.name} ${item.code || ''} ${item.tag || ''} ${item.description || ''}`
          .toLocaleLowerCase('vi-VN')
          .includes(needle);
      const matchFilter = filter === 'all' || Boolean(item.is_joined);
      return matchText && matchFilter;
    });
  }, [rawList, search, filter]);

  const setFilterMode = (mode) => {
    const next = new URLSearchParams(params);
    if (mode === 'mine') next.set('filter', 'mine');
    else next.delete('filter');
    setParams(next, { replace: false });
  };

  const setSearchValue = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  return (
    <section id="tab-clans" className="tab-pane active">
      {/* Header faithfully matching production */}
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="clan-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 className="section-title">CLB & Nhóm Học Tập BDU</h2>
            <p className="section-desc">
              Cơ chế Clan/Guild: Không gian sinh hoạt câu lạc bộ, chia sẻ tài liệu ôn thi, slide bài giảng và video Google Drive nội bộ.
            </p>
          </div>
          <button
            type="button"
            id="btn-open-create-clan"
            className="btn btn-primary btn-create-clan"
            onClick={(event) => { createOpenerRef.current = event.currentTarget; setShowCreateModal(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Tạo CLB / Nhóm Mới
          </button>
        </div>
      </div>

      <div id="clan-main-view">
        {/* Toolbar faithfully matching production */}
        <div className="clan-toolbar glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', margin: '20px 0' }}>
          <div className="clan-filter-tabs" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              id="filter-clans-all"
              className={`clan-tab-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              Tất Cả CLB / Nhóm
            </button>
            <button
              type="button"
              id="filter-clans-mine"
              className={`clan-tab-btn ${filter === 'mine' ? 'active' : ''}`}
              onClick={() => setFilterMode('mine')}
            >
              CLB Của Tôi
            </button>
          </div>
          <div className="clan-search-wrap" style={{ position: 'relative', minWidth: '280px' }}>
            <input
              type="text"
              id="clan-search-input"
              className="search-input form-input"
              placeholder="Tìm kiếm CLB theo tên hoặc mã [TAG]..."
              value={search}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
        </div>

        {/* Clans Grid */}
        <div id="clans-list-grid" className="clans-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
          {query.isLoading ? (
            [1, 2, 3].map((card) => (
              <div
                className="clan-card glass-panel skeleton-clan-card"
                key={card}
                aria-hidden="true"
                style={{
                  padding: '20px',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255, 255, 255, 0.03)'
                }}
              >
                <SkeletonBlock className="skeleton-line eyebrow" />
                <SkeletonBlock className="skeleton-line heading" />
                <SkeletonBlock className="skeleton-line wide" />
                <SkeletonBlock className="skeleton-line medium" />
                <SkeletonBlock className="skeleton-line short" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="glass-panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 24px', borderRadius: 'var(--radius-lg)' }}>
              <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>👥</span>
              <h4 style={{ margin: '0 0 6px 0' }}>{search ? 'Không tìm thấy CLB phù hợp' : 'Chưa có CLB nào'}</h4>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                {search ? 'Hãy thử tìm bằng từ khóa hoặc mã tag khác.' : 'Hãy là người tiên phong thành lập CLB học tập đầu tiên!'}
              </p>
            </div>
          ) : (
            filtered.map((clan) => (
              <div
                key={clan.id}
                className="clan-card glass-panel"
                style={{
                  padding: '20px',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255, 255, 255, 0.03)'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="clan-tag-badge" style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--bdu-light)' }}>
                      [{clan.tag || 'TAG'}]
                    </span>
                    <span className="clan-level-badge" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Cấp 1
                    </span>
                    {clan.my_role === 'leader' && (
                      <span style={{ fontSize: '11px', color: '#fbbf24', marginLeft: 'auto', fontWeight: 700 }}>
                        👑 Bang Chủ
                      </span>
                    )}
                  </div>

                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.15rem', color: 'var(--text-main)' }}>
                    {clan.name}
                  </h3>
                  <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    {clan.description || 'Không gian học tập, trao đổi tài liệu môn học chuyên sâu.'}
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    👥 {clan.member_count || 1} Thành viên
                  </span>

                  {clan.is_joined ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/clans/${clan.id}`)}
                    >
                      Vào phòng CLB →
                    </button>
                  ) : clan.has_pending_request ? (
                    <span className="badge-pending" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                      Đang chờ duyệt
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => { setJoinResult(null); setJoinTarget(clan); }}
                      disabled={join.isPending}
                    >
                      Xin tham gia
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ClanJoinQuizModal
        open={Boolean(joinTarget)}
        clanName={joinTarget?.name}
        quiz={joinQuizQuery.data}
        isLoading={joinQuizQuery.isLoading}
        isPending={join.isPending}
        result={joinResult}
        onClose={() => { if (!join.isPending) setJoinTarget(null); }}
        onSubmit={(answers) => join.mutate({ clanId: joinTarget.id, answers })}
      />

      {/* Modal: Create Clan faithful to #modal-create-clan */}
      {showCreateModal && (
        <ViewportModal id="modal-create-clan" title="Thành Lập CLB / Nhóm Học Tập Mới" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="clan-create-dialog">
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div className="modal-title-group">
                <h3 className="modal-title" style={{ margin: 0, fontSize: '1.2rem' }}>Thành Lập CLB / Nhóm Học Tập Mới</h3>
                <span className="modal-badge" style={{ fontSize: '11px', color: 'var(--bdu-light)' }}>GUILD</span>
              </div>
              <button
                ref={createCloseRef}
                type="button"
                id="btn-close-create-clan"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.name.trim()) {
                  notify('Vui lòng nhập tên CLB.', 'warning');
                  return;
                }
                create.mutate();
              }}
            >
              <div className="modal-body">
                <div
                  className="clan-vip-creation-notice"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    background: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: '8px',
                    marginBottom: '16px'
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#c084fc', fontSize: '13px', background: 'rgba(168, 85, 247, 0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                    #TTCDS
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Quyền thành lập CLB mới hiện tại dành cho các thành viên sở hữu danh hiệu <strong>#TTCDS</strong> hoặc có thẩm quyền.
                  </span>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '13px' }}>
                    Tên CLB / Nhóm Học Tập *
                  </label>
                  <input
                    type="text"
                    id="new-clan-name"
                    className="form-input"
                    placeholder="Ví dụ: CLB Trí Tuệ Nhân Tạo BDU"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '13px' }}>
                      Mã Định Danh (Code) *
                    </label>
                    <input
                      type="text"
                      id="new-clan-code"
                      className="form-input"
                      placeholder="Ví dụ: CLB_AI"
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                      required
                    />
                  </div>
                  <div style={{ width: '140px' }}>
                    <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '13px' }}>
                      Tag Viết Tắt
                    </label>
                    <input
                      type="text"
                      id="new-clan-tag"
                      className="form-input"
                      placeholder="[AI]"
                      value={draft.tag}
                      onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '13px' }}>
                    Mô Tả Mục Tiêu / Hoạt Động Của CLB
                  </label>
                  <textarea
                    id="new-clan-desc"
                    className="form-input"
                    rows={3}
                    placeholder="Chia sẻ mục đích học tập, môn học trọng tâm hoặc tài liệu chuyên ngành..."
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  id="btn-cancel-create-clan"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  id="btn-confirm-create-clan"
                  className="btn btn-primary"
                  disabled={create.isPending}
                >
                  {create.isPending ? 'Đang tạo...' : 'Tạo CLB Ngay'}
                </button>
              </div>
            </form>
        </ViewportModal>
      )}
    </section>
  );
}
