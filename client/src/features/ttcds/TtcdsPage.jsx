import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createTtcdsGroup, deleteTtcdsGroup, getTtcdsGroups } from '../../api/ttcds.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
import EmptyState from '../clubs/components/EmptyState.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import '../clubs/clubs.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

export default function TtcdsPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draft, setDraft] = useState(() => ({ name: '', mentor: auth.user?.name ?? '' }));
  const [nameInvalid, setNameInvalid] = useState(false);
  const [confirmUI, askConfirm] = useConfirm();
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
    onSuccess: (group) => {
      setDraft({ name: '', mentor: auth.user?.name ?? '' });
      setNameInvalid(false);
      setShowCreateModal(false);
      refreshGroups();
      notify('Đã tạo nhóm mới.', 'success');
      // Tạo xong vào thẳng nhóm vừa tạo để thêm SV ngay; `justCreated` cho
      // TtcdsGroupPage biết cần mở popup thêm sinh viên.
      if (group?.id != null) navigate(`/ttcds/groups/${group.id}`, { state: { justCreated: true } });
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
    setNameInvalid(false);
    setShowCreateModal(true);
  };

  // Xoá nhóm là thao tác phá huỷ và không thể hoàn tác → luôn hỏi tên nhóm trước
  // khi gọi DELETE (nhất quán với luồng admin và các trang khác của cổng).
  const confirmRemove = async (group) => {
    const ok = await askConfirm({
      title: 'Xóa nhóm sinh viên?',
      message: `Nhóm "${group.name}" cùng danh sách sinh viên đã gán sẽ bị xóa. Thao tác này không thể hoàn tác.`,
      confirmText: 'Xóa nhóm',
      danger: true
    });
    if (ok) remove.mutate(group.id);
  };

  if (caps.isLoading) {
    return (
      <section className="club-directory-grid" aria-label="Đang tải Sinh viên của tôi">
        {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }

  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  if (caps.isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải Sinh viên của tôi</h2>
        <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => caps.refetch()}>Thử lại</button>
      </div>
    );
  }

  const list = Array.isArray(groups.data) ? groups.data : [];
  const totalMembers = list.reduce((sum, group) => sum + (group.member_count ?? 0), 0);

  return (
    <section id="tab-ttcds" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <h1>Sinh viên của tôi</h1>
          <p>Nhóm tân sinh viên được phân công cho bạn.</p>
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
          action={canCreate ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              Tạo nhóm đầu tiên
            </button>
          ) : undefined}
        />
      ) : (
        <>
          <div className="ttcds-stats" aria-label="Tổng quan nhóm">
            <div className="ttcds-stat" data-testid="ttcds-stat">
              <span className="ttcds-stat__label">Số nhóm</span>
              <span className="ttcds-stat__value">{list.length}</span>
              <span className="ttcds-stat__meta">Nhóm được phân công cho bạn</span>
            </div>
            <div className="ttcds-stat" data-testid="ttcds-stat">
              <span className="ttcds-stat__label">Tổng sinh viên</span>
              <span className="ttcds-stat__value">{totalMembers}</span>
              <span className="ttcds-stat__meta">Sinh viên đang theo dõi</span>
            </div>
          </div>
          <div className="card glass-panel ttcds-panel" style={{ padding: '16px' }}>
            <div className="ttcds-panel-head">
              <h2>Danh sách nhóm</h2>
              <p className="ttcds-panel-sub">{list.length} nhóm · {totalMembers} sinh viên đang theo dõi</p>
            </div>
            <div className="table-scroll">
            <table className="ttcds-groups-table">
              <thead>
                <tr>
                  <th scope="col">Tên nhóm</th>
                  <th scope="col">Mentor</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Số SV</th>
                  {canCreate && <th scope="col">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((group) => (
                  <tr key={group.id}>
                    <td><Link to={`/ttcds/groups/${group.id}`}>{group.name}</Link></td>
                    <td>{group.mentor || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{group.member_count ?? 0}</td>
                    {canCreate && (
                      <td>
                        <button type="button" className="btn btn-secondary" aria-label={`Xóa nhóm ${group.name}`} disabled={remove.isPending} onClick={() => confirmRemove(group)}>
                          Xóa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {showCreateModal && canCreate && (
        <ViewportModal id="modal-create-ttcds-group" title="Tạo nhóm sinh viên" onClose={() => setShowCreateModal(false)} dialogRef={createDialogRef} className="club-modal club-modal-anim">
          <div className="club-modal__header">
            <div><span className="club-eyebrow">NHÓM MỚI</span><h2>Tạo nhóm sinh viên</h2></div>
            <button ref={createCloseRef} type="button" className="club-icon-button" onClick={() => setShowCreateModal(false)} aria-label="Đóng hộp thoại">×</button>
          </div>
          <form className="club-form" onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim()) {
              setNameInvalid(true);
              notify('Vui lòng nhập tên nhóm.', 'warning');
              return;
            }
            create.mutate();
          }}>
            <label htmlFor="new-ttcds-group-name">
              <span>Tên nhóm <span aria-hidden="true">*</span></span>
              <input
                id="new-ttcds-group-name"
                className="form-input"
                value={draft.name}
                aria-required="true"
                aria-invalid={nameInvalid || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  if (nameInvalid && event.target.value.trim()) setNameInvalid(false);
                }}
                placeholder="Ví dụ: K29 Tân sinh viên"
              />
            </label>
            <label htmlFor="new-ttcds-group-mentor">
              <span>Mentor</span>
              <input
                id="new-ttcds-group-mentor"
                className="form-input"
                value={draft.mentor}
                maxLength={120}
                onChange={(event) => setDraft({ ...draft, mentor: event.target.value })}
                placeholder="Người phụ trách nhóm"
              />
            </label>
            <div className="club-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Đang tạo…' : 'Tạo nhóm'}</button>
            </div>
          </form>
        </ViewportModal>
      )}

      {confirmUI}
    </section>
  );
}
