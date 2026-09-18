export function cleanTag(tag) {
  return String(tag || '').trim().replace(/^\[+|\]+$/g, '') || 'CLB';
}

export function initials(name) {
  const words = String(name || 'CLB').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'CL';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatRelativeTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Không rõ thời điểm';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Vừa xong';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}

export function postsFrom(data) {
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data)) return data;
  return [];
}
