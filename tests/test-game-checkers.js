// Test engine Cờ đam (checkers) — node assert thuần, không DB, không mạng.
// Chạy: node tests/test-game-checkers.js
import assert from 'node:assert/strict';
import { initialState, applyMove, legalMoves, stateForViewer, meta } from '../src/services/games/checkers.js';

const isDark = (row, column) => (row + column) % 2 === 1;
const mv = (fromRow, fromColumn, toRow, toColumn) => ({
  from: { row: fromRow, column: fromColumn },
  to: { row: toRow, column: toColumn }
});

// Dựng state JSON thuần từ 8 hàng ký tự: '.' trống, 'r'/'R' đỏ, 'b'/'B' đen.
// idle_ply/position_history là tuỳ chọn để test được cả state cũ thiếu field.
function buildState(rows, { current_seat = 1, chain = null, idle_ply, position_history } = {}) {
  assert.equal(rows.length, 8, 'Bàn cờ phải có 8 hàng');
  const board = rows.map((line) => {
    assert.equal(line.length, 8, 'Mỗi hàng phải có 8 ký tự');
    return [...line].map((char) => (char === '.' ? null : char));
  });
  const state = { size: 8, board, current_seat, chain, winner_seat: null, result: null, move_number: 0, last_move: null };
  if (idle_ply !== undefined) state.idle_ply = idle_ply;
  if (position_history !== undefined) state.position_history = position_history;
  return state;
}

function countPieces(board, chars) {
  let count = 0;
  for (const line of board) for (const cell of line) if (chars.includes(cell)) count += 1;
  return count;
}

// ---------- meta ----------
assert.equal(meta.id, 'checkers');
assert.equal(meta.label, 'Cờ đam');
assert.equal(meta.players, 2);
assert.equal(meta.clock, true);
assert.equal(meta.hidden, false);
assert.equal(meta.order, 40);
assert.equal(typeof meta.tagline, 'string');

// ---------- 1. Thiết lập bàn: đúng 24 quân, đúng màu ô ----------
const initial = initialState();
assert.equal(countPieces(initial.board, ['r']), 12, 'Đỏ phải có 12 quân');
assert.equal(countPieces(initial.board, ['b']), 12, 'Đen phải có 12 quân');
for (let row = 0; row < 8; row += 1) {
  for (let column = 0; column < 8; column += 1) {
    const value = initial.board[row][column];
    if (!isDark(row, column)) {
      assert.equal(value, null, `Ô sáng (${row},${column}) phải trống`);
    } else if (row <= 2) {
      assert.equal(value, 'b', `Hàng ${row} phải là quân đen`);
    } else if (row >= 5) {
      assert.equal(value, 'r', `Hàng ${row} phải là quân đỏ`);
    } else {
      assert.equal(value, null, `Hàng ${row} phải trống`);
    }
  }
}
assert.equal(initial.current_seat, 1);
assert.equal(initial.chain, null);
assert.equal(initial.result, null);
assert.equal(initial.winner_seat, null);
assert.equal(initial.move_number, 0);
assert.equal(legalMoves(initial, 1).length, 7, 'Đỏ có 7 nước tiến ban đầu');
assert.deepEqual(legalMoves(initial, 2), [], 'Chưa tới lượt đen thì không có nước');

// ---------- 2. Nước đi hợp lệ, không mutate state gốc ----------
const snapshot = JSON.parse(JSON.stringify(initial));
const afterStep = applyMove(initial, mv(5, 0, 4, 1), 1);
assert.equal(afterStep.board[5][0], null);
assert.equal(afterStep.board[4][1], 'r');
assert.equal(afterStep.current_seat, 2);
assert.equal(afterStep.chain, null);
assert.equal(afterStep.move_number, 1);
assert.deepEqual(afterStep.last_move, { from: { row: 5, column: 0 }, to: { row: 4, column: 1 } });
assert.deepEqual(initial, snapshot, 'applyMove không được mutate state gốc');

// ---------- 3. Sai lượt / nước không hợp lệ / sai chủ quân ----------
assert.throws(() => applyMove(initial, mv(2, 1, 3, 0), 1), /Không phải quân của bạn/, 'Đỏ không được đi quân đen');
assert.throws(() => applyMove(initial, mv(5, 0, 4, 1), 2), /Chưa đến lượt/, 'Đen không được đi khi chưa tới lượt');
assert.throws(() => applyMove(initial, null, 1), /không hợp lệ/, 'Thiếu move phải bị chặn');
assert.throws(() => applyMove(afterStep, mv(5, 2, 4, 1), 2), /Không phải quân của bạn/, 'Không được đi quân đối phương');

