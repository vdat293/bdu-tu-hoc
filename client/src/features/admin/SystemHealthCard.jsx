import { useState } from 'react';

export default function SystemHealthCard({ system, onPurgeLogs, isPurging }) {
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeDays, setPurgeDays] = useState(14);
  const [purgeResult, setPurgeResult] = useState(null);

  const server = system?.server || {};
  const memory = system?.memory || {};
  const realtime = system?.realtime || {};
  const database = system?.database || {};

  const formatUptime = (seconds = 0) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days} ngày ${hours} giờ ${mins} phút`;
    if (hours > 0) return `${hours} giờ ${mins} phút`;
    return `${mins} phút ${seconds % 60} giây`;
  };

  const handleConfirmPurge = async () => {
    if (!onPurgeLogs) return;
    const res = await onPurgeLogs(purgeDays);
    setPurgeResult(res);
    setTimeout(() => {
      setShowPurgeModal(false);
      setPurgeResult(null);
    }, 2500);
  };

  return (
    <div className="admin-panel system-health-panel">
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-title">Sức Khỏe Hệ Thống Máy Chủ (AWS VPS)</span>
          <span className="panel-subtitle">Tài nguyên Node.js runtime, bộ nhớ đệm và kết nối trực tiếp</span>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="btn-purge-action"
            onClick={() => setShowPurgeModal(true)}
          >
            🧹 Dọn Dẹp Log Cũ
          </button>
        </div>
      </div>

      <div className="system-metrics-grid">
        {/* Metric 1: Uptime & Platform */}
        <div className="system-metric-card">
          <div className="metric-label">Thời Gian Hoạt Động (Uptime)</div>
          <div className="metric-value">{formatUptime(server.uptimeSeconds)}</div>
          <div className="metric-sub">
            <span>Node {server.nodeVersion || process.version}</span> • <span>Platform {server.platform}</span>
          </div>
        </div>

        {/* Metric 2: Memory RSS & Heap */}
        <div className="system-metric-card">
          <div className="metric-label">Bộ Nhớ RAM Node.js (RSS)</div>
          <div className="metric-value">{memory.rssMb || 0} MB</div>
          <div className="metric-sub">
            <span>Heap: {memory.heapUsedMb || 0} / {memory.heapTotalMb || 0} MB</span>
          </div>
        </div>

        {/* Metric 3: WebSocket Realtime */}
        <div className="system-metric-card">
          <div className="metric-label">Kết Nối WebSocket Trực Tuyến</div>
          <div className="metric-value metric-highlight-green">
            ● {realtime.connected_clients || 0} sockets
          </div>
          <div className="metric-sub">
            <span>{realtime.active_rooms || 0} phòng hoạt động</span> • <span>{realtime.topology || 'single-node'}</span>
          </div>
        </div>

        {/* Metric 4: Database Storage */}
        <div className="system-metric-card">
          <div className="metric-label">Lưu Trữ Log Trong Database</div>
          <div className="metric-value">
            {(database.totalLogs || 0).toLocaleString()} logs
          </div>
          <div className="metric-sub">
            <span>Hàng đợi bộ đệm: {system?.bufferQueueSize || 0} items</span>
          </div>
        </div>
      </div>

      {/* Modal xác nhận dọn dẹp log */}
      {showPurgeModal && (
        <div className="admin-modal-overlay" onClick={() => !isPurging && setShowPurgeModal(false)}>
          <div className="admin-modal-container purge-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Dọn Dẹp Bản Ghi Log Cũ</span>
              <button
                type="button"
                className="btn-modal-close"
                disabled={isPurging}
                onClick={() => setShowPurgeModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Hệ thống định kỳ tự động giữ lại log trong 14 ngày. Nếu bạn muốn giải phóng dung lượng đĩa trên AWS VPS ngay lập tức, hãy chọn mốc thời gian bên dưới để xóa các bản ghi cũ hơn:
              </p>

              <div className="purge-options">
                {[7, 14, 30].map((d) => (
                  <label key={d} className={`purge-radio-card ${purgeDays === d ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="purgeDays"
                      value={d}
                      checked={purgeDays === d}
                      onChange={() => setPurgeDays(d)}
                    />
                    <div className="radio-text">
                      <strong>Cũ hơn {d} ngày</strong>
                      <span>Giữ lại {d} ngày gần nhất</span>
                    </div>
                  </label>
                ))}
              </div>

              {purgeResult && (
                <div className="purge-success-alert">
                  ✓ {purgeResult.message || 'Dọn dẹp log thành công.'}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary-action"
                disabled={isPurging}
                onClick={() => setShowPurgeModal(false)}
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                className="btn-danger-action"
                disabled={isPurging}
                onClick={handleConfirmPurge}
              >
                {isPurging ? 'Đang dọn dẹp...' : `Xóa Log Cũ Hơn ${purgeDays} Ngày`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
