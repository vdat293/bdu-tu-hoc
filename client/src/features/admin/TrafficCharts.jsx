import { useEffect, useRef } from 'react';

export default function TrafficCharts({ timeline, endpoints, devices, isLoading }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let chartInstance;
    let cancelled = false;

    if (!timeline || timeline.length === 0 || !canvasRef.current) return;

    import('chart.js/auto').then(({ default: Chart }) => {
      if (cancelled || !canvasRef.current) return;

      const isDark = document.body.classList.contains('theme-dark');
      const textColor = isDark ? '#c0b8ae' : '#475569';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

      const labels = timeline.map((item) => {
        const d = new Date(item.time);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) +
          (timeline.length > 24 ? ` (${d.getDate()}/${d.getMonth() + 1})` : '');
      });

      const totalData = timeline.map((item) => item.total);
      const errorData = timeline.map((item) => item.error);
      const latencyData = timeline.map((item) => item.avgLatency);

      chartInstance = new Chart(canvasRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Tổng Yêu Cầu (Requests)',
              data: totalData,
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              fill: true,
              tension: 0.35,
              yAxisID: 'yRequests',
              pointRadius: timeline.length > 30 ? 2 : 4,
              pointHoverRadius: 6
            },
            {
              label: 'Yêu Cầu Lỗi (Errors 4xx/5xx)',
              data: errorData,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              fill: true,
              tension: 0.35,
              yAxisID: 'yRequests',
              pointRadius: timeline.length > 30 ? 2 : 4,
              pointHoverRadius: 6
            },
            {
              label: 'Độ Trễ TB (ms)',
              data: latencyData,
              borderColor: '#10b981',
              borderDash: [4, 4],
              backgroundColor: 'transparent',
              tension: 0.2,
              yAxisID: 'yLatency',
              pointRadius: 2,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: { color: textColor, font: { family: 'inherit', size: 12 } }
            },
            tooltip: {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              titleColor: isDark ? '#f8fafc' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? '#334155' : '#e2e8f0',
              borderWidth: 1,
              padding: 10
            }
          },
          scales: {
            x: {
              ticks: { color: textColor, maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
              grid: { color: gridColor }
            },
            yRequests: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              ticks: { color: textColor, precision: 0 },
              grid: { color: gridColor },
              title: { display: true, text: 'Số lượng yêu cầu', color: textColor }
            },
            yLatency: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              ticks: { color: textColor, callback: (v) => `${v}ms` },
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Độ trễ (ms)', color: textColor }
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      if (chartInstance) chartInstance.destroy();
    };
  }, [timeline]);

  const maxEndpointCount = Math.max(...(endpoints || []).map((e) => e.count), 1);

  return (
    <div className="admin-charts-grid">
      {/* Biểu đồ lưu lượng thời gian thực */}
      <div className="admin-chart-panel chart-main-timeline">
        <div className="panel-header">
          <div className="panel-title-group">
            <span className="panel-title">Biểu Đồ Lưu Lượng Theo Thời Gian</span>
            <span className="panel-subtitle">Lượt truy cập, phản hồi lỗi và biến động độ trễ (ms)</span>
          </div>
        </div>
        <div className="chart-canvas-container" style={{ height: '320px', position: 'relative' }}>
          {isLoading && (!timeline || timeline.length === 0) ? (
            <div className="chart-loading-placeholder">Đang tải dữ liệu biểu đồ...</div>
          ) : timeline && timeline.length > 0 ? (
            <canvas ref={canvasRef} />
          ) : (
            <div className="chart-empty-placeholder">Chưa có dữ liệu lưu lượng trong khoảng thời gian đã chọn.</div>
          )}
        </div>
      </div>

      {/* Top Endpoints & Tính năng */}
      <div className="admin-chart-panel chart-endpoints-panel">
        <div className="panel-header">
          <div className="panel-title-group">
            <span className="panel-title">Top Tuyến Đường & API</span>
            <span className="panel-subtitle">Các tính năng được sử dụng nhiều nhất</span>
          </div>
        </div>
        <div className="endpoints-list-container">
          {(!endpoints || endpoints.length === 0) ? (
            <div className="chart-empty-placeholder">Chưa có dữ liệu API</div>
          ) : (
            endpoints.slice(0, 8).map((ep, idx) => {
              const pct = Math.round((ep.count / maxEndpointCount) * 100);
              const isErrorHeavy = ep.errorCount > 0 && (ep.errorCount / ep.count) > 0.1;
              return (
                <div className="endpoint-item" key={`${ep.method}-${ep.path}-${idx}`}>
                  <div className="endpoint-meta">
                    <span className={`method-tag method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="endpoint-path" title={ep.path}>{ep.path}</span>
                    <span className="endpoint-count">{ep.count.toLocaleString()} req</span>
                  </div>
                  <div className="endpoint-bar-wrapper">
                    <div
                      className={`endpoint-progress-bar ${isErrorHeavy ? 'bar-error' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="endpoint-subinfo">
                    <span className="endpoint-latency">⏱ {ep.avgLatency} ms</span>
                    {ep.errorCount > 0 && (
                      <span className="endpoint-errors">⚠ {ep.errorCount} lỗi</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Phân bố Thiết Bị & Nền Tảng */}
      <div className="admin-chart-panel chart-devices-panel">
        <div className="panel-header">
          <div className="panel-title-group">
            <span className="panel-title">Thiết Bị & Nền Tảng</span>
            <span className="panel-subtitle">Tỷ lệ truy cập từ Mobile / Desktop / OS</span>
          </div>
        </div>
        <div className="devices-breakdown-container">
          <div className="device-types-row">
            {(devices?.devices || []).map((dev) => {
              const icon = dev.name === 'mobile' ? '📱' : dev.name === 'tablet' ? '📟' : dev.name === 'bot' ? '🤖' : '💻';
              const label = dev.name === 'mobile' ? 'Mobile' : dev.name === 'tablet' ? 'Tablet' : dev.name === 'bot' ? 'Bot' : 'Desktop';
              return (
                <div className="device-type-card" key={dev.name}>
                  <span className="device-icon">{icon}</span>
                  <div className="device-info">
                    <span className="device-label">{label}</span>
                    <span className="device-count">{dev.count.toLocaleString()} req</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="breakdown-subgroups">
            <div className="breakdown-group">
              <span className="breakdown-title">Hệ Điều Hành</span>
              <div className="breakdown-tags">
                {(devices?.os || []).map((o) => (
                  <div className="breakdown-pill" key={o.name}>
                    <span className="pill-name">{o.name}</span>
                    <span className="pill-count">{o.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="breakdown-group">
              <span className="breakdown-title">Trình Duyệt</span>
              <div className="breakdown-tags">
                {(devices?.browsers || []).map((b) => (
                  <div className="breakdown-pill" key={b.name}>
                    <span className="pill-name">{b.name}</span>
                    <span className="pill-count">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
