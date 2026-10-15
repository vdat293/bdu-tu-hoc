import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { addTtcdsGroupMember, getTtcdsGroupMembers, getTtcdsGroups, getTtcdsStudent, parseMssvList, removeTtcdsGroupMember } from '../../api/ttcds.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import EmptyState from '../clubs/components/EmptyState.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import '../clubs/clubs.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

/** Tóm tắt 1 dòng cho mỗi thành viên từ detail Dashboard đã cache. Thiếu → '—'. */
export function summarizeTtcdsStudent(detail) {
  const gpaTerms = Array.isArray(detail?.gpa_hoc_ky) ? detail.gpa_hoc_ky : [];
  const attendanceTerms = Array.isArray(detail?.diem_danh) ? detail.diem_danh : [];
  const renLuyen = Array.isArray(detail?.ren_luyen) ? detail.ren_luyen : [];
  const events = Array.isArray(detail?.su_kien) ? detail.su_kien : [];

  const lastGpa = gpaTerms[gpaTerms.length - 1];
  const lastAttendance = attendanceTerms[attendanceTerms.length - 1];
  const lastRenLuyen = renLuyen[renLuyen.length - 1];
  const latestNkhk = lastAttendance?.nkhk ?? lastGpa?.nkhk ?? null;

  let attendancePct = null;
  if (lastAttendance) {
    const present = Number(lastAttendance.di_hoc) || 0;
    const absent = Number(lastAttendance.vang) || 0;
    const total = present + absent;
    if (total > 0) attendancePct = (100 * present) / total;
  }

  return {
    name: detail?.ho_so?.ten_day_du || '—',
    className: detail?.ho_so?.ma_lop || '—',
    gpa: lastGpa?.dtb_tich_luy_he_4 != null ? Number(lastGpa.dtb_tich_luy_he_4).toFixed(2) : '—',
    attendance: attendancePct != null ? `${attendancePct.toFixed(1)}%` : '—',
    renLuyen: lastRenLuyen?.diem_ren_luyen != null ? String(lastRenLuyen.diem_ren_luyen) : '—',
    renLuyenRank: lastRenLuyen?.xep_loai || '—',
    eventCount: latestNkhk != null ? events.filter((event) => event?.nkhk === latestNkhk).length : 0
  };
}

