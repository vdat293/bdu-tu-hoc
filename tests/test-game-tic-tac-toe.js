// Test engine Tic Tac Toe: thuần, server-authoritative, không cần DB.
// Chạy: node tests/test-game-tic-tac-toe.js
import assert from 'node:assert/strict';
import { meta, initialState, applyMove, legalMoves, stateForViewer } from '../src/services/games/tic-tac-toe.js';

function expectCode(fn, code, message) {
  assert.throws(fn, (err) => err && err.code === code, message || `phải ném lỗi mã ${code}`);
}

// moves: [[index, seat], ...]
function play(moves, start = initialState()) {
  return moves.reduce((state, [index, seat]) => applyMove(state, { index }, seat), start);
}

// ---- meta + state khởi tạo ----
assert.equal(meta.id, 'tic_tac_toe');
assert.equal(meta.players, 2);
assert.equal(meta.clock, true);
assert.equal(meta.hidden, false);
assert.equal(meta.order, 20);
assert.equal(typeof meta.label, 'string');
assert.ok(meta.label.length > 0);

const initial = initialState();
assert.deepEqual(initial.board, Array(9).fill(null));
assert.equal(initial.current_seat, 1);
assert.equal(initial.winner_seat, null);
assert.equal(initial.result, null);
assert.deepEqual(initialState(), initial, 'initialState phải trả state JSON thuần, tách biệt');
assert.equal(stateForViewer(initial, 1), initial, 'game công khai không che state');
assert.equal(stateForViewer(initial, 2), initial);

// ---- legalMoves phản ánh lượt + ô trống ----
assert.deepEqual(legalMoves(initial, 1), Array.from({ length: 9 }, (_, index) => ({ index })));
assert.deepEqual(legalMoves(initial, 2), [], 'chưa tới lượt thì không có nước đi');

const opening = applyMove(initial, { index: 4 }, 1);
assert.equal(opening.board[4], 1);
assert.equal(opening.current_seat, 2);
assert.equal(initial.board[4], null, 'applyMove không được mutate state gốc');
assert.equal(legalMoves(opening, 1).length, 0);
assert.equal(legalMoves(opening, 2).length, 8);
assert.ok(!legalMoves(opening, 2).some((move) => move.index === 4), 'ô đã đánh không nằm trong legalMoves');

// ---- chặn sai lượt ----
expectCode(() => applyMove(initial, { index: 0 }, 2), 'NOT_YOUR_TURN');
expectCode(() => applyMove(initial, { index: 0 }, 3), 'NOT_YOUR_TURN');
assert.throws(() => applyMove(initial, { index: 0 }, 2), /chưa đến lượt/i);

// ---- chặn payload sai / ô không hợp lệ / ô đã có quân ----
expectCode(() => applyMove(initial, null, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, [0], 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, {}, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: -1 }, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: 9 }, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: 1.5 }, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: null }, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: '4' }, 1), 'GAME_INVALID');
expectCode(() => applyMove(initial, { index: true }, 1), 'GAME_INVALID');

const occupied = applyMove(initial, { index: 0 }, 1);
expectCode(() => applyMove(occupied, { index: 0 }, 2), 'GAME_INVALID');
assert.throws(() => applyMove(occupied, { index: 0 }, 2), /đã được đánh/i);

// ---- thắng hàng ngang (seat 1) ----
const horizontal = play([[0, 1], [3, 2], [1, 1], [4, 2], [2, 1]]);
assert.equal(horizontal.winner_seat, 1);
assert.equal(horizontal.result, 'win');
assert.deepEqual(horizontal.winning_cells, [[0, 0], [0, 1], [0, 2]]);
assert.deepEqual(legalMoves(horizontal, 1), []);
assert.deepEqual(legalMoves(horizontal, 2), []);
expectCode(() => applyMove(horizontal, { index: 8 }, 2), 'GAME_FINISHED');
expectCode(() => applyMove(horizontal, { index: 8 }, 1), 'GAME_FINISHED', 'người thắng cũng không được đi tiếp');

// ---- thắng hàng dọc (seat 2) ----
const vertical = play([[0, 1], [1, 2], [3, 1], [4, 2], [8, 1], [7, 2]]);
assert.equal(vertical.winner_seat, 2);
assert.equal(vertical.result, 'win');
assert.deepEqual(vertical.winning_cells, [[0, 1], [1, 1], [2, 1]]);

// ---- thắng chéo chính (seat 1) ----
const diagonal = play([[0, 1], [1, 2], [4, 1], [2, 2], [8, 1]]);
assert.equal(diagonal.winner_seat, 1);
assert.equal(diagonal.result, 'win');
assert.deepEqual(diagonal.winning_cells, [[0, 0], [1, 1], [2, 2]]);

// ---- thắng chéo phụ (seat 2) ----
const antiDiagonal = play([[0, 1], [2, 2], [1, 1], [4, 2], [3, 1], [6, 2]]);
assert.equal(antiDiagonal.winner_seat, 2);
assert.equal(antiDiagonal.result, 'win');
assert.deepEqual(antiDiagonal.winning_cells, [[0, 2], [1, 1], [2, 0]]);

// ---- hòa khi đầy bàn ----
const draw = play([[4, 1], [0, 2], [8, 1], [2, 2], [6, 1], [3, 2], [5, 1], [7, 2], [1, 1]]);
assert.ok(draw.board.every((cell) => cell !== null), 'ván hòa phải đầy bàn');
assert.equal(draw.result, 'draw');
assert.equal(draw.winner_seat, null);
assert.ok(!draw.winning_cells || draw.winning_cells.length === 0, 'ván hòa không có winning_cells');
assert.deepEqual(legalMoves(draw, 1), []);
assert.deepEqual(legalMoves(draw, 2), []);
expectCode(() => applyMove(draw, { index: 0 }, 1), 'GAME_FINISHED');

// ---- state gốc vẫn nguyên vẹn sau tất cả ----
assert.deepEqual(initial.board, Array(9).fill(null));

console.log('✓ Tic Tac Toe engine: chặn sai lượt/ô không hợp lệ, đủ 4 kiểu thắng, hòa, khóa sau khi kết thúc, legalMoves đúng theo lượt.');