// ---------- 4. Ô sáng và ô trống ----------
assert.throws(() => applyMove(initial, mv(5, 1, 4, 0), 1), /ô đen/i, 'Ô xuất phát sáng phải bị chặn');
assert.throws(() => applyMove(initial, mv(5, 0, 4, 0), 1), /ô đen/i, 'Ô đến sáng phải bị chặn');
assert.throws(() => applyMove(initial, mv(4, 1, 3, 0), 1), /không có quân/, 'Ô xuất phát trống phải bị chặn');

// ---------- 5. Bắt buộc ăn: có nước ăn thì nước thường bị từ chối ----------
const forced = buildState([
  '........',
  '........',
  '........',
  '........',
  '...b....',
  '..r.....',
  '........',
  '........'
]);
assert.deepEqual(legalMoves(forced, 1), [{ from: { row: 5, column: 2 }, to: { row: 3, column: 4 } }]);
assert.throws(() => applyMove(forced, mv(5, 2, 4, 1), 1), /Bắt buộc ăn/, 'Có nước ăn thì cấm đi thường');

// ---------- 6. Ăn 1 quân ----------
const single = buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...b....',
  '..r.....',
  '........',
  '........'
]);
assert.deepEqual(legalMoves(single, 1), [{ from: { row: 5, column: 2 }, to: { row: 3, column: 4 } }]);
const afterCapture = applyMove(single, mv(5, 2, 3, 4), 1);
assert.equal(afterCapture.board[4][3], null, 'Quân bị ăn phải bị xoá');
assert.equal(afterCapture.board[5][2], null);
assert.equal(afterCapture.board[3][4], 'r');
assert.equal(afterCapture.chain, null, 'Hết nước ăn tiếp thì kết thúc lượt');
assert.equal(afterCapture.current_seat, 2);
assert.deepEqual(afterCapture.last_move.captured, [{ row: 4, column: 3 }]);
assert.equal(legalMoves(afterCapture, 2).length, 2, 'Đen còn quân (0,1) với 2 nước tiến');

// ---------- 7. Chuỗi ăn 2 quân: phải đi tiếp đúng quân, không kết thúc giữa chuỗi ----------
const chainStart = buildState([
  '.......b',
  '........',
  '...b....',
  '........',
  '.b......',
  'r.......',
  '........',
  '..r.....'
]);
assert.deepEqual(legalMoves(chainStart, 1), [{ from: { row: 5, column: 0 }, to: { row: 3, column: 2 } }]);
const chained = applyMove(chainStart, mv(5, 0, 3, 2), 1);
assert.deepEqual(chained.chain, { row: 3, column: 2 }, 'Còn nước ăn tiếp thì state phải giữ chain');
assert.equal(chained.current_seat, 1, 'Chuỗi ăn chưa xong thì vẫn là lượt đỏ');
assert.equal(chained.board[4][1], null, 'Quân bị ăn ở (4,1) đã bị xoá');
assert.deepEqual(legalMoves(chained, 1), [{ from: { row: 3, column: 2 }, to: { row: 1, column: 4 } }]);
assert.deepEqual(legalMoves(chained, 2), [], 'Đang chuỗi ăn thì đen không có nước');
assert.throws(() => applyMove(chained, mv(7, 2, 6, 3), 1), /chuỗi ăn/i, 'Không được đi quân khác giữa chuỗi');
assert.throws(() => applyMove(chained, mv(3, 2, 2, 1), 1), /chuỗi ăn/i, 'Đích nối chuỗi sai phải bị chặn');

const chainDone = applyMove(chained, mv(3, 2, 1, 4), 1);
assert.equal(chainDone.chain, null, 'Hết nước nối thì chain phải được xoá');
assert.equal(chainDone.current_seat, 2);
assert.equal(chainDone.board[2][3], null, 'Quân bị ăn thứ hai đã bị xoá');
assert.equal(chainDone.board[1][4], 'r');
assert.equal(chainDone.move_number, 2);
assert.deepEqual(legalMoves(chainDone, 2), [{ from: { row: 0, column: 7 }, to: { row: 1, column: 6 } }]);

