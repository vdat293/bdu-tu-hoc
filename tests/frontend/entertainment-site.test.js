import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { navigation } from '../../client/src/app/navigation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('standalone entertainment site contract', () => {
  it('keeps the portal entry point separate from sidebar navigation', () => {
    const html = fs.readFileSync(path.join(root, 'public/games/index.html'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');
    expect(html).toContain('/games/games.css');
    expect(html).toContain('/games/games.js');
    expect(script).toContain('/api/entertainment/rooms');
    expect(script).toContain('/ws/community');
    expect(css).toContain('grid-template-rows: repeat(var(--rows), minmax(0, 1fr));');
    expect(css).toContain('width: min(81%, 760px);');
    expect(navigation.some((item) => item.path === '/entertainment' || item.path === '/games')).toBe(false);
  });

  it('exposes every requested game in the standalone UI', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    for (const label of ['Cờ caro', 'Cờ vua', 'Cờ tướng', 'Cờ vây', 'Connect 4']) expect(script).toContain(label);
    expect(script).toContain('challenges');
    expect(script).toContain('accept-challenge');
  });

  it('separates opponent and spectator mechanisms and handles waiting state with spinner', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');

    // Dual links & separate roles
    expect(script).toContain('copy-opponent-link');
    expect(script).toContain('copy-spectator-link');
    expect(script).toContain('role=player');
    expect(script).toContain('role=spectator');
    expect(script).toContain('renderWaitingOpponent');

    // Waiting spinner & radar styling
    expect(css).toContain('.waiting-stage');
    expect(css).toContain('.waiting-spinner');
    expect(css).toContain('.waiting-radar');
    expect(css).toContain('@keyframes waitingSpin');
    expect(css).toContain('.spectator-banner');

    // Private vs Public support
    expect(script).toContain('private');
    expect(script).toContain('public');
    expect(css).toContain('.meta-tag-private');
    expect(css).toContain('.meta-tag-public');
  });

  it('supports rematch countdown and player leave auto-exit logic', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');

    // Rematch timer & UI
    expect(script).toContain('startRematchCountdown');
    expect(script).toContain('clearRematchCountdown');
    expect(script).toContain('request-rematch');
    expect(script).toContain('/rematch');
    expect(script).toContain('game.rematch.requested');
    expect(script).toContain('game.rematch.started');

    // Auto-exit & room deletion
    expect(script).toContain('/leave');
    expect(script).toContain('game.room.closed');

    // Rematch styling
    expect(css).toContain('.rematch-card');
    expect(css).toContain('.rematch-timer-circle');
    expect(css).toContain('.rematch-timer-num');
    expect(css).toContain('.rematch-info');
    expect(css).toContain('.rematch-actions');
  });

  it('provides rich win/loss feedback, resign button, and winning cell highlight', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');

    // Resign action
    expect(script).toContain('data-action="resign"');
    expect(script).toContain('submitMove({ resign: true })');

    // Winning cells highlight
    expect(script).toContain('winning-cell');
    expect(css).toContain('.cell.winning-cell');
    expect(css).toContain('@keyframes winningCellGlow');

    // Win/Loss seat badges and toolbar
    expect(script).toContain('seat-score');
    expect(script).toContain('THẮNG');
    expect(script).toContain('THUA');
    expect(css).toContain('.seat-score.win');
    expect(css).toContain('.seat-score.loss');
    expect(css).toContain('.board-toolbar--finished');
  });

  it('renders authentic Xiangqi board with river, palace diagonals, and red/black piece discs', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');

    // Traditional pieces
    expect(script).toContain("rr: '俥'");
    expect(script).toContain("rn: '傌'");
    expect(script).toContain("rk: '帥'");
    expect(script).toContain("bk: '將'");

    // River and palace classes
    expect(script).toContain('xq-river-top');
    expect(script).toContain('xq-river-bottom');
    expect(script).toContain('xq-palace');
    expect(script).toContain('xq-diag-cross');
    expect(script).toContain('楚河');
    expect(script).toContain('漢界');

    // CSS styling
    expect(css).toContain('.board.xiangqi');
    expect(css).toContain('.xq-river-text');
    expect(css).toContain('.xq-diag-cross');
    expect(css).toContain('.piece-red');
    expect(css).toContain('.piece-black');
    // Ensure broken odd/even coloring is gone
    expect(css).not.toContain('.board-stage .board.xiangqi .cell:nth-child(odd)');
  });

  it('renders prominent victory finish overlay directly on board with real player name', () => {
    const script = fs.readFileSync(path.join(root, 'public/games/games.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/games/games.css'), 'utf8');

    // Finish overlay on the board
    expect(script).toContain('renderBoardFinishOverlay');
    expect(script).toContain('board-finish-overlay');
    expect(script).toContain('board-finish-card');
    expect(script).toContain('board-finish-winner-pill');
    expect(script).toContain('toggle-finish-overlay');

    // CSS finish overlay
    expect(css).toContain('.board-finish-overlay');
    expect(css).toContain('.board-finish-card');
    expect(css).toContain('.board-finish-winner-pill');
    expect(css).toContain('.board-finish-minimized');

    // Dynamic winner name resolution (no hardcoded 'Người chơi 1' for winners)
    expect(script).not.toContain('Thắng cuộc: Người chơi ${winnerSeat}');
    expect(script).toContain('Thắng cuộc: ${escapeHtml(winnerName)}');
  });
});

