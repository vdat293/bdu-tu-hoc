import { afterEach, describe, expect, it, vi } from 'vitest';
import checkers from '../../../public/games/js/games/checkers.js';

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function makeView(overrides = {}) {
  return {
    state: {
      size: 8,
      board: emptyBoard(),
      current_seat: 1,
      chain: null,
      winner_seat: null,
      result: null,
      move_number: 0,
      last_move: null
    },
    mySeat: 1,
    role: 'player',
    interactive: false,
    legalMoves: null,
    lastMove: null,
    status: 'active',
    winnerSeat: null,
    players: [],
    roomCode: 'TEST01',
    turnSeconds: 60,
    ...overrides
  };
}

function mountCheckers(overrides = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
  const app = checkers.mount(root, api);
  app.update(makeView(overrides));
  return { root, api, app };
}

const cellAt = (root, row, column) => root.querySelector(`.chk-cell[data-row="${row}"][data-column="${column}"]`);
const pieceAt = (root, row, column) => cellAt(root, row, column).querySelector('.chk-piece');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('checkers UI module', () => {
  it('export đúng meta/preview/mount theo hợp đồng', () => {
    expect(checkers.meta.id).toBe('checkers');
    expect(checkers.meta.label).toBe('Cờ đam');
    expect(typeof checkers.meta.tagline).toBe('string');
    expect(typeof checkers.preview).toBe('function');
    expect(checkers.preview()).toContain('chk-preview');
    expect(checkers.preview()).not.toContain('<script');

    const root = document.createElement('div');
    const app = checkers.mount(root, { onMove: vi.fn() });
    expect(typeof app.update).toBe('function');
    expect(typeof app.destroy).toBe('function');
    app.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('mount + update state đầu vẽ đủ 64 ô (32 ô đen), tái sử dụng node', () => {
    const { root, app } = mountCheckers();
    expect(root.querySelectorAll('.chk-cell')).toHaveLength(64);
    expect(root.querySelectorAll('.chk-cell.is-dark')).toHaveLength(32);
    expect(root.querySelectorAll('.chk-cell.is-light')).toHaveLength(32);

    const first = root.querySelector('.chk-cell');
    expect(() => app.update({ state: {}, interactive: false, legalMoves: null })).not.toThrow();
    expect(() => app.update({})).not.toThrow();
    app.update(makeView());
    expect(root.querySelectorAll('.chk-cell')).toHaveLength(64);
    expect(root.querySelector('.chk-cell')).toBe(first);
  });

  it('interactive=false thì mọi ô disabled và click không gọi onMove', () => {
    const board = emptyBoard();
    board[5][0] = 'r';
    const legalMoves = [{ from: { row: 5, column: 0 }, to: { row: 4, column: 1 } }];
    const { root, api } = mountCheckers({ interactive: false, state: { board }, legalMoves });

    expect(root.querySelectorAll('.chk-cell:disabled')).toHaveLength(64);
    cellAt(root, 5, 0).click();
    cellAt(root, 4, 1).click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(cellAt(root, 5, 0).className).not.toContain('is-selected');
  });

  it('interactive=true: chọn quân rồi click đích gọi onMove đúng {from,to}', () => {
    const board = emptyBoard();
    board[5][0] = 'r';
    const legalMoves = [{ from: { row: 5, column: 0 }, to: { row: 4, column: 1 } }];
    const { root, api } = mountCheckers({ interactive: true, state: { board }, legalMoves });

    const source = cellAt(root, 5, 0);
    source.click();
    expect(source.className).toContain('is-selected');
    expect(cellAt(root, 4, 1).className).toContain('is-target');

    cellAt(root, 4, 1).click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({ from: { row: 5, column: 0 }, to: { row: 4, column: 1 } });
  });

  it('legalMoves rỗng: click không gọi onMove', () => {
    const board = emptyBoard();
    board[5][0] = 'r';
    const { root, api } = mountCheckers({ interactive: true, state: { board }, legalMoves: [] });

    cellAt(root, 5, 0).click();
    cellAt(root, 4, 1).click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(cellAt(root, 5, 0).className).not.toContain('is-selected');
  });

  it('đang trong chuỗi ăn: chỉ quân trong state.chain được chọn và đi tiếp', () => {
    const board = emptyBoard();
    board[3][2] = 'r';
    board[2][3] = 'b';
    board[7][2] = 'r';
    const legalMoves = [{ from: { row: 3, column: 2 }, to: { row: 1, column: 4 } }];
    const { root, api } = mountCheckers({
      interactive: true,
      state: { board, current_seat: 1, chain: { row: 3, column: 2 } },
      legalMoves
    });

    const chainCell = cellAt(root, 3, 2);
    expect(chainCell.className).toContain('is-chain');
    expect(chainCell.className).toContain('is-selected');
    expect(cellAt(root, 1, 4).className).toContain('is-target');

    // Quân khác không được chọn giữa chuỗi.
    cellAt(root, 7, 2).click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(cellAt(root, 7, 2).className).not.toContain('is-selected');

    cellAt(root, 1, 4).click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({ from: { row: 3, column: 2 }, to: { row: 1, column: 4 } });
  });

  it('highlight nước vừa đi và nước ăn', () => {
    const board = emptyBoard();
    board[5][2] = 'r';
    const { root } = mountCheckers({
      interactive: true,
      state: { board },
      legalMoves: [{ from: { row: 5, column: 2 }, to: { row: 3, column: 4 } }],
      lastMove: { from: { row: 5, column: 2 }, to: { row: 3, column: 4 } }
    });

    expect(cellAt(root, 5, 2).className).toContain('is-last-from');
    expect(cellAt(root, 3, 4).className).toContain('is-last-to');

    cellAt(root, 5, 2).click();
    const target = cellAt(root, 3, 4);
    expect(target.className).toContain('is-target');
    expect(target.className).toContain('is-capture');
  });

  it('phát sound capture đúng một lần cho mỗi nước ăn mới', () => {
    const board = emptyBoard();
    board[5][2] = 'r';
    board[4][3] = 'b';
    const lastMove = { from: { row: 5, column: 2 }, to: { row: 3, column: 4 } };
    const { app, api } = mountCheckers({ interactive: true, state: { board }, legalMoves: null, lastMove });

    expect(api.sound).toHaveBeenCalledWith('capture');
    expect(api.sound).toHaveBeenCalledTimes(1);

    app.update(makeView({ interactive: true, state: { board }, legalMoves: null, lastMove }));
    expect(api.sound).toHaveBeenCalledTimes(1);

    app.update(makeView({ interactive: true, state: { board }, legalMoves: null, lastMove: { from: { row: 5, column: 0 }, to: { row: 4, column: 1 } } }));
    expect(api.sound).toHaveBeenCalledTimes(1);
  });

  it('vẽ đúng màu quân và dấu vua', () => {
    const board = emptyBoard();
    board[0][1] = 'B';
    board[5][0] = 'r';
    const { root } = mountCheckers({ interactive: false, state: { board } });

    expect(pieceAt(root, 0, 1).className).toContain('is-p2');
    expect(pieceAt(root, 0, 1).className).toContain('is-king');
    expect(pieceAt(root, 5, 0).className).toContain('is-p1');
    expect(pieceAt(root, 5, 0).className).not.toContain('is-king');
    expect(pieceAt(root, 4, 3).className).toContain('is-empty');
  });
});
