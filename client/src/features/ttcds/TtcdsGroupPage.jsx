import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { addTtcdsGroupMember, getTtcdsGroupMembers, getTtcdsGroups, getTtcdsStudent, removeTtcdsGroupMember, searchTtcdsStudents } from '../../api/ttcds.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';
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

const SEARCH_MIN_LENGTH = 2;
const MSSV_MIN_DIGITS = 4;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Ngưỡng ký tự tối thiểu trước khi gọi search:
 * - gõ toàn số (đang tra MSSV) → cần ≥4 số, tránh nã API bằng 2-3 số vô nghĩa;
 * - còn lại (tra theo tên) → ≥2 ký tự.
 */
export function searchMinLength(query) {
  const value = String(query ?? '').trim();
  if (/^\d+$/.test(value)) return MSSV_MIN_DIGITS;
  return SEARCH_MIN_LENGTH;
}

/**
 * Chuẩn hoá payload search sinh viên của Dashboard về dòng gợi ý
 * `{ mssv, name, className }`. Backend passthrough `{ ket_qua }` nhưng vẫn
 * nhận thêm mảng trần / `{ data | items | results }` để không vỡ khi đổi shape.
 * Thiếu text → '—'; dòng không có MSSV bị loại.
 */
export function normalizeTtcdsSearchResults(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.ket_qua) ? payload.ket_qua
      : Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.items) ? payload.items
          : Array.isArray(payload?.results) ? payload.results
            : [];
  return list.map((raw) => {
    const mssv = raw?.mssv ?? raw?.ma_sinh_vien ?? raw?.ma_sv ?? '';
    if (!String(mssv).trim()) return null;
    const name = raw?.ho_ten ?? raw?.ten_day_du ?? raw?.full_name ?? raw?.ho_va_ten ?? '';
    const className = raw?.ma_lop ?? raw?.ten_lop ?? raw?.lop ?? '';
    return {
      mssv: String(mssv).trim().toUpperCase(),
      name: String(name ?? '').trim() || '—',
      className: String(className ?? '').trim() || '—'
    };
  }).filter(Boolean);
}

/**
 * Ô thêm sinh viên kiểu autocomplete nhiều chọn: gõ đủ ngưỡng (tên ≥2 ký tự,
 * MSSV ≥4 số) → debounce → search → gợi ý tên + MSSV + lớp hiện TRONG cùng
 * khung viền. Chọn gợi ý (Enter/click) = đưa vào danh sách đã chọn dưới dạng
 * chip, CHƯA gọi API; nút "Thêm vào nhóm" ở ngoài mới lưu cả danh sách.
 * `exclude` (MSSV đã có trong nhóm) và chip đã chọn bị loại khỏi dropdown để
 * không thêm trùng. Backspace khi ô trống = bỏ chip cuối.
 *
 * Vùng kết quả LUÔN hiện và cao cố định (`__list`) để popup không giật kích
 * thước khi kết quả về ít/nhiều; chưa đủ ngưỡng gõ thì vùng đó để trống.
 */