export default function TtcdsGroupPage() {
  const { id } = useParams();
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();
  const [paste, setPaste] = useState('');
  const [addErrors, setAddErrors] = useState([]);
  const pasteRef = useRef(null);
  const focusPaste = () => pasteRef.current?.focus();

  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);
  const canCreate = canAccess && caps.data?.level === 'create';

  const groupsQuery = useQuery({
    queryKey: ['ttcds-groups'],
    queryFn: ({ signal }) => getTtcdsGroups(auth.token, { signal }),
    enabled: Boolean(auth.token && canAccess)
  });

  const membersQuery = useQuery({
    queryKey: ['ttcds-group-members', id],
    queryFn: ({ signal }) => getTtcdsGroupMembers(auth.token, id, { signal }),
    enabled: Boolean(auth.token && canAccess && id)
  });

  const members = useMemo(() => (Array.isArray(membersQuery.data) ? membersQuery.data : []), [membersQuery.data]);
  const group = useMemo(() => (Array.isArray(groupsQuery.data) ? groupsQuery.data.find((entry) => String(entry.id) === String(id)) : null), [groupsQuery.data, id]);

  const details = useQueries({
    queries: members.map((member) => ({
      queryKey: ['ttcds-student', member.mssv],
      queryFn: ({ signal }) => getTtcdsStudent(auth.token, member.mssv, { signal }),
      enabled: Boolean(auth.token && member.mssv),
      retry: false,
      staleTime: 5 * 60 * 1000
    }))
  });

  const summaries = useMemo(() => {
    const map = {};
    members.forEach((member, index) => {
      const data = details[index]?.data;
      map[member.mssv] = details[index]?.isSuccess && data ? summarizeTtcdsStudent(data) : null;
    });
    return map;
  }, [details, members]);

  const refreshMembers = () => {
    client.invalidateQueries({ queryKey: ['ttcds-group-members', id] });
    client.invalidateQueries({ queryKey: ['ttcds-groups'] });
  };

  const reloadDetails = () => {
    members.forEach((member) => client.invalidateQueries({ queryKey: ['ttcds-student', member.mssv] }));
    notify('Đang tải lại thông tin sinh viên.', 'info');
  };

  const add = useMutation({
    mutationFn: async (mssvList) => {
      const errors = [];
      for (const mssv of mssvList) {
        try {
          await addTtcdsGroupMember(auth.token, id, { mssv });
        } catch (error) {
          errors.push({ mssv, message: error.message });
        }
      }
      return errors;
    },
    onSuccess: (errors) => {
      setAddErrors(errors);
      if (errors.length === 0) {
        setPaste('');
        notify('Đã thêm sinh viên vào nhóm.', 'success');
      } else {
        notify(`Thêm xong với ${errors.length} lỗi.`, 'warning');
      }
      refreshMembers();
    },
    onError: (error) => notify(error.message, 'error')
  });

  const remove = useMutation({
    mutationFn: (mssv) => removeTtcdsGroupMember(auth.token, id, mssv),
    onSuccess: () => {
      refreshMembers();
      notify('Đã xóa thành viên khỏi nhóm.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  // Xoá thành viên là thao tác phá huỷ → hỏi đúng tên/MSSV trước khi gọi DELETE.
  const confirmRemoveMember = async (member) => {
    const label = summaries[member.mssv]?.name || member.mssv;
    const ok = await askConfirm({
      title: 'Xóa sinh viên khỏi nhóm?',
      message: `Sinh viên "${label}" (${member.mssv}) sẽ bị xóa khỏi nhóm này. Thao tác không thể hoàn tác.`,
      confirmText: 'Xóa sinh viên',
      danger: true
    });
    if (ok) remove.mutate(member.mssv);
  };

  if (caps.isLoading) {
    return (
      <section className="club-directory-grid" aria-label="Đang tải nhóm">
        {[1, 2].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }
  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  const submitPaste = (event) => {
    event.preventDefault();
    const mssvList = parseMssvList(paste);
    if (mssvList.length === 0) {
      notify('Dán ít nhất một MSSV để thêm.', 'warning');
      return;
    }
    add.mutate(mssvList);
  };

  return (
    <section id="tab-ttcds-group" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <p><Link to="/mystudent">← Sinh viên của tôi</Link></p>
          <h1>{group?.name || 'Nhóm sinh viên'}</h1>
          <p>{group?.nien_khoa || '—'} · {members.length} sinh viên</p>
        </div>
        <div className="club-directory-hero__action">
          <button type="button" className="btn btn-secondary" onClick={reloadDetails}>Tải lại</button>
        </div>
      </header>

      {canCreate && (
        <form className="card glass-panel" style={{ padding: '16px', marginBottom: '16px' }} onSubmit={submitPaste}>
          <label htmlFor="ttcds-add-mssv">Thêm MSSV (dán danh sách, cách nhau bởi phẩy / khoảng trắng / chấm phẩy)
            <textarea id="ttcds-add-mssv" ref={pasteRef} className="form-input" rows={3} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="24050126, 24050006; 22050006" />
          </label>
          {addErrors.length > 0 && (
            <ul role="alert" style={{ color: 'var(--color-rose)' }}>
              {addErrors.map((entry) => <li key={entry.mssv}>{entry.mssv}: {entry.message}</li>)}
            </ul>
          )}
          <div className="club-modal__footer">
            <button type="submit" className="btn btn-primary" disabled={add.isPending}>{add.isPending ? 'Đang thêm…' : 'Thêm vào nhóm'}</button>
          </div>
        </form>
      )}

      {membersQuery.isLoading ? (
        <div className="club-directory-grid" aria-label="Đang tải thành viên">
          {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
        </div>
      ) : membersQuery.isError ? (
        <div className="club-empty" role="alert">
          <h2>Chưa thể tải danh sách thành viên</h2>
          <p>{membersQuery.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
          <button type="button" className="btn btn-secondary" onClick={() => membersQuery.refetch()}>Thử lại</button>
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          title="Nhóm chưa có sinh viên"
          hint={canCreate ? 'Dán danh sách MSSV ở ô phía trên để thêm.' : 'Nhờ quản trị viên giao sinh viên vào nhóm này.'}
          action={canCreate ? (
            <button type="button" className="btn btn-primary" onClick={focusPaste}>
              Thêm sinh viên đầu tiên
            </button>
          ) : undefined}
        />
      ) : (
        <div className="club-directory-grid">
          {members.map((member, index) => {
            const summary = summaries[member.mssv];
            const loading = details[index]?.isLoading;
            return (
              <article className="club-card" key={member.mssv}>
                <h2><Link to={`/ttcds/students/${member.mssv}`}>{summary ? summary.name : member.mssv}</Link></h2>
                <p>{member.mssv} · {summary ? summary.className : '—'}</p>
                {loading ? (
                  <p>Đang tải tóm tắt…</p>
                ) : summary ? (
                  <ul>
                    <li>GPA tích lũy: {summary.gpa}</li>
                    <li>Chuyên cần kỳ này: {summary.attendance}</li>
                    <li>Rèn luyện: {summary.renLuyen} · {summary.renLuyenRank}</li>
                    <li>Sự kiện kỳ này: {summary.eventCount}</li>
                  </ul>
                ) : (
                  <p>Chưa tải được tóm tắt —</p>
                )}
                <div className="club-modal__footer">
                  <Link className="btn btn-secondary" aria-label={`Chi tiết sinh viên ${summary ? summary.name : member.mssv}`} to={`/ttcds/students/${member.mssv}`}>Chi tiết</Link>
                  {canCreate && (
                    <button type="button" className="btn btn-secondary" aria-label={`Xóa sinh viên ${summary ? summary.name : member.mssv}`} disabled={remove.isPending} onClick={() => confirmRemoveMember(member)}>
                      Xóa
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {confirmUI}
    </section>
  );
}
