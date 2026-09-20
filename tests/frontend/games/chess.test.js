import { describe, expect, it, vi } from 'vitest';
import chess from '../../../public/games/js/games/chess.js';

function initialBoard() {
  return [
    ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
    Array(8).fill('bp'),
    Array(8).fill(null), Array(8).fill(null),
    Array(8).fill(null), Array(8).fill(null),
    Array(8).fill('wp'),
    ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
  ];
}

function makeView(overrides = {}) {
  return {
    state: { board: initialBoard(), fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', current_seat: 1, last_notation: null, move_number: 0 },
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

function mountChess(overrides = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
  const app = chess.mount(root, api);
  app.update(makeView(overrides));
  return { root, api, app };
}

describe('chess UI module', () => {
  it('export đúng meta và preview art cho card', () => {
    expect(chess.meta).toMatchObject({ id: 'chess', label: 'Cờ vua' });
    expect(typeof chess.meta.tagline).toBe('string');
    expect(typeof chess.mount).toBe('function');
    expect(typeof chess.preview).toBe('function');
    const art = chess.preview();
    expect(art).toContain('chess-preview');
    expect(art).toContain('chess-preview-square');
  });

  it('mount + update state đầu vẽ 64 ô và tái sử dụng node', () => {
    const { root, app } = mountChess();
    expect(root.querySelectorAll('.chess-square')).toHaveLength(64);
    expect(root.querySelectorAll('.chess-piece.is-white')).toHaveLength(16);
    expect(root.querySelectorAll('.chess-piece.is-black')).toHaveLength(16);
    expect(root.querySelector('[data-square="e2"] .chess-piece').textContent).toBe('♟');
    expect(root.querySelector('[data-square="e1"] .chess-piece').textContent).toBe('♚');
    expect(root.querySelector('[data-square="h8"] .chess-piece').className).toContain('is-black');

    // Update với state rỗng không được lỗi, không dựng lại node.
    const first = root.querySelector('.chess-square');
    expect(() => app.update({ state: {}, interactive: false, legalMoves: null })).not.toThrow();
    app.update(makeView());
    expect(root.querySelectorAll('.chess-square')).toHaveLength(64);
    expect(root.querySelector('.chess-square')).toBe(first);

    app.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('interactive=false thì click không gọi onMove', () => {
    const { root, api } = mountChess({ interactive: false });
    root.querySelector('[data-square="e2"]').click();
    root.querySelector('[data-square="e4"]').click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('interactive=true + legalMoves: chọn e2 rồi e4 gửi đúng toạ độ', () => {
    const view = makeView({
      interactive: true,
      legalMoves: [{ from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }]
    });
    const { root, api } = mountChess(view);
    const source = root.querySelector('[data-square="e2"]');
    source.click();
    expect(source.className).toContain('is-selected');

    const target = root.querySelector('[data-square="e4"]');
    expect(target.className).toContain('is-target');
    target.click();

    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({
      from: { row: 6, column: 4 },
      to: { row: 4, column: 4 }
    });
  });

  it('không gửi nước đi khi ô đích không có trong legalMoves', () => {
    const { root, api } = mountChess({
      interactive: true,
      legalMoves: [{ from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }]
    });
    root.querySelector('[data-square="e2"]').click();
    root.querySelector('[data-square="e5"]').click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('highlight nước vừa đi theo view.lastMove', () => {
    const { root } = mountChess({
      interactive: true,
      lastMove: { from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }
    });
    expect(root.querySelector('[data-square="e2"]').className).toContain('is-last-from');
    expect(root.querySelector('[data-square="e4"]').className).toContain('is-last-to');
  });

  it('tốt tới hàng cuối mở bộ chọn phong cấp rồi gửi kèm promotion', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[1][0] = 'wp'; // a7
    board[7][0] = 'wk';
    board[0][7] = 'bk';
    const legalMoves = ['q', 'r', 'b', 'n'].map((promotion) => ({
      from: { row: 1, column: 0 },
      to: { row: 0, column: 0 },
      promotion
    }));
    const { root, api } = mountChess({ interactive: true, state: { board }, legalMoves });

    root.querySelector('[data-square="a7"]').click();
    root.querySelector('[data-square="a8"]').click();
    expect(root.querySelector('[data-chess-promotion]').hidden).toBe(false);
    expect(root.querySelectorAll('.chess-promotion-btn')).toHaveLength(4);
    expect(api.onMove).not.toHaveBeenCalled();

    root.querySelector('[data-promotion="q"]').click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({
      from: { row: 1, column: 0 },
      to: { row: 0, column: 0 },
      promotion: 'q'
    });
  });

  it('ghế 2 (bàn lật): panel phong cấp đặt theo toạ độ thị giác', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[6][0] = 'bp'; // a2 của đen
    board[7][4] = 'wk';
    board[0][4] = 'bk';
    const legalMoves = ['q', 'r', 'b', 'n'].map((promotion) => ({
      from: { row: 6, column: 0 },
      to: { row: 7, column: 0 },
      promotion
    }));
    const { root } = mountChess({ interactive: true, mySeat: 2, state: { board }, legalMoves });
    const boardEl = root.querySelector('[data-chess-board]');
    Object.defineProperty(boardEl, 'clientWidth', { configurable: true, value: 320 });

    root.querySelector('[data-square="a2"]').click();
    root.querySelector('[data-square="a1"]').click();
    const panel = root.querySelector('[data-chess-promotion]');
    expect(panel.hidden).toBe(false);
    // Ghế 2 nhìn bàn lật: a1 là ô trên-phải (visual row 0, col 7).
    // Nếu dùng nhầm toạ độ logic (row 7, col 0) thì top/left sẽ sai.
    expect(panel.style.top).toBe('50px');
    expect(panel.style.left).toBe('160px');
  });

  it('update nhiều lần rồi click một lần chỉ gửi onMove đúng 1 lần', () => {
    const view = makeView({
      interactive: true,
      legalMoves: [{ from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }]
    });
    const { root, api, app } = mountChess(view);
    app.update(view);
    app.update(view);
    app.update(makeView({
      interactive: true,
      legalMoves: [{ from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }]
    }));

    root.querySelector('[data-square="e2"]').click();
    root.querySelector('[data-square="e4"]').click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
  });
});
