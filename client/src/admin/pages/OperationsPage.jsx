import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import { formatDateTime, formatNumber, formatUptime, safeNumber } from '../utils/format.js';
import { Icons } from '../components/Icons.jsx';
import { ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

const ODP_TABLE_LABELS = {
  sinh_vien: 'Sinh viên (odp_sinh_vien)',
  tbhk: 'Điểm TB học kỳ (odp_tbhk)',
  bang_diem: 'Bảng điểm (odp_bang_diem)',
  diem_danh: 'Điểm danh (odp_diem_danh)',
  thoi_khoa_bieu: 'Thời khóa biểu (odp_thoi_khoa_bieu)',
  ren_luyen: 'Rèn luyện (odp_ren_luyen)',
  su_kien: 'Sự kiện (odp_su_kien)',
  mon_hoc: 'Môn học (odp_mon_hoc)'
};

const ODP_STATUS_LABELS = {
  running: '● Đang chạy',
  success: '● Thành công',
  failed: '● Thất bại'
};

export default function OperationsPage({ refreshMs, onOpenPurge, onOpenVpsTab, showToast }) {
  const [subTab, setSubTab] = useState('system');
  const [drafts, setDrafts] = useState({});
  const [lockBusyGroups, setLockBusyGroups] = useState(() => new Set());
  const [ttcdsMssv, setTtcdsMssv] = useState('');
  const [ttcdsLevel, setTtcdsLevel] = useState('view');
  const [ttcdsNote, setTtcdsNote] = useState('');

  const queryClient = useQueryClient();
  const pollMs = refreshMs > 0 ? refreshMs : false;

  // 1. System + Ranking Sync + Service Lock
  const systemQuery = useQuery({
    queryKey: ['admin-system'],
    queryFn: ({ signal }) => AdminApi.getSystem(signal),
    enabled: subTab === 'system',
    refetchInterval: subTab === 'system' ? pollMs : false
  });

  const rankingSyncQuery = useQuery({
    queryKey: ['admin-ranking-sync'],
    queryFn: ({ signal }) => AdminApi.getRankingSync(signal),
    enabled: subTab === 'system',
    refetchInterval: subTab === 'system' ? pollMs : false
  });

  const serviceLockQuery = useQuery({
    queryKey: ['admin-service-lock'],
    queryFn: ({ signal }) => AdminApi.getServiceLock(signal),
    enabled: subTab === 'system',
    refetchInterval: subTab === 'system' ? pollMs : false
  });

  const rankingMutation = useMutation({
    mutationFn: (enabled) => AdminApi.updateRankingSync(enabled),
    onSuccess: (data, enabled) => {
      queryClient.setQueryData(['admin-ranking-sync'], data);
      const hour = String(data?.sync_hour ?? 3).padStart(2, '0');
      showToast?.(
        enabled
          ? `Đã bật: đồng bộ xếp hạng sẽ chạy vào ${hour}:00 kế tiếp.`
          : `Đã tắt: các lần chạy ${hour}:00 sẽ bị bỏ qua.`,
        'success'
      );
    },
    onError: (err) => {
      showToast?.(err.message || 'Không lưu được cấu hình đồng bộ.', 'error');
    }
  });

  const serviceLockMutation = useMutation({
    mutationFn: (payload) => AdminApi.updateServiceLock(payload),
    onSuccess: (data, variables) => {
      // PUT trả { groups, updated_at, updated_by } không kèm catalog; ghép catalog từ cache GET
      queryClient.setQueryData(['admin-service-lock'], (prev) => ({
        ...(prev || {}),
        ...(data || {}),
        catalog: Array.isArray(data?.catalog) ? data.catalog : (prev?.catalog || [])
      }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.group];
        return next;
      });
      const catalog = Array.isArray(serviceLockQuery.data?.catalog) ? serviceLockQuery.data.catalog : [];
      const label = catalog.find((c) => c.id === variables.group)?.label || variables.group;
      showToast?.(
        variables.locked ? `Đã khóa nhóm ${label} để bảo trì.` : `Đã mở khóa nhóm ${label}.`,
        'success'
      );
    },
    onError: (err) => {
      showToast?.(err.message || 'Không lưu được trạng thái khóa dịch vụ.', 'error');
    }
  });

  async function handleToggleServiceLock(group, label, nextLocked, entry) {
    if (lockBusyGroups.has(group)) return;

    // Chỉ hỏi xác nhận khi BẬT khóa bảo trì; mở khóa an toàn nên không hỏi.
    if (nextLocked) {
      const ok = window.confirm(
        `Khóa nhóm "${label}" sẽ đưa người dùng đang xem trang của nhóm này sang màn hình bảo trì. Tiếp tục?`
      );
      if (!ok) return;
    }

    const draft = drafts[group];
    const title = (draft?.title ?? entry?.title ?? '').trim();
    const message = (draft?.message ?? entry?.message ?? '').trim();

    setLockBusyGroups((prev) => new Set(prev).add(group));
    try {
      await serviceLockMutation.mutateAsync({ group, locked: nextLocked, title, message });
    } finally {
      setLockBusyGroups((prev) => {
        const next = new Set(prev);
        next.delete(group);
        return next;
      });
    }
  }

  // 2. ODP Sync
  const odpQuery = useQuery({
    queryKey: ['admin-odp-sync'],
    queryFn: ({ signal }) => AdminApi.getOdpSync(signal),
    enabled: subTab === 'odp',
    refetchInterval: subTab === 'odp' ? pollMs : false
  });

  const odpRunMutation = useMutation({
    mutationFn: () => AdminApi.runOdpSync(),
    onSuccess: (data) => {
      if (data?.skipped) {
        showToast?.('Một tiến trình khác đang đồng bộ kho ODP; bỏ qua lần này.', 'info');
      } else if (Array.isArray(data?.errors) && data.errors.length > 0) {
        showToast?.(`Đồng bộ xong nhưng ${data.errors.length} bảng lỗi (giữ nguyên dữ liệu cũ).`, 'error');
      } else {
        showToast?.('Đã đồng bộ kho ODP xong.', 'success');
      }
      odpQuery.refetch();
    },
    onError: (err) => {
      showToast?.(err.message || 'Không chạy được đồng bộ kho ODP.', 'error');
    }
  });

  // 3. TTCDS Permissions
  const ttcdsPermQuery = useQuery({
    queryKey: ['admin-ttcds-permissions'],
    queryFn: ({ signal }) => AdminApi.getTtcdsPermissions(signal),
    enabled: subTab === 'ttcds',
    retry: false
  });

  const ttcdsAuditQuery = useQuery({
    queryKey: ['admin-ttcds-audit'],
    queryFn: ({ signal }) => AdminApi.getTtcdsAudit(signal),
    enabled: subTab === 'ttcds',
    retry: false
  });

  const ttcdsSaveMutation = useMutation({
    mutationFn: (payload) => AdminApi.saveTtcdsPermission(payload),
    onSuccess: (_data, vars) => {
      if (vars.isRevoke) {
        showToast?.(`Đã thu hồi quyền tạo nhóm của ${vars.mssv}.`, 'success');
      } else {
        setTtcdsMssv('');
        setTtcdsNote('');
        showToast?.('Đã cập nhật phân quyền.', 'success');
      }
      ttcdsPermQuery.refetch();
      ttcdsAuditQuery.refetch();
    },
    onError: (err) => {
      showToast?.(err.message || 'Không lưu được phân quyền TTCDS.', 'error');
    }
  });

  const sys = systemQuery.data || {};
  const srv = sys.server || {};
  const mem = sys.memory || {};
  const rt = sys.realtime || {};
  const db = sys.database || {};
  const tel = sys.telemetry || {};

  const ranking = rankingSyncQuery.data;
  const rankingEnvEnabled = ranking?.env_enabled !== false;
  const rankingEnabled = Boolean(ranking?.effective_enabled) && rankingEnvEnabled;

  const lockData = serviceLockQuery.data || {};
  const lockCatalog = Array.isArray(lockData.catalog) ? lockData.catalog : [];
  const lockGroups = lockData.groups || {};
  const lockedCount = lockCatalog.filter((c) => lockGroups[c.id]?.locked === true).length;

  const odp = odpQuery.data;
  const odpLatest = odp?.latest_run;
  const odpCounts = odpLatest?.counts || {};
  const odpKeys = Object.keys(odpCounts);
  const odpTotalRows = Object.values(odpCounts).reduce((s, v) => s + safeNumber(v), 0);

  return (
    <div className="admin-page-stack system-stack">
      {/* Sub-navigation */}
      <div className="panel-card filter-bar-card">
        <div className="segmented-control" role="group" aria-label="Phân mục vận hành">
          <button
            type="button"
            className={`chip ${subTab === 'system' ? 'active' : ''}`}
            aria-pressed={subTab === 'system'}
            onClick={() => setSubTab('system')}
          >
            <Icons.server size={15} />
            <span>Máy Chủ & Khóa Bảo Trì</span>
          </button>
          <button
            type="button"
            className={`chip ${subTab === 'odp' ? 'active' : ''}`}
            aria-pressed={subTab === 'odp'}
            onClick={() => setSubTab('odp')}
          >
            <Icons.database size={15} />
            <span>Kho ODP</span>
          </button>
          <button
            type="button"
            className={`chip ${subTab === 'ttcds' ? 'active' : ''}`}
            aria-pressed={subTab === 'ttcds'}
            onClick={() => setSubTab('ttcds')}
          >
            <Icons.users size={15} />
            <span>TTCDS Phân Quyền</span>
          </button>
        </div>
      </div>

      {/* Sub-tab 1: System & Maintenance */}
      {subTab === 'system' ? (
        <div className="system-stack" id="pane-system">
          <section className="panel-card">
            <div className="card-header card-header--wrap">
              <div>
                <h2 className="card-title">Sức Khỏe Máy Chủ VPS</h2>
                <p className="card-subtitle">Node.js runtime, bộ nhớ đệm, kết nối WebSocket và hàng đợi telemetry</p>
              </div>
              <div className="filter-group">
                {onOpenVpsTab ? (
                  <button
                    type="button"
                    className="btn-action-outline btn-sm"
                    onClick={onOpenVpsTab}
                  >
                    <span>Mở Dashboard VPS & RAM chi tiết →</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-purge-trigger"
                  id="btn-open-purge-modal"
                  onClick={onOpenPurge}
                >
                  <Icons.trash size={16} />
                  <span>Dọn Dẹp Dữ Liệu Cũ</span>
                </button>
              </div>
            </div>

            {systemQuery.isLoading ? (
              <SkeletonBlock rows={2} />
            ) : (
              <div className="system-metrics-row" id="system-metrics-container">
                <div className="sys-card">
                  <span className="sys-label">Thời Gian Hoạt Động (Uptime)</span>
                  <span className="sys-val" id="sys-uptime">{formatUptime(srv.uptimeSeconds)}</span>
                  <span className="sys-sub" id="sys-platform">Node {srv.nodeVersion || '--'} · {srv.platform || 'linux'}</span>
                </div>
                <div className="sys-card">
                  <span className="sys-label">Bộ Nhớ RAM Node (RSS)</span>
                  <span className="sys-val" id="sys-ram">{mem.rssMb || 0} MB</span>
                  <span className="sys-sub" id="sys-heap">Heap: {mem.heapUsedMb || 0} / {mem.heapTotalMb || 0} MB</span>
                </div>
                <div className="sys-card">
                  <span className="sys-label">WebSocket Trực Tuyến</span>
                  <span className="sys-val text-green" id="sys-ws">● {rt.connected_clients || 0} sockets</span>
                  <span className="sys-sub" id="sys-rooms">{rt.active_rooms || 0} phòng hoạt động</span>
                </div>
                <div className="sys-card">
                  <span className="sys-label">Lưu Trữ & Bộ Đệm RAM</span>
                  <span className="sys-val" id="sys-db-logs">{formatNumber(db.totalLogs)} logs</span>
                  <span className="sys-sub" id="sys-buffer">
                    Queue: {sys.bufferQueueSize || 0} HTTP · {tel.queueSize || 0} UI
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Đồng Bộ Xếp Hạng Học Tập</h2>
                <p className="card-subtitle">Chỉ cần bật quanh đợt công bố điểm/kết thúc kỳ; hệ thống chạy lúc 03:00</p>
              </div>
              <label className="switch" title="Bật/tắt đồng bộ xếp hạng">
                <input
                  type="checkbox"
                  id="ranking-sync-toggle"
                  aria-label="Bật tắt đồng bộ xếp hạng"
                  checked={rankingEnabled}
                  disabled={!rankingEnvEnabled || rankingMutation.isPending}
                  onChange={(e) => rankingMutation.mutate(e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>

            <div className="system-metrics-row">
              <div className="sys-card">
                <span className="sys-label">Trạng Thái</span>
                <span className={`sys-val ${rankingEnabled ? 'text-green' : ''}`} id="ranking-sync-state">
                  {rankingEnabled ? '● Đang bật' : '● Đang tắt'}
                </span>
                <span className="sys-sub" id="ranking-sync-state-sub">
                  {rankingEnvEnabled
                    ? (ranking?.enabled ? 'Theo cấu hình /admin' : 'Đã tắt từ /admin')
                    : 'Bị khoá bởi RANKING_SYNC_ENABLED trên server'}
                </span>
              </div>
              <div className="sys-card">
                <span className="sys-label">Đồng Bộ Gần Nhất</span>
                <span className="sys-val" id="ranking-sync-last">
                  {ranking?.latest_run?.completed_at ? formatDateTime(ranking.latest_run.completed_at) : '--'}
                </span>
                <span className="sys-sub" id="ranking-sync-last-sub">
                  {ranking?.latest_run
                    ? (ranking.latest_run.status === 'succeeded'
                      ? `${formatNumber(ranking.latest_run.student_count)} sinh viên`
                      : `Lần cuối: ${ranking.latest_run.status}`)
                    : 'Chưa có lần đồng bộ nào'}
                </span>
              </div>
              <div className="sys-card">
                <span className="sys-label">Lần Chạy Kế Tiếp</span>
                <span className="sys-val" id="ranking-sync-next">
                  {rankingEnabled && ranking?.next_run_at ? formatDateTime(ranking.next_run_at) : 'Tạm dừng'}
                </span>
                <span className="sys-sub" id="ranking-sync-next-sub">
                  {String(ranking?.sync_hour ?? 3).padStart(2, '0')}:00 Asia/Ho_Chi_Minh
                </span>
              </div>
            </div>
          </section>

          <section className="panel-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Khóa Dịch Vụ Bảo Trì Theo Nhóm</h2>
                <p className="card-subtitle">
                  Bật công tắc nhóm nào thì trang thuộc nhóm đó hiện màn hình bảo trì; các nhóm còn lại hoạt động bình thường.
                </p>
              </div>
            </div>

            <div className="system-metrics-row">
              <div className="sys-card">
                <span className="sys-label">Trạng Thái Chung</span>
                <span className={`sys-val ${lockedCount > 0 ? 'text-red' : 'text-green'}`} id="service-lock-state">
                  {lockedCount > 0 ? `● Đang khóa ${lockedCount}/${lockCatalog.length} nhóm` : '● Đang mở toàn bộ'}
                </span>
                <span className="sys-sub">
                  {lockedCount > 0 ? 'Trang thuộc nhóm bị khóa đang thấy màn hình bảo trì' : 'Mọi dịch vụ hoạt động bình thường'}
                </span>
              </div>
              <div className="sys-card">
                <span className="sys-label">Cập Nhật Gần Nhất</span>
                <span className="sys-val">{lockData.updated_at ? formatDateTime(lockData.updated_at) : '--'}</span>
                <span className="sys-sub">{lockData.updated_by ? `Bởi ${lockData.updated_by}` : 'Chưa từng thay đổi'}</span>
              </div>
            </div>

            <div className="service-lock-list" id="service-lock-list">
              {lockCatalog.map((item) => {
                const group = item.id;
                const entry = lockGroups[group] || {};
                const locked = entry.locked === true;
                const draft = drafts[group];
                const titleVal = draft?.title !== undefined ? draft.title : (entry.title || '');
                const messageVal = draft?.message !== undefined ? draft.message : (entry.message || '');
                const isBusy = lockBusyGroups.has(group);

                return (
                  <div className="service-lock-row" key={group} data-group={group}>
                    <div className="service-lock-row-head">
                      <div className="service-lock-row-heading">
                        <span className="service-lock-group-label">{item.label || group}</span>
                        <span className={`sys-sub service-lock-row-state ${locked ? 'text-red' : 'text-green'}`}>
                          {locked ? 'Đang khóa — người dùng thấy màn hình bảo trì' : 'Đang mở'}
                        </span>
                      </div>
                      <label className="switch service-lock-row-switch" title={`Bật/tắt khóa nhóm ${item.label}`}>
                        <input
                          type="checkbox"
                          className="service-lock-row-toggle"
                          aria-label={`Bật tắt khóa nhóm ${item.label}`}
                          checked={locked}
                          disabled={isBusy}
                          onChange={(e) => handleToggleServiceLock(group, item.label || group, e.target.checked, entry)}
                        />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="service-lock-form">
                      <label className="service-lock-field">
                        <span className="sys-label">Tiêu đề màn hình bảo trì</span>
                        <input
                          type="text"
                          className="service-lock-input"
                          maxLength={120}
                          placeholder="Dịch vụ đang tạm khóa để bảo trì"
                          value={titleVal}
                          onChange={(e) => setDrafts((prev) => ({
                            ...prev,
                            [group]: { title: e.target.value, message: messageVal }
                          }))}
                        />
                      </label>
                      <label className="service-lock-field">
                        <span className="sys-label">Nội dung thông báo</span>
                        <textarea
                          className="service-lock-input"
                          rows={2}
                          maxLength={500}
                          placeholder="Hệ thống đang bảo trì, vui lòng quay lại sau."
                          value={messageVal}
                          onChange={(e) => setDrafts((prev) => ({
                            ...prev,
                            [group]: { title: titleVal, message: e.target.value }
                          }))}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {/* Sub-tab 2: ODP */}
      {subTab === 'odp' ? (
        <div className="system-stack" id="pane-odp">
          <section className="panel-card">
            <div className="card-header card-header--wrap">
              <div>
                <h2 className="card-title">Kho ODP (Dữ liệu học vụ của trường)</h2>
                <p className="card-subtitle">
                  8 bảng ODP được kéo tự động lúc 03:00 mỗi ngày; “Sinh viên của tôi” và Bảng xếp hạng đều đọc từ kho này.
                </p>
              </div>
              <button
                type="button"
                className="btn-action-primary"
                id="btn-odp-sync-run"
                disabled={odpRunMutation.isPending}
                onClick={() => odpRunMutation.mutate()}
              >
                <Icons.refresh size={16} />
                <span>{odpRunMutation.isPending ? 'Đang đồng bộ...' : 'Chạy ngay'}</span>
              </button>
            </div>

            {odpQuery.isLoading ? (
              <SkeletonBlock rows={3} />
            ) : odpQuery.isError ? (
              <ErrorState message={odpQuery.error?.message} onRetry={() => odpQuery.refetch()} />
            ) : (
              <>
                <div className="system-metrics-row">
                  <div className="sys-card">
                    <span className="sys-label">Trạng Thái Lần Chạy</span>
                    <span className={`sys-val ${odpLatest?.status === 'success' ? 'text-green' : ''}`}>
                      {odpLatest ? (ODP_STATUS_LABELS[odpLatest.status] || `● ${odpLatest.status}`) : '○ Chưa chạy'}
                    </span>
                    <span className="sys-sub">
                      {odpLatest
                        ? `${odpLatest.trigger_source === 'manual' ? 'Chạy tay' : 'Theo lịch 03:00'} · bắt đầu ${formatDateTime(odpLatest.started_at)}`
                        : 'Chưa có lần đồng bộ nào'}
                    </span>
                  </div>
                  <div className="sys-card">
                    <span className="sys-label">Hoàn Tất Gần Nhất</span>
                    <span className="sys-val">
                      {odpLatest?.finished_at ? formatDateTime(odpLatest.finished_at) : '--'}
                    </span>
                    <span className="sys-sub">
                      {odpLatest ? `${formatNumber(odpTotalRows)} dòng · ${odpKeys.length} bảng` : '--'}
                    </span>
                  </div>
                  <div className="sys-card">
                    <span className="sys-label">Lần Chạy Kế Tiếp</span>
                    <span className="sys-val">
                      {odp?.next_run_at ? formatDateTime(odp.next_run_at) : 'Tạm dừng'}
                    </span>
                    <span className="sys-sub">{String(odp?.sync_hour ?? 3).padStart(2, '0')}:00 Asia/Ho_Chi_Minh</span>
                  </div>
                </div>

                {odpLatest?.error ? (
                  <p className="maintenance-info-content system-note text-error">
                    Bảng lỗi ở lần chạy gần nhất: {odpLatest.error}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="panel-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Số Dòng Mỗi Bảng</h2>
                <p className="card-subtitle">Nguồn trả 0 dòng cho một bảng thì bảng đó giữ nguyên dữ liệu cũ.</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">Bảng</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Số dòng</th>
                  </tr>
                </thead>
                <tbody>
                  {odpKeys.length === 0 ? (
                    <tr><td colSpan={2} className="text-center-muted">Chưa có số liệu số dòng.</td></tr>
                  ) : (
                    odpKeys.map((key) => (
                      <tr key={key}>
                        <td>{ODP_TABLE_LABELS[key] || key}</td>
                        <td className="text-mono" style={{ textAlign: 'right' }}>{formatNumber(odpCounts[key])}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {/* Sub-tab 3: TTCDS Permissions */}
      {subTab === 'ttcds' ? (
        <section className="panel-card" id="pane-ttcds">
          <div className="card-header card-header--wrap">
            <div>
              <h2 className="card-title">TTCDS Phân Quyền</h2>
              <p className="card-subtitle">
                Cấp nấc xem (view) hoặc tạo nhóm (create) cho dịch vụ “Sinh viên của tôi” theo MSSV. Thu hồi = hạ về nấc view.
              </p>
            </div>
            <button
              type="button"
              className="btn-refresh"
              onClick={() => {
                ttcdsPermQuery.refetch();
                ttcdsAuditQuery.refetch();
              }}
            >
              <Icons.refresh size={15} />
              <span>Làm Mới</span>
            </button>
          </div>

          <form
            className="table-filter-bar"
            style={{ marginBottom: '18px', alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              const clean = ttcdsMssv.trim().toUpperCase();
              if (!clean) {
                showToast?.('Vui lòng nhập MSSV được cấp quyền.', 'error');
                return;
              }
              ttcdsSaveMutation.mutate({
                mssv: clean,
                level: ttcdsLevel,
                note: ttcdsNote.trim() || undefined
              });
            }}
          >
            <div>
              <label htmlFor="input-ttcds-mssv" className="filter-label">MSSV</label>
              <input
                type="text"
                id="input-ttcds-mssv"
                className="admin-input"
                value={ttcdsMssv}
                onChange={(e) => setTtcdsMssv(e.target.value)}
                placeholder="Ví dụ: 22050006"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="select-ttcds-level" className="filter-label">Nấc quyền</label>
              <select
                id="select-ttcds-level"
                className="admin-select"
                value={ttcdsLevel}
                onChange={(e) => setTtcdsLevel(e.target.value)}
              >
                <option value="view">view — chỉ xem</option>
                <option value="create">create — tạo nhóm</option>
              </select>
            </div>
            <div>
              <label htmlFor="input-ttcds-note" className="filter-label">Ghi chú</label>
              <input
                type="text"
                id="input-ttcds-note"
                className="admin-input"
                value={ttcdsNote}
                onChange={(e) => setTtcdsNote(e.target.value)}
                placeholder="Lý do cấp quyền..."
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-action-primary" disabled={ttcdsSaveMutation.isPending}>
              Lưu phân quyền
            </button>
          </form>

          {ttcdsPermQuery.isError ? (
            <ErrorState
              title="Không tải được phân quyền TTCDS"
              message="Chức năng này yêu cầu tài khoản quản trị hệ thống (System Owner)."
              onRetry={() => ttcdsPermQuery.refetch()}
            />
          ) : (
            <>
              <h3 className="activity-section-title">
                Danh sách phân quyền ({formatNumber((ttcdsPermQuery.data || []).length)})
              </h3>
              <div className="table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th scope="col">MSSV</th>
                      <th scope="col">Nấc</th>
                      <th scope="col">Người cấp</th>
                      <th scope="col">Cập nhật</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ttcdsPermQuery.data || []).length === 0 ? (
                      <tr><td colSpan={5} className="text-center-muted">Chưa có dòng phân quyền nào.</td></tr>
                    ) : (
                      (ttcdsPermQuery.data || []).map((row) => (
                        <tr key={row.mssv}>
                          <td className="text-mono">{row.mssv}</td>
                          <td>{row.level}</td>
                          <td>{row.granted_by || '—'}</td>
                          <td>{row.updated_at || row.granted_at || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {row.level === 'create' ? (
                              <button
                                type="button"
                                className="btn-page"
                                onClick={() => {
                                  if (!window.confirm(`Thu hồi quyền tạo nhóm của ${row.mssv} (hạ về nấc view)?`)) return;
                                  ttcdsSaveMutation.mutate({ mssv: row.mssv, level: 'view', isRevoke: true });
                                }}
                              >
                                Thu hồi
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <h3 className="activity-section-title" style={{ marginTop: '20px' }}>Nhật ký thao tác mới nhất</h3>
              <div className="table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Người thao tác</th>
                      <th scope="col">Hành động</th>
                      <th scope="col">Nhóm</th>
                      <th scope="col">MSSV đích</th>
                      <th scope="col">Lúc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ttcdsAuditQuery.data || []).length === 0 ? (
                      <tr><td colSpan={6} className="text-center-muted">Chưa có thao tác nào được ghi nhận.</td></tr>
                    ) : (
                      (ttcdsAuditQuery.data || []).map((log) => (
                        <tr key={log.id}>
                          <td className="text-mono">{log.id}</td>
                          <td className="text-mono">{log.actor_mssv}</td>
                          <td>{log.action}</td>
                          <td>{log.target_group_id || '—'}</td>
                          <td className="text-mono">{log.target_mssv || '—'}</td>
                          <td>{log.created_at ? formatDateTime(log.created_at) : '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
