import { afterEach, describe, expect, it, vi } from 'vitest';
import ticTacToe from '../../../public/games/js/games/tic-tac-toe.js';

function emptyState(overrides = {}) {
  return { board: Array(9).fill(null), current_seat: 1, winner_seat: null, result: null, ...overrides };
}

function setup({ interactive = false, legalMoves = null, state = emptyState(), winnerSeat = null, lastMove = null, status = 'active', mySeat = 1, role = 'player' } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onMove = vi.fn();
  const showToast = vi.fn();
  const sound = vi.fn();
  const board = ticTacToe.mount(root, { onMove, showToast, sound });
  board.update({
    state,
    mySeat,
    role,
    interactive,
    legalMoves,
    lastMove,
    status,
    winnerSeat,
    players: [],
    roomCode: 'TEST1234',
    turnSeconds: 30
  });
  return { root, board, onMove, showToast, cells: [...root.querySelectorAll('.ttt-cell')] };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tic-tac-toe UI module', () => {
  it('export đúng meta/preview/mount theo hợp đồng', () => {
    expect(ticTacToe.meta.id).toBe('tic_tac_toe');
    expect(typeof ticTacToe.meta.label).toBe('string');
    expect(typeof ticTacToe.meta.tagline).toBe('string');
    expect(typeof ticTacToe.preview).toBe('function');
    expect(ticTacToe.preview()).toContain('ttt-preview');
    expect(ticTacToe.preview()).not.toContain('<script');

    const root = document.createElement('div');
    const board = ticTacToe.mount(root, { onMove: vi.fn() });
    expect(typeof board.update).toBe('function');
    expect(typeof board.destroy).toBe('function');
    board.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('mount + update với state rỗng render 9 ô, không lỗi', () => {
    const { root, cells } = setup();
    expect(cells).toHaveLength(9);
    expect(root.querySelectorAll('button.ttt-cell')).toHaveLength(9);
    expect(cells.every((cell) => cell.textContent === '')).toBe(true);
    expect(cells.every((cell) => cell.disabled)).toBe(true);
  });

  it('interactive=false thì click không gọi onMove', () => {
    const { cells, onMove } = setup({ interactive: false, legalMoves: [{ index: 0 }] });
    cells.forEach((cell) => cell.click());
    expect(onMove).not.toHaveBeenCalled();
  });

  it('khán giả: bàn bị khóa và mọi ô disabled', () => {
    const { root, cells } = setup({ interactive: false, role: 'spectator' });
    expect(root.querySelector('.ttt-board')).toHaveClass('is-locked');
    expect(cells.every((cell) => cell.disabled)).toBe(true);
  });

  it('interactive=true + legalMoves: chỉ ô hợp lệ gọi onMove({ index })', () => {
    const { cells, onMove, showToast } = setup({ interactive: true, legalMoves: [{ index: 0 }, { index: 4 }] });
    cells[1].click();
    expect(onMove).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);

    cells[0].click();
    expect(onMove).toHaveBeenCalledWith({ index: 0 });
    cells[4].click();
    expect(onMove).toHaveBeenCalledWith({ index: 4 });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('nước vừa đánh có class is-last và đúng màu quân', () => {
    const state = emptyState({ board: [null, null, null, null, 2, null, null, null, null], current_seat: 1 });
    const { cells } = setup({ state, interactive: true, legalMoves: [{ index: 0 }], lastMove: { index: 4 }, mySeat: 2 });
    expect(cells[4]).toHaveClass('is-p2');
    expect(cells[4]).toHaveClass('is-last');
    expect(cells[4].textContent).toBe('○');
    expect(cells[0]).toHaveClass('is-empty');
  });

  it('winning_cells [[row, column]] tô sáng đúng hàng thắng', () => {
    const state = emptyState({
      board: [1, 2, null, null, 1, null, null, null, 1],
      winner_seat: 1,
      result: 'win',
      winning_cells: [[0, 0], [1, 1], [2, 2]]
    });
    const { cells } = setup({ state, winnerSeat: 1, status: 'finished', interactive: false });
    for (const index of [0, 4, 8]) expect(cells[index]).toHaveClass('is-winning');
    expect(cells[1]).not.toHaveClass('is-winning');
    expect(cells[0].getAttribute('aria-label')).toContain('hàng thắng');
  });

  it('winning_cells dạng index trần (tương thích cũ) vẫn tô sáng', () => {
    const state = emptyState({
      board: [1, 1, 1, 2, 2, null, null, null, null],
      winner_seat: 1,
      result: 'win',
      winning_cells: [0, 1, 2]
    });
    const { cells } = setup({ state, winnerSeat: 1, status: 'finished' });
    for (const index of [0, 1, 2]) expect(cells[index]).toHaveClass('is-winning');
    expect(cells[3]).not.toHaveClass('is-winning');
  });

  it('update lại nhiều lần tái sử dụng node, không nhân đôi ô', () => {
    const { root, board, cells } = setup({ interactive: true, legalMoves: [] });
    board.update({ state: emptyState({ board: [1, null, null, null, null, null, null, null, null] }), interactive: true, legalMoves: [{ index: 1 }] });
    expect(root.querySelectorAll('.ttt-cell')).toHaveLength(9);
    expect(cells[0].textContent).toBe('✕');
    expect(cells[0]).toHaveClass('is-p1');
    expect(cells[1].disabled).toBe(false);
  });
});
