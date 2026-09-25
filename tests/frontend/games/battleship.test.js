// Test UI Battleship (Vitest + jsdom): hợp đồng module, mount/update, pha đặt tàu,
// pha bắn với state đã được server che theo ghế, click khi interactive bật/tắt.
import { describe, expect, it, vi } from 'vitest';
import battleship from '../../../public/games/js/games/battleship.js';
import { canInteractWithGameBoard } from '../../../public/games/js/views/room.js';

const SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

const clone = (value) => JSON.parse(JSON.stringify(value));

function emptyShips() {
  return SHIP_LENGTHS.map((length) => ({ length, cells: [], hits: [], sunk: false }));
}

function placingState(overrides = {}) {
  return {
    phase: 'placing',
    size: SIZE,
    fleets: { 1: emptyShips(), 2: emptyShips() },
    ready: { 1: false, 2: false },
    shots: { 1: [], 2: [] },
    current_seat: 1,
    winner_seat: null,
    result: null,
    move_number: 0,
    ...overrides
  };
}

// State đúng như server gửi cho ghế 1 lúc playing: hạm đội mình đầy đủ toạ độ,
// hạm đội địch chỉ lộ tàu đã chìm + toạ độ, tàu chưa chìm cells rỗng.
function playerOneState() {
  return {
    phase: 'playing',
    size: SIZE,
    fleets: {
      1: [
        { length: 5, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], hits: [], sunk: false },
        { length: 4, cells: [[2, 0], [2, 1], [2, 2], [2, 3]], hits: [[2, 0]], sunk: false },
        { length: 3, cells: [[4, 0], [4, 1], [4, 2]], hits: [], sunk: false },
        { length: 3, cells: [[6, 0], [6, 1], [6, 2]], hits: [], sunk: false },
        { length: 2, cells: [[8, 0], [8, 1]], hits: [], sunk: false }
      ],
      2: [
        { length: 5, hits: 0, sunk: false, cells: [] },
        { length: 4, hits: 0, sunk: false, cells: [] },
        { length: 3, hits: 2, sunk: false, cells: [] },
        { length: 3, hits: 0, sunk: false, cells: [] },
        { length: 2, hits: 2, sunk: true, cells: [[8, 5], [8, 6]] }
      ]
    },
    ready: { 1: true, 2: true },
    shots: {
      1: [[8, 5, 'hit'], [8, 6, 'hit']],
      2: [[2, 0, 'hit'], [0, 9, 'miss']]
    },
    current_seat: 1,
    winner_seat: null,
    result: null,
    move_number: 5
  };
}

function view(state, extra = {}) {
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
    turnSeconds: 0,
    ...extra
  };
}

function setup(state, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
  const board = battleship.mount(root, api);
  board.update(view(state, extra));
  return { root, api, board };
}

const gridCells = (root, board) => Array.from(root.querySelectorAll(`[data-board="${board}"] .bs-cell`));
const cellAt = (root, board, row, column) => root.querySelector(
  `[data-board="${board}"] .bs-cell[data-row="${row}"][data-column="${column}"]`
);
const markedCells = (root, board, className) => gridCells(root, board).filter((cell) => cell.classList.contains(className));

