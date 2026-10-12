import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useToasts } from '../../app/providers.jsx';
import {
  deleteTrainingCdsCredentials,
  getTrainingCdsCredentials,
  getTrainingCriteria,
  getTrainingSemesters,
  submitTrainingScore,
  syncTraining616
} from '../../api/tools.js';
import { useViewportDialog, ViewportModal } from '../../components/ViewportModal.jsx';

const MUC5_PENALTY_CODE = '5.5';
const MUC5_PENALTY_DIEM = -10;
const BONUS_616_CODE = '6.16';

const DEFAULT_ROLE_OPTIONS = [
  { code: '5.1', diem: 10, label: 'BCH Đoàn Thanh niên/Hội Sinh viên cấp Trường, Chi ủy viên Chi bộ Đảng sinh viên' },
  { code: '5.2', diem: 8, label: 'BCH Đoàn/Hội cấp Khoa/Viện, Chủ nhiệm CLB sinh viên, Ban cán sự lớp (Lớp trưởng)' },
  { code: '5.3', diem: 7, label: 'Ban chủ nhiệm CLB sinh viên, Ban cán sự lớp (Lớp phó/Bí thư)' },
  { code: '5.4', diem: 3, label: 'Thành viên CLB/đội nhóm trực thuộc Trường quản lý' }
];

/** Dựng danh sách hoạt động (tên sự kiện + điểm cộng) từ minh chứng app sinh viên. */
function buildActivityLines(criterion) {
  const items = Array.isArray(criterion?.minhChung) ? criterion.minhChung : [];
  return items.map((item) => {
    const points = String(item.giaTri || '').trim();
    const when = String(item.phuDe || '').trim();
    const extras = [points, when].filter(Boolean).join(', ');
    return `${item.tieuDe || 'Hoạt động'}${extras ? ` (${extras})` : ''}`;
  });
}

/** Ghép thêm các dòng hoạt động mới, giữ phần ghi chú đã có và tránh trùng lặp. */
function mergeActivityLines(current, existing, lines) {
  const base = (current || '').trim() || (existing || '').trim();
  const rows = base.split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set(rows);
  for (const line of lines) {
    if (!seen.has(line)) {
      rows.push(line);
      seen.add(line);
    }
  }
  return rows.join('\n');
}

function clampTotal(value) {
  if (!Number.isFinite(value)) return 0;
  if (value > 100) return 100;
  return value;
}

function rolePoints(option, muc5Group) {
  if (Number.isFinite(Number(option?.diem)) && Number(option.diem) > 0) return Number(option.diem);
  const question = muc5Group?.cauHoi?.find((item) => item.so === option?.code);
  return Number(question?.diemToiDa) || 0;
}

/**
 * Tính trước điểm mục 5 + tiêu chí 6.16 (nếu đồng bộ) và tổng điểm, bám đúng
 * luật cổng BDU: tổng nhóm = min(tổng điểm các câu, điểm tối đa nhóm).
 */
function previewScores(summary, roleOptions, roles, penalty, bonus616) {
  if (!summary) return { byGroup: {}, total: 0, muc5: 0, muc5Max: 0, group6: 0 };
  const overrides = {};

  const group5 = summary.groups.find((group) => group.so === '5');
  if (group5) {
    let sum = 0;
    for (const question of group5.cauHoi) {
      if (question.so === MUC5_PENALTY_CODE) {
        sum += penalty ? MUC5_PENALTY_DIEM : 0;
        continue;
      }
      const option = roleOptions.find((item) => item.code === question.so);
      if (option && roles.includes(question.so)) sum += rolePoints(option, group5);
    }
    const max = Number(group5.diemToiDa) || 0;
    overrides['5'] = sum >= max ? max : sum;
  }

  const group6 = summary.groups.find((group) => group.so === '6');
  if (group6 && bonus616 !== null && bonus616 !== undefined) {
    const max = Number(group6.diemToiDa) || 0;
    const sum = group6.cauHoi.reduce((acc, question) => (
      acc + (question.so === BONUS_616_CODE ? Number(bonus616) : (Number(question.diem) || 0))
    ), 0);
    overrides['6'] = sum >= max ? max : sum;
  }

  const byGroup = {};
  summary.groups.forEach((group) => {
    byGroup[group.so] = Object.prototype.hasOwnProperty.call(overrides, group.so)
      ? overrides[group.so]
      : (Number(group.diem) || 0);
  });

  return {
    byGroup,
    total: clampTotal(Object.values(byGroup).reduce((acc, value) => acc + value, 0)),
    muc5: byGroup['5'] ?? 0,
    muc5Max: Number(group5?.diemToiDa) || 0,
    group6: byGroup['6'] ?? 0
  };
}

