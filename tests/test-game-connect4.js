// Test engine Connect 4 (server-authoritative). Chạy: node tests/test-game-connect4.js
// Không cần DB: engine là hàm thuần, chỉ import từ src/services/games/.
import assert from 'node:assert/strict';
import { meta, initialState, applyMove, legalMoves, stateForViewer } from '../src/services/games/connect4.js';

const ROWS = 6;
const COLUMNS = 7;

function play(state, moves) {
  let next = state;
  moves.forEach((column, index) => {
    next = applyMove(next, { column }, index % 2 === 0 ? 1 : 2);
  });
  return next;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------- meta & state khởi tạo ----------
assert.equal(meta.id, 'connect4');
assert.equal(meta.players, 2);
assert.equal(meta.clock, true);
assert.equal(meta.hidden, false);
assert.equal(meta.order, 30);

let state = initialState();
assert.equal(state.rows, ROWS);
assert.equal(state.columns, COLUMNS);
assert.equal(state.board.length, ROWS);
assert.ok(state.board.every((row) => row.length === COLUMNS && row.every((cell) => cell === null)));
assert.equal(state.current_seat, 1);
assert.equal(state.winner_seat, null);
assert.equal(state.result, null);

// stateForViewer: game công khai, không che gì.
assert.deepEqual(stateForViewer(state, 1), state);
assert.deepEqual(stateForViewer(state, 2), state);

// ---------- thắng dọc (cột 0) ----------
const vertical = play(initialState(), [0, 1, 0, 1, 0, 1, 0]);
assert.equal(vertical.result, 'win');
assert.equal(vertical.winner_seat, 1);
assert.equal(vertical.winning_cells.length, 4);
const verticalSet = new Set(vertical.winning_cells.map((cell) => `${cell[0]},${cell[1]}`));
assert.deepEqual(verticalSet, new Set(['5,0', '4,0', '3,0', '2,0']));
assert.ok(vertical.winning_cells.every((cell) => cell[1] === 0), 'chuỗi thắng dọc phải cùng cột 0');

// Ván đã kết thúc: không ai đi được nữa, kể cả đúng lượt.
assert.throws(() => applyMove(vertical, { column: 0 }, 1), /đã kết thúc/i);
assert.throws(() => applyMove(vertical, { column: 1 }, 2), /đã kết thúc/i);
assert.deepEqual(legalMoves(vertical, 1), []);
assert.deepEqual(legalMoves(vertical, 2), []);

// ---------- thắng ngang (hàng đáy) ----------
const horizontal = play(initialState(), [0, 0, 1, 1, 2, 2, 3]);
assert.equal(horizontal.result, 'win');
assert.equal(horizontal.winner_seat, 1);
assert.equal(horizontal.winning_cells.length, 4);
assert.ok(horizontal.winning_cells.every((cell) => cell[0] === 5), 'chuỗi thắng ngang phải cùng hàng 5');
assert.deepEqual(
  [...horizontal.winning_cells].map((cell) => cell[1]).sort(),
  [0, 1, 2, 3]
);

// ---------- thắng chéo xuôi (↘, xuống phải) ----------
const diagonalDown = play(initialState(), [6, 5, 5, 4, 4, 3, 3, 6, 6, 5, 4, 3, 3]);
assert.equal(diagonalDown.result, 'win');
assert.equal(diagonalDown.winner_seat, 1);
assert.equal(diagonalDown.winning_cells.length, 4);
assert.deepEqual(
  new Set(diagonalDown.winning_cells.map((cell) => `${cell[0]},${cell[1]}`)),
  new Set(['2,3', '3,4', '4,5', '5,6'])
);

// ---------- thắng chéo ngược (↙, xuống trái) ----------
const diagonalUp = play(initialState(), [0, 1, 1, 2, 2, 3, 3, 0, 0, 6, 2, 3, 3]);
assert.equal(diagonalUp.result, 'win');
assert.equal(diagonalUp.winner_seat, 1);
assert.equal(diagonalUp.winning_cells.length, 4);
assert.deepEqual(
  new Set(diagonalUp.winning_cells.map((cell) => `${cell[0]},${cell[1]}`)),
  new Set(['5,0', '4,1', '3,2', '2,3'])
);

// ---------- cột đầy bị chặn ----------
let fullColumn = initialState();
for (let index = 0; index < ROWS; index += 1) {
  fullColumn = applyMove(fullColumn, { column: 0 }, index % 2 === 0 ? 1 : 2);
}
assert.equal(fullColumn.result, null, 'xen kẽ 2 ghế trong một cột không được tạo thắng dọc');
assert.equal(fullColumn.board[0][0], 2, 'ô trên cùng cột 0 phải là quân ghế 2');
assert.throws(() => applyMove(fullColumn, { column: 0 }, 1), /đầy/i);
// Cột khác vẫn hợp lệ.
const afterFull = applyMove(fullColumn, { column: 1 }, 1);
assert.equal(afterFull.board[5][1], 1);
assert.equal(afterFull.current_seat, 2);

// ---------- cột ngoài 0..6 bị chặn ----------
for (const column of [7, -1, 99]) {
  assert.throws(() => applyMove(initialState(), { column }, 1), /Cột cờ không hợp lệ/, `cột ${column} phải bị chặn`);
}
assert.throws(() => applyMove(initialState(), {}, 1), /không hợp lệ/i);
assert.throws(() => applyMove(initialState(), null, 1), /không hợp lệ/i);

// ---------- sai kiểu column bị chặn, không được ép qua Number() ----------
// Audit MEDIUM: trước đây Number(move.column) biến null/''/[]/false thành cột 0
// và '3' thành cột 3. Engine chỉ nhận number nguyên ở giá trị gốc.
for (const column of [null, '', [], false, true, '3', '0', {}, [3], 2.5, NaN, undefined]) {
  assert.throws(
    () => applyMove(initialState(), { column }, 1),
    /Cột cờ không hợp lệ/,
    `column=${JSON.stringify(column)} phải bị chặn, không được ép kiểu`
  );
}

// Lỗi giữ nguyên status 400 và code GAME_INVALID như trước.
assert.throws(
  () => applyMove(initialState(), { column: '3' }, 1),
  (thrown) => thrown.status === 400 && thrown.code === 'GAME_INVALID' && thrown.message === 'Cột cờ không hợp lệ.'
);

// Số nguyên hợp lệ vẫn đi được bình thường.
const typedOk = applyMove(initialState(), { column: 6 }, 1);
assert.equal(typedOk.board[5][6], 1);
assert.equal(typedOk.current_seat, 2);

// ---------- sai lượt bị chặn ----------
assert.throws(() => applyMove(initialState(), { column: 0 }, 2), /lượt/i);
const turnState = play(initialState(), [0]);
assert.equal(turnState.current_seat, 2);
assert.throws(() => applyMove(turnState, { column: 1 }, 1), /lượt/i);
// Đúng lượt thì đi được và đổi lượt.
const turned = applyMove(turnState, { column: 1 }, 2);
assert.equal(turned.current_seat, 1);

// ---------- state gốc không bị mutate ----------
const before = initialState();
const snapshot = clone(before);
const moved = applyMove(before, { column: 3 }, 1);
assert.deepEqual(before, snapshot, 'applyMove không được sửa state gốc');
assert.equal(moved.board[5][3], 1);
assert.notEqual(moved, before);
assert.equal(before.board[5][3], null);

// ---------- legalMoves ----------
const fresh = initialState();
assert.deepEqual(legalMoves(fresh, 1), [
  { column: 0 }, { column: 1 }, { column: 2 }, { column: 3 }, { column: 4 }, { column: 5 }, { column: 6 }
]);
assert.deepEqual(legalMoves(fresh, 2), [], 'không phải lượt thì legalMoves rỗng');
assert.deepEqual(legalMoves(turnState, 1), [], 'không phải lượt thì legalMoves rỗng');
assert.deepEqual(legalMoves(turnState, 2).length, COLUMNS, 'cột chưa đầy vẫn còn 7 lựa chọn');
const fullColumnMoves = legalMoves(fullColumn, 1);
assert.equal(fullColumnMoves.length, COLUMNS - 1, 'cột đầy bị loại khỏi legalMoves');
assert.ok(!fullColumnMoves.some((move) => move.column === 0));

// legalMoves trả mảng mới, không tham chiếu nội bộ state.
fullColumnMoves.push({ column: 99 });
assert.equal(legalMoves(fullColumn, 1).length, COLUMNS - 1);

// ---------- hòa khi đầy bàn (42 nước hợp lệ, không ai thắng sớm) ----------
// Chuỗi tìm bằng random search và đã kiểm tra từng bước: 21 quân mỗi ghế, không
// có chuỗi 4 nào trước nước cuối; nước 42 lấp ô trống cuối cùng => hòa.
const drawMoves = [0, 3, 0, 6, 0, 0, 3, 3, 6, 2, 0, 5, 1, 5, 3, 2, 4, 2, 1, 4, 0, 4, 2, 3, 3, 6, 1, 1, 1, 4, 4, 1, 6, 2, 4, 6, 2, 6, 5, 5, 5, 5];
assert.equal(drawMoves.length, ROWS * COLUMNS);
const draw = play(initialState(), drawMoves);
assert.equal(draw.winner_seat, null);
assert.equal(draw.result, 'draw');
assert.ok(draw.board.every((row) => row.every((cell) => cell !== null)), 'bàn phải đầy');
const drawCounts = { 1: 0, 2: 0 };
for (const row of draw.board) for (const cell of row) drawCounts[cell] += 1;
assert.equal(drawCounts[1], 21);
assert.equal(drawCounts[2], 21);
assert.deepEqual(legalMoves(draw, 1), []);
assert.deepEqual(legalMoves(draw, 2), []);
assert.throws(() => applyMove(draw, { column: 6 }, 1), /đã kết thúc/i);

// Ván hòa không được phép đi tiếp dù còn "lượt" cũ.
assert.equal(draw.current_seat, 2, 'ghế vừa đi nước cuối giữ nguyên current_seat');

console.log('connect4 engine: OK — thắng dọc/ngang/chéo 2 hướng, chặn cột đầy & ngoài biên, sai kiểu column, sai lượt, hòa bàn đầy, legalMoves.');