// ---------- 8. Phong cấp kết thúc lượt ngay (kể cả khi còn nước ăn tiếp) ----------
const promo = buildState([
  '........',
  '..b.b...',
  '.r......',
  '........',
  '........',
  '........',
  '........',
  '....r...'
]);
assert.deepEqual(legalMoves(promo, 1), [{ from: { row: 2, column: 1 }, to: { row: 0, column: 3 } }]);
const promoted = applyMove(promo, mv(2, 1, 0, 3), 1);
assert.equal(promoted.board[0][3], 'R', 'Tốt đỏ tới hàng cuối thành vua');
assert.equal(promoted.board[1][2], null);
assert.equal(promoted.board[1][4], 'b', 'Quân đen kế bên không bị ăn thêm');
assert.equal(promoted.chain, null, 'Phong cấp phải kết thúc lượt, dù vua còn nước ăn tiếp');
assert.equal(promoted.current_seat, 2);
assert.deepEqual(legalMoves(promoted, 1), []);
assert.equal(legalMoves(promoted, 2).length, 2, 'Đen (1,4) còn 2 nước tiến');

// Phong cấp bằng nước đi thường.
const stepPromo = buildState([
  '........',
  'r.......',
  '........',
  '........',
  '........',
  '......b.',
  '........',
  '........'
]);
const stepPromoted = applyMove(stepPromo, mv(1, 0, 0, 1), 1);
assert.equal(stepPromoted.board[0][1], 'R');
assert.equal(stepPromoted.board[1][0], null);
assert.equal(stepPromoted.chain, null);
assert.equal(stepPromoted.current_seat, 2);

// ---------- 9. Vua đi ngược và ăn ngược; tốt không được ăn ngược ----------
const kingStep = buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...R....',
  '........',
  '........',
  '........'
]);
const kingTargets = legalMoves(kingStep, 1).map((move) => `${move.to.row},${move.to.column}`).sort();
assert.deepEqual(kingTargets, ['3,2', '3,4', '5,2', '5,4'], 'Vua đi chéo 1 ô cả 4 hướng');
const kingMovedBack = applyMove(kingStep, mv(4, 3, 5, 4), 1);
assert.equal(kingMovedBack.board[5][4], 'R', 'Vua được đi ngược hướng tiến');
assert.equal(kingMovedBack.board[4][3], null);

const kingCapture = buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...R....',
  '....b...',
  '........',
  '........'
]);
assert.deepEqual(legalMoves(kingCapture, 1), [{ from: { row: 4, column: 3 }, to: { row: 6, column: 5 } }]);
const kingAte = applyMove(kingCapture, mv(4, 3, 6, 5), 1);
assert.equal(kingAte.board[5][4], null, 'Vua ăn được quân phía sau');
assert.equal(kingAte.board[6][5], 'R');
assert.equal(kingAte.chain, null);

const manBack = buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...r....',
  '....b...',
  '........',
  '........'
]);
const manBackMoves = legalMoves(manBack, 1).map((move) => `${move.to.row},${move.to.column}`).sort();
assert.deepEqual(manBackMoves, ['3,2', '3,4'], 'Tốt chỉ tiến, không được ăn ngược');
assert.throws(() => applyMove(manBack, mv(4, 3, 6, 5), 1), /không hợp lệ/, 'Tốt nhảy ngược phải bị chặn');

// ---------- 10. Thắng khi đối phương hết quân ----------
const lastStand = buildState([
  '........',
  '........',
  '........',
  '........',
  '...b....',
  '..r.....',
  '........',
  '........'
]);
const wonByCapture = applyMove(lastStand, mv(5, 2, 3, 4), 1);
assert.equal(countPieces(wonByCapture.board, ['b', 'B']), 0);
assert.equal(wonByCapture.winner_seat, 1);
assert.equal(wonByCapture.result, 'win');
assert.equal(wonByCapture.chain, null);
assert.throws(() => applyMove(wonByCapture, mv(3, 4, 2, 5), 1), /kết thúc/i, 'Ván đã kết thúc thì không đi được nữa');

