import { initTheme, applyTheme, getSession, loginUrl, currentName } from './session.js';
import { GamesApi } from './api.js';
import { loadGameModules } from './games/index.js';
import { loadFrameCatalog } from './identity.js';
import { renderHome } from './views/home.js';
import { renderGamePage } from './views/game-page.js';
import { createRoomView } from './views/room.js';
import { esc } from './ui.js';

// main.js giữ state cấp app và router; mỗi view tự gắn/huỷ vòng đời của mình.
const state = {
  games: [],
  presentation: null,
  session: null,
  userName: ''
};
let currentView = null;

window.__gamesToggleTheme = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
  return next;
};

function parseRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'games') return { name: 'home' };
  if (parts[1] === 'room' && parts[2]) return { name: 'room', code: decodeURIComponent(parts[2]) };
  if (parts[1] === 'challenges') return { name: 'home' };
  if (parts[1]) return { name: 'game', id: decodeURIComponent(parts[1]) };
  return { name: 'home' };
}

function navigate(path) {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState({}, '', path);
  void route();
}

async function route() {
  currentView?.teardown?.();
  currentView = null;
  const root = document.getElementById('games-app');
  if (!root) return;
  root.innerHTML = '';
  const parsed = parseRoute();

  if (!state.session) {
    renderLoginGate(root);
    return;
  }

  if (parsed.name === 'room') {
    const view = createRoomView({ root, state, code: parsed.code, navigate });
    currentView = view;
    await view.start();
    return;
  }
  if (parsed.name === 'game') {
    await renderGamePage(root, state, { navigate, gameId: parsed.id });
    return;
  }
  renderHome(root, state, { navigate });
}

function renderLoginGate(root) {
  const returnTo = window.location.pathname + window.location.search;
  root.innerHTML = `
    <header class="site-header"><div class="site-header-inner">
      <a class="brand" href="/games"><img class="brand-logo" src="/assets/images/logo-bdu-2024.png" alt="Trường Đại học Bình Dương" /></a>
    </div></header>
    <main class="page">
      <div class="share-screen">
        <div class="share-card">
          <span class="kicker">Cần đăng nhập</span>
          <h1>Đăng nhập để chơi cùng bạn</h1>
          <p>BDU Game Hub dùng tài khoản sinh viên để hiển thị tên, khung và danh hiệu của bạn trong phòng chơi.</p>
          <a class="btn btn-primary" href="${esc(loginUrl(returnTo))}">Đăng nhập bằng tài khoản BDU</a>
        </div>
      </div>
    </main>`;
}

function renderBootError(root, message) {
  root.innerHTML = `
    <main class="page">
      <div class="empty-state" style="margin-top:40px">
        <h2>Không tải được phòng chơi</h2>
        <p>${esc(message || 'Vui lòng thử lại sau ít phút.')}</p>
        <button type="button" class="btn btn-primary" data-action="retry">Thử lại</button>
      </div>
    </main>`;
  root.querySelector('[data-action="retry"]')?.addEventListener('click', () => boot());
}

async function boot() {
  initTheme();
  state.session = getSession();
  const root = document.getElementById('games-app');
  if (!root) return;
  if (!state.session) {
    renderLoginGate(root);
    return;
  }
  state.userName = currentName();
  root.innerHTML = '<main class="page"><div class="empty-state" style="margin-top:40px"><span class="spinner"></span><p>Đang tải danh sách trò chơi…</p></div></main>';

  try {
    const data = await GamesApi.listGames();
    state.games = Array.isArray(data?.games) ? data.games : [];
  } catch (error) {
    if (error.status === 401) return;
    renderBootError(root, error.message);
    return;
  }

  try { state.presentation = await GamesApi.myPresentation(); } catch {}
  await Promise.all([loadGameModules(), loadFrameCatalog().catch(() => null)]);

  window.addEventListener('popstate', () => { void route(); });
  await route();
}

boot();
