import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  formatNumber,
  formatPercent,
  formatUptime,
  safeNumber
} from '../utils/format.js';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

const SPACE_LABELS = {
  new_space: 'New Space (Vùng tạo mới)',
  old_space: 'Old Space (Đối tượng sống lâu)',
  code_space: 'Code Space (Mã JIT)',
  map_space: 'Map Space (Hidden classes)',
  large_object_space: 'Large Object Space (> kích thước trang)',
  read_only_space: 'Read-Only Space'
};

function severityClass(severity) {
  if (severity === 'critical') return 'vps-alert-item vps-alert-item--critical';
  if (severity === 'warning') return 'vps-alert-item vps-alert-item--warning';
  return 'vps-alert-item';
}

function progressToneClass(pct) {
  if (pct >= 85) return 'vps-fill--danger';
  if (pct >= 75) return 'vps-fill--warning';
  return 'vps-fill--ok';
}

function containerBadgeClass(container) {
  const status = String(container?.status || '');
  const isPlannedBackup = String(container?.name || '').includes('backup') && /exited\s*\(0\)/i.test(status);
  if (isPlannedBackup) return 'tool-status-badge tool-status-badge--viewed';
  if (container?.state === 'running' && (!container?.health || container.health === 'healthy')) {
    return 'tool-status-badge tool-status-badge--used';
  }
  if (container?.health === 'starting') {
    return 'tool-status-badge tool-status-badge--tried';
  }
  return 'status-badge badge-5xx';
}

function serviceBadgeClass(status) {
  if (status === 'active') return 'tool-status-badge tool-status-badge--used';
  if (status === 'unknown') return 'tool-status-badge tool-status-badge--viewed';
  return 'status-badge badge-5xx';
}