describe('battleship UI module', () => {
  it('cho phép cả hai ghế chuẩn bị song song nhưng vẫn giữ lượt bắn', () => {
    const placing = {
      role: 'player',
      roomStatus: 'active',
      gameType: 'battleship',
      phase: 'placing',
      mySeat: 2,
      ready: { 1: false, 2: false },
      currentSeat: 1,
      result: null
    };
    expect(canInteractWithGameBoard(placing)).toBe(true);
    expect(canInteractWithGameBoard({ ...placing, ready: { 1: true, 2: false } })).toBe(true);
    expect(canInteractWithGameBoard({ ...placing, ready: { 1: false, 2: true } })).toBe(false);
    expect(canInteractWithGameBoard({ ...placing, phase: 'playing', currentSeat: 1 })).toBe(false);
    expect(canInteractWithGameBoard({ ...placing, phase: 'playing', currentSeat: 2 })).toBe(true);
  });

  it('export meta đúng và preview 10×10', () => {
    expect(battleship.meta.id).toBe('battleship');
    expect(battleship.meta.label).toBeTruthy();
    expect(typeof battleship.preview).toBe('function');
    expect(typeof battleship.mount).toBe('function');
    const html = battleship.preview();
    expect((html.match(/bs-preview-cell/g) || []).length).toBe(SIZE * SIZE);
    expect(html).toContain('is-ship');
    expect(html).toContain('is-hit');
    expect(html).toContain('is-miss');
  });

  it('mount/update với state rỗng không lỗi; DOM dựng một lần và destroy dọn sạch', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
    const board = battleship.mount(root, api);
    expect(() => board.update({})).not.toThrow();
    expect(() => board.update(view(placingState(), { interactive: true }))).not.toThrow();
    expect(gridCells(root, 'placing')).toHaveLength(SIZE * SIZE);
    expect(gridCells(root, 'attack')).toHaveLength(SIZE * SIZE);
    expect(gridCells(root, 'home')).toHaveLength(SIZE * SIZE);

    const firstCell = gridCells(root, 'placing')[0];
    board.update(view(placingState(), { interactive: true }));
    expect(gridCells(root, 'placing')[0]).toBe(firstCell);

    board.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('pha placing interactive=true: đặt tay đủ 5 tàu rồi Sẵn sàng gửi place:true', () => {
    const { root, api } = setup(placingState(), { interactive: true });
    expect(root.querySelector('[data-panel="placing"]').hidden).toBe(false);
    expect(root.querySelector('[data-panel="attack"]').hidden).toBe(true);
    expect(root.querySelector('[data-panel="home"]').hidden).toBe(true);
    expect(gridCells(root, 'placing').every((cell) => cell.disabled)).toBe(false);

    // Chưa đủ 5 tàu thì nút Sẵn sàng bị khoá.
    const ready = root.querySelector('[data-action="ready"]');
    expect(ready.disabled).toBe(true);
    ready.click();
    expect(api.onMove).not.toHaveBeenCalled();

    // Đặt ngẫu nhiên gửi { auto: true }.
    root.querySelector('[data-action="auto"]').click();
    expect(api.onMove).toHaveBeenCalledWith({ auto: true });
    api.onMove.mockClear();

    // Đặt tay 5 tàu ngang ở các hàng 0,2,4,6,8.
    const anchors = [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]];
    anchors.forEach(([row, column]) => cellAt(root, 'placing', row, column).click());
    expect(api.onMove).not.toHaveBeenCalled();
    expect(markedCells(root, 'placing', 'is-ship')).toHaveLength(5 + 4 + 3 + 3 + 2);
    expect(ready.disabled).toBe(false);

    ready.click();
    expect(api.onMove).toHaveBeenCalledTimes(1);
    expect(api.onMove).toHaveBeenCalledWith({
      place: true,
      ships: [
        { row: 0, column: 0, horizontal: true },
        { row: 2, column: 0, horizontal: true },
        { row: 4, column: 0, horizontal: true },
        { row: 6, column: 0, horizontal: true },
        { row: 8, column: 0, horizontal: true }
      ]
    });
  });

  it('pha placing: xoay dọc đặt tàu theo cột, hoàn tác bớt tàu', () => {
    const { root, api } = setup(placingState(), { interactive: true });
    root.querySelector('[data-action="rotate"]').click();
    cellAt(root, 'placing', 0, 1).click();
    const placed = markedCells(root, 'placing', 'is-ship').map((cell) => `${cell.dataset.row},${cell.dataset.column}`);
    expect(placed.sort()).toEqual(['0,1', '1,1', '2,1', '3,1', '4,1']);
    expect(api.sound).toHaveBeenCalledWith('move');

    root.querySelector('[data-action="undo"]').click();
    expect(markedCells(root, 'placing', 'is-ship')).toHaveLength(0);

    // Tàu không được chồng lên nhau: đặt lại rồi thử đè lên chính nó.
    root.querySelector('[data-action="rotate"]').click(); // về ngang
    cellAt(root, 'placing', 0, 0).click();
    cellAt(root, 'placing', 0, 3).click(); // tàu 4 ô bắt đầu tại (0,3) chồng (0,3)-(0,4)
    expect(markedCells(root, 'placing', 'is-ship')).toHaveLength(5);
    expect(api.showToast).toHaveBeenCalled();
  });

  it('interactive=false: click lưới đặt tàu và nút auto/ready đều không gửi move', () => {
    const { root, api } = setup(placingState(), { interactive: false });
    expect(gridCells(root, 'placing').every((cell) => cell.disabled)).toBe(true);
    cellAt(root, 'placing', 0, 0).click();
    root.querySelector('[data-action="auto"]').click();
    root.querySelector('[data-action="ready"]').click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('mình đã ready: hiện thông báo chờ, ẩn công cụ đặt tàu', () => {
    const state = placingState({ ready: { 1: true, 2: false } });
    const { root } = setup(state, { interactive: false });
    expect(root.querySelector('[data-tools]').hidden).toBe(true);
    expect(root.querySelector('[data-wait]').hidden).toBe(false);
    expect(root.querySelector('[data-wait]').textContent).toContain('chờ đối thủ');
  });

  it('pha playing: click ô chưa bắn gửi { row, column }, ô đã bắn bị chặn', () => {
    const state = playerOneState();
    const { root, api } = setup(state, { interactive: true, legalMoves: null });
    expect(root.querySelector('[data-panel="attack"]').hidden).toBe(false);
    expect(root.querySelector('[data-panel="home"]').hidden).toBe(false);
    expect(root.querySelector('[data-panel="placing"]').hidden).toBe(true);

    const target = cellAt(root, 'attack', 3, 3);
    expect(target.disabled).toBe(false);
    target.click();
    expect(api.onMove).toHaveBeenCalledWith({ row: 3, column: 3 });

    // Ô đã bắn (8,5) bị khoá, không gửi thêm.
    api.onMove.mockClear();
    const shot = cellAt(root, 'attack', 8, 5);
    expect(shot.disabled).toBe(true);
    shot.click();
    expect(api.onMove).not.toHaveBeenCalled();

    // Lưới hạm đội mình luôn chỉ để xem.
    const own = cellAt(root, 'home', 5, 5);
    expect(own.disabled).toBe(true);
    own.click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('interactive=false: click lưới bắn không gọi onMove', () => {
    const { root, api } = setup(playerOneState(), { interactive: false });
    expect(gridCells(root, 'attack').every((cell) => cell.disabled)).toBe(true);
    cellAt(root, 'attack', 3, 3).click();
    expect(api.onMove).not.toHaveBeenCalled();
  });

  it('legalMoves giới hạn ô được bắn', () => {
    const { root, api } = setup(playerOneState(), { interactive: true, legalMoves: [{ row: 3, column: 3 }] });
    cellAt(root, 'attack', 4, 4).click();
    expect(api.onMove).not.toHaveBeenCalled();
    expect(api.showToast).toHaveBeenCalled();
    cellAt(root, 'attack', 3, 3).click();
    expect(api.onMove).toHaveBeenCalledWith({ row: 3, column: 3 });
  });

  it('DOM chỉ vẽ theo state đã che: tàu địch chưa chìm không hề xuất hiện', () => {
    const { root, board } = setup(playerOneState(), { interactive: true });

    // Lưới địch chỉ có đúng 2 ô "tàu" — là tàu 2 ô đã chìm — dù hạm đội địch có 5 tàu.
    const enemyShipCells = markedCells(root, 'attack', 'is-ship')
      .map((cell) => `${cell.dataset.row},${cell.dataset.column}`)
      .sort();
    expect(enemyShipCells).toEqual(['8,5', '8,6']);
    expect(markedCells(root, 'attack', 'is-sunk')).toHaveLength(2);

    // Lưới nhà hiện đủ 17 ô tàu của mình.
    expect(markedCells(root, 'home', 'is-ship')).toHaveLength(5 + 4 + 3 + 3 + 2);

    // Nếu server che hoàn toàn (không tàu nào chìm), lưới địch không còn ô tàu nào.
    const hiddenState = clone(playerOneState());
    hiddenState.fleets[2] = emptyShips();
    board.update(view(hiddenState, { interactive: true }));
    expect(markedCells(root, 'attack', 'is-ship')).toHaveLength(0);
    expect(markedCells(root, 'attack', 'is-sunk')).toHaveLength(0);

    // Defense-in-depth: tàu địch chưa chìm không được vẽ ngay cả nếu payload
    // không có thuộc tính sunk/cells đúng chuẩn.
    const malformedHiddenState = clone(playerOneState());
    malformedHiddenState.fleets[2][0] = { length: 5, hits: 0, sunk: false, cells: [[0, 0], [0, 1]] };
    board.update(view(malformedHiddenState, { interactive: true }));
    expect(markedCells(root, 'attack', 'is-ship')).toHaveLength(2);
  });

  it('bắn trúng phát âm capture từ chênh lệch shots trong state', () => {
    const start = playerOneState();
    const { api, board } = setup(start, { interactive: true });
    expect(api.sound).not.toHaveBeenCalledWith('capture');

    const next = clone(start);
    next.shots[1] = [...next.shots[1], [3, 3, 'hit']];
    next.move_number += 1;
    board.update(view(next, { interactive: true }));
    expect(api.sound).toHaveBeenCalledWith('capture');
  });

  it('lastMove tô ô vừa bắn trên đúng lưới', () => {
    const state = playerOneState();
    const { root } = setup(state, { interactive: false, lastMove: { row: 8, column: 6 } });
    expect(cellAt(root, 'attack', 8, 6).classList.contains('is-last')).toBe(true);
    expect(markedCells(root, 'attack', 'is-last')).toHaveLength(1);

    const { root: homeRoot } = setup(state, { interactive: false, lastMove: { row: 2, column: 0 } });
    expect(cellAt(homeRoot, 'home', 2, 0).classList.contains('is-last')).toBe(true);
    expect(markedCells(homeRoot, 'attack', 'is-last')).toHaveLength(0);
  });

  it('render trục A–J / 1–10 và trạng thái chuẩn bị hai bên', () => {
    const state = placingState();
    const { root } = setup(state, { interactive: true });
    expect(root.querySelector('[data-board="placing"]').querySelectorAll('.bs-axis-label')).toHaveLength(SIZE * 2);
    expect(root.querySelector('[data-prep]').hidden).toBe(false);
    expect(root.querySelector('[data-prep-count]').textContent).toContain('0/2');
    expect(root.querySelectorAll('.bs-readiness-item')).toHaveLength(2);
    expect(root.querySelector('[data-prep-copy]').textContent).toContain('Không cần chờ lượt');

    const readyState = placingState({ ready: { 1: true, 2: false } });
    // setup/update is intentionally exercised through the public board contract.
    const nextRoot = document.createElement('div');
    document.body.appendChild(nextRoot);
    const api = { onMove: vi.fn(), showToast: vi.fn(), sound: vi.fn() };
    const nextBoard = battleship.mount(nextRoot, api);
    nextBoard.update(view(readyState, { interactive: false }));
    expect(nextRoot.querySelector('[data-prep-count]').textContent).toContain('1/2');
    expect(nextRoot.querySelector('[data-prep-copy]').textContent).toContain('đã sẵn sàng');
    nextBoard.destroy();
  });

  it('báo trúng/trượt bằng live region và tô ô vừa bắn', () => {
    const start = playerOneState();
    const { root, board } = setup(start, { interactive: true });
    const feedback = root.querySelector('[data-feedback]');
    expect(feedback.hidden).toBe(true);

    const hit = clone(start);
    hit.shots[1] = [...hit.shots[1], [3, 3, 'hit']];
    hit.move_number += 1;
    board.update(view(hit, { interactive: true }));
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toContain('Bắn trúng');
    expect(cellAt(root, 'attack', 3, 3).classList.contains('is-last')).toBe(true);

    const miss = clone(hit);
    miss.shots[1] = [...miss.shots[1], [3, 4, 'miss']];
    miss.move_number += 1;
    board.update(view(miss, { interactive: true }));
    expect(feedback.textContent).toContain('Bắn trượt');
  });

  it('phát hiện chuyển tàu sang sunk và không lộ tàu chưa chìm', () => {
    const before = playerOneState();
    before.fleets[2][4] = { length: 2, hits: 1, sunk: false, cells: [] };
    before.shots[1] = [[8, 5, 'hit']];
    const { root, board } = setup(before, { interactive: true });
    expect(markedCells(root, 'attack', 'is-just-sunk')).toHaveLength(0);

    const after = clone(before);
    after.fleets[2][4] = { length: 2, hits: 2, sunk: true, cells: [[8, 5], [8, 6]] };
    after.shots[1] = [[8, 5, 'hit'], [8, 6, 'hit']];
    after.move_number += 1;
    board.update(view(after, { interactive: true }));

    const feedback = root.querySelector('[data-feedback]');
    expect(feedback.textContent).toContain('Bắn chìm');
    expect(markedCells(root, 'attack', 'is-just-sunk')).toHaveLength(2);
    expect(markedCells(root, 'attack', 'is-sunk')).toHaveLength(2);
  });
});
