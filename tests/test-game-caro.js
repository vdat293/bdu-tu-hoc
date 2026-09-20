// Test engine Cờ caro 15×15 (server-authoritative).
// Chạy: node tests/test-game-caro.js
// Bao phủ: luật 5 quân auto win (kể cả bị chặn hai đầu), 6 quân, thắng chéo,
// chặn ô đã đánh / sai lượt / sau khi kết thúc, legalMoves và hòa bàn đầy.
import assert from 'node:assert/strict';
import { applyMove, initialState, legalMoves, meta, stateForViewer } from '../src/services/games/caro.js';

const key = ([row, column]) => `${row},${column}`;
const play = (moves, start = initialState()) => {
  let state = start;
  for (const [row, column, seat] of moves) state = applyMove(state, { row, column }, seat);
  return state;
};

// ---------- meta ----------
assert.equal(meta.id, 'caro');
assert.equal(meta.players, 2);
assert.equal(meta.clock, true);
assert.equal(meta.hidden, false);
assert.equal(meta.order, 10);
assert.ok(meta.label && meta.tagline, 'meta phải có label và tagline');

// ---------- bàn khởi tạo ----------
const initial = initialState();
assert.equal(initial.size, 15);
assert.equal(initial.board.length, 15);
assert.ok(initial.board.every((row) => row.length === 15 && row.every((cell) => cell === null)));
assert.equal(initial.current_seat, 1);
assert.equal(initial.result, null);
assert.equal(initial.winner_seat, null);

// ---------- 5 quân liên tiếp, một đầu trống => THẮNG ----------
const five = play([
  [7, 3, 1], [0, 0, 2],
  [7, 4, 1], [0, 1, 2],
  [7, 5, 1], [0, 2, 2],
  [7, 6, 1], [0, 3, 2],
  [7, 7, 1]
]);
assert.equal(five.result, 'win', '5 quân liên tiếp khi một đầu trống phải thắng');
assert.equal(five.winner_seat, 1);
assert.equal(five.winning_cells.length, 5);
assert.deepEqual(new Set(five.winning_cells.map(key)), new Set(['7,3', '7,4', '7,5', '7,6', '7,7']));
assert.ok(five.winning_cells.every(([row, column]) => five.board[row][column] === 1));

// ---------- 5 quân bị chặn hai đầu => VẪN thắng (luật BDU: 5 là auto win) ----------
const blocked = play([
  [7, 2, 1], [7, 1, 2],
  [7, 3, 1], [7, 7, 2],
  [7, 4, 1], [0, 0, 2],
  [7, 5, 1], [0, 1, 2],
  [7, 6, 1]
]);
assert.equal(blocked.result, 'win', '5 quân bị chặn cả hai đầu vẫn phải thắng');
assert.equal(blocked.winner_seat, 1);
assert.equal(blocked.winning_cells.length, 5);

// ---------- 6 quân liên tiếp => THẮNG dù chặn hai đầu ----------
const six = play([
  [7, 1, 1], [7, 0, 2],
  [7, 2, 1], [7, 7, 2],
  [7, 3, 1], [0, 0, 2],
  [7, 5, 1], [0, 1, 2],
  [7, 6, 1], [0, 2, 2],
  [7, 4, 1]
]);
assert.equal(six.result, 'win', '6 quân liên tiếp phải thắng dù bị chặn hai đầu');
assert.equal(six.winner_seat, 1);
assert.equal(six.winning_cells.length, 6);

// ---------- thắng chéo xuôi ----------
const diag = play([
  [0, 0, 1], [1, 0, 2],
  [1, 1, 1], [2, 0, 2],
  [2, 2, 1], [3, 0, 2],
  [3, 3, 1], [4, 0, 2],
  [4, 4, 1]
]);
assert.equal(diag.result, 'win', 'thắng chéo xuôi phải được nhận diện');
assert.equal(diag.winner_seat, 1);
assert.deepEqual(new Set(diag.winning_cells.map(key)), new Set(['0,0', '1,1', '2,2', '3,3', '4,4']));

// ---------- thắng chéo ngược ----------
const anti = play([
  [7, 7, 1], [0, 0, 2],
  [8, 6, 1], [0, 1, 2],
  [9, 5, 1], [0, 2, 2],
  [10, 4, 1], [0, 3, 2],
  [11, 3, 1]
]);
assert.equal(anti.result, 'win', 'thắng chéo ngược phải được nhận diện');
assert.equal(anti.winner_seat, 1);
assert.deepEqual(new Set(anti.winning_cells.map(key)), new Set(['7,7', '8,6', '9,5', '10,4', '11,3']));

// ---------- chặn ô đã có quân / sai lượt / sau khi kết thúc ----------
const one = applyMove(initial, { row: 0, column: 0 }, 1);
assert.throws(() => applyMove(one, { row: 0, column: 0 }, 2), /đã được đánh|không hợp lệ/i, 'không được đánh vào ô đã có quân');
assert.throws(() => applyMove(initial, { row: 5, column: 5 }, 2), /chưa đến lượt/i, 'seat 2 không được đi khi chưa tới lượt');
assert.throws(() => applyMove(five, { row: 1, column: 1 }, 2), /đã kết thúc/i, 'ván đã kết thúc thì không nhận nước đi');
assert.throws(() => applyMove(five, { row: 1, column: 1 }, 1), /đã kết thúc/i, 'kể cả người thắng cũng không đi thêm được');

