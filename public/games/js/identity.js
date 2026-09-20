import { GamesApi } from './api.js';
import { esc, initials } from './ui.js';

// Bản đồ asset khung giống portal (client/src/components/identity/Identity.jsx).
// Site /games là static không build nên giữ bản rút gọn tại đây; khung lạ sẽ
// fallback về vòng sáng theo rarity thay vì vỡ giao diện.
const FRAME_ASSETS = {
  'truong-1': { src: '/assets/frames/frame-truong-top-1.svg', tier: 'top-1', scope: 'truong', rarity: 'legendary' },
  'truong-2': { src: '/assets/frames/frame-truong-top-2.svg', tier: 'top-2', scope: 'truong', rarity: 'epic' },
  'truong-3': { src: '/assets/frames/frame-truong-top-3.svg', tier: 'top-3', scope: 'truong', rarity: 'epic' },
  'truong-top': { src: '/assets/frames/frame-truong-top.svg', tier: 'top-6-10', scope: 'truong', rarity: 'rare' },
  'vien-1': { src: '/assets/frames/frame-vien-top-1.svg', tier: 'top-2', scope: 'vien', rarity: 'epic' },
  'vien-top': { src: '/assets/frames/frame-vien-top.svg', tier: 'top-2', scope: 'vien', rarity: 'rare' },
  'khoa-1': { src: '/assets/frames/frame-khoa-top-1.svg', tier: 'top-4-5', scope: 'khoa', rarity: 'epic' },
  'khoa-2': { src: '/assets/frames/frame-khoa-top.svg', tier: 'top-4-5', scope: 'khoa', rarity: 'rare' },
  'khoa-3': { src: '/assets/frames/frame-khoa-top.svg', tier: 'top-4-5', scope: 'khoa', rarity: 'rare' },
  'khoa-top': { src: '/assets/frames/frame-khoa-top.svg', tier: 'top-4-5', scope: 'khoa', rarity: 'rare' },
  'khoa-th-1': { src: '/assets/frames/frame-khoa-th-top-1.svg', tier: 'top-1', scope: 'khoa-th', rarity: 'epic' },
  'khoa-th-2': { src: '/assets/frames/frame-khoa-th-top-2.svg', tier: 'top-2', scope: 'khoa-th', rarity: 'epic' },
  'khoa-th-3': { src: '/assets/frames/frame-khoa-th-top-3.svg', tier: 'top-3', scope: 'khoa-th', rarity: 'epic' },
  'khoa-th-top': { src: '/assets/frames/frame-khoa-th-top-4-10.svg', tier: 'top-6-10', scope: 'khoa-th', rarity: 'rare' },
  'lop-1': { src: '/assets/frames/frame-lop-top-1.svg', tier: 'top-3', scope: 'lop', rarity: 'epic' },
  'lop-top': { src: '/assets/frames/frame-lop-top.svg', tier: 'top-3', scope: 'lop', rarity: 'rare' },
  'aidti-bdu': { src: '/assets/images/frame-aidti-bdu-chibi-v2.png', tier: 'aidti-bdu', scope: 'aidti', rarity: 'legendary' },
  'anime-gojo': { src: '/assets/images/frame-gojo-limitless-art.png', tier: 'anime-gojo', scope: 'anime', rarity: 'legendary' },
  'anime-itachi': { src: '/assets/images/frame-itachi-genjutsu-art.png', tier: 'anime-itachi', scope: 'anime', rarity: 'legendary' },
  'anime-sukuna': { src: '/assets/images/frame-sukuna-shrine-overlay.png', tier: 'anime-sukuna', scope: 'anime', rarity: 'legendary' }
};