export default function VpsMonitorPage({
  refreshMs,
  theme,
  onOpenPurge,
  showToast
}) {
  const [copiedId, setCopiedId] = useState('');
  const queryClient = useQueryClient();
  const pollMs = refreshMs > 0 ? refreshMs : false;

  const vpsQuery = useQuery({
    queryKey: ['admin-vps-metrics'],
    queryFn: ({ signal }) => AdminApi.getVps(signal),
    refetchInterval: pollMs
  });

  const flushMutation = useMutation({
    mutationFn: () => AdminApi.flushVpsBuffers(),
    onSuccess: (data) => {
      const before = data?.before || {};
      showToast?.(
        `Đã xả ${formatNumber(before.trafficQueueSize)} HTTP log và ${formatNumber(before.telemetryQueueSize)} UI telemetry xuống DB.`,
        'success'
      );
      queryClient.invalidateQueries({ queryKey: ['admin-vps-metrics'] });
    },
    onError: (err) => {
      showToast?.(err.message || 'Không thể xả bộ đệm RAM.', 'error');
    }
  });

  const data = vpsQuery.data;
  const host = data?.host || {};
  const cpu = data?.cpu || {};
  const mem = data?.memory || {};
  const diskRoot = data?.disk?.root || {};
  const dataDirs = Array.isArray(data?.disk?.dataDirs) ? data.disk.dataDirs : [];
  const rt = data?.nodeRuntime || {};
  const db = data?.database || null;
  const docker = data?.docker || null;
  const services = data?.services || null;
  const topProcesses = Array.isArray(data?.topProcesses) ? data.topProcesses : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const quickCommands = Array.isArray(data?.quickCommands) ? data.quickCommands : [];
  const net = data?.network || null;
  const historyRows = useMemo(
    () => (Array.isArray(data?.history) ? data.history : []),
    [data?.history]
  );

  const totalRam = Math.max(1, safeNumber(mem.totalMb));
  const usedRamPctBar = Math.min(100, Math.round((safeNumber(mem.usedMb) / totalRam) * 100));
  const cacheRamPctBar = Math.min(
    Math.max(0, 100 - usedRamPctBar),
    Math.round(((safeNumber(mem.buffersMb) + safeNumber(mem.cachedMb)) / totalRam) * 100)
  );
  const freeRamPctBar = Math.max(0, 100 - usedRamPctBar - cacheRamPctBar);

  const isDark = theme === 'dark';
  const textColor = isDark ? '#CBD5E1' : '#111111';
  const gridColor = isDark ? 'rgba(228, 228, 231, 0.14)' : 'rgba(17, 17, 17, 0.12)';
  const axisBorder = isDark ? '#E4E4E7' : '#111111';
  const blueColor = isDark ? '#3B82F6' : '#1D4ED8';
  const greenColor = isDark ? '#34D399' : '#10B981';

  const historyChart = useMemo(() => {
    const labels = historyRows.map((pt) => {
      const d = new Date(pt.at);
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    });
    return {
      hasData: historyRows.length > 0,
      data: {
        labels,
        datasets: [
          {
            label: 'RAM đang dùng (%)',
            data: historyRows.map((p) => safeNumber(p.ramUsedPct)),
            borderColor: blueColor,
            backgroundColor: isDark ? 'rgba(59, 130, 246, 0.16)' : 'rgba(29, 78, 216, 0.12)',
            borderWidth: 2.5,
            fill: true,
            tension: 0,
            pointRadius: 3
          },
          {
            label: 'CPU (%)',
            data: historyRows.map((p) => safeNumber(p.cpuPct)),
            borderColor: greenColor,
            backgroundColor: isDark ? 'rgba(52, 211, 153, 0.14)' : 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2.5,
            fill: true,
            tension: 0,
            pointRadius: 3
          }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, font: { family: 'Manrope, sans-serif', size: 12, weight: '700' } }
          }
        },
        scales: {
          x: { border: { color: axisBorder, width: 2 }, ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
          y: {
            beginAtZero: true,
            max: 100,
            border: { color: axisBorder, width: 2 },
            ticks: { color: textColor, callback: (v) => `${v}%` },
            grid: { color: gridColor }
          }
        }
      }
    };
  }, [historyRows, textColor, gridColor, axisBorder, blueColor, greenColor, isDark]);

  const handleCopyCommand = async (cmdObj) => {
    try {
      await navigator.clipboard?.writeText(cmdObj.command);
      setCopiedId(cmdObj.id);
      showToast?.(`Đã sao chép lệnh "${cmdObj.label}"!`, 'info');
      setTimeout(() => setCopiedId(''), 1800);
    } catch {
      showToast?.('Không sao chép được tự động, hãy chọn thủ công.', 'error');
    }
  };

  if (vpsQuery.isLoading) {
    return (
      <div className="admin-page-stack">
        <SkeletonBlock rows={3} />
        <SkeletonBlock rows={5} />
      </div>
    );
  }

  if (vpsQuery.isError) {
    return (
      <ErrorState
        title="Không tải được thông số VPS & RAM"
        message={vpsQuery.error?.message || 'Lỗi kết nối API giám sát tài nguyên.'}
        onRetry={() => vpsQuery.refetch()}
      />
    );
  }

  const heapSpaces = Array.isArray(rt.heapSpaces) ? rt.heapSpaces : [];

  return (
    <div className="admin-page-stack" id="pane-vps">
      {/* 1. Host & Source Header Banner */}
      <section className="panel-card vps-banner">
        <div className="vps-banner-top">
          <div className="vps-banner-id">
            <span className={data?.source === 'host-agent' ? 'tool-status-badge tool-status-badge--used' : 'tool-status-badge tool-status-badge--tried'}>
              {data?.source === 'host-agent' ? 'Host Agent VPS (Chỉ đọc)' : 'Node Runtime Cục Bộ'}
            </span>
            <strong className="vps-hostname">{host.hostname || 'bdu-hub'}</strong>
            <span className="vps-os-pill">{host.os || rt.platform}</span>
          </div>
          <div className="vps-banner-meta text-mono">
            <span>Kernel {host.kernel || '--'}</span>
            <span>Uptime Host: {formatUptime(host.uptimeSeconds)}</span>
            {net ? (
              <span>Mạng ({net.interface}): ↓ {net.rxKbps} KB/s · ↑ {net.txKbps} KB/s</span>
            ) : null}
          </div>
        </div>

        {alerts.length > 0 ? (
          <div className="vps-alerts-list" role="region" aria-label="Cảnh báo tài nguyên máy chủ">
            {alerts.map((al) => (
              <div key={al.id} className={severityClass(al.severity)}>
                <Icons.alert size={16} />
                <div>
                  <strong>{al.title}</strong>
                  <span> — {al.message}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="vps-healthy-strip">
            <Icons.checkCircle size={16} />
            <span>Mọi chỉ số RAM, CPU, ổ đĩa và dịch vụ nền đang nằm trong ngưỡng ổn định.</span>
          </div>
        )}
      </section>

      {/* 2. 4 Main Resource KPI Cards */}
      <section className="kpi-grid" aria-label="Chỉ số tài nguyên VPS chính">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">RAM Máy Chủ</span>
            <span className="kpi-icon icon-blue"><Icons.server size={18} /></span>
          </div>
          <div className="kpi-value text-mono">
            {formatNumber(mem.usedMb)} <small className="kpi-unit">/ {formatNumber(mem.totalMb)} MB</small>
          </div>
          <div className="adoption-stack-bar" aria-hidden="true">
            <div className="adoption-seg adoption-seg--used" style={{ width: `${usedRamPctBar}%` }} />
            <div className="adoption-seg adoption-seg--tried" style={{ width: `${cacheRamPctBar}%` }} />
            <div className="adoption-seg adoption-seg--viewed" style={{ width: `${freeRamPctBar}%` }} />
          </div>
          <div className="kpi-sub">
            <span className={`error-status-badge ${safeNumber(mem.usedPct) >= 85 ? 'trend-down' : safeNumber(mem.usedPct) >= 75 ? 'trend-warning' : 'trend-up'}`}>
              {formatPercent(mem.usedPct)} đang dùng
            </span>
            <span className="kpi-desc">Khả dụng: {formatNumber(mem.availableMb)} MB</span>
          </div>
          <div className="kpi-footer-note text-mono">
            Swap: {formatNumber(mem.swapUsedMb)} / {formatNumber(mem.swapTotalMb)} MB ({formatPercent(mem.swapPct)})
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">CPU & Tải Hệ Thống</span>
            <span className="kpi-icon icon-green"><Icons.cpu size={18} /></span>
          </div>
          <div className="kpi-value text-mono">{formatPercent(cpu.usagePct)}</div>
          <div className="vps-progress-track" aria-hidden="true">
            <div
              className={`vps-progress-fill ${progressToneClass(safeNumber(cpu.usagePct))}`}
              style={{ width: `${Math.min(100, Math.max(2, safeNumber(cpu.usagePct)))}%` }}
            />
          </div>
          <div className="kpi-sub">
            <span className="kpi-desc">{safeNumber(cpu.cores)} vCPU · Load: {(cpu.loadAvg || [0, 0, 0]).join(' / ')}</span>
          </div>
          <div className="kpi-footer-note" title={cpu.model}>
            {cpu.model || 'CPU máy chủ'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Ổ Đĩa SSD (/)</span>
            <span className="kpi-icon icon-amber"><Icons.database size={18} /></span>
          </div>
          <div className="kpi-value text-mono">
            {diskRoot.usedGb || 0} <small className="kpi-unit">/ {diskRoot.totalGb || 0} GB</small>
          </div>
          <div className="vps-progress-track" aria-hidden="true">
            <div
              className={`vps-progress-fill ${progressToneClass(safeNumber(diskRoot.usedPct))}`}
              style={{ width: `${Math.min(100, safeNumber(diskRoot.usedPct))}%` }}
            />
          </div>
          <div className="kpi-sub">
            <span className={`error-status-badge ${safeNumber(diskRoot.usedPct) >= 85 ? 'trend-down' : safeNumber(diskRoot.usedPct) >= 75 ? 'trend-warning' : 'trend-up'}`}>
              Đã dùng {formatPercent(diskRoot.usedPct)}
            </span>
            <span className="kpi-desc">Còn trống {diskRoot.availGb || 0} GB</span>
          </div>
          <div className="kpi-footer-note text-mono">Mount: {diskRoot.mount || '/'}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Node.js & V8 Heap</span>
            <span className="kpi-icon icon-purple"><Icons.zap size={18} /></span>
          </div>
          <div className="kpi-value text-mono">{rt.rssMb || 0} MB</div>
          <div className="kpi-sub">
            <span className="kpi-desc text-mono">
              Heap: {rt.heapUsedMb || 0} / {rt.heapLimitMb || 0} MB ({formatPercent(rt.heapUsedPctOfLimit)})
            </span>
          </div>
          <div className="kpi-footer-note vps-node-actions">
            <span className="text-mono">
              Lag {rt.eventLoopLagMs || 0}ms · {rt.realtime?.connected_clients || 0} WS
            </span>
            <button
              type="button"
              className="btn-action-outline btn-xs"
              id="btn-flush-vps-buffers"
              disabled={flushMutation.isPending}
              onClick={() => flushMutation.mutate()}
            >
              {flushMutation.isPending ? 'Đang xả…' : 'Xả Buffer RAM'}
            </button>
          </div>
        </div>
      </section>

      {/* 3. Realtime RAM & CPU History Chart */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Biểu Đồ Biến Động RAM & CPU Thực Tế</h2>
            <p className="card-subtitle">
              Lưu 60 mẫu gần nhất theo chu kỳ 10 giây giúp phát hiện thời điểm tăng đột biến RAM/CPU.
            </p>
          </div>
          <button
            type="button"
            className="btn-refresh"
            onClick={() => vpsQuery.refetch()}
          >
            <Icons.refresh size={15} />
            <span>Đọc lại ngay</span>
          </button>
        </div>

        <div className="chart-wrapper">
          {!historyChart.hasData ? (
            <EmptyState message="Đang tích lũy các điểm đo đầu tiên..." />
          ) : (
            <ChartCanvas type="line" data={historyChart.data} options={historyChart.options} height={240} />
          )}
        </div>
      </section>

      {/* 4. Deep Dive: Memory Breakdown & V8 Heap + PostgreSQL */}
      <div className="two-col-row two-col-row--equal">
        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Phân Rã Chi Tiết RAM & V8 Heap</h2>
              <p className="card-subtitle">Kiểm soát rò rỉ bộ nhớ từ nhân Linux tới từng vùng cấp phát V8</p>
            </div>
          </div>

          <div className="vps-mem-breakdown">
            <div className="detail-row">
              <span className="k">RAM Tiến trình đang chiếm (Used)</span>
              <strong className="text-mono">{formatNumber(mem.usedMb)} MB</strong>
            </div>
            <div className="detail-row">
              <span className="k">Page Cache & SReclaimable</span>
              <strong className="text-mono">{formatNumber(mem.cachedMb)} MB</strong>
            </div>
            <div className="detail-row">
              <span className="k">Kernel Buffers</span>
              <strong className="text-mono">{formatNumber(mem.buffersMb)} MB</strong>
            </div>
            <div className="detail-row">
              <span className="k">RAM Rảnh / Khả dụng (Available)</span>
              <strong className="text-mono">{formatNumber(mem.freeMb)} MB / {formatNumber(mem.availableMb)} MB</strong>
            </div>
            <div className="detail-row">
              <span className="k">Hàng đợi trong RAM Node</span>
              <strong className="text-mono">
                {formatNumber(rt.queues?.trafficQueueSize)} HTTP · {formatNumber(rt.queues?.telemetryQueueSize)} UI · {formatNumber(rt.queues?.onlineCount)} online
              </strong>
            </div>
            {rt.cgroupMemoryMb != null ? (
              <div className="detail-row">
                <span className="k">Cgroup v2 Container RAM</span>
                <strong className="text-mono">
                  {rt.cgroupMemoryMb} MB {rt.cgroupLimitMb ? `/ ${rt.cgroupLimitMb} MB` : '(không giới hạn)'}
                </strong>
              </div>
            ) : null}
          </div>

          <h3 className="vps-sub-heading">V8 Heap Spaces ({rt.nodeVersion})</h3>
          <div className="vps-spaces-list">
            {heapSpaces.map((sp) => {
              const pct = sp.sizeMb > 0 ? Math.min(100, Math.round((sp.usedMb / sp.sizeMb) * 100)) : 0;
              return (
                <div className="vps-space-row" key={sp.name}>
                  <div className="vps-space-head">
                    <span>{SPACE_LABELS[sp.name] || sp.name}</span>
                    <span className="text-mono">{sp.usedMb} / {sp.sizeMb} MB</span>
                  </div>
                  <div className="rank-bar">
                    <div className="rank-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel-card">
          <div className="card-header card-header--wrap">
            <div>
              <h2 className="card-title">PostgreSQL & Dung Lượng Bảng</h2>
              <p className="card-subtitle">Theo dõi RAM Cache Hit, kết nối DB và các bảng phình lớn nhất</p>
            </div>
            {onOpenPurge ? (
              <button type="button" className="btn-purge-trigger" onClick={onOpenPurge}>
                <Icons.trash size={15} />
                <span>Dọn Nhật Ký Cũ</span>
              </button>
            ) : null}
          </div>

          {!db ? (
            <EmptyState message="Chưa kết nối PostgreSQL hoặc đang chạy ở chế độ không có DB." />
          ) : (
            <>
              <div className="vps-db-pills">
                <span className="breakdown-chip">
                  DB <strong>{db.databaseName}</strong>: <span className="chip-val">{db.sizeMb} MB</span>
                </span>
                <span className="breakdown-chip">
                  Cache Hit: <span className="chip-val">{formatPercent(db.cacheHitRatioPct)}</span>
                </span>
                <span className="breakdown-chip">
                  Kết nối: <span className="chip-val">{db.connections?.active || 0} active / {db.connections?.total || 0}</span>
                </span>
              </div>

              <div className="table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th scope="col">Tên bảng</th>
                      <th scope="col">Dung lượng</th>
                      <th scope="col">Số dòng</th>
                      <th scope="col">Dead tuples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(db.topTables || []).map((t) => (
                      <tr key={t.tableName}>
                        <td className="text-mono"><strong>{t.tableName}</strong></td>
                        <td className="text-mono">{t.totalMb} MB</td>
                        <td className="text-mono">{formatNumber(t.liveRows)}</td>
                        <td className="text-mono">{formatNumber(t.deadRows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {/* 5. Docker Containers + Storage + Host Services */}
      <section className="panel-card">
        <div className="card-header card-header--wrap">
          <div>
            <h2 className="card-title">Docker Containers & Dịch Vụ Máy Chủ</h2>
            <p className="card-subtitle">
              Tài nguyên từng container (`bdu-hub`, `postgres`, `bdu-bot`), dung lượng image/build cache và Caddy HTTPS.
            </p>
          </div>
          {services ? (
            <div className="filter-group">
              <span className={serviceBadgeClass(services.caddy)}>Caddy: {services.caddy}</span>
              <span className={serviceBadgeClass(services.docker)}>Docker: {services.docker}</span>
              <span className={serviceBadgeClass(services.fail2ban)}>Fail2ban: {services.fail2ban}</span>
              {services.certDaysRemaining != null ? (
                <span className="breakdown-chip">
                  Origin Cert: <span className="chip-val">{services.certDaysRemaining} ngày</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {!docker ? (
          <EmptyState
            title="Chưa có snapshot từ Host Agent VPS"
            message="Khi bdu-vps-agent chạy trên máy chủ Ubuntu và mount snapshot vào container, thông số từng Docker container và top tiến trình sẽ hiển thị đầy đủ tại đây."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">Container</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">CPU</th>
                    <th scope="col">RAM / Giới hạn</th>
                    <th scope="col">Net I/O</th>
                    <th scope="col">Block I/O</th>
                    <th scope="col">PIDs</th>
                  </tr>
                </thead>
                <tbody>
                  {(docker.containers || []).map((c) => (
                    <tr key={c.name}>
                      <td>
                        <div className="table-cell-stack">
                          <strong className="text-mono">{c.name}</strong>
                          <small className="text-muted-inline">{c.image}</small>
                        </div>
                      </td>
                      <td>
                        <span className={containerBadgeClass(c)}>{c.status || c.state}</span>
                      </td>
                      <td className="text-mono">{formatPercent(c.cpuPct)}</td>
                      <td className="text-mono">
                        {c.memUsedMb > 0 ? `${c.memUsedMb} MB (${formatPercent(c.memPct)})` : '--'}
                      </td>
                      <td className="text-mono">{c.netIO || '--'}</td>
                      <td className="text-mono">{c.blockIO || '--'}</td>
                      <td className="text-mono">{formatNumber(c.pids)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Array.isArray(docker.storage) && docker.storage.length > 0 ? (
              <div className="vps-storage-grid">
                {docker.storage.map((st) => (
                  <div className="sys-card" key={st.type}>
                    <span className="sys-label">Docker {st.type}</span>
                    <span className="sys-val text-mono">{st.size}</span>
                    <span className="sys-sub">
                      Đang dùng {st.active}/{st.total} · Dọn được: <strong>{st.reclaimable}</strong>
                    </span>
                  </div>
                ))}
                {dataDirs.slice(0, 4).map((dir) => (
                  <div className="sys-card" key={dir.name}>
                    <span className="sys-label">/data/{dir.name}</span>
                    <span className="sys-val text-mono">{dir.sizeMb} MB</span>
                    <span className="sys-sub">Thư mục lưu trữ host</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 6. Top Memory Processes & Safe Maintenance Commands */}
      <div className="two-col-row two-col-row--equal">
        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Top 10 Tiến Trình Ngốn RAM Nhất</h2>
              <p className="card-subtitle">Xác định chính xác tiến trình nào trên Ubuntu đang giữ bộ nhớ</p>
            </div>
          </div>

          {topProcesses.length === 0 ? (
            <EmptyState message="Danh sách tiến trình OS sẽ hiển thị khi có dữ liệu từ bdu-vps-agent." />
          ) : (
            <div className="table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">PID</th>
                    <th scope="col">Tiến trình</th>
                    <th scope="col">RSS RAM</th>
                    <th scope="col">% RAM</th>
                    <th scope="col">% CPU</th>
                  </tr>
                </thead>
                <tbody>
                  {topProcesses.map((p) => (
                    <tr key={`${p.pid}-${p.command}`}>
                      <td className="text-mono">{p.pid}</td>
                      <td><strong>{p.command}</strong></td>
                      <td className="text-mono">{p.rssMb} MB</td>
                      <td className="text-mono">{formatPercent(p.memPct)}</td>
                      <td className="text-mono">{formatPercent(p.cpuPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Lệnh Vận Hành & Giải Phóng Đĩa Nhanh</h2>
              <p className="card-subtitle">Sao chép để chạy qua SSH khi cần dọn build cache hoặc xem log production</p>
            </div>
          </div>

          <div className="vps-commands-list">
            {quickCommands.map((cmdObj) => (
              <div className="vps-cmd-row" key={cmdObj.id}>
                <div className="vps-cmd-meta">
                  <strong>{cmdObj.label}</strong>
                  <span>{cmdObj.description}</span>
                </div>
                <div className="detail-code-box">
                  <code>{cmdObj.command}</code>
                  <button
                    type="button"
                    className="btn-copy-code"
                    onClick={() => handleCopyCommand(cmdObj)}
                  >
                    {copiedId === cmdObj.id ? <Icons.check size={13} /> : <Icons.copy size={13} />}
                    <span>{copiedId === cmdObj.id ? 'Đã chép' : 'Chép'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
