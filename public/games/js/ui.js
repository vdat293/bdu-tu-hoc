// Tiện ích UI dùng chung: escape HTML, toast, modal, thông báo góc, định dạng.

export function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

export function initials(value) {
  const parts = String(value || 'SV').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SV';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

export function toast(message, variant = 'default', duration = 4000) {
  const host = document.getElementById('games-toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast${variant && variant !== 'default' ? ` toast--${variant}` : ''}`;
  node.textContent = message;
  host.appendChild(node);
  window.setTimeout(() => {
    node.style.transition = 'opacity .2s ease';
    node.style.opacity = '0';
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

export function openModal({ title, bodyHtml = '', footHtml = '', onMount = null, onClose = null }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><span class="grow"></span><button class="icon-button" data-modal-close aria-label="Đóng">✕</button></div>
      <div class="modal-body"></div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;
  backdrop.querySelector('.modal-body').innerHTML = bodyHtml;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', close));
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  onMount?.(backdrop, close);
  return close;
}

export function cornerHost() {
  let host = document.getElementById('games-corner');
  if (!host) {
    host = document.createElement('div');
    host.id = 'games-corner';
    host.className = 'corner-feed';
    document.body.appendChild(host);
  }
  return host;
}

export function cornerNotice(html, duration = 4200) {
  const host = cornerHost();
  const node = document.createElement('div');
  node.className = 'corner-item';
  node.innerHTML = html;
  host.appendChild(node);
  window.setTimeout(() => {
    node.style.transition = 'opacity .25s ease, transform .25s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateX(14px)';
    window.setTimeout(() => node.remove(), 260);
  }, duration);
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).catch(() => fallbackCopy(text)) ?? fallbackCopy(text);
}

function fallbackCopy(text) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : String(seconds);
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function playerLabel(player) {
  if (!player) return 'Người chơi';
  return player.name || player.full_name || player.mssv || 'Người chơi';
}
