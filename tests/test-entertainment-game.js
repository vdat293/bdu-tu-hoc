import assert from 'node:assert/strict';
import { EntertainmentGameInternals } from '../src/services/entertainment-game.service.js';

const { initialState, applyMove } = EntertainmentGameInternals;

let state = initialState('tic_tac_toe');
state = applyMove('tic_tac_toe', state, { index: 0 }, 1);
state = applyMove('tic_tac_toe', state, { index: 3 }, 2);
state = applyMove('tic_tac_toe', state, { index: 1 }, 1);
state = applyMove('tic_tac_toe', state, { index: 4 }, 2);
state = applyMove('tic_tac_toe', state, { index: 2 }, 1);
assert.equal(state.winner_seat, 1);
assert.throws(() => applyMove('tic_tac_toe', state, { index: 5 }, 2), /đã kết thúc/i);

state = initialState('caro');
for (const [row, column, seat] of [[7, 3, 1], [0, 0, 2], [7, 4, 1], [0, 1, 2], [7, 5, 1], [0, 2, 2], [7, 6, 1], [0, 3, 2], [7, 7, 1]]) state = applyMove('caro', state, { row, column }, seat);
assert.equal(state.winner_seat, 1);

state = initialState('connect4');
for (const [column, seat] of [[0, 1], [1, 2], [0, 1], [1, 2], [0, 1], [1, 2], [0, 1]]) state = applyMove('connect4', state, { column }, seat);
assert.equal(state.winner_seat, 1);

state = initialState('chess');
state = applyMove('chess', state, { from: { row: 6, column: 4 }, to: { row: 4, column: 4 } }, 1);
assert.equal(state.board[4][4], 'wp');
assert.throws(() => applyMove('chess', state, { from: { row: 6, column: 0 }, to: { row: 3, column: 0 } }, 2), /không hợp lệ/i);

state = initialState('xiangqi');
state = applyMove('xiangqi', state, { from: { row: 6, column: 0 }, to: { row: 5, column: 0 } }, 1);
assert.equal(state.board[5][0], 'rp');

state = initialState('go');
state = applyMove('go', state, { row: 4, column: 4 }, 1);
assert.equal(state.board[4][4], 1);
state = applyMove('go', state, { pass: true }, 2);
state = applyMove('go', state, { pass: true }, 1);
assert.equal(state.result, 'win');
assert.equal(state.winner_seat, 1);

// Test Vietnamese Caro 2-end block rule (Chặn 2 đầu không thắng)
let caroBlocked = initialState('caro');
// O X X X X X O (seat 1 has 5 in a row, but both ends blocked by seat 2)
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 2 }, 1); // X
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 1 }, 2); // O (blocks left)
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 3 }, 1); // X
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 7 }, 2); // O (blocks right)
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 4 }, 1); // X
caroBlocked = applyMove('caro', caroBlocked, { row: 0, column: 0 }, 2);
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 5 }, 1); // X
caroBlocked = applyMove('caro', caroBlocked, { row: 0, column: 1 }, 2);
caroBlocked = applyMove('caro', caroBlocked, { row: 7, column: 6 }, 1); // X (completes 5, but blocked both ends by O at (7,1) and (7,7)!)
assert.equal(caroBlocked.result, null); // NOT a win because blocked at both ends!
assert.equal(caroBlocked.winner_seat, null);

// Caro: 5 quân chỉ bị chặn MỘT đầu vẫn thắng.
let caroOneEnd = initialState('caro');
caroOneEnd = applyMove('caro', caroOneEnd, { row: 7, column: 3 }, 1);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 0, column: 0 }, 2);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 7, column: 4 }, 1);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 0, column: 1 }, 2);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 7, column: 5 }, 1);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 0, column: 2 }, 2);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 7, column: 6 }, 1);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 0, column: 3 }, 2);
caroOneEnd = applyMove('caro', caroOneEnd, { row: 7, column: 7 }, 1); // O X X X X X _
assert.equal(caroOneEnd.winner_seat, 1, '5 quân chặn một đầu phải thắng');
assert.equal(caroOneEnd.winning_cells.length, 5);

// Caro: 6 quân liên tiếp thắng kể cả khi bị chặn hai đầu. Chuỗi được tạo bằng
// cách lấp khe nên không có thế 5 quân nào xuất hiện trước đó.
let caroSix = initialState('caro');
const caroSixMoves = [
  [1, 5, 1], [0, 5, 2],
  [2, 5, 1], [7, 5, 2],
  [3, 5, 1], [0, 0, 2],
  [5, 5, 1], [0, 1, 2],
  [6, 5, 1], [0, 2, 2],
  [4, 5, 1] // O X X X X X X O theo cột 5 => 6 quân, thắng
];
for (const [row, column, seat] of caroSixMoves) caroSix = applyMove('caro', caroSix, { row, column }, seat);
assert.equal(caroSix.result, 'win', '6 quân liên tiếp phải thắng dù bị chặn hai đầu');

