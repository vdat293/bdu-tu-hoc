export function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function formatNumber(value, fractionDigits = 0) {
  return safeNumber(value).toLocaleString('vi-VN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

export function formatPercent(value, fractionDigits = 1) {
  return `${formatNumber(value, fractionDigits)}%`;
}

export function formatLatencyMs(value) {
  const ms = safeNumber(value);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${formatNumber(seconds, seconds < 10 ? 2 : 1)} s`;
}

export function formatDurationMs(value) {
  const ms = safeNumber(value);
  if (ms <= 0) return '0 giây';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} giây`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) {
    return remSec > 0 ? `${totalMin} phút ${remSec} giây` : `${totalMin} phút`;
  }
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `${hours} giờ ${remMin} phút` : `${hours} giờ`;
}

export function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatFullDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatClock(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatShortClock(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(value, nowMs = Date.now()) {
  if (!value) return '--';
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return '--';
  const diffSec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (diffSec < 15) return 'Vừa xong';
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return formatDateTime(value);
}

export function formatCohortDay(value) {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[1]}`;
  return formatDateTime(value);
}

export function compactCount(value) {
  const count = safeNumber(value);
  if (count < 1000) return formatNumber(count);
  if (count < 1000000) return `${formatNumber(count / 1000, 1)}k`;
  return `${formatNumber(count / 1000000, 1)}tr`;
}

export function labelForTimeRange(range) {
  return {
    '1h': '1 giờ qua',
    '6h': '6 giờ qua',
    '24h': '24 giờ qua',
    '7d': '7 ngày qua',
    '30d': '30 ngày qua',
    'all': 'Toàn bộ thời gian'
  }[range] || range;
}

export function getInitials(name, fallback = 'SV') {
  const clean = String(name || '').trim();
  if (!clean) return fallback;
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatUptime(uptimeSeconds) {
  const sec = Math.max(0, Math.floor(safeNumber(uptimeSeconds)));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m ${sec % 60}s`;
}

export function cappedRangeText(data = {}, selectedRange = '24h', reason = '') {
  const requested = String(data?.requestedTimeRange ?? selectedRange);
  const effective = String(data?.timeRange ?? requested);
  if (effective === requested || effective !== '30d') return '';
  return `Lưu ý: khối này chỉ dựng trên 30 ngày gần nhất dù bạn chọn ${labelForTimeRange(requested)} — ${reason}.`;
}
