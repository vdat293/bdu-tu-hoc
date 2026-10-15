import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createTtcdsGroup, deleteTtcdsGroup, getTtcdsGroups } from '../../api/ttcds.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import EmptyState from '../clubs/components/EmptyState.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

export default function TtcdsPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draft, setDraft] = useState({ name: '', nien_khoa: '', description: '' });
  const createDialogRef = useRef(null);
  const createCloseRef = useRef(null);
  const createOpenerRef = useRef(null);
  useViewportDialog(showCreateModal, () => setShowCreateModal(false), createDialogRef, createCloseRef, createOpenerRef);

  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);
  const canCreate = canAccess && caps.data?.level === 'create';

  const groups = useQuery({
    queryKey: ['ttcds-groups'],
    queryFn: ({ signal }) => getTtcdsGroups(auth.token, { signal }),
    enabled: Boolean(auth.token && canAccess)
  });

  const refreshGroups = () => client.invalidateQueries({ queryKey: ['ttcds-groups'] });

  const create = useMutation({
    mutationFn: () => createTtcdsGroup(auth.token, draft),
    onSuccess: () => {
      setDraft({ name: '', nien_khoa: '', description: '' });
      setShowCreateModal(false);
      refreshGroups();
      notify('Đã tạo nhóm mới.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const remove = useMutation({
    mutationFn: (groupId) => deleteTtcdsGroup(auth.token, groupId),
    onSuccess: () => {
      refreshGroups();
      notify('Đã xóa nhóm.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const openCreate = (event) => {
    if (!canCreate) return;
    createOpenerRef.current = event.currentTarget;
    setShowCreateModal(true);
  };

  if (caps.isLoading) {
    return (
      <section className="club-directory-grid" aria-label="Đang tải Trung tâm CĐS">
        {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }

  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  if (caps.isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải Trung tâm Chuyển đổi số</h2>
        <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => caps.refetch()}>Thử lại</button>
      </div>
    );
  }

  const list = Array.isArray(groups.data) ? groups.data : [];

  return (
    <section id="tab-ttcds" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <h1>Trung tâm Chuyển đổi số</h1>
          <p>Nhóm sinh viên quan tâm theo khóa — mỗi nhóm do chính bạn tạo và quản lý.</p>
        </div>
        {canCreate && (
          <div className="club-directory-hero__action">
            <button type="button" className="btn btn-primary club-primary-action" onClick={openCreate}>
              Tạo nhóm mới
            </button>
          </div>
        )}
      </header>

      {groups.isLoading ? (
        <div className="club-directory-grid" aria-label="Đang tải danh sách nhóm">
          {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
        </div>
      ) : groups.isError ? (
        <div className="club-empty" role="alert">
          <h2>Chưa thể tải danh sách nhóm</h2>
          <p>{groups.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
          <button type="button" className="btn btn-secondary" onClick={() => groups.refetch()}>Thử lại</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title="Chưa có nhóm nào"
          hint={canCreate ? 'Tạo nhóm đầu tiên cho khóa sinh viên của bạn.' : 'Nhờ quản trị viên tạo nhóm và giao sinh viên cho bạn.'}
        />
      ) : (
        <div className="club-directory-grid">
          {list.map((group) => (
            <article className="club-card" key={group.id}>
              <h2><Link to={`/ttcds/groups/${group.id}`}>{group.name}</Link></h2>
              <p>{group.nien_khoa || '—'} · {group.member_count ?? 0} sinh viên</p>
              {group.description && <p className="club-permission-note">{group.description}</p>}
              <div className="club-modal__footer">
                <Link className="btn btn-secondary" to={`/ttcds/groups/${group.id}`}>Mở nhóm</Link>
                {canCreate && (
                  <button type="button" className="btn btn-secondary" disabled={remove.isPending} onClick={() => remove.mutate(group.id)}>
                    Xóa
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreateModal && canCreate && (
        <ViewportModal id="modal-create-ttcds-group" title="Tạo nhóm sinh viên" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="club-modal club-modal-anim">
          <div className="club-modal__header">
            <div><span className="club-eyebrow">NHÓM MỚI</span><h2>Tạo nhóm sinh viên</h2></div>
            <button ref={createCloseRef} type="button" className="club-icon-button" onClick={() => setShowCreateModal(false)} aria-label="Đóng hộp thoại">×</button>
          </div>
          <form className="club-form" onSubmit={(event) => { event.preventDefault(); if (!draft.name.trim()) { notify('Vui lòng nhập tên nhóm.', 'warning'); return; } create.mutate(); }}>
            <label htmlFor="new-ttcds-group-name">Tên nhóm <span aria-hidden="true">*</span><input id="new-ttcds-group-name" className="form-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: K29 Tân sinh viên" required /></label>
            <label htmlFor="new-ttcds-group-nien-khoa">Niên khóa<input id="new-ttcds-group-nien-khoa" className="form-input" value={draft.nien_khoa} onChange={(event) => setDraft({ ...draft, nien_khoa: event.target.value })} placeholder="Ví dụ: K29" /></label>
            <label htmlFor="new-ttcds-group-desc">Mô tả<textarea id="new-ttcds-group-desc" className="form-input" rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ghi chú về nhóm sinh viên này…" /></label>
            <div className="club-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Đang tạo…' : 'Tạo nhóm'}</button>
            </div>
          </form>
        </ViewportModal>
      )}
    </section>
  );
}
