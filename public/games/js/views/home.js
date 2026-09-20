import { esc } from '../ui.js';
import { gameModule, isGameReady, gameUnavailableReason } from '../games/index.js';
import { headerHtml, bindHeader } from '../components/header.js';

// Trang chủ: chỉ có một hình thức chơi là mời bạn qua link, nên không có lobby.
export function renderHome(root, state, { navigate }) {
  const cards = state.games.map((game) => {
    const module = gameModule(game.id);
    const ready = isGameReady(game.id);
    const tagline = module?.meta?.tagline || game.tagline || 'Chơi với một người bạn';
    const art = ready
      ? safePreview(module) || '<span class="preview-unavailable">Xem trước bàn chơi</span>'
      : '<span class="preview-unavailable">Đang hoàn thiện</span>';
    const inner = `
      <span class="game-card-art">${art}${ready ? '' : '<span class="game-card-soon">Sắp ra mắt</span>'}</span>
      <span class="game-card-name">
        <span>${esc(module?.meta?.label || game.label)}<small>${esc(tagline)}</small></span>
      </span>`;
    if (!ready) {
      const reason = gameUnavailableReason(game.id);
      return `<button type="button" class="game-card" disabled title="${esc(reason || 'Game đang được hoàn thiện')}">${inner}</button>`;
    }
    return `<a class="game-card" href="/games/${encodeURIComponent(game.id)}" data-nav="/games/${encodeURIComponent(game.id)}">${inner}</a>`;
  }).join('');

  root.innerHTML = `
    ${headerHtml(state)}
    <main class="page">
      <section class="home-hero">
        <div class="home-hero-copy">
          <span class="kicker">BDU Game Hub</span>
          <h1>Rủ bạn vào một ván.</h1>
          <p>Chọn trò chơi, gửi liên kết và bắt đầu. Người vào phòng đầu tiên sẽ là đối thủ của bạn.</p>
        </div>
      </section>
      <section>
        <div class="home-section-head">
          <h2>Trò chơi</h2>
          <p>${state.games.filter((game) => isGameReady(game.id)).length} trò đang mở</p>
        </div>
        <div class="game-grid">${cards}</div>
      </section>
    </main>
    <footer class="site-footer">
      <span>BDU Game Hub</span>
      <span>Dành cho sinh viên BDU</span>
    </footer>`;

  bindHeader(root);
  bindNav(root, navigate);
}

function safePreview(module) {
  try {
    return module.preview ? module.preview() : '';
  } catch {
    return '';
  }
}

// Điều hướng nội bộ cho mọi link [data-nav] để không tải lại trang.
export function bindNav(root, navigate) {
  root.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      navigate(link.dataset.nav);
    });
  });
}