const FRAME_THEMES = {
  'truong-1': { primary: '#7ff0ff', secondary: '#8a7bff', highlight: '#d9fbff' },
  'truong-2': { primary: '#b9c8ff', secondary: '#6f7bff', highlight: '#eef2ff' },
  'truong-3': { primary: '#ffd28a', secondary: '#ff8a5c', highlight: '#fff1d6' },
  'truong': { primary: '#8fd3ff', secondary: '#8275f5', highlight: '#e6f6ff' },
  'vien-1': { primary: '#a5ecff', secondary: '#5aa8ff', highlight: '#eafaff' },
  'vien': { primary: '#a5ecff', secondary: '#7f9bff', highlight: '#eafaff' },
  'khoa-1': { primary: '#6fe0a8', secondary: '#2fa98a', highlight: '#d3ffe9' },
  'khoa-2': { primary: '#6fe0a8', secondary: '#2fa98a', highlight: '#d3ffe9' },
  'khoa-3': { primary: '#6fe0a8', secondary: '#2fa98a', highlight: '#d3ffe9' },
  'khoa': { primary: '#6fe0a8', secondary: '#2fa98a', highlight: '#d3ffe9' },
  'khoa-th-1': { primary: '#7ff0ff', secondary: '#39d98a', highlight: '#e6fffa' },
  'khoa-th': { primary: '#7ff0ff', secondary: '#39d98a', highlight: '#e6fffa' },
  'lop-1': { primary: '#ffd76a', secondary: '#ff9d5c', highlight: '#fff3d0' },
  'lop': { primary: '#ffd76a', secondary: '#ff9d5c', highlight: '#fff3d0' },
  'aidti-bdu': { primary: '#ff6b6b', secondary: '#4f7dff', highlight: '#ffe6e6' },
  'anime-gojo': { primary: '#8ad2ff', secondary: '#5a6cff', highlight: '#eaf6ff' },
  'anime-itachi': { primary: '#ff7b7b', secondary: '#8a4bff', highlight: '#ffe3e3' },
  'anime-sukuna': { primary: '#ff7a9c', secondary: '#6d5bff', highlight: '#ffe0ea' },
  default: { primary: '#3ddc97', secondary: '#61a8ff', highlight: '#e9fff6' }
};

let catalogPromise = null;
const catalog = new Map();

export function frameKey(frameId) {
  return String(frameId || '').replace(/^frame:/, '').trim();
}

export function frameInfo(frameId) {
  const key = frameKey(frameId);
  if (!key) return null;
  const local = FRAME_ASSETS[key] || null;
  const remote = catalog.get(key) || null;
  const rarity = remote?.rarity || local?.rarity || 'common';
  const scope = local?.scope || (key.startsWith('anime') ? 'anime' : key.startsWith('aidti') ? 'aidti' : key.split('-')[0]);
  const theme = FRAME_THEMES[key] || FRAME_THEMES[scope] || (key.startsWith('anime') ? FRAME_THEMES['anime-gojo'] : FRAME_THEMES.default);
  return {
    key,
    label: remote?.label || key,
    asset: local?.src || null,
    rarity,
    scope,
    tier: local?.tier || (rarity === 'legendary' ? 'legendary' : 'plain'),
    theme,
    motion: remote?.motion || null
  };
}

// Catalog tải một lần cho mỗi phiên; lỗi mạng không được chặn phòng chơi.
export async function loadFrameCatalog() {
  if (!catalogPromise) {
    catalogPromise = GamesApi.frames()
      .then((data) => {
        for (const frame of data?.frames || []) catalog.set(frameKey(frame.key || frame.id), frame);
        return catalog;
      })
      .catch(() => catalog);
  }
  return catalogPromise;
}

export function avatarHtml(identity, { size = 44, frameId = null, className = '' } = {}) {
  const info = frameInfo(frameId ?? identity?.equipped_frame_id);
  const name = identity?.name || identity?.full_name || identity?.mssv || 'Sinh viên';
  const photo = identity?.avatar_url || null;
  const tierClass = info ? `id-avatar--tier-${esc(info.tier)}` : 'id-avatar--plain';
  const frameColor = info ? info.theme.primary : 'transparent';
  const content = photo
    ? `<img class="id-avatar-photo" src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="id-avatar-initials">${esc(initials(name))}</span>`;
  const frame = info?.asset ? `<img class="id-avatar-frame" src="${esc(info.asset)}" alt="" loading="lazy">` : '';
  return `<span class="id-avatar ${tierClass} ${className}" style="--avatar-size:${Number(size) || 44}px;--frame-color:${esc(frameColor)}" title="${esc(name)}">${content}${frame}</span>`;
}

export function titleBadgesHtml(titles, max = 4) {
  const list = Array.isArray(titles) ? titles.filter(Boolean) : [];
  if (!list.length) return '';
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  return `<span class="id-title-badges">${shown.map((title) => `
    <span class="id-title-badge${title.tone ? ` tone-${esc(title.tone)}` : ''}${title.rarity ? ` rarity-${esc(title.rarity)}` : ''}">${esc(title.label || title.id || '')}</span>`).join('')}${more > 0 ? `<span class="id-title-badge id-title-badge--more">+${more}</span>` : ''}</span>`;
}

