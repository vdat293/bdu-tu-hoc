import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminApi } from '../api/adminApi.js';
import {
  cappedRangeText,
  compactCount,
  formatCohortDay,
  formatNumber,
  formatPercent,
  labelForTimeRange,
  safeNumber
} from '../utils/format.js';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { Icons } from '../components/Icons.jsx';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/StateBlocks.jsx';

const HEATMAP_WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

const DEVICE_META = {
  mobile: { label: 'Mobile', Icon: Icons.smartphone },
  tablet: { label: 'Tablet', Icon: Icons.tablet },
  bot: { label: 'Bot', Icon: Icons.bot },
  desktop: { label: 'Desktop', Icon: Icons.monitor }
};

export default function FlowsInsightsPage({ timeRange, refreshMs, theme }) {
  const pollMs = refreshMs > 0 ? refreshMs : false;

  const flowsQuery = useQuery({
    queryKey: ['admin-interactions-flows', timeRange],
    queryFn: ({ signal }) => AdminApi.getInteractionsFlows({ timeRange, limit: 15 }, signal),
    refetchInterval: pollMs
  });

  const hoursQuery = useQuery({
    queryKey: ['admin-insights-hours', timeRange],
    queryFn: ({ signal }) => AdminApi.getInsightsHours(timeRange, signal),
    refetchInterval: pollMs
  });

  const cohortQuery = useQuery({
    queryKey: ['admin-insights-cohort', timeRange],
    queryFn: ({ signal }) => AdminApi.getInsightsCohort(timeRange, signal),
    refetchInterval: pollMs
  });

  const devicesQuery = useQuery({
    queryKey: ['admin-devices', timeRange],
    queryFn: ({ signal }) => AdminApi.getDevices(timeRange, signal),
    refetchInterval: pollMs
  });

  const entryPages = Array.isArray(flowsQuery.data?.entryPages) ? flowsQuery.data.entryPages : [];
  const transitions = Array.isArray(flowsQuery.data?.transitions) ? flowsQuery.data.transitions : [];
  const maxEntry = Math.max(...entryPages.map((e) => safeNumber(e.count)), 1);

  // Heatmap matrix normalization
  const hoursData = hoursQuery.data;
  const weekdays = Array.isArray(hoursData?.weekdays) && hoursData.weekdays.length === 7
    ? hoursData.weekdays
    : HEATMAP_WEEKDAYS;
  const matrix = useMemo(() => (
    Array.from({ length: 7 }, (_, d) => {
      const row = Array.isArray(hoursData?.matrix?.[d]) ? hoursData.matrix[d] : [];
      return Array.from({ length: 24 }, (_, h) => safeNumber(row[h]));
    })
  ), [hoursData]);

  const heatmapTotal = useMemo(
    () => matrix.reduce((sum, row) => sum + row.reduce((rs, v) => rs + v, 0), 0),
    [matrix]
  );
  const heatmapMax = useMemo(
    () => matrix.reduce((m, row) => Math.max(m, ...row), 0),
    [matrix]
  );
  const peak = hoursData?.peak || { weekday: 0, hour: 0, count: 0 };
  const peakText = safeNumber(peak.count) > 0
    ? `${weekdays[safeNumber(peak.weekday)] || ''} lúc ${String(safeNumber(peak.hour)).padStart(2, '0')}:00 với ${formatNumber(peak.count)} lượt`
    : 'chưa có đỉnh rõ ràng';
  const heatmapCapNote = hoursData ? cappedRangeText(hoursData, timeRange, 'lưới giờ × thứ sẽ không còn đọc được') : '';

  // Cohort Chart.js configuration
  const cohortData = cohortQuery.data;
  const dayBuckets = useMemo(
    () => (Array.isArray(cohortData?.dayBuckets) ? cohortData.dayBuckets : []),
    [cohortData?.dayBuckets]
  );
  const cohortCapNote = cohortData ? cappedRangeText(cohortData, timeRange, 'dải ngày sẽ kéo dài vô độ') : '';

  const isDark = theme === 'dark';
  const textColor = isDark ? '#94A3B8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';

  const cohortChart = useMemo(() => ({
    labels: dayBuckets.map((b) => formatCohortDay(b?.date)),
    datasets: [
      {
        label: 'Hoạt động',
        data: dayBuckets.map((b) => safeNumber(b?.active)),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'Hoạt động lần đầu trong kỳ',
        data: dayBuckets.map((b) => safeNumber(b?.new)),
        borderColor: '#15803D',
        backgroundColor: 'transparent',
        borderDash: [4, 4],
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'Quay lại',
        data: dayBuckets.map((b) => safeNumber(b?.returning)),
        borderColor: '#D97706',
        backgroundColor: 'transparent',
        tension: 0.35,
        pointRadius: 2
      }
    ]
  }), [dayBuckets]);

  const cohortOptions = useMemo(() => ({
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
      }
    },
    scales: {
      x: { ticks: { color: textColor, maxTicksLimit: 12 }, grid: { color: gridColor } },
      y: { beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } }
    }
  }), [textColor, gridColor]);

  // Devices
  const devData = devicesQuery.data;
  const devices = Array.isArray(devData?.devices) ? devData.devices : [];
  const totalDevices = devices.reduce((s, d) => s + safeNumber(d.count), 0);
  const osList = Array.isArray(devData?.os) ? devData.os : [];
  const browserList = Array.isArray(devData?.browsers) ? devData.browsers : [];

  return (
    <div className="admin-page-stack">
      {/* 1. Navigation Flows */}
      <div className="two-col-row two-col-row--equal">
        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Trang Sinh Viên Mở Đầu Tiên (Entry Pages)</h2>
              <p className="card-subtitle">
                Điểm bắt đầu của mỗi phiên truy cập trong {labelForTimeRange(timeRange).toLowerCase()}
              </p>
            </div>
          </div>

          {flowsQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : flowsQuery.isError ? (
            <ErrorState message={flowsQuery.error?.message} onRetry={() => flowsQuery.refetch()} />
          ) : entryPages.length === 0 ? (
            <EmptyState message="Chưa có dữ liệu điểm vào phiên trong mốc thời gian này." />
          ) : (
            <ul className="element-rank-list">
              {entryPages.map((item) => {
                const barPct = Math.min(100, Math.round((safeNumber(item.count) / maxEntry) * 100));
                return (
                  <li className="element-rank-item" key={item.pagePath}>
                    <div className="element-rank-head">
                      <span className="element-rank-label">{item.pageTitle}</span>
                      <span className="route-code">{item.pagePath}</span>
                    </div>
                    <div className="element-rank-bar-row">
                      <div className="rank-bar">
                        <div className="rank-bar-fill" style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="element-rank-stats text-mono">
                        {formatNumber(item.count)} phiên · {formatPercent(safeNumber(item.share) * 100)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Luồng Chuyển Trang Phổ Biến Nhất</h2>
              <p className="card-subtitle">
                Cách sinh viên di chuyển liên tiếp từ trang này sang trang khác trong cùng một phiên
              </p>
            </div>
          </div>

          {flowsQuery.isLoading ? (
            <SkeletonBlock rows={5} />
          ) : flowsQuery.isError ? (
            <ErrorState message={flowsQuery.error?.message} onRetry={() => flowsQuery.refetch()} />
          ) : transitions.length === 0 ? (
            <EmptyState message="Chưa đủ dữ liệu chuyển trang liên tiếp trong mốc thời gian này." />
          ) : (
            <ol className="flow-list">
              {transitions.map((t, idx) => (
                <li className="flow-row" key={`${t.fromPath}-${t.toPath}-${idx}`}>
                  <div className="flow-nodes">
                    <span className="flow-node" title={t.fromPath}>{t.fromTitle}</span>
                    <span className="flow-arrow" aria-hidden="true">→</span>
                    <span className="flow-node flow-node--to" title={t.toPath}>{t.toTitle}</span>
                  </div>
                  <div className="flow-metrics text-mono">
                    <strong>{formatNumber(t.count)}</strong>
                    <span>({formatPercent(safeNumber(t.share) * 100)})</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* 2. Heatmap 7x24 */}
      <section className="panel-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Sinh Viên Hoạt Động Vào Khung Giờ Nào?</h2>
            <p className="card-subtitle">
              Lưới 7 ngày × 24 giờ theo giờ Việt Nam; mỗi ô đều hiển thị số lượt, kèm bảng số dự phòng bên dưới.
            </p>
          </div>
        </div>

        <div id="hours-heatmap">
          {hoursQuery.isLoading ? (
            <SkeletonBlock rows={4} />
          ) : hoursQuery.isError ? (
            <ErrorState message={hoursQuery.error?.message} onRetry={() => hoursQuery.refetch()} />
          ) : heatmapTotal <= 0 ? (
            <EmptyState
              message="Chưa có lượt truy cập nào để dựng nhiệt đồ."
              hint="Chọn mốc thời gian rộng hơn (7D hoặc 30D) ở thanh trên."
            />
          ) : (
            <>
              <div className="heatmap-legend">
                <span className="heatmap-legend-title">Ít hơn</span>
                {[0, 1, 2, 3, 4, 5].map((lv) => (
                  <span key={lv} className={`heatmap-swatch heatmap-lv${lv}`} />
                ))}
                <span className="heatmap-legend-title">Nhiều hơn</span>
              </div>

              <div className="table-scroll">
                <div
                  className="heatmap-grid"
                  role="img"
                  aria-label={`Nhiệt đồ lượt truy cập theo 7 ngày và 24 giờ, tổng ${formatNumber(heatmapTotal)} lượt. Khung giờ cao điểm nhất: ${peakText}.`}
                >
                  <span className="heatmap-label" />
                  {Array.from({ length: 24 }, (_, h) => (
                    <span className="heatmap-hour" key={h}>{h % 3 === 0 ? h : ''}</span>
                  ))}
                  {matrix.map((row, day) => (
                    <FragmentRow
                      key={day}
                      day={day}
                      weekday={weekdays[day] || `Thứ ${day + 2}`}
                      row={row}
                      max={heatmapMax}
                      peakDay={safeNumber(peak.weekday)}
                      peakHour={safeNumber(peak.hour)}
                    />
                  ))}
                </div>
              </div>

              <p className="card-subtitle" style={{ marginTop: '10px' }}>
                Ô viền đậm là khung giờ cao điểm nhất: {peakText}.
              </p>
              {heatmapCapNote ? <p className="card-subtitle" style={{ marginTop: '4px' }}>{heatmapCapNote}</p> : null}

              <details className="insight-details">
                <summary className="insight-details-summary">Xem dạng bảng số (7 ngày × 24 giờ)</summary>
                <div id="hours-heatmap-table" className="table-scroll">
                  <table className="admin-data-table heatmap-numbers">
                    <caption className="sr-only">Số lượt truy cập theo từng giờ trong tuần</caption>
                    <thead>
                      <tr>
                        <th scope="col">Thứ</th>
                        {Array.from({ length: 24 }, (_, h) => (
                          <th scope="col" key={h}>{String(h).padStart(2, '0')}</th>
                        ))}
                        <th scope="col">Tổng</th>
                        <th scope="col">Giờ cao nhất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((row, day) => {
                        const rowTotal = row.reduce((s, v) => s + v, 0);
                        let bestHour = 0;
                        row.forEach((v, h) => {
                          if (v > row[bestHour]) bestHour = h;
                        });
                        return (
                          <tr key={day}>
                            <th scope="row">{weekdays[day]}</th>
                            {row.map((val, h) => <td key={h}>{formatNumber(val)}</td>)}
                            <td><strong>{formatNumber(rowTotal)}</strong></td>
                            <td className="heatmap-peak-hour">
                              {String(bestHour).padStart(2, '0')}:00 ({formatNumber(row[bestHour])})
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      </section>

      {/* 3. Cohort + Devices */}
      <div className="two-col-row two-col-row--equal">
        <section className="panel-card" id="cohort-chart">
          <div className="card-header">
            <div>
              <h2 className="card-title">Người Dùng Có Quay Lại Không?</h2>
              <p className="card-subtitle">Số lượng sinh viên mới (cả kỳ), quay lại và tỷ lệ gắn kết DAU/WAU</p>
            </div>
          </div>

          {cohortQuery.isLoading ? (
            <SkeletonBlock rows={4} />
          ) : cohortQuery.isError ? (
            <ErrorState message={cohortQuery.error?.message} onRetry={() => cohortQuery.refetch()} />
          ) : dayBuckets.length === 0 ? (
            <EmptyState
              message="Chưa có dữ liệu hoạt động theo ngày."
              hint="Cần ít nhất một ngày có sinh viên đăng nhập trong mốc thời gian đang chọn."
            />
          ) : (
            <>
              <div className="cohort-stat-row">
                {[
                  { label: 'Trong kỳ', value: formatNumber(cohortData?.totals?.active) },
                  { label: 'Mới (cả kỳ)', value: formatNumber(cohortData?.totals?.new) },
                  { label: 'Quay lại', value: formatNumber(cohortData?.totals?.returning) },
                  { label: 'DAU', value: formatNumber(cohortData?.stickiness?.dau) },
                  { label: 'WAU', value: formatNumber(cohortData?.stickiness?.wau) },
                  { label: 'DAU/WAU', value: formatPercent(safeNumber(cohortData?.stickiness?.ratio) * 100) },
                  { label: 'Quay lại 7 ngày', value: formatPercent(safeNumber(cohortData?.returnRate7d) * 100) }
                ].map((stat) => (
                  <div className="cohort-stat" key={stat.label}>
                    <span className="cohort-stat-label">{stat.label}</span>
                    <span className="cohort-stat-value">{stat.value}</span>
                  </div>
                ))}
              </div>
              <ChartCanvas
                type="line"
                data={cohortChart}
                options={cohortOptions}
                ariaLabel="Số người dùng hoạt động, hoạt động lần đầu trong kỳ và quay lại theo từng ngày."
                height={250}
              />
              <p className="card-subtitle" style={{ marginTop: '10px' }}>
                Chuỗi Hoạt động lần đầu trong kỳ được tính lại ở từng ngày nên một người vào hệ thống lần đầu trong kỳ vẫn xuất hiện ở những ngày họ hoạt động sau đó; số Mới (cả kỳ) ở dải số là số người khác nhau, mỗi người chỉ tính một lần.
              </p>
              {cohortCapNote ? <p className="card-subtitle" style={{ marginTop: '4px' }}>{cohortCapNote}</p> : null}
            </>
          )}
        </section>

        <section className="panel-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Sinh Viên Xem Trang Bằng Thiết Bị Gì?</h2>
              <p className="card-subtitle">Phân bố thiết bị, hệ điều hành và trình duyệt trong {labelForTimeRange(timeRange).toLowerCase()}</p>
            </div>
          </div>

          {devicesQuery.isLoading ? (
            <SkeletonBlock rows={4} />
          ) : devicesQuery.isError ? (
            <ErrorState message={devicesQuery.error?.message} onRetry={() => devicesQuery.refetch()} />
          ) : devices.length === 0 ? (
            <EmptyState message="Chưa có dữ liệu thiết bị trong mốc thời gian đang chọn." />
          ) : (
            <div className="devices-stack">
              <div className="devices-grid" id="insights-devices-grid">
                {devices.map((d) => {
                  const name = String(d.name || '');
                  const meta = DEVICE_META[name] || { label: name || 'Khác', Icon: Icons.monitor };
                  const pct = totalDevices > 0 ? (safeNumber(d.count) / totalDevices) * 100 : 0;
                  return (
                    <div className="device-card" key={name}>
                      <span className="icon"><meta.Icon size={22} /></span>
                      <span className="name">{meta.label}</span>
                      <span className="val">{formatNumber(d.count)}</span>
                      <span className="sub-pct text-mono">{formatPercent(pct)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="os-browser-lists" id="insights-os-browser">
                {osList.length > 0 ? (
                  <div className="breakdown-group">
                    <h3 className="breakdown-group-title">Hệ Điều Hành</h3>
                    <div className="pills-wrap">
                      {osList.map((row) => (
                        <div className="breakdown-chip" key={row.name}>
                          <span>{row.name}</span>
                          <span className="chip-val">{formatNumber(row.count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {browserList.length > 0 ? (
                  <div className="breakdown-group" style={{ marginTop: '12px' }}>
                    <h3 className="breakdown-group-title">Trình Duyệt</h3>
                    <div className="pills-wrap">
                      {browserList.map((row) => (
                        <div className="breakdown-chip" key={row.name}>
                          <span>{row.name}</span>
                          <span className="chip-val">{formatNumber(row.count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FragmentRow({ day, weekday, row, max, peakDay, peakHour }) {
  return (
    <>
      <span className="heatmap-label">{weekday}</span>
      {row.map((count, hour) => {
        const level = max > 0 ? Math.min(5, Math.ceil((count / max) * 5)) : 0;
        const isPeak = count > 0 && day === peakDay && hour === peakHour;
        const tip = `${weekday} ${String(hour).padStart(2, '0')}:00 — ${formatNumber(count)} lượt`;
        return (
          <div
            key={`${day}-${hour}`}
            className={`heatmap-cell heatmap-lv${level}${count === 0 ? ' heatmap-cell--zero' : ''}${isPeak ? ' heatmap-cell--peak' : ''}`}
            title={tip}
          >
            {compactCount(count)}
          </div>
        );
      })}
    </>
  );
}
