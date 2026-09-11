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

// Test Resignation
let chessResign = initialState('chess');
chessResign = applyMove('chess', chessResign, { resign: true }, 1);
assert.equal(chessResign.result, 'win');
assert.equal(chessResign.winner_seat, 2);
assert.equal(chessResign.resigned_seat, 1);

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