function StudentSearchBox({ token, disabled, errorMessage, inputRef, picked = [], exclude = [], onPick, onUnpick, onType }) {
  const listId = useId();
  const optionRefs = useRef([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmedQuery = query.trim();
  // Chưa đủ ngưỡng gõ (tên ≥2 ký tự, MSSV ≥4 số) → chưa gọi search, khung kết quả để trống.
  const idle = trimmedQuery.length < searchMinLength(query);

  useEffect(() => {
    const q = query.trim();
    if (q.length < searchMinLength(q)) {
      setDebounced('');
      return undefined;
    }
    const timer = window.setTimeout(() => setDebounced(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ['ttcds-student-search', debounced],
    queryFn: ({ signal }) => searchTtcdsStudents(token, debounced, { limit: 8, signal }),
    enabled: Boolean(token && debounced && debounced.length >= searchMinLength(debounced)),
    staleTime: 60 * 1000,
    retry: false
  });
  const results = useMemo(() => normalizeTtcdsSearchResults(searchQuery.data), [searchQuery.data]);

  // Sinh viên đã nằm trong nhóm hoặc đã chọn rồi thì không gợi ý lại.
  const hideMssv = useMemo(() => new Set([
    ...picked.map((student) => student.mssv),
    ...exclude.map((mssv) => String(mssv ?? '').trim().toUpperCase())
  ]), [picked, exclude]);
  const options = useMemo(() => results.filter((student) => !hideMssv.has(student.mssv)), [results, hideMssv]);

  const pendingSearch = trimmedQuery !== debounced;

  useEffect(() => { setActiveIndex(0); }, [debounced]);
  // Lọc bớt gợi ý (chọn xong / đã trong nhóm) có thể làm chỉ số đang chọn vượt danh sách.
  useEffect(() => { setActiveIndex((index) => (index >= options.length ? 0 : index)); }, [options.length]);
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, options.length]);

  const pick = (student) => {
    onPick(student);
    setQuery('');
    setDebounced('');
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Backspace' && query === '' && picked.length > 0) {
      event.preventDefault();
      onUnpick(picked[picked.length - 1].mssv);
      return;
    }
    if (idle || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(options[Math.min(activeIndex, options.length - 1)]);
    }
  };

  const loading = !idle && (pendingSearch || searchQuery.isFetching);
  const showEmpty = !idle && !loading && !searchQuery.isError && searchQuery.isFetched && options.length === 0;

  const hint = picked.length > 0
    ? `Đã chọn ${picked.length} sinh viên. Bấm "Thêm vào nhóm" để lưu vào nhóm.`
    : 'Chưa chọn sinh viên nào.';

  return (
    <div className="ttcds-student-search">
      <label htmlFor="ttcds-add-student-search">Thêm sinh viên theo tên hoặc MSSV</label>
      <div className="ttcds-student-search__control">
        {picked.length > 0 && (
          <ul className="ttcds-student-search__chips" aria-label="Sinh viên đã chọn">
            {picked.map((student) => (
              <li key={student.mssv} className="ttcds-student-search__chip">
                <span className="ttcds-student-search__chip-name">{student.name}</span>
                <span className="ttcds-student-search__chip-meta">{student.mssv}</span>
                <button
                  type="button"
                  className="ttcds-student-search__chip-remove"
                  onClick={() => onUnpick(student.mssv)}
                  aria-label={`Bỏ ${student.name} (${student.mssv})`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id="ttcds-add-student-search"
          ref={inputRef}
          className="form-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby="ttcds-add-student-hint"
          autoComplete="off"
          spellCheck={false}
          value={query}
          disabled={disabled}
          placeholder="Ví dụ: nguyen hoặc 24050126"
          onChange={(event) => {
            setQuery(event.target.value);
            onType?.();
          }}
          onKeyDown={handleKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Gợi ý sinh viên" className="ttcds-student-search__list">
          {loading && <li className="ttcds-student-search__empty" aria-disabled="true">Đang tìm kiếm…</li>}
          {!idle && !loading && searchQuery.isError && (
            <li className="ttcds-student-search__empty" aria-disabled="true">
              <span role="alert">{searchQuery.error?.message || 'Không thể tìm kiếm sinh viên.'}</span>
              <button type="button" className="club-text-action" onPointerDown={(event) => event.preventDefault()} onClick={() => searchQuery.refetch()}>
                Thử lại
              </button>
            </li>
          )}
          {showEmpty && <li className="ttcds-student-search__empty" aria-disabled="true">Không tìm thấy sinh viên phù hợp.</li>}
          {!loading && options.map((student, index) => {
            const isActive = index === activeIndex;
            return (
              <li
                key={student.mssv}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={isActive}
                className={`ttcds-student-search__option${isActive ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(student)}
                >
                  <span className="ttcds-student-search__avatar" aria-hidden="true">{(student.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="ttcds-student-search__text">
                    <span className="ttcds-student-search__name">{student.name}</span>
                    <span className="ttcds-student-search__meta">{student.mssv} · {student.className}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p id="ttcds-add-student-hint" className="ttcds-student-search__hint">{hint}</p>
      {errorMessage && <p className="club-field-error" role="alert">{errorMessage}</p>}
    </div>
  );
}

export default function TtcdsGroupPage() {
  const { id } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [confirmUI, askConfirm] = useConfirm();
  const [picked, setPicked] = useState([]);
  const [addErrors, setAddErrors] = useState([]);
  const [searchAddError, setSearchAddError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const addDialogRef = useRef(null);
  const addCloseRef = useRef(null);
  const addOpenerRef = useRef(null);
  const searchRef = useRef(null);
  useViewportDialog(showAddModal, () => setShowAddModal(false), addDialogRef, searchRef, addOpenerRef);

  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);
  const canCreate = canAccess && caps.data?.level === 'create';
  const justCreated = Boolean(location.state?.justCreated);

  // Vừa tạo nhóm xong (navigate từ list kèm state) → mở luôn popup thêm SV.
  useEffect(() => {
    if (justCreated && canCreate) setShowAddModal(true);
  }, [justCreated, canCreate]);

  const openAddModal = (event) => {
    if (!canCreate) return;
    addOpenerRef.current = event?.currentTarget || null;
    setPicked([]);
    setAddErrors([]);
    setSearchAddError(null);
    setShowAddModal(true);
  };

  const pickStudent = (student) => {
    setAddErrors([]);
    setSearchAddError(null);
    setPicked((list) => (list.some((entry) => entry.mssv === student.mssv) ? list : [...list, student]));
  };

  const unpickStudent = (mssv) => setPicked((list) => list.filter((entry) => entry.mssv !== mssv));

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
  const memberMssv = useMemo(() => members.map((member) => member.mssv), [members]);
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
    mutationFn: async ({ mssvList }) => {
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
    onSuccess: (errors, variables) => {
      const fromSearch = variables?.mssvList?.length === 1;
      setAddErrors(errors);
      if (errors.length === 0) {
        setPicked([]);
        setSearchAddError(null);
        notify('Đã thêm sinh viên vào nhóm.', 'success');
        setShowAddModal(false);
      } else {
        // Lỗi khi thêm từ ô tìm kiếm (1 MSSV) hiện ngay cạnh input; thêm hàng loạt thì liệt kê.
        setSearchAddError(fromSearch ? errors[0].message : null);
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

  const submitAdd = (event) => {
    event.preventDefault();
    if (picked.length === 0) {
      notify('Chọn ít nhất một sinh viên để thêm.', 'warning');
      return;
    }
    add.mutate({ mssvList: picked.map((student) => student.mssv) });
  };

  return (
    <section id="tab-ttcds-group" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <p><Link to="/mystudent">← Sinh viên của tôi</Link></p>
          <h1>{group?.name || (groupsQuery.isLoading ? 'Đang tải nhóm…' : 'Nhóm sinh viên')}</h1>
          <p>{group?.mentor ? `Mentor: ${group.mentor} · ` : ''}{members.length} sinh viên</p>
        </div>
        <div className="club-directory-hero__action">
          {canCreate && (
            <button type="button" className="btn btn-primary club-primary-action" onClick={openAddModal}>
              Thêm sinh viên
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={reloadDetails}>Tải lại</button>
        </div>
      </header>


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
          hint={canCreate ? 'Bấm "Thêm sinh viên" để tìm theo tên hoặc MSSV.' : 'Nhờ quản trị viên giao sinh viên vào nhóm này.'}
          action={canCreate ? (
            <button type="button" className="btn btn-primary" onClick={openAddModal}>
              Thêm sinh viên đầu tiên
            </button>
          ) : undefined}
        />
      ) : (
        <div className="card glass-panel ttcds-panel">
          <div className="ttcds-panel-head">
            <h2>Danh sách sinh viên</h2>
            <p className="ttcds-panel-sub">{members.length} sinh viên{group?.name ? ` · ${group.name}` : ''}</p>
          </div>
          <div className="table-scroll">
          <table className="ttcds-groups-table">
            <caption className="sr-only">Danh sách sinh viên trong nhóm {group?.name || ''}</caption>
            <thead>
              <tr>
                <th scope="col">MSSV</th>
                <th scope="col">Họ tên</th>
                <th scope="col">Lớp</th>
                <th scope="col" style={{ textAlign: 'right' }}>GPA tích lũy</th>
                <th scope="col" style={{ textAlign: 'right' }}>Chuyên cần kỳ này</th>
                <th scope="col" style={{ textAlign: 'right' }}>Rèn luyện</th>
                <th scope="col" style={{ textAlign: 'right' }}>Sự kiện</th>
                <th scope="col">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member, index) => {
                const summary = summaries[member.mssv];
                const loading = details[index]?.isLoading;
                const cell = (value) => (summary ? value : (loading ? '…' : '—'));
                const renLuyen = summary && (summary.renLuyen !== '—' || summary.renLuyenRank !== '—')
                  ? `${summary.renLuyen} · ${summary.renLuyenRank}`
                  : cell('—');
                const name = summary ? summary.name : member.mssv;
                return (
                  <Fragment key={member.mssv}>
                    <tr>
                      <td>{member.mssv}</td>
                      <td><Link to={`/ttcds/students/${member.mssv}`} state={{ from: location.pathname, fromLabel: group?.name ? `Nhóm ${group.name}` : 'Nhóm sinh viên' }}>{name}</Link></td>
                      <td>{cell(summary?.className)}</td>
                      <td style={{ textAlign: 'right' }}>{cell(summary?.gpa)}</td>
                      <td style={{ textAlign: 'right' }}>{cell(summary?.attendance)}</td>
                      <td style={{ textAlign: 'right' }}>{loading ? '…' : renLuyen}</td>
                      <td style={{ textAlign: 'right' }}>{cell(summary?.eventCount)}</td>
                      <td>
                        <div className="club-member__actions">
                          <Link className="btn btn-secondary" aria-label={`Chi tiết sinh viên ${name}`} to={`/ttcds/students/${member.mssv}`} state={{ from: location.pathname, fromLabel: group?.name ? `Nhóm ${group.name}` : 'Nhóm sinh viên' }}>Chi tiết</Link>
                          {canCreate && (
                            <button type="button" className="btn btn-secondary" aria-label={`Xóa sinh viên ${name}`} disabled={remove.isPending} onClick={() => confirmRemoveMember(member)}>
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!loading && !summary && (
                      <tr>
                        <td colSpan={8} className="club-muted">Chưa tải được tóm tắt.</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {canCreate && showAddModal && (
        <ViewportModal
          id="modal-add-ttcds-student"
          title="Thêm sinh viên vào nhóm"
          onClose={() => setShowAddModal(false)}
          dialogRef={addDialogRef}
          className="club-modal ttcds-invite"
        >
          <div className="club-modal__header">
            <div>
              <span className="club-eyebrow">NHÓM {group?.name ? group.name.toUpperCase() : ''}</span>
              <h2>Thêm sinh viên vào nhóm</h2>
            </div>
            <button ref={addCloseRef} type="button" className="club-icon-button" onClick={() => setShowAddModal(false)} aria-label="Đóng hộp thoại">×</button>
          </div>

          <p className="club-modal__intro">
            Tìm theo họ tên, hoặc nhập ít nhất 4 số trong MSSV. Chọn một hay nhiều gợi ý rồi bấm "Thêm vào nhóm".
          </p>

          <StudentSearchBox
            token={auth.token}
            disabled={add.isPending}
            errorMessage={searchAddError}
            inputRef={searchRef}
            picked={picked}
            exclude={memberMssv}
            onPick={pickStudent}
            onUnpick={unpickStudent}
            onType={() => setSearchAddError(null)}
          />

          <form className="ttcds-add-student__submit" onSubmit={submitAdd}>
            {addErrors.length > 0 && (
              <ul role="alert" className="club-field-error">
                {addErrors.map((entry) => <li key={entry.mssv}>{entry.mssv}: {entry.message}</li>)}
              </ul>
            )}
            <div className="club-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={picked.length === 0 || add.isPending}>
                {add.isPending ? 'Đang thêm…' : 'Thêm vào nhóm'}
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {confirmUI}
    </section>
  );
}