// Caro: 5 quân sát biên (một đầu là thành bàn) vẫn thắng vì chỉ quân đối
// phương mới tính là chặn.
let caroWall = initialState('caro');
const caroWallMoves = [
  [0, 0, 1], [1, 0, 2],
  [0, 1, 1], [1, 1, 2],
  [0, 2, 1], [1, 2, 2],
  [0, 3, 1], [1, 3, 2],
  [0, 4, 1]
];
for (const [row, column, seat] of caroWallMoves) caroWall = applyMove('caro', caroWall, { row, column }, seat);
assert.equal(caroWall.winner_seat, 1, '5 quân sát biên vẫn phải thắng');

// Caro: lấp khe để tạo chuỗi 6 quân liên tiếp giữa hai quân chặn vẫn thắng.
let caroBreakBlock = initialState('caro');
const caroBreakMoves = [
  [7, 1, 1], [7, 0, 2],
  [7, 2, 1], [7, 7, 2],
  [7, 3, 1], [0, 0, 2],
  [7, 5, 1], [0, 1, 2],
  [7, 6, 1], [0, 2, 2],
  [7, 4, 1] // O X X X X X X O => 6 quân, thắng
];
for (const [row, column, seat] of caroBreakMoves) caroBreakBlock = applyMove('caro', caroBreakBlock, { row, column }, seat);
assert.equal(caroBreakBlock.result, 'win', '6 quân liên tiếp luôn thắng');

// Test Resignation
let chessResign = initialState('chess');
chessResign = applyMove('chess', chessResign, { resign: true }, 1);
assert.equal(chessResign.result, 'win');
assert.equal(chessResign.winner_seat, 2);
assert.equal(chessResign.resigned_seat, 1);

// Đầu hàng không phụ thuộc lượt: seat 2 được xin thua khi đang là lượt seat 1.
let caroResign = initialState('caro');
caroResign = applyMove('caro', caroResign, { row: 7, column: 7 }, 1); // giờ là lượt seat 2
caroResign = applyMove('caro', caroResign, { resign: true }, 2);
assert.equal(caroResign.winner_seat, 1, 'đối thủ phải thắng khi seat 2 đầu hàng');
assert.equal(caroResign.resigned_seat, 2);
assert.throws(() => applyMove('caro', caroResign, { resign: true }, 1), /đã kết thúc/i, 'không thể đầu hàng khi ván đã kết thúc');

// Test Xiangqi Board Cannon Count
const xq = initialState('xiangqi');
const redCannons = xq.board.flat().filter((p) => p === 'rc').length;
const blackCannons = xq.board.flat().filter((p) => p === 'bc').length;
assert.equal(redCannons, 2, 'Xiangqi must have exactly 2 red cannons');
assert.equal(blackCannons, 2, 'Xiangqi must have exactly 2 black cannons');

// Test Xiangqi Flying General rule (Chống tướng / Lộ mặt tướng)
const xqFlying = initialState('xiangqi');
// Clear col 4 except red pawn at (6, 4)
xqFlying.board[3][4] = null; // Remove black pawn at (3, 4)
// Now only red pawn at (6, 4) is between rk at (9,4) and bk at (0,4)
// If Red moves (6, 4) to (5, 4) (same column), it remains blocked -> legal
let xqNext = applyMove('xiangqi', xqFlying, { from: { row: 6, column: 4 }, to: { row: 5, column: 4 } }, 1);
assert.equal(xqNext.board[5][4], 'rp');
// If next move exposes the kings, it must be rejected!
// For instance, if Red had a board where moving a piece out of col 4 causes kings to face each other:
const xqExposed = initialState('xiangqi');
xqExposed.board[3][4] = null;
xqExposed.board[6][4] = null;
xqExposed.board[5][4] = 'rr'; // Red rook at (5, 4) is the ONLY piece on col 4
assert.throws(
  () => applyMove('xiangqi', xqExposed, { from: { row: 5, column: 4 }, to: { row: 5, column: 3 } }, 1),
  /lộ mặt tướng/i,
  'Moving piece out of col 4 exposes the two kings and must be rejected'
);

console.log('✓ Entertainment game state machines are server-authoritative, enforce accurate win conditions, and reject invalid turns/moves.');