// ---------- 11. Thắng khi đối phương tới lượt mà hết nước ----------
const trapped = buildState([
  '.b......',
  'r.r.....',
  '...r....',
  '........',
  '........',
  '........',
  '........',
  '....r...'
]);
assert.equal(legalMoves(trapped, 1).length, 4, 'Đỏ có 4 nước đi thường, không có nước ăn');
const wonByBlock = applyMove(trapped, mv(7, 4, 6, 3), 1);
assert.equal(countPieces(wonByBlock.board, ['b', 'B']), 1, 'Đen vẫn còn quân');
assert.equal(wonByBlock.winner_seat, 1);
assert.equal(wonByBlock.result, 'win');
assert.deepEqual(legalMoves(wonByBlock, 2), [], 'Đen hết nước phải thua');

// ---------- 12. legalMoves tôn trọng lượt/kết thúc; stateForViewer bỏ history nội bộ ----------
assert.deepEqual(legalMoves(initial, 3), []);
assert.deepEqual(legalMoves({ ...initial, result: 'win', winner_seat: 1 }, 1), []);
assert.deepEqual(legalMoves({ ...initial, current_seat: 2 }, 1), []);
assert.notEqual(stateForViewer(initial, 1), initial, 'view phải là bản clone');
assert.equal(stateForViewer(initial, 1).position_history, undefined, 'không lộ lịch sử thế cờ nội bộ');
assert.deepEqual(stateForViewer(initial, 1).board, initial.board);

// ---------- 13. Hòa do lặp thế 3 lần (2 vua đi qua lại) ----------
const repeatMoves = [
  [1, 7, 2, 6, 3],
  [2, 0, 1, 1, 2],
  [1, 6, 3, 7, 2],
  [2, 1, 2, 0, 1]
];
let repeated = buildState([
  '.B......',
  '........',
  '........',
  '........',
  '........',
  '........',
  '........',
  '..R.....'
]);
assert.equal(repeated.idle_ply, undefined, 'State dựng tay thiếu field mới vẫn phải chạy được');
for (let cycle = 0; cycle < 3; cycle += 1) {
  for (const [seat, fromRow, fromColumn, toRow, toColumn] of repeatMoves) {
    if (repeated.result) break;
    repeated = applyMove(repeated, mv(fromRow, fromColumn, toRow, toColumn), seat);
    if (repeated.move_number === 8) assert.equal(repeated.result, null, 'Mới lặp 2 lần thì chưa hòa');
  }
}
assert.equal(repeated.result, 'draw');
assert.equal(repeated.winner_seat, null);
assert.equal(repeated.move_number, 9, 'Hòa ngay khi thế cờ xuất hiện lần thứ 3');
assert.equal(repeated.idle_ply, 9, 'Hòa do lặp thế phải xảy ra trước ngưỡng idle_ply');
assert.equal(repeated.current_seat, 2);
const repeatedKey = repeated.position_history[repeated.position_history.length - 1];
assert.equal(typeof repeatedKey, 'string', 'Key thế cờ phải là chuỗi JSON rút gọn');
assert.equal(repeated.position_history.filter((item) => item === repeatedKey).length, 3, 'Key thế cờ phải xuất hiện 3 lần');
assert.deepEqual(legalMoves(repeated, 1), []);
assert.deepEqual(legalMoves(repeated, 2), []);
assert.throws(() => applyMove(repeated, mv(7, 2, 6, 3), 1), /kết thúc/);