// ---------- toạ độ không hợp lệ ----------
for (const move of [{ row: 15, column: 0 }, { row: -1, column: 0 }, { row: 0, column: 15 }, { row: 1.5, column: 2 }, { row: 'x', column: 0 }, {}]) {
  assert.throws(() => applyMove(initial, move, 1), /không hợp lệ|đã được đánh/i, `phải từ chối ${JSON.stringify(move)}`);
}
assert.throws(() => applyMove(initial, null, 1), /không hợp lệ/i);
assert.throws(() => applyMove(initial, [], 1), /không hợp lệ/i);

// ---------- sai kiểu: không được ép kiểu ngầm (audit MEDIUM) ----------
// Trước đây Number(null) === 0, Number('') === 0, Number(false) === 0 nên các
// payload này lọt thành giao điểm (0,0); Number('3') cũng bị ép thành 3.
const beforeBadTypes = JSON.parse(JSON.stringify(initial));
const badTypes = [
  { row: null, column: null },
  { row: '', column: '' },
  { row: false, column: false },
  { row: '3', column: '4' },
  { row: 3, column: '4' },
  { row: true, column: 0 },
  { row: 0, column: null },
  { row: NaN, column: 0 },
  { row: undefined, column: undefined },
  { row: [0], column: 0 },
  { row: {}, column: 0 }
];
for (const move of badTypes) {
  assert.throws(
    () => applyMove(initial, move, 1),
    /Ô cờ caro không hợp lệ hoặc đã được đánh\./,
    `phải từ chối payload sai kiểu ${JSON.stringify(move)}`
  );
}
assert.deepEqual(initial, beforeBadTypes, 'payload sai kiểu không được làm thay đổi bàn');
assert.equal(initial.board[0][0], null, 'null/false/"" không được lọt thành giao điểm (0,0)');
assert.equal(initial.board[3][4], null, "chuỗi '3','4' không được ép thành số");
const stillWorks = applyMove(initial, { row: 0, column: 0 }, 1);
assert.equal(stillWorks.board[0][0], 1, 'số nguyên hợp lệ vẫn đi được bình thường');

// ---------- legalMoves ----------
assert.equal(legalMoves(initial, 1).length, 225);
assert.equal(legalMoves(initial, 2).length, 0, 'không phải lượt thì không có nước hợp lệ');
assert.ok(legalMoves(initial, 1).some((move) => move.row === 0 && move.column === 0));
const afterOne = applyMove(initial, { row: 7, column: 7 }, 1);
assert.equal(legalMoves(afterOne, 2).length, 224, 'đúng 225 - số quân đã đánh khi tới lượt');
assert.equal(legalMoves(afterOne, 1).length, 0);
assert.ok(!legalMoves(afterOne, 2).some((move) => move.row === 7 && move.column === 7), 'ô đã đánh không nằm trong legalMoves');
const afterTwo = applyMove(afterOne, { row: 0, column: 0 }, 2);
assert.equal(legalMoves(afterTwo, 1).length, 223);
assert.deepEqual(legalMoves(five, 2), []);
assert.deepEqual(legalMoves(five, 1), [], 'ván kết thúc thì không còn nước hợp lệ');

// ---------- state tĩnh: applyMove không sửa state gốc ----------
const snapshot = JSON.parse(JSON.stringify(initial));
applyMove(initial, { row: 3, column: 3 }, 1);
assert.deepEqual(initial, snapshot, 'applyMove phải trả state mới, không mutate state gốc');
assert.deepEqual(stateForViewer(afterOne, 1), afterOne, 'caro công khai: stateForViewer trả nguyên state');

// ---------- hòa khi bàn đầy mà không ai nối 5 ----------
// Mẫu màu (floor(row/2) + column) % 2 tạo các đoạn thẳng tối đa 2 quân theo
// cả 4 hướng, nên lấp kín 225 ô vẫn không phát sinh chuỗi 5.
const size = 15;
const drawBoard = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => ((Math.floor(row / 2) + column) % 2 === 0 ? 1 : 2)));
drawBoard[0][0] = null;
const nearFull = { size, board: drawBoard, current_seat: 1, winner_seat: null, result: null, move_number: 224 };
const draw = applyMove(nearFull, { row: 0, column: 0 }, 1);
assert.equal(draw.result, 'draw', 'bàn đầy không có chuỗi 5 phải là hòa');
assert.equal(draw.winner_seat, null);
assert.equal(draw.winning_cells, undefined);
assert.equal(draw.board.flat().filter((cell) => cell === null).length, 0);
assert.deepEqual(legalMoves(draw, 1), []);

console.log('✓ Caro engine: 5 quân auto win, 6 quân phá chặn, thắng chéo, chặn nước sai và legalMoves chuẩn.');
