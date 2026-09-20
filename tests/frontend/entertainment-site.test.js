import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { navigation } from '../../client/src/app/navigation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const games = (relative) => fs.readFileSync(path.join(root, 'public/games', relative), 'utf8');

describe('standalone entertainment site contract', () => {
  it('keeps the portal entry point separate from sidebar navigation', () => {
    const html = games('index.html');
    expect(html).toContain('/games/styles/tokens.css');
    expect(html).toContain('/games/js/main.js');
    expect(html).not.toContain('/games/games.js');
    expect(navigation.some((item) => item.path === '/entertainment' || item.path === '/games')).toBe(false);
  });

  it('ships a module per requested game through the client registry', () => {
    const registry = games('js/games/index.js');
    const pairs = [
      ['tic_tac_toe', 'tic-tac-toe'], ['connect4', 'connect4'], ['caro', 'caro'], ['chess', 'chess'],
      ['checkers', 'checkers'], ['battleship', 'battleship'], ['backgammon', 'backgammon']
    ];
    for (const [id, file] of pairs) {
      expect(registry).toContain(`id: '${id}'`);
      expect(registry).toContain(`import('./${file}.js')`);
    }
    // Mỗi game có CSS riêng (placeholder cũng hợp lệ trước khi team hoàn thiện).
    for (const id of ['tic-tac-toe', 'connect4', 'caro', 'chess', 'checkers', 'battleship', 'backgammon']) {
      expect(fs.existsSync(path.join(root, 'public/games/styles/games', `${id}.css`))).toBe(true);
    }
    // Game mẫu đã sẵn sàng để các team copy convention.
    const sample = games('js/games/tic-tac-toe.js');
    expect(sample).toContain('export default');
    expect(sample).toContain('function mount(root, api)');
    expect(sample).toContain('function preview()');
    expect(sample).toContain('update(');
  });

  it('only exposes the friend-link flow with a copyable invite link and no QR code', () => {
    const gamePage = games('js/views/game-page.js');
    const room = games('js/views/room.js');
    const home = games('js/views/home.js');
    expect(gamePage).toContain('Chơi với một người bạn');
    expect(gamePage).toContain('visibility: \'private\'');
    expect(room).toContain('Chia sẻ liên kết này với một người bạn');
    expect(room).toContain('copyText');
    expect(room).toContain('data-action="copy-link"');
    // Không còn QR/lobby/challenge như bản cũ.
    const allSources = [home, gamePage, room, games('js/main.js'), games('js/api.js')].join('\n');
    expect(allSources.toLowerCase()).not.toContain('qrcode');
    expect(allSources).not.toContain('data-filter');
    expect(allSources).not.toContain('accept-challenge');
    expect(room).not.toContain('challenges');
  });

  it('auto-assigns roles: first joiner plays, later joiners spectate', () => {
    const room = games('js/views/room.js');
    const api = games('js/api.js');
    expect(api).toContain('/join');
    expect(room).toContain("role === 'spectator'");
    expect(room).toContain('viewer_seat');
    expect(room).toContain('Bạn đang xem trực tiếp');
    expect(room).toContain('spectator_count');
  });

  it('supports light and dark themes toggled from the header', () => {
    const tokens = games('styles/tokens.css');
    const session = games('js/session.js');
    const header = games('js/components/header.js');
    expect(tokens).toContain(':root[data-theme="light"]');
    expect(tokens).toContain('prefers-color-scheme');
    expect(session).toContain('bdu_theme');
    expect(session).toContain('applyTheme');
    expect(header).toContain('data-action="toggle-theme"');
  });

  it('renders frames and titles from the identity catalog with cinematic effects', () => {
    const identity = games('js/identity.js');
    const api = games('js/api.js');
    const css = games('styles/identity.css');
    const room = games('js/views/room.js');
    expect(api).toContain('/api/identity/frames');
    expect(identity).toContain('GamesApi.frames');
    expect(identity).toContain('titleBadgesHtml');
    expect(identity).toContain('playCinematic');
    expect(css).toContain('.id-avatar-frame');
    expect(css).toContain('.fx-cinematic');
    // Cinematic chạy khi đối thủ vào phòng và khi thắng ván.
    expect(room).toContain('playCinematic');
    expect(room).toContain('playConfetti');
    expect(room).toContain('game.spectator.joined');
    expect(room).toContain('vào xem');
  });

  it('keeps chat, move history and rematch inside the room without persistence', () => {
    const room = games('js/views/room.js');
    const realtime = games('js/realtime.js');
    expect(realtime).toContain("type: 'game.chat'");
    expect(room).toContain('data-emoji');
    expect(room).toContain('Chat');
    expect(room).toContain('Nước đi');
    expect(realtime).toContain("type: 'game.rematch'");
    expect(room).toContain('Chơi lại');
  });

  it('uses the BDU logo as the header brand instead of custom text', () => {
    const header = games('js/components/header.js');
    const main = games('js/main.js');
    expect(header).toContain('/assets/images/logo-bdu-2024.png');
    expect(header).toContain('Trường Đại học Bình Dương');
    expect(main).toContain('/assets/images/logo-bdu-2024.png');
    expect(header).not.toContain('brand-mark');
  });

  it('shows the match score above the board and career wins per player', () => {
    const room = games('js/views/room.js');
    const css = games('styles/room.css');
    expect(room).toContain('data-scoreboard');
    expect(room).toContain('match-score-num');
    expect(room).toContain('sessionScore');
    expect(room).toContain('player-wins');
    expect(css).toContain('.match-scoreboard');
    expect(css).toContain('.match-score-num');
  });

  it('declares Game Hub titles with entry effects ready for future titles', () => {
    const identity = games('js/identity.js');
    const css = games('styles/identity.css');
    const room = games('js/views/room.js');
    expect(identity).toContain('GAME_TITLE_EFFECTS');
    expect(identity).toContain("'vua-tro-choi'");
    expect(identity).toContain("'doi-mem'");
    expect(identity).toContain('gameTitleEffectFor');
    expect(identity).toContain('gameTitleBadgesHtml');
    expect(css).toContain('.id-game-title--game-king');
    expect(css).toContain('.fx-title-game-king');
    expect(css).toContain('.fx-title-soft-opponent');
    expect(room).toContain('playEntryEffect');
    expect(room).toContain('gameTitleEffectFor');
  });

  it('renders the caro board on intersections with color stones, no X/O glyphs', () => {
    const caro = games('js/games/caro.js');
    const css = games('styles/games/caro.css');
    expect(css).toContain('repeating-linear-gradient');
    expect(caro).not.toContain('✕');
    expect(caro).not.toContain('○');
    expect(css).toContain('--caro-board-surface');
    expect(css).toContain('--caro-stone-p1');
    expect(css).not.toContain('radial-gradient');
    expect(css).toContain('caro-lines');
    expect(css).toContain('caro-stars');
  });
});
