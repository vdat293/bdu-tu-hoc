import { useState } from 'react';

export default function DetailedLogsTable({
  logsData,
  filters,
  onFilterChange,
  isLoading
}) {
  const [selectedLog, setSelectedLog] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const logs = logsData?.logs || [];
  const pagination = logsData?.pagination || { total: 0, page: 1, limit: 50, totalPages: 1 };

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getStatusClass = (code) => {
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400 && code < 500) return 'status-4xx';
    return 'status-5xx';
  };

  const getLatencyClass = (ms) => {
    if (ms < 150) return 'latency-fast';
    if (ms < 400) return 'latency-med';
    return 'latency-slow';
  };

  return (
    <div className="admin-panel detailed-logs-panel" id="detailed-logs-section">
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-title">Nhật Ký Truy Cập Chi Tiết (Access Logs)</span>
          <span className="panel-subtitle">Theo dõi trực tiếp từng yêu cầu HTTP gửi đến hệ thống</span>
        </div>
        <div className="panel-actions">
          <span className="logs-count-indicator">
            Tổng cộng: <strong>{pagination.total.toLocaleString()}</strong> bản ghi
          </span>
        </div>
      </div>

      {/* Thanh công cụ lọc & tìm kiếm */}
      <div className="logs-toolbar">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="admin-search-input"
            placeholder="Tìm theo đường dẫn, MSSV, địa chỉ IP hoặc lỗi..."
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
          />
          {filters.search && (
            <button
              type="button"
              className="btn-clear-search"
              onClick={() => onFilterChange({ search: '', page: 1 })}
            >
              ✕
            </button>
          )}
        </div>

        {/* Bộ lọc trạng thái */}
        <div className="filter-pills-group">
          <span className="filter-label">Mã HTTP:</span>
          {['all', '2xx', '3xx', '4xx', '5xx'].map((st) => (
            <button
              key={st}
              type="button"
              className={`filter-pill ${filters.status === st ? 'active' : ''}`}
              onClick={() => onFilterChange({ status: st, page: 1 })}
            >
              {st === 'all' ? 'Tất cả' : st.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Bộ lọc phương thức */}
        <div className="filter-pills-group">
          <span className="filter-label">Method:</span>
          {['all', 'GET', 'POST', 'PUT', 'DELETE'].map((m) => (
            <button
              key={m}
              type="button"
              className={`filter-pill ${filters.method === m ? 'active' : ''}`}
              onClick={() => onFilterChange({ method: m, page: 1 })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Hiển thị tag lọc MSSV nếu đang được chọn */}
      {filters.mssv && (
        <div className="active-filter-tags">
          <div className="filter-tag">
            <span>Đang lọc theo MSSV: <strong>{filters.mssv}</strong></span>
            <button
              type="button"
              className="btn-remove-tag"
              onClick={() => onFilterChange({ mssv: '', page: 1 })}
            >
              ✕ Bỏ lọc
            </button>
          </div>
        </div>
      )}

      {/* Bảng dữ liệu nhật ký */}
      <div className="table-responsive-wrapper">
        <table className="admin-table logs-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>Thời Gian</th>
              <th style={{ width: '80px' }}>Method</th>
              <th>Đường Dẫn (Path)</th>
              <th style={{ width: '90px' }}>Status</th>
              <th style={{ width: '100px' }}>Độ Trễ</th>
              <th style={{ width: '130px' }}>Sinh Viên</th>
              <th style={{ width: '140px' }}>IP / Thiết Bị</th>
              <th style={{ width: '80px', textAlign: 'center' }}>Chi Tiết</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && logs.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-loading-cell">Đang tải danh sách nhật ký...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">Không tìm thấy bản ghi log nào phù hợp với bộ lọc.</td>
              </tr>
            ) : (
              logs.map((log) => {
                const d = new Date(log.createdAt);
                const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const dateStr = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });

                return (
                  <tr
                    key={log.id}
                    className={`log-row ${log.statusCode >= 400 ? 'row-has-error' : ''}`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <td>
                      <div className="log-time-cell">
                        <span className="log-time-clock">{timeStr}</span>
                        <span className="log-time-date">{dateStr}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`method-tag method-${log.method.toLowerCase()}`}>
                        {log.method}
                      </span>
                    </td>
                    <td>
                      <div className="log-path-cell">
                        <span className="log-path-text" title={log.path}>
                          {log.path}
                        </span>
                        {log.errorMessage && (
                          <span className="log-error-pill" title={log.errorMessage}>
                            ⚠ {log.errorMessage}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${getStatusClass(log.statusCode)}`}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td>
                      <span className={`latency-pill ${getLatencyClass(log.responseTimeMs)}`}>
                        {log.responseTimeMs} ms
                      </span>
                    </td>
                    <td>
                      {log.mssv ? (
                        <div className="log-user-badge" title={log.fullName || log.mssv}>
                          <span className="log-mssv">{log.mssv}</span>
                        </div>
                      ) : (
                        <span className="text-muted-clean">Khách / Ẩn danh</span>
                      )}
                    </td>
                    <td>
                      <div className="log-client-cell">
                        <span className="log-ip">{log.ipAddress || '127.0.0.1'}</span>
                        <span className="log-device-meta">
                          {log.os !== 'Unknown' ? log.os : ''} {log.browser !== 'Unknown' ? `• ${log.browser}` : ''}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn-view-log"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        title="Xem chi tiết nhật ký"
                      >
                        👁
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      <div className="logs-pagination-bar">
        <div className="pagination-info">
          Trang <strong>{pagination.page}</strong> / <strong>{pagination.totalPages}</strong> (Hiển thị {logs.length} dòng)
        </div>
        <div className="pagination-controls">
          <button
            type="button"
            className="btn-page"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => onFilterChange({ page: pagination.page - 1 })}
          >
            ◀ Trang trước
          </button>
          <button
            type="button"
            className="btn-page"
            disabled={pagination.page >= pagination.totalPages || isLoading}
            onClick={() => onFilterChange({ page: pagination.page + 1 })}
          >
            Trang sau ▶
          </button>
          <select
            className="admin-select-limit"
            value={filters.limit || 50}
            onChange={(e) => onFilterChange({ limit: Number(e.target.value), page: 1 })}
          >
            <option value="25">25 dòng/trang</option>
            <option value="50">50 dòng/trang</option>
            <option value="100">100 dòng/trang</option>
          </select>
        </div>
      </div>

      {/* Modal chi tiết Log khi bấm xem */}
      {selectedLog && (
        <div className="admin-modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="admin-modal-container log-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-title">Chi Tiết Nhật Ký Yêu Cầu #{selectedLog.id}</span>
                <span className="modal-subtitle">
                  {new Date(selectedLog.createdAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setSelectedLog(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-meta-grid">
                <div className="detail-item">
                  <span className="detail-label">Phương thức:</span>
                  <span className={`method-tag method-${selectedLog.method.toLowerCase()}`}>
                    {selectedLog.method}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Mã HTTP:</span>
                  <span className={`status-pill ${getStatusClass(selectedLog.statusCode)}`}>
                    {selectedLog.statusCode}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Thời gian xử lý:</span>
                  <span className={`latency-pill ${getLatencyClass(selectedLog.responseTimeMs)}`}>
                    {selectedLog.responseTimeMs} ms
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Sinh viên:</span>
                  <span className="detail-value">
                    {selectedLog.mssv ? `${selectedLog.mssv} (${selectedLog.fullName || 'BDU'})` : 'Chưa đăng nhập'}
                  </span>
                </div>
              </div>

              <div className="detail-section">
                <span className="detail-label">Đường dẫn đầy đủ:</span>
                <div className="code-box-wrapper">
                  <code className="detail-code-box">{selectedLog.path}</code>
                  <button
                    type="button"
                    className="btn-copy-mini"
                    onClick={() => handleCopy(selectedLog.path, 'path')}
                  >
                    {copiedKey === 'path' ? '✓ Đã sao chép' : '📋 Chép'}
                  </button>
                </div>
              </div>

              {selectedLog.errorMessage && (
                <div className="detail-section error-section">
                  <span className="detail-label text-danger">Thông báo lỗi ghi nhận:</span>
                  <div className="error-alert-box">
                    {selectedLog.errorMessage}
                  </div>
                </div>
              )}

              <div className="detail-section">
                <span className="detail-label">Địa chỉ IP & Thiết bị:</span>
                <div className="client-detail-box">
                  <div className="client-detail-row">
                    <span>IP Client: <strong>{selectedLog.ipAddress || 'Không xác định'}</strong></span>
                    <button
                      type="button"
                      className="btn-copy-mini"
                      onClick={() => handleCopy(selectedLog.ipAddress, 'ip')}
                    >
                      {copiedKey === 'ip' ? '✓ Đã sao chép' : '📋 Chép IP'}
                    </button>
                  </div>
                  <div className="client-detail-row">
                    <span>Nền tảng: <strong>{selectedLog.deviceType}</strong> • OS: <strong>{selectedLog.os}</strong> • Trình duyệt: <strong>{selectedLog.browser}</strong></span>
                  </div>
                  {selectedLog.referrer && (
                    <div className="client-detail-row">
                      <span>Nguồn (Referrer): <code className="detail-mini-code">{selectedLog.referrer}</code></span>
                    </div>
                  )}
                  {selectedLog.userAgent && (
                    <div className="client-detail-row ua-row">
                      <span className="ua-label">User-Agent:</span>
                      <p className="ua-text">{selectedLog.userAgent}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {selectedLog.mssv && (
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => {
                    onFilterChange({ mssv: selectedLog.mssv, page: 1 });
                    setSelectedLog(null);
                  }}
                >
                  🔍 Lọc tất cả log của {selectedLog.mssv}
                </button>
              )}
              <button
                type="button"
                className="btn-primary-action"
                onClick={() => setSelectedLog(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
