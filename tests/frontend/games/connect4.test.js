// Test UI Connect 4 (Vitest + jsdom): hợp đồng module, mount/update, click khi
// interactive bật/tắt, cột đầy, winning_cells, lastMove, hover ghost.
import { describe, expect, it, vi } from 'vitest';
import connect4 from '../../../public/games/js/games/connect4.js';

const ROWS = 6;
const COLUMNS = 7;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));
}

function emptyState() {
  return { rows: ROWS, columns: COLUMNS, board: emptyBoard(), current_seat: 1, winner_seat: null, result: null };
}

function view(state = emptyState(), extra = {}) {
  return {
    state,
    mySeat: 1,
    role: 'player',
    interactive: false,
    legalMoves: null,
    lastMove: null,
    status: 'active',
    winnerSeat: null,
    players: [],
    roomCode: 'TEST',
    turnSeconds: 30,
    ...extra
  };
}

function setup(state = emptyState(), extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
  const board = connect4.mount(root, api);
  board.update(view(state, extra));
  return { root, api, board };
}

const cellsOf = (root) => Array.from(root.querySelectorAll('.c4-cell'));
const cellAt = (root, row, column) => root.querySelector(`.c4-cell[data-row="${row}"][data-column="${column}"]`);

describe('connect4 UI module', () => {
  it('export meta đúng và preview art 7×6', () => {
    expect(connect4.meta.id).toBe('connect4');
    expect(connect4.meta.label).toBeTruthy();
    expect(typeof connect4.preview).toBe('function');
    expect(typeof connect4.mount).toBe('function');
    const html = connect4.preview();
    expect((html.match(/c4-preview-hole/g) || []).length).toBe(ROWS * COLUMNS);
    expect(html).toContain('is-p1');
    expect(html).toContain('is-p2');
  });

  it('mount/update với state rỗng không lỗi và tái sử dụng DOM node', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
    const board = connect4.mount(root, api);
    expect(() => board.update({})).not.toThrow();
    expect(() => board.update(view())).not.toThrow();
    expect(root.querySelectorAll('.c4-col')).toHaveLength(COLUMNS);
    expect(cellsOf(root)).toHaveLength(ROWS * COLUMNS);
    expect(cellsOf(root).every((cell) => cell.disabled)).toBe(true);
    expect(root.querySelector('.c4-board').classList.contains('is-locked')).toBe(true);

    const firstCell = cellsOf(root)[0];
    board.update(view(emptyState(), { interactive: true }));
    expect(cellsOf(root)[0]).toBe(firstCell);
    expect(cellsOf(root).every((cell) => cell.disabled)).toBe(false);

    board.update(view(emptyState(), { interactive: false }));
    expect(cellsOf(root).every((cell) => cell.disabled)).toBe(true);

    board.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('interactive=false: click không gọi onMove', () => {
    const { root, api } = setup(emptyState(), { interactive: false });
    const cell = root.querySelector('.c4-cell[data-column="3"]');
    expect(cell.disabled).toBe(true);
    cell.click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('interactive=true: click cột hợp lệ gọi onMove({column})', () => {
    const { root, api } = setup(emptyState(), { interactive: true });
    const cell = root.querySelector('.c4-cell[data-column="4"][data-row="2"]');
    expect(cell.disabled).toBe(false);
    cell.click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({ column: 4 });

    // Click trúng quân (span con) vẫn nhờ event delegation mà gửi đúng cột.
    root.querySelector('.c4-cell[data-column="0"] .c4-stone').click();
    expect(api.onMove).toHaveBeenLastCalledWith({ column: 0 });
    expect(api.onMove).toHaveBeenCalledTimes(2);
  });

  it('cột đầy bị chặn, chỉ hiện toast', () => {
    const state = emptyState();
    for (let row = 0; row < ROWS; row += 1) state.board[row][2] = row % 2 === 0 ? 2 : 1;
    const { root, api } = setup(state, { interactive: true });
    root.querySelector('.c4-cell[data-column="2"]').click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(api.showToast).toHaveBeenCalled();
  });

  it('legalMoves giới hạn cột được phép gửi', () => {
    const { root, api } = setup(emptyState(), { interactive: true, legalMoves: [{ column: 1 }] });
    root.querySelector('.c4-cell[data-column="5"]').click();
    expect(api.onMove).not.toHaveBeenCalled();
    root.querySelector('.c4-cell[data-column="1"]').click();
    expect(api.onMove).toHaveBeenCalledWith({ column: 1 });
  });

  it('winning_cells render class thắng', () => {
    const state = emptyState();
    state.board[5] = [1, 1, 1, 1, null, null, null];
    state.winner_seat = 1;
    state.result = 'win';
    state.winning_cells = [[5, 0], [5, 1], [5, 2], [5, 3]];
    const { root } = setup(state, { interactive: false });
    const cells = cellsOf(root);
    for (const [row, column] of state.winning_cells) {
      expect(cellAt(root, row, column).classList.contains('is-win')).toBe(true);
    }
    expect(cellAt(root, 5, 4).classList.contains('is-win')).toBe(false);
    expect(cells.filter((cell) => cell.classList.contains('is-win'))).toHaveLength(4);
  });

  it('lastMove.column đánh dấu quân vừa đi', () => {
    const state = emptyState();
    state.board[5][2] = 1;
    state.board[4][2] = 2;
    const { root } = setup(state, { lastMove: { column: 2 }, interactive: false });
    const cells = cellsOf(root);
    expect(cellAt(root, 4, 2).classList.contains('is-last')).toBe(true);
    expect(cellAt(root, 5, 2).classList.contains('is-last')).toBe(false);
    expect(cells.filter((cell) => cell.classList.contains('is-last'))).toHaveLength(1);
  });

  it('hover hiện quân mờ ở ô sẽ rơi và tô cột', () => {
    const { root } = setup(emptyState(), { interactive: true });
    const target = root.querySelector('.c4-cell[data-column="1"][data-row="5"]');
    target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(target.classList.contains('is-ghost')).toBe(true);
    expect(target.querySelector('.c4-stone').classList.contains('has-stone')).toBe(true);
    expect(root.querySelector('.c4-col[data-column="1"]').classList.contains('is-hover')).toBe(true);

    target.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    expect(target.classList.contains('is-ghost')).toBe(false);
    expect(root.querySelector('.c4-col[data-column="1"]').classList.contains('is-hover')).toBe(false);
  });
});