// Danh hiệu riêng của Game Hub (server trả trong `player.game_titles`). Mỗi entry
// khai báo effect + bảng màu; thêm danh hiệu mới chỉ cần thêm một dòng ở đây và
// một entry server trong `src/config/game-titles.js` — không phải sửa phòng chơi.
export const GAME_TITLE_EFFECTS = {
  'vua-tro-choi': {
    effect: 'game-king',
    label: 'Vua trò chơi',
    kicker: 'VUA TRÒ CHƠI · 100+ TRẬN THẮNG',
    theme: { primary: '#ffd76a', secondary: '#ff8a5c', highlight: '#fff3d0' }
  },
  'doi-mem': {
    effect: 'soft-opponent',
    label: 'Đối mềm',
    kicker: 'ĐỐI MỀM · 100 TRẬN',
    theme: { primary: '#8fd3ff', secondary: '#c1a8ff', highlight: '#eaf6ff' }
  }
};

export function gameTitleEffectFor(player) {
  const titles = Array.isArray(player?.game_titles) ? player.game_titles : [];
  for (const title of titles) {
    const preset = GAME_TITLE_EFFECTS[title.id];
    if (preset) return { ...preset, id: title.id, label: title.label || preset.label };
  }
  return null;
}

export function gameTitleBadgesHtml(titles, max = 2) {
  const list = Array.isArray(titles) ? titles.filter((title) => GAME_TITLE_EFFECTS[title.id]) : [];
  if (!list.length) return '';
  return `<span class="id-game-title-badges">${list.slice(0, max).map((title) => `
    <span class="id-game-title id-game-title--${esc(GAME_TITLE_EFFECTS[title.id].effect)}" title="${esc(title.description || GAME_TITLE_EFFECTS[title.id].label)}">${esc(title.label || GAME_TITLE_EFFECTS[title.id].label)}</span>`).join('')}</span>`;
}

// Cinematic theo khung/danh hiệu: chỉ phát khi đối thủ vào phòng hoặc khi thắng
// ván. Bấm để bỏ qua; người bật "giảm chuyển động" sẽ không thấy hiệu ứng.
export function playCinematic(identity, { duration = 2800, title = null } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return () => {};
  const portal = document.getElementById('games-portal');
  const info = frameInfo(identity?.equipped_frame_id);
  const effect = title || null;
  if (!portal || (!info && !effect)) return () => {};
  const theme = effect?.theme || info.theme;
  const overlay = document.createElement('div');
  overlay.className = `fx-cinematic${effect ? ` fx-title-${esc(effect.effect)}` : ''}`;
  const particles = Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * 360;
    const distance = 120 + (index % 4) * 46;
    return `<span class="fx-particle" style="--a:${angle}deg;--d:${distance}px;animation-delay:${(index % 5) * 60}ms;background:${index % 3 === 0 ? theme.highlight : index % 3 === 1 ? theme.primary : theme.secondary}"></span>`;
  }).join('');
  const kicker = effect?.kicker || (info.rarity === 'legendary' ? 'HUYỀN THOẠI' : info.rarity === 'epic' ? 'CAO CẤP' : 'VINH DANH');
  overlay.innerHTML = `
    <div class="fx-cinematic-inner" style="--frame-primary:${esc(theme.primary)};--frame-secondary:${esc(theme.secondary)};--frame-highlight:${esc(theme.highlight)}">
      <span class="fx-rays"></span>
      <span class="fx-ring"></span><span class="fx-ring"></span><span class="fx-ring"></span>
      <span class="fx-avatar">${avatarHtml(identity, { size: 96 })}</span>
      <span class="fx-kicker">${esc(kicker)}</span>
      <span class="fx-name">${esc(identity?.name || identity?.mssv || 'Người chơi')}</span>
      <span class="fx-titles">${effect ? `<span class="fx-title-chip">${esc(effect.label)}</span>` : titleBadgesHtml(identity?.titles || [], 2)}</span>
      ${particles}
      <span class="fx-hint">Bấm để bỏ qua</span>
    </div>`;
  portal.appendChild(overlay);
  let timer = window.setTimeout(cleanup, duration);
  overlay.addEventListener('click', cleanup);
  function cleanup() {
    window.clearTimeout(timer);
    overlay.remove();
  }
  return cleanup;
}

export function playConfetti({ colors = ['#3ddc97', '#61a8ff', '#ffd76a', '#ff7a9c'], count = 40 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  const portal = document.getElementById('games-portal');
  if (!portal) return;
  const layer = document.createElement('div');
  layer.className = 'fx-confetti';
  layer.innerHTML = Array.from({ length: count }, (_, index) => `
    <i style="left:${(index * 100) / count + (index % 3)}%;background:${colors[index % colors.length]};animation-delay:${(index % 8) * 120}ms"></i>`).join('');
  portal.appendChild(layer);
  window.setTimeout(() => layer.remove(), 3400);
}