// ---------- 14. Hòa do idle_ply: 2 vua đi qua lại đủ 80 ply không ăn/không đi tốt ----------
// Vua đỏ đi đường con lắc 9 ô (chu kỳ 16 nước), vua đen đi vòng 6 ô (chu kỳ 6
// nước); lcm(16, 6) = 48 > 40 nên không thế cờ nào lặp tới 3 lần trước ngưỡng
// 80 ply (kiểm chứng bằng maxRepeat bên dưới) — hòa ở đây chắc chắn do idle_ply.
const RED_PATH = [[5, 0], [6, 1], [7, 2], [6, 3], [7, 4], [6, 5], [7, 6], [6, 7], [5, 6]];
const BLACK_CYCLE = [[3, 6], [2, 5], [1, 4], [0, 5], [1, 6], [2, 7]];
const pathIndex = (step, length) => {
  const period = 2 * (length - 1);
  const index = step % period;
  return index < length ? index : period - index;
};
let kingsWalk = buildState([
  '........',
  '........',
  '........',
  '......B.',
  '........',
  'R.......',
  '........',
  '........'
]);
for (let step = 0; step < 40 && !kingsWalk.result; step += 1) {
  const redFrom = RED_PATH[pathIndex(step, RED_PATH.length)];
  const redTo = RED_PATH[pathIndex(step + 1, RED_PATH.length)];
  kingsWalk = applyMove(kingsWalk, mv(redFrom[0], redFrom[1], redTo[0], redTo[1]), 1);
  if (kingsWalk.result) break;
  const blackFrom = BLACK_CYCLE[step % BLACK_CYCLE.length];
  const blackTo = BLACK_CYCLE[(step + 1) % BLACK_CYCLE.length];
  kingsWalk = applyMove(kingsWalk, mv(blackFrom[0], blackFrom[1], blackTo[0], blackTo[1]), 2);
  if (kingsWalk.move_number === 78) assert.equal(kingsWalk.result, null, 'Chưa chạm 80 ply thì chưa hòa');
}
assert.equal(kingsWalk.move_number, 80);
assert.equal(kingsWalk.idle_ply, 80, 'Đúng 80 ply không tiến triển thì hòa');
assert.equal(kingsWalk.result, 'draw');
assert.equal(kingsWalk.winner_seat, null);
assert.equal(kingsWalk.position_history.length, 80);
const repeatCounts = new Map();
for (const key of kingsWalk.position_history) repeatCounts.set(key, (repeatCounts.get(key) || 0) + 1);
assert.equal(Math.max(...repeatCounts.values()), 2, 'Không thế cờ nào lặp tới 3 lần trước khi chạm idle_ply');
assert.deepEqual(legalMoves(kingsWalk, 1), []);

// ---------- 15. Ăn quân / đi tốt reset idle_ply ----------
const afterKingCapture = applyMove(buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...R....',
  '....b...',
  '........',
  '........'
], { idle_ply: 60 }), mv(4, 3, 6, 5), 1);
assert.equal(afterKingCapture.idle_ply, 0, 'Vua ăn quân phải reset idle_ply');
assert.equal(afterKingCapture.result, null);
assert.equal(afterKingCapture.move_number, 1);

const afterManStep = applyMove(buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...r....',
  '........',
  '........',
  '........'
], { idle_ply: 60 }), mv(4, 3, 3, 2), 1);
assert.equal(afterManStep.idle_ply, 0, 'Đi tốt phải reset idle_ply');
assert.equal(afterManStep.result, null);

const afterManCapture = applyMove(buildState([
  '.b......',
  '........',
  '........',
  '....b...',
  '...r....',
  '........',
  '........',
  '........'
], { idle_ply: 60 }), mv(4, 3, 2, 5), 1);
assert.equal(afterManCapture.idle_ply, 0, 'Tốt ăn quân cũng reset idle_ply');
assert.equal(afterManCapture.board[3][4], null);
assert.equal(afterManCapture.board[2][5], 'r');

// ---------- 16. Thắng ưu tiên hơn hòa khi cùng chạm ngưỡng idle_ply ----------
const afterWinOverDraw = applyMove(buildState([
  '.b......',
  'r.r.....',
  '...r....',
  '........',
  '........',
  '........',
  '........',
  '....R...'
], { idle_ply: 79 }), mv(7, 4, 6, 3), 1);
assert.equal(afterWinOverDraw.idle_ply, 80, 'Nước vua không ăn phải tăng idle_ply lên đúng ngưỡng');
assert.equal(afterWinOverDraw.result, 'win', 'Đối phương hết nước phải thắng, không hòa');
assert.equal(afterWinOverDraw.winner_seat, 1);

// ---------- 17. Tương thích state cũ thiếu idle_ply/position_history ----------
const legacyKing = applyMove(buildState([
  '.B......',
  '........',
  '........',
  '........',
  '........',
  '........',
  '........',
  '..R.....'
]), mv(7, 2, 6, 3), 1);
assert.equal(legacyKing.idle_ply, 1, 'State cũ thiếu idle_ply thì bắt đầu từ 0 rồi tăng');
assert.equal(Array.isArray(legacyKing.position_history), true);
assert.equal(legacyKing.position_history.length, 1);
assert.equal(typeof legacyKing.position_history[0], 'string');
assert.equal(legacyKing.result, null);

const legacyMan = applyMove(buildState([
  '.b......',
  '........',
  '........',
  '........',
  '...r....',
  '........',
  '........',
  '........'
]), mv(4, 3, 3, 2), 1);
assert.equal(legacyMan.idle_ply, 0);
assert.equal(legacyMan.position_history.length, 1);

console.log('checkers engine: tất cả test pass');