export default function TrainingScorePage() {
  const auth = useAuth();
  const { notify } = useToasts();

  const [semesters, setSemesters] = useState(null);
  const [selectedHocKy, setSelectedHocKy] = useState('');
  const [loadingSemesters, setLoadingSemesters] = useState(false);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [criteria, setCriteria] = useState(null);
  const [roles, setRoles] = useState([]);
  const [penalty, setPenalty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [cdsPassword, setCdsPassword] = useState('');
  const [saveSync, setSaveSync] = useState(false);
  const [cdsSaved, setCdsSaved] = useState(false);
  const [cdsSyncing, setCdsSyncing] = useState(false);
  const [cdsError, setCdsError] = useState('');
  const [cdsCriterion, setCdsCriterion] = useState(null);
  const [activityNote, setActivityNote] = useState('');

  const confirmRef = useRef(null);
  const syncDialogRef = useRef(null);
  const cdsPasswordRef = useRef(null);
  useViewportDialog(confirmOpen, () => setConfirmOpen(false), confirmRef);
  useViewportDialog(syncModalOpen, () => setSyncModalOpen(false), syncDialogRef, cdsPasswordRef);

  const roleOptions = useMemo(
    () => (criteria?.roleOptions?.length ? criteria.roleOptions : DEFAULT_ROLE_OPTIONS),
    [criteria]
  );

  const penaltyLabel = useMemo(() => {
    const question = criteria?.summary?.muc5?.cauHoi?.find((item) => item.so === MUC5_PENALTY_CODE);
    return question?.noiDung || 'Cán bộ lớp/đoàn/hội không hoàn thành nhiệm vụ được phân công';
  }, [criteria]);

  const loadCriteria = useCallback(async (hocKy) => {
    if (!auth.token || !hocKy) return;
    setLoadingCriteria(true);
    setError('');
    setCriteria(null);
    setCdsCriterion(null);
    setCdsError('');
    try {
      const data = await getTrainingCriteria(auth.token, hocKy);
      setCriteria(data);
      setRoles(Array.isArray(data?.selection?.roles) ? data.selection.roles : []);
      setPenalty(Boolean(data?.selection?.penalty));
      setActivityNote(data?.summary?.ghiChuSv || '');
    } catch (err) {
      setError(err.message || 'Không thể tải tiêu chí điểm rèn luyện.');
      notify(err.message || 'Không thể tải tiêu chí điểm rèn luyện.', 'error');
    } finally {
      setLoadingCriteria(false);
    }
  }, [auth.token, notify]);

  const loadSemesters = useCallback(async () => {
    if (!auth.token || loadingSemesters) return;
    setLoadingSemesters(true);
    setError('');
    try {
      const items = await getTrainingSemesters(auth.token);
      setSemesters(items);
      if (items.length) {
        const preferred = items.find((item) => item.hienThiDiem) || items[0];
        setSelectedHocKy(String(preferred.hocKy));
        await loadCriteria(preferred.hocKy);
      } else {
        notify('Cổng BDU không trả về học kỳ nào để đánh giá.', 'info');
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách học kỳ.');
      notify(err.message || 'Không thể tải danh sách học kỳ.', 'error');
    } finally {
      setLoadingSemesters(false);
    }
  }, [auth.token, loadCriteria, loadingSemesters, notify]);

  useEffect(() => {
    if (auth.token) loadSemesters();
    // Chỉ tự nạp một lần cho mỗi phiên token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token) return;
    getTrainingCdsCredentials(auth.token)
      .then((data) => setCdsSaved(Boolean(data?.saved)))
      .catch(() => setCdsSaved(false));
  }, [auth.token]);

  const onSelectSemester = (event) => {
    const value = event.target.value;
    setSelectedHocKy(value);
    setCdsCriterion(null);
    setCdsError('');
    if (value) loadCriteria(value);
  };

  const toggleRole = (code) => {
    setRoles((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  };

  const openSyncModal = () => {
    setCdsError('');
    setSaveSync(false);
    setSyncModalOpen(true);
  };

  const doSync = async () => {
    if (!auth.token || !selectedHocKy || cdsSyncing) return;
    setCdsSyncing(true);
    setCdsError('');
    try {
      const payload = { hocKy: Number(selectedHocKy), saveSync: Boolean(saveSync) };
      const typed = cdsPassword.trim();
      if (typed) payload.cdsPassword = typed;
      const data = await syncTraining616(auth.token, payload);
      setCdsCriterion(data.criterion);
      if (data.savedSync) setCdsSaved(true);
      setActivityNote((current) => mergeActivityLines(current, criteria?.summary?.ghiChuSv, buildActivityLines(data.criterion)));
      setSyncModalOpen(false);
      notify(`Đã đồng bộ 6.16: ${data.criterion?.diemThucTe ?? 0} điểm (${data.criterion?.minhChung?.length || 0} sự kiện).`, 'success');
    } catch (err) {
      setCdsError(err.message || 'Không thể đồng bộ tiêu chí 6.16 từ app sinh viên.');
    } finally {
      setCdsSyncing(false);
    }
  };

  const clearSavedSync = async () => {
    try {
      await deleteTrainingCdsCredentials(auth.token);
      setCdsSaved(false);
      setCdsPassword('');
      notify('Đã xoá mật khẩu đồng bộ đã lưu.', 'info');
    } catch (err) {
      setCdsError(err.message || 'Không thể xoá đồng bộ đã lưu.');
    }
  };

  const bonus616 = cdsCriterion ? cdsCriterion.diemThucTe : null;

  const preview = useMemo(
    () => previewScores(criteria?.summary, roleOptions, roles, penalty, bonus616),
    [criteria, roleOptions, roles, penalty, bonus616]
  );

  const isReadOnly = Boolean(criteria?.summary?.isReadOnly);

  const submit = async () => {
    setConfirmOpen(false);
    if (submitting || isReadOnly) return;
    setSubmitting(true);
    setError('');
    try {
      const data = await submitTrainingScore(auth.token, {
        hocKy: Number(selectedHocKy),
        roles,
        penalty,
        ...(bonus616 !== null ? { bonus616 } : {}),
        ghiChuSv: activityNote
      });
      setCriteria((current) => (current ? { ...current, summary: data.summary, selection: data.selection } : current));
      notify(`Đã lưu điểm rèn luyện: ${data.summary?.total ?? 0}/100${data.summary?.xepLoai ? ` (${data.summary.xepLoai})` : ''}.`, 'success');
    } catch (err) {
      setError(err.message || 'Không thể lưu điểm rèn luyện.');
      notify(err.message || 'Không thể lưu điểm rèn luyện.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const summary = criteria?.summary;
  const syncedOverMax = cdsCriterion && Number(cdsCriterion.diemThucTe) > Number(cdsCriterion.diemToiDa);

  return (
    <section id="tab-training-score" className="tab-pane active dgrl-page">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Tự Động Chấm Điểm Rèn Luyện</h2>
            <p className="section-desc">Chọn học kỳ, trả lời nhanh vài câu về chức vụ (mục 5), đồng bộ tiêu chí 6.16 từ app sinh viên rồi lưu điểm rèn luyện trực tiếp qua API BDU.</p>
          </div>
          <span className="badge-mini badge-pill-amber">DGRL Bot</span>
        </div>
      </div>

      <div className="dgrl-layout">
        <div className="dgrl-card glass-panel">
          <div className="survey-card-topbar">
            <span className="survey-card-topbar-title">CHỌN HỌC KỲ</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadSemesters} disabled={loadingSemesters}>
              {loadingSemesters ? 'Đang lấy…' : '↻ Lấy lại'}
            </button>
          </div>

          <div className="dgrl-field">
            <label htmlFor="dgrl-semester">Học kỳ muốn đánh giá</label>
            <select
              id="dgrl-semester"
              className="dgrl-select"
              value={selectedHocKy}
              onChange={onSelectSemester}
              disabled={!semesters?.length || loadingSemesters}
            >
              {!semesters && <option value="">— Chưa tải danh sách —</option>}
              {(semesters || []).map((item) => (
                <option key={item.hocKy} value={item.hocKy}>
                  {item.ten}{item.hienThiDiem ? ' • đang mở' : ''}
                </option>
              ))}
            </select>
            {!semesters && (
              <button type="button" className="btn btn-primary btn-block" onClick={loadSemesters} disabled={loadingSemesters}>
                {loadingSemesters ? 'Đang tải học kỳ…' : 'Lấy danh sách học kỳ'}
              </button>
            )}
          </div>

          {error && <div className="survey-inline-error" role="alert">{error}</div>}
          {loadingCriteria && <div className="dgrl-loading">Đang tải tiêu chí rèn luyện…</div>}

          {summary && <>
            <div className="survey-card-topbar">
              <span className="survey-card-topbar-title">MỤC 5 – CHỨC VỤ / THÀNH TÍCH</span>
            </div>

            {isReadOnly && (
              <div className="dgrl-notice dgrl-notice-warn" role="alert">
                Học kỳ này đang ngoài thời gian cho phép sinh viên tự đánh giá nên không thể lưu.
              </div>
            )}

            <div className="dgrl-role-list">
              {roleOptions.map((option) => {
                const checked = roles.includes(option.code);
                return (
                  <label className={`dgrl-role-row${checked ? ' selected' : ''}`} key={option.code}>
                    <input type="checkbox" checked={checked} onChange={() => toggleRole(option.code)} disabled={isReadOnly || submitting} />
                    <span className="dgrl-role-main">
                      <strong>{option.code}</strong>
                      <span>{option.label}</span>
                    </span>
                    <span className="dgrl-role-points">+{rolePoints(option, summary.muc5)}</span>
                  </label>
                );
              })}

              <label className={`dgrl-role-row dgrl-role-penalty${penalty ? ' selected' : ''}`}>
                <input type="checkbox" checked={penalty} onChange={() => setPenalty((value) => !value)} disabled={isReadOnly || submitting} />
                <span className="dgrl-role-main">
                  <strong>{MUC5_PENALTY_CODE}</strong>
                  <span>{penaltyLabel}</span>
                </span>
                <span className="dgrl-role-points">{MUC5_PENALTY_DIEM}</span>
              </label>
            </div>

            <div className="dgrl-sync-row">
              <span className="dgrl-sync-status">
                {cdsCriterion
                  ? `Đã đồng bộ 6.16 = ${cdsCriterion.diemThucTe}đ · ${cdsCriterion.minhChung?.length || 0} sự kiện`
                  : ''}
              </span>
              <button type="button" className="dgrl-sync-link" onClick={openSyncModal} disabled={submitting}>
                Đồng bộ danh sách sự kiện
              </button>
            </div>
            {syncedOverMax && (
              <div className="dgrl-cds-warn" role="alert">
                ⚠️ Điểm từ app sinh viên ({cdsCriterion.diemThucTe}) vượt điểm tối đa của tiêu chí 6.16 ({cdsCriterion.diemToiDa}). Cổng BDU vẫn nhận nhưng CVHT/Khoa có thể chỉnh lại.
              </div>
            )}

            <button
              type="button"
              id="btn-submit-dgrl"
              className="btn btn-primary btn-block btn-lg"
              onClick={() => setConfirmOpen(true)}
              disabled={isReadOnly || submitting || loadingCriteria}
            >
              <span className="btn-text">{submitting ? 'Đang lưu lên cổng BDU…' : 'Chấm & Lưu điểm rèn luyện'}</span>
            </button>
          </>}
        </div>

        <div className="dgrl-card glass-panel dgrl-summary-card">
          <div className="survey-card-topbar">
            <span className="survey-card-topbar-title">XEM TRƯỚC &amp; ĐIỂM HIỆN TẠI</span>
          </div>

          {!summary && <div className="dgrl-empty">Chọn một học kỳ để xem tiêu chí và điểm.</div>}

          {summary && <>
            <div className="dgrl-score-hero">
              <div className="dgrl-score-item">
                <span className="dgrl-score-label">Hiện tại</span>
                <strong className="dgrl-score-value">{summary.total}<small>/100</small></strong>
                {summary.xepLoai && <span className="dgrl-score-tag">{summary.xepLoai}</span>}
              </div>
              <div className="dgrl-score-arrow" aria-hidden="true">→</div>
              <div className="dgrl-score-item dgrl-score-after">
                <span className="dgrl-score-label">Sau khi chấm</span>
                <strong className="dgrl-score-value">{preview.total}<small>/100</small></strong>
                <span className="dgrl-score-tag">Mục 5: {preview.muc5}/{preview.muc5Max || 10}{bonus616 !== null ? ` · 6.16: ${bonus616}đ` : ''}</span>
              </div>
            </div>

            <ul className="dgrl-groups">
              {summary.groups.map((group) => {
                const isActive = group.so === '5' || (group.so === '6' && bonus616 !== null);
                const diem = preview.byGroup[group.so] ?? group.diem;
                return (
                  <li className={`dgrl-group-row${isActive ? ' dgrl-group-active' : ''}`} key={group.so}>
                    <span className="dgrl-group-name">
                      <strong>Mục {group.so}</strong> {group.noiDung}
                    </span>
                    <span className="dgrl-group-score">{diem}<small>/{group.diemToiDa}</small></span>
                  </li>
                );
              })}
            </ul>

            <p className="dgrl-note">
              Chỉ mục 5 và tiêu chí 6.16 được chỉnh ở đây; danh sách sự kiện đồng bộ sẽ được ghi vào ghi chú hoạt động. Điểm mặc định (mục 1: 20đ, mục 2: 25đ, mục 4: 25đ) và các tiêu chí khác luôn giữ nguyên như cổng trả về.
            </p>
          </>}
        </div>
      </div>

      {syncModalOpen && (
        <ViewportModal
          id="modal-dgrl-sync"
          title="Đồng bộ danh sách sự kiện"
          labelledBy="dgrl-sync-title"
          onClose={() => setSyncModalOpen(false)}
          dialogRef={syncDialogRef}
          className="dgrl-dialog"
        >
          <div className="dgrl-dlg-hero">
            <div className="dgrl-dlg-hero-text">
              <span className="dgrl-dlg-kicker">APP SINH VIÊN</span>
              <h3 id="dgrl-sync-title" className="dgrl-dlg-title">Đăng nhập để đồng bộ</h3>
            </div>
            <button type="button" className="survey-modal-close" onClick={() => setSyncModalOpen(false)} aria-label="Đóng">×</button>
          </div>

          <div className="dgrl-dlg-body">
            <div className="dgrl-callout dgrl-callout-info">
              Điểm <strong>6.16</strong> và danh sách sự kiện nằm ở <strong>app sinh viên</strong> — tài khoản riêng với cổng thông tin.
              Đăng nhập để đồng bộ tài khoản sinh viên của bạn trên app.
            </div>

            <div className="dgrl-form-row">
              <label htmlFor="dgrl-sync-mssv">Mã số sinh viên</label>
              <input id="dgrl-sync-mssv" className="dgrl-text-input" type="text" value={auth.user?.mssv || ''} disabled readOnly />
            </div>

            <div className="dgrl-form-row">
              <label htmlFor="dgrl-cds-password">Mật khẩu app sinh viên</label>
              <input
                id="dgrl-cds-password"
                ref={cdsPasswordRef}
                className="dgrl-text-input"
                type="password"
                autoComplete="off"
                placeholder={cdsSaved ? 'Để trống để dùng mật khẩu đã lưu' : 'Nhập mật khẩu app sinh viên'}
                value={cdsPassword}
                onChange={(event) => setCdsPassword(event.target.value)}
                disabled={cdsSyncing}
              />
            </div>

            <label className="dgrl-check-row">
              <input type="checkbox" checked={saveSync} onChange={() => setSaveSync((value) => !value)} disabled={cdsSyncing} />
              <span><strong>Lưu đồng bộ</strong> — lưu mật khẩu (mã hoá) để tự động đồng bộ cho các lần sau.</span>
            </label>

            {cdsError && <div className="dgrl-dlg-error" role="alert">{cdsError}</div>}

            {cdsSaved && (
              <div className="dgrl-saved-row">
                <span>🔒 Đang có mật khẩu đồng bộ đã lưu trên máy chủ.</span>
                <button type="button" className="dgrl-sync-clear" onClick={clearSavedSync} disabled={cdsSyncing}>Xoá đồng bộ</button>
              </div>
            )}
          </div>

          <div className="dgrl-dlg-foot">
            <span className="dgrl-dlg-foot-note">Mật khẩu chỉ dùng để lấy token app sinh viên, không hiển thị lại.</span>
            <div className="dgrl-dlg-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSyncModalOpen(false)} disabled={cdsSyncing}>Huỷ</button>
              <button type="button" className="btn btn-primary" onClick={doSync} disabled={cdsSyncing}>
                {cdsSyncing ? 'Đang đồng bộ…' : 'Đồng bộ'}
              </button>
            </div>
          </div>
        </ViewportModal>
      )}

      {confirmOpen && summary && (
        <ViewportModal
          id="modal-dgrl-confirm"
          title="Xác nhận lưu điểm rèn luyện"
          labelledBy="dgrl-confirm-title"
          onClose={() => setConfirmOpen(false)}
          dialogRef={confirmRef}
          className="dgrl-dialog"
        >
          <div className="dgrl-dlg-hero">
            <div className="dgrl-dlg-hero-text">
              <span className="dgrl-dlg-kicker">XÁC NHẬN</span>
              <h3 id="dgrl-confirm-title" className="dgrl-dlg-title">Lưu điểm rèn luyện lên cổng BDU?</h3>
            </div>
            <button type="button" className="survey-modal-close" onClick={() => setConfirmOpen(false)} aria-label="Đóng">×</button>
          </div>

          <div className="dgrl-dlg-body">
            <ul className="dgrl-dlg-rows">
              <li>
                <span className="dgrl-dlg-row-label">Học kỳ</span>
                <span className="dgrl-dlg-row-value">{semesters?.find((item) => String(item.hocKy) === String(selectedHocKy))?.ten || selectedHocKy}</span>
              </li>
              <li>
                <span className="dgrl-dlg-row-label">Chức vụ (mục 5)</span>
                <span className="dgrl-dlg-row-value">{roles.length ? roles.join(', ') : 'Không giữ chức vụ'}{penalty ? ' · có vi phạm 5.5' : ''}</span>
              </li>
              <li>
                <span className="dgrl-dlg-row-label">Tiêu chí 6.16</span>
                <span className="dgrl-dlg-row-value">{bonus616 !== null ? `${bonus616} điểm (từ app sinh viên)` : 'Không áp dụng'}</span>
              </li>
            </ul>

            <div className="dgrl-dlg-total">
              <span>Tổng điểm dự kiến</span>
              <strong>{preview.total}<small>/100</small></strong>
            </div>

            <div className="dgrl-callout dgrl-callout-warn">
              Thao tác này ghi trực tiếp lên cổng sinh viên BDU. Hãy kiểm tra kỹ trước khi xác nhận.
            </div>

            <p className="dgrl-dlg-hint">
              Một số dữ liệu cộng thêm (ví dụ <strong>NCKH</strong>, hội thảo, khen thưởng…) bạn có thể tự nhập thêm trên cổng nếu cần.
            </p>
          </div>

          <div className="dgrl-dlg-foot">
            <span className="dgrl-dlg-foot-note">
              {syncedOverMax ? '⚠️ Có tiêu chí vượt điểm tối đa.' : 'Điểm được lưu theo mức tự đánh giá của sinh viên.'}
            </span>
            <div className="dgrl-dlg-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Huỷ</button>
              <button type="button" className="btn btn-primary" onClick={submit}>Xác nhận lưu</button>
            </div>
          </div>
        </ViewportModal>
      )}
    </section>
  );
}
