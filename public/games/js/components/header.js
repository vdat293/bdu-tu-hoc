import { avatarHtml, titleBadgesHtml } from '../identity.js';
import { esc } from '../ui.js';

const sunIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3"></path></svg>`;
const moonIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"></path></svg>`;
const homeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 10 8.5-7 8.5 7v10.5h-6v-6h-5v6h-6Z"></path></svg>`;

function themeToggleContent(theme) {
  const nextIsLight = theme !== 'light';
  return {
    icon: nextIsLight ? sunIcon : moonIcon,
    label: `Chuyển sang giao diện ${nextIsLight ? 'sáng' : 'tối'}`
  };
}

function updateThemeToggle(button, theme) {
  const { icon, label } = themeToggleContent(theme);
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute('aria-label', label);
}

export function headerHtml(state, { showUser = true } = {}) {
  const presentation = state.presentation;
  const name = presentation?.name || state.userName || 'Sinh viên';
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const themeToggle = themeToggleContent(theme);
  return `
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="/games" data-nav="/games">
          <img class="brand-logo" src="/assets/images/logo-bdu-2024.png" alt="Trường Đại học Bình Dương" />
        </a>
        <span class="header-spacer"></span>
        <div class="header-actions">
          <button type="button" class="icon-button" data-action="toggle-theme" title="${themeToggle.label}" aria-label="${themeToggle.label}">${themeToggle.icon}</button>
          <a class="icon-button" href="/" title="Về trang chủ BDU" aria-label="Về trang chủ BDU">${homeIcon}</a>
          ${showUser ? `
            <span class="user-chip" title="${esc(name)}">
              ${avatarHtml(presentation || { name }, { size: 30 })}
              <span class="user-chip-name">${esc(name)}</span>
            </span>` : ''}
        </div>
      </div>
    </header>`;
}

// Gắn sự kiện header: đổi theme + chặn điều hướng cứng cho link nội bộ.
export function bindHeader(root, { onThemeChange = null } = {}) {
  const themeButton = root.querySelector('[data-action="toggle-theme"]');
  themeButton?.addEventListener('click', () => {
    const next = window.__gamesToggleTheme?.();
    if (next === 'light' || next === 'dark') updateThemeToggle(themeButton, next);
    onThemeChange?.(next);
  });
}

export function userTitlesHtml(presentation, max = 2) {
  return titleBadgesHtml(presentation?.titles || presentation?.selected_titles || [], max);
}
