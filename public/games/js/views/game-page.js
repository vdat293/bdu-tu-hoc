import { GamesApi } from '../api.js';
import { esc, openModal, toast } from '../ui.js';
import { gameModule, isGameReady } from '../games/index.js';
import { headerHtml, bindHeader } from '../components/header.js';
import { bindNav } from './home.js';

const SETTINGS_KEY = 'bdu_games_room_settings';
const TURN_OPTIONS = [
  { value: 0, label: 'Không giới hạn' },
  { value: 30, label: '30 giây' },
  { value: 60, label: '1 phút' },
  { value: 180, label: '3 phút' }
];

function loadSettings() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      turnSeconds: TURN_OPTIONS.some((option) => option.value === Number(raw.turnSeconds)) ? Number(raw.turnSeconds) : 60,
      allowSpectators: raw.allowSpectators !== false,
      allowChat: raw.allowChat !== false
    };
  } catch {
    return { turnSeconds: 60, allowSpectators: true, allowChat: true };
  }
}

function saveSettings(settings) {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

export async function renderGamePage(root, state, { navigate, gameId }) {
  const game = state.games.find((item) => item.id === gameId) || null;
  const module = gameModule(gameId);
  const ready = isGameReady(gameId);
  const label = module?.meta?.label || game?.label || gameId;
  const tagline = module?.meta?.tagline || game?.tagline || 'Chơi với một người bạn';
  const settings = loadSettings();

  root.innerHTML = `
    ${headerHtml(state)}
    <main class="page">
      <section class="game-page">
        <a class="game-page-back" href="/games" data-nav="/games">← Tất cả trò chơi</a>
        <div class="game-intro">
          <div class="game-intro-copy">
            <span class="kicker">${esc(tagline)}</span>
            <h1>${esc(label)}</h1>
            <p>${esc(ready ? 'Tạo phòng, gửi liên kết cho bạn rồi bắt đầu. Không cần phòng chờ công khai.' : 'Trò chơi này đang được hoàn thiện. Bạn có thể quay lại sau.')}</p>
            ${ready ? `<button type="button" class="btn btn-primary" data-action="create-room">🔗 Chơi với một người bạn</button>` : '<button type="button" class="btn btn-ghost" disabled>Sắp ra mắt</button>'}
            ${ready ? `<button type="button" class="btn btn-ghost btn-sm play-settings-btn" data-action="room-settings">⚙ Cài đặt phòng</button>` : ''}
          </div>
          <div class="game-intro-art"><div class="preview-frame">${ready && module?.preview ? safePreview(module) : '<span class="preview-glyph">🎮</span>'}</div></div>
        </div>
        ${ready ? `<div class="panel" style="padding:16px 18px">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div class="stack" style="gap:2px">
              <strong style="font-size:13px">Cài đặt hiện tại</strong>
              <span class="faint tiny" data-settings-summary></span>
            </div>
            <span class="faint tiny">Người mở link đầu tiên là đối thủ · người vào sau xem trực tiếp</span>
          </div>
        </div>` : ''}
      </section>
    </main>
    <footer class="site-footer">
      <span>BDU Game Hub · dành cho sinh viên BDU</span>
      <a href="/games" data-nav="/games">Về trang chủ</a>
    </footer>`;

  const summary = root.querySelector('[data-settings-summary]');
  const renderSummary = () => {
    if (!summary) return;
    const turn = TURN_OPTIONS.find((option) => option.value === settings.turnSeconds)?.label || '1 phút';
    summary.textContent = `Thời gian mỗi nước: ${turn} · Khán giả: ${settings.allowSpectators ? 'cho phép' : 'không'} · Chat: ${settings.allowChat ? 'bật' : 'tắt'}`;
  };
  renderSummary();

  root.querySelector('[data-action="room-settings"]')?.addEventListener('click', () => openSettings(settings, renderSummary));
  root.querySelector('[data-action="create-room"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang tạo phòng…';
    try {
      const room = await GamesApi.createRoom({
        gameType: gameId,
        visibility: 'private',
        allowSpectators: settings.allowSpectators,
        allowChat: settings.allowChat,
        turnSeconds: settings.turnSeconds
      });
      navigate(`/games/room/${encodeURIComponent(room.room_code)}`);
    } catch (error) {
      button.disabled = false;
      button.textContent = '🔗 Chơi với một người bạn';
      toast(error.message || 'Không thể tạo phòng.', 'error');
    }
  });

  bindHeader(root);
  bindNav(root, navigate);
}

function safePreview(module) {
  try { return module.preview ? module.preview() : ''; } catch { return ''; }
}

function openSettings(settings, onChange) {
  const body = `
    <div class="field">
      <label>Thời gian mỗi nước</label>
      <div class="segmented" data-turn-options>
        ${TURN_OPTIONS.map((option) => `<button type="button" data-value="${option.value}" aria-pressed="${settings.turnSeconds === option.value}">${esc(option.label)}</button>`).join('')}
      </div>
      <span class="field-hint">Hết thời gian, người đang tới lượt bị xử thua.</span>
    </div>
    <div class="switch-row">
      <span class="switch-copy"><strong>Cho phép người khác xem</strong><span>Người vào sau link sẽ ở chế độ khán giả.</span></span>
      <button type="button" class="switch" data-toggle="spectators" aria-pressed="${settings.allowSpectators}" aria-label="Cho phép khán giả"></button>
    </div>
    <div class="switch-row">
      <span class="switch-copy"><strong>Bật chat trong phòng</strong><span>Chat và emoji nhanh, không lưu lại.</span></span>
      <button type="button" class="switch" data-toggle="chat" aria-pressed="${settings.allowChat}" aria-label="Bật chat"></button>
    </div>`;

  openModal({
    title: 'Cài đặt phòng',
    bodyHtml: body,
    footHtml: '<button type="button" class="btn btn-primary btn-block" data-modal-close>Xong</button>',
    onMount(backdrop, close) {
      backdrop.querySelectorAll('[data-turn-options] button').forEach((button) => {
        button.addEventListener('click', () => {
          settings.turnSeconds = Number(button.dataset.value);
          backdrop.querySelectorAll('[data-turn-options] button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
          saveSettings(settings);
          onChange?.();
        });
      });
      backdrop.querySelectorAll('[data-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.dataset.toggle === 'spectators' ? 'allowSpectators' : 'allowChat';
          settings[key] = !settings[key];
          button.setAttribute('aria-pressed', String(settings[key]));
          saveSettings(settings);
          onChange?.();
        });
      });
    }
  });
}
