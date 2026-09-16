export default function TrafficOverviewCards({ overview, isLoading }) {
  const data = overview || {};
  const total = data.totalRequests || 0;
  const uniqueMssv = data.uniqueMssv || 0;
  const uniqueUsers = data.uniqueUsers || 0;
  const avgLatency = data.avgResponseTime || 0;
  const errorRate = data.errorRate || 0;
  const growth = data.requestGrowth || 0;
  const status = data.statusBreakdown || {};

  return (
    <div className="admin-overview-grid">
      {/* Card 1: Tổng lượt yêu cầu */}
      <div className="admin-stat-card">
        <div className="stat-header">
          <span className="stat-title">Tổng Lượt Yêu Cầu</span>
          <div className="stat-icon-wrapper icon-blue">
            <span className="stat-icon">⚡</span>
          </div>
        </div>
        <div className="stat-body">
          <div className="stat-main-value">
            {isLoading ? <span className="stat-skeleton">...</span> : total.toLocaleString()}
          </div>
          <div className="stat-sub-text">
            {growth !== 0 ? (
              <span className={`stat-trend ${growth > 0 ? 'trend-up' : 'trend-down'}`}>
                {growth > 0 ? `▲ +${growth}%` : `▼ ${growth}%`}
              </span>
            ) : (
              <span className="stat-trend trend-neutral">■ 0%</span>
            )}
            <span className="stat-sub-label">so với chu kỳ trước</span>
          </div>
        </div>
        <div className="stat-footer-bar">
          <div className="status-micro-badges">
            <span className="badge-micro badge-micro-2xx">2xx: {status['2xx'] || 0}</span>
            <span className="badge-micro badge-micro-4xx">4xx: {status['4xx'] || 0}</span>
            <span className="badge-micro badge-micro-5xx">5xx: {status['5xx'] || 0}</span>
          </div>
        </div>
      </div>

      {/* Card 2: Sinh viên & Người dùng hoạt động */}
      <div className="admin-stat-card">
        <div className="stat-header">
          <span className="stat-title">Sinh Viên Hoạt Động</span>
          <div className="stat-icon-wrapper icon-purple">
            <span className="stat-icon">👥</span>
          </div>
        </div>
        <div className="stat-body">
          <div className="stat-main-value">
            {isLoading ? <span className="stat-skeleton">...</span> : uniqueMssv.toLocaleString()}
          </div>
          <div className="stat-sub-text">
            <span className="stat-highlight">{uniqueUsers.toLocaleString()}</span>
            <span className="stat-sub-label">tổng phiên / thiết bị duy nhất</span>
          </div>
        </div>
        <div className="stat-footer-bar">
          <span className="stat-note-badge">Tài khoản sinh viên BDU xác thực</span>
        </div>
      </div>

      {/* Card 3: Độ trễ phản hồi trung bình */}
      <div className="admin-stat-card">
        <div className="stat-header">
          <span className="stat-title">Độ Trễ Phản Hồi TB</span>
          <div className="stat-icon-wrapper icon-green">
            <span className="stat-icon">⏱</span>
          </div>
        </div>
        <div className="stat-body">
          <div className="stat-main-value">
            {isLoading ? <span className="stat-skeleton">...</span> : `${avgLatency} ms`}
          </div>
          <div className="stat-sub-text">
            <span className={`latency-status ${avgLatency < 150 ? 'latency-good' : avgLatency < 400 ? 'latency-moderate' : 'latency-slow'}`}>
              {avgLatency < 150 ? '● Tuyệt vời (<150ms)' : avgLatency < 400 ? '● Bình thường' : '● Cần tối ưu (>400ms)'}
            </span>
          </div>
        </div>
        <div className="stat-footer-bar">
          <span className="stat-sub-label">Đo từ gateway Express trên AWS</span>
        </div>
      </div>

      {/* Card 4: Tỷ lệ lỗi */}
      <div className="admin-stat-card">
        <div className="stat-header">
          <span className="stat-title">Tỷ Lệ Yêu Cầu Lỗi</span>
          <div className="stat-icon-wrapper icon-amber">
            <span className="stat-icon">🛡</span>
          </div>
        </div>
        <div className="stat-body">
          <div className="stat-main-value">
            {isLoading ? <span className="stat-skeleton">...</span> : `${errorRate}%`}
          </div>
          <div className="stat-sub-text">
            <span className={`stat-trend ${errorRate <= 2 ? 'trend-up' : errorRate <= 5 ? 'trend-warning' : 'trend-down'}`}>
              {errorRate <= 2 ? 'Ổn định (<2%)' : errorRate <= 5 ? 'Cảnh báo (2-5%)' : 'Cao (>5%)'}
            </span>
            <span className="stat-sub-label">yêu cầu HTTP 4xx / 5xx</span>
          </div>
        </div>
        <div className="stat-footer-bar">
          <span className="stat-sub-label">Bao gồm lỗi xác thực và kết nối</span>
        </div>
      </div>
    </div>
  );
}
