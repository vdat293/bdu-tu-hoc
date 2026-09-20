// Test UI module Cờ caro kiểu gomoku (Vitest + jsdom).
// Chạy: npx vitest run tests/frontend/games/caro.test.js --config vitest.config.js
import { afterEach, describe, expect, it, vi } from 'vitest';
import game from '../../../public/games/js/games/caro.js';

const SIZE = 15;

function emptyState(overrides = {}) {
  return {
    size: SIZE,
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    current_seat: 1,
    winner_seat: null,
    result: null,
    ...overrides
  };
}

function mountGame(viewOverrides = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
  const board = game.mount(root, api);
  const view = {
    state: emptyState(),
    mySeat: 1,
    role: 'player',
    interactive: true,
    legalMoves: null,
    lastMove: null,
    status: 'active',
    winnerSeat: null,
    players: [],
    roomCode: 'CARO01',
    turnSeconds: 30,
    ...viewOverrides
  };
  board.update(view);
  const cells = [...root.querySelectorAll('.caro-cell')];
  return { root, api, board, view, cells };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('caro UI module (gomoku)', () => {
  it('export đúng meta; preview là art giao điểm, không dùng chữ X/O', () => {
    expect(game.meta).toMatchObject({ id: 'caro', label: expect.any(String), tagline: expect.any(String) });
    const html = game.preview();
    expect(html).toContain('caro-preview');
    expect(html).toContain('caro-preview-stone');
    expect(html).toContain('caro-preview-star');
    expect(html).not.toContain('✕');
    expect(html).not.toContain('○');
    expect(html).not.toContain('<script');
  });

  it('mount dựng bàn giao điểm: lưới, 5 điểm sao, 225 nút có quân tròn', () => {
    const { root, board } = mountGame();
    expect(root.querySelectorAll('.caro-cell')).toHaveLength(SIZE * SIZE);
    expect(root.querySelectorAll('.caro-stone')).toHaveLength(SIZE * SIZE);
    expect(root.querySelectorAll('.caro-star')).toHaveLength(5);
    expect(root.querySelector('.caro-lines')).toBeTruthy();
    expect(root.querySelector('.caro-grid')).toBeTruthy();
    // Góc dưới phải là giao điểm (14, 14).
    const last = root.querySelectorAll('.caro-cell')[225 - 1];
    expect(last.dataset.row).toBe('14');
    expect(last.dataset.column).toBe('14');
    expect(() => board.update({ state: {} })).not.toThrow();
    expect(() => board.update()).not.toThrow();
    expect(() => board.update(null)).not.toThrow();
  });

  it('tái sử dụng DOM node giữa các lần update', () => {
    const { root, board } = mountGame();
    const before = root.querySelectorAll('.caro-cell')[100];
    board.update({ state: emptyState(), interactive: true, mySeat: 1 });
    expect(root.querySelectorAll('.caro-cell')[100]).toBe(before);
  });

  it('interactive=false: bàn giữ nguyên hiển thị, ô disabled, click không gọi onMove', () => {
    const { api, cells, root } = mountGame({ interactive: false });
    expect(root.querySelector('.caro-board').className).toContain('is-locked');
    cells[0].click();
    cells[16].click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(cells[0].disabled).toBe(true);
  });

  it('thể hiện rõ lượt đối thủ dựa trên ghế hiện tại nhưng vẫn giữ bàn đọc được', () => {
    const state = emptyState({ current_seat: 2 });
    const { root } = mountGame({ state, mySeat: 1, interactive: false });
    expect(root.querySelector('.caro-board')).toHaveClass('is-opponent-turn');
  });

  it('interactive=true: click giao điểm trống gọi onMove({ row, column })', () => {
    const { api, cells, root } = mountGame();
    expect(root.querySelector('.caro-board').className).not.toContain('is-locked');
    cells[1 * SIZE + 1].click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({ row: 1, column: 1 });
  });

  it('nước không nằm trong legalMoves không gọi onMove, có toast cảnh báo', () => {
    const { api, cells } = mountGame({ legalMoves: [{ row: 0, column: 0 }] });
    cells[16].click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(api.showToast).toHaveBeenCalled();
    cells[0].click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({ row: 0, column: 0 });
  });

  it('click giao điểm đã có quân không gọi onMove; quân gắn đúng màu ghế', () => {
    const state = emptyState();
    state.board[0][0] = 1;
    state.board[0][1] = 2;
    const { api, root } = mountGame({ state });
    const first = root.querySelector('.caro-cell[data-row="0"][data-column="0"]');
    const second = root.querySelector('.caro-cell[data-row="0"][data-column="1"]');
    first.click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(first.className).toContain('is-p1');
    expect(second.className).toContain('is-p2');
    expect(first.textContent).toBe('');
    expect(first.querySelector('.caro-stone')).toBeTruthy();
    expect(first.disabled).toBe(true);
  });

  it('highlight nước vừa đi (is-last) và đường thắng (is-winning + winline)', () => {
    const state = emptyState();
    state.board[7][3] = 1;
    state.board[7][4] = 1;
    state.board[0][0] = 2;
    state.winning_cells = [[7, 3], [7, 4]];
    const { root } = mountGame({ state, lastMove: { row: 7, column: 4 } });
    const first = root.querySelector('.caro-cell[data-row="7"][data-column="3"]');
    const second = root.querySelector('.caro-cell[data-row="7"][data-column="4"]');
    const opponent = root.querySelector('.caro-cell[data-row="0"][data-column="0"]');
    expect(first.className).toContain('is-winning');
    expect(second.className).toContain('is-winning');
    expect(second.className).toContain('is-last');
    expect(opponent.className).not.toContain('is-winning');
    const winline = root.querySelector('.caro-winline');
    expect(winline.hidden).toBe(false);
    expect(winline.style.width).not.toBe('');
    expect(winline.style.transform).toContain('0deg');
  });

  it('winline nối đúng hướng chéo và ẩn khi không có đường thắng', () => {
    const state = emptyState();
    state.winning_cells = [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]];
    const { root } = mountGame({ state });
    const winline = root.querySelector('.caro-winline');
    expect(winline.hidden).toBe(false);
    expect(winline.style.transform).toContain('45deg');
    const clean = mountGame();
    expect(clean.root.querySelector('.caro-winline').hidden).toBe(true);
  });

  it('destroy dọn sạch DOM', () => {
    const { root, board } = mountGame();
    board.destroy();
    expect(root.innerHTML).toBe('');
  });
});
