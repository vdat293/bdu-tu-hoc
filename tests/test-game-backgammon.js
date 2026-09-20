// Test engine Backgammon — chạy thuần node, không DB, không mạng.
// Xúc xắc xác định được bơm qua state.pending_roll = [d1, d2] (engine dùng rồi xoá).
// Bao phủ: thế xếp chuẩn, nước hợp lệ, sai lượt, xúc xắc không hợp lệ, ưu tiên bar,
// điểm bị chặn, ăn blot, doubles 4 lượt, hết nước tự chuyển lượt, tự bỏ lượt,
// bear-off đúng/sai điều kiện, thắng khi off đủ 15, legalMoves, không mutate state gốc.
import assert from 'node:assert/strict';
import { initialState, applyMove, legalMoves, stateForViewer, meta } from '../src/services/games/backgammon.js';

function customPoints(entries) {
  const points = Array(24).fill(0);
  for (const [point, value] of entries) points[point - 1] = value;
  return points;
}

function stateWith({ points = customPoints([]), bar = { 1: 0, 2: 0 }, off = { 1: 0, 2: 0 }, dice = [], current_seat = 1 } = {}) {
  return {
    points: points.slice(),
    bar: { 1: Number(bar[1] || 0), 2: Number(bar[2] || 0) },
    off: { 1: Number(off[1] || 0), 2: Number(off[2] || 0) },
    dice: { remaining: dice.slice() },
    current_seat,
    pending_roll: null,
    winner_seat: null,
    result: null,
    move_number: 0,
    last_move: null,
    skipped: false
  };
}

// Bơm xúc xắc xác định cho test: pending_roll thay thế dice.remaining.
function withPending(state, roll) {
  const next = JSON.parse(JSON.stringify(state));
  next.pending_roll = roll;
  next.dice.remaining = [];
  return next;
}

// --- meta ---
assert.equal(meta.id, 'backgammon');
assert.equal(meta.label, 'Backgammon');
assert.equal(meta.players, 2);
assert.equal(meta.clock, false, 'backgammon không dùng đồng hồ theo yêu cầu');
assert.equal(meta.hidden, false);
assert.equal(meta.order, 45);

// --- thế xếp chuẩn: đúng 30 quân, mỗi ghế 15, đối xứng ---
const fresh = initialState();
assert.equal(fresh.points.length, 24);
assert.equal(fresh.points.reduce((sum, value) => sum + Math.max(0, value), 0), 15, 'ghế 1 phải có 15 quân');
assert.equal(fresh.points.reduce((sum, value) => sum + Math.max(0, -value), 0), 15, 'ghế 2 phải có 15 quân');
const setup = { 1: -5, 6: 5, 8: 3, 12: -2, 13: 5, 17: -3, 19: -5, 24: 2 };
for (const [point, value] of Object.entries(setup)) {
  assert.equal(fresh.points[Number(point) - 1], value, `thế xếp điểm ${point} sai`);
}
assert.deepEqual(fresh.bar, { 1: 0, 2: 0 });
assert.deepEqual(fresh.off, { 1: 0, 2: 0 });
assert.equal(fresh.current_seat, 1);
assert.equal(fresh.pending_roll, null);
assert.equal(fresh.winner_seat, null);
assert.equal(fresh.result, null);
assert.ok(fresh.dice.remaining.length === 2 || fresh.dice.remaining.length === 4, 'đầu ván phải có 2 xúc xắc (4 khi doubles)');
assert.ok(fresh.dice.remaining.every((die) => Number.isInteger(die) && die >= 1 && die <= 6));
// stateForViewer: bản clone cho client, không cùng reference và không lộ hook test.
const freshView = stateForViewer(fresh, 1);
assert.notEqual(freshView, fresh, 'view phải là bản clone, không cùng reference với state gốc');
assert.deepEqual(freshView.points, fresh.points);
assert.equal(freshView.current_seat, fresh.current_seat);
assert.equal(Object.prototype.hasOwnProperty.call(freshView, 'pending_roll'), false, 'view không được lộ pending_roll');
const pendingView = stateForViewer(withPending(fresh, [6, 6]), 1);
assert.equal(Object.prototype.hasOwnProperty.call(pendingView, 'pending_roll'), false, 'pending_roll phải bị strip khi trả view');
assert.deepEqual(pendingView.dice, { remaining: [] });
assert.deepEqual(fresh.points[23], 2, 'state gốc không bị đụng bởi stateForViewer');

// --- legalMoves thế mở màn với pending_roll [3, 5] ---
const opening = withPending(initialState(), [3, 5]);
assert.deepEqual(
  legalMoves(opening, 1).map((move) => `${move.from}->${move.to}:${move.die}`).sort(),
  ['13->10:3', '13->8:5', '24->21:3', '6->3:3', '8->3:5', '8->5:3'].sort(),
  'legalMoves mở màn phải đúng 6 nước'
);
assert.deepEqual(legalMoves(opening, 2), [], 'không phải lượt thì legalMoves rỗng');

// --- pending_roll được dùng rồi xoá; applyMove không mutate state gốc ---
const openingSnapshot = JSON.stringify(opening);
const afterFirst = applyMove(opening, { from: 24, die: 3 }, 1);
assert.equal(JSON.stringify(opening), openingSnapshot, 'applyMove không được mutate state gốc');
assert.equal(afterFirst.pending_roll, null, 'pending_roll phải được dùng rồi xoá');
assert.deepEqual(afterFirst.dice.remaining, [5]);
assert.equal(afterFirst.current_seat, 1, 'còn xúc xắc đi được thì chưa kết thúc lượt');
assert.equal(afterFirst.points[23], 1, 'điểm 24 phải còn 1 quân');
assert.equal(afterFirst.points[20], 1, 'quân phải nằm ở điểm 21');
assert.equal(afterFirst.move_number, 1);
assert.deepEqual(afterFirst.last_move, { from: 24, to: 21, die: 3, seat: 1 });

// pending_roll ghi đè xúc xắc cũ trong state (phục vụ test xác định).
const overridden = withPending(afterFirst, [2, 2]);
const doublesInjected = applyMove(overridden, { from: 13, die: 2 }, 1);
assert.deepEqual(doublesInjected.dice.remaining, [2, 2, 2], 'pending_roll doubles phải tách thành 4 lượt');

// --- audit MEDIUM: payload client không được bơm pending_roll/dice/chain vào state ---
const injection = applyMove(opening, {
  from: 24,
  die: 3,
  pending_roll: [6, 6],
  dice: { remaining: [6, 6, 6, 6] },
  chain: true,
  winner_seat: 2,
  result: 'win'
}, 1);
assert.equal(injection.pending_roll, null, 'pending_roll từ client không được ghi vào state');
assert.deepEqual(injection.dice.remaining, [5], 'dice client gửi lên không được ghi đè xúc xắc thật');
assert.equal(Object.prototype.hasOwnProperty.call(injection, 'chain'), false, 'field lạ không được copy vào state');
assert.equal(injection.winner_seat, null);
assert.equal(injection.result, null);

// --- nước sai lượt bị chặn ---
assert.throws(() => applyMove(opening, { from: 24, die: 3 }, 2), (err) => {
  assert.equal(err.code, 'NOT_YOUR_TURN');
  assert.equal(err.status, 409);
  return true;
}, 'ghế 2 không được đi khi chưa đến lượt');

// --- die không có trong remaining bị chặn ---
assert.throws(() => applyMove(opening, { from: 24, die: 4 }, 1), /Xúc xắc/i);
assert.throws(() => applyMove(opening, { from: 24, die: 7 }, 1), /Xúc xắc/i);
assert.throws(() => applyMove(opening, { from: 12, die: 3 }, 1), /quân của bạn/i, 'điểm không có quân mình bị chặn');

// --- ưu tiên vào bar: còn quân bar thì cấm đi quân khác ---
const barPriority = stateWith({ points: customPoints([[8, 3], [21, -1]]), bar: { 1: 1 }, dice: [4] });
assert.deepEqual(legalMoves(barPriority, 1), [{ from: 'bar', to: 21, die: 4 }]);
assert.throws(() => applyMove(barPriority, { from: 8, die: 4 }, 1), /bar/i, 'còn quân bar thì phải vào bar trước');
const entered = applyMove(barPriority, { from: 'bar', die: 4 }, 1);
assert.equal(entered.bar[1], 0);
assert.equal(entered.points[7], 3, 'quân ở điểm 8 phải đứng yên khi chưa vào hết bar');
assert.equal(entered.points[20], 1, 'ghế 1 vào bar ở điểm 25 - die = 21');
assert.equal(entered.bar[2], 1, 'blot ở điểm vào bị ăn phải về bar ghế 2');

// Điểm vào bar bị chặn bởi >= 2 quân đối phương.
const blockedBar = stateWith({ points: customPoints([[8, 3], [21, -2]]), bar: { 1: 1 }, dice: [4] });
assert.deepEqual(legalMoves(blockedBar, 1), []);
assert.throws(() => applyMove(blockedBar, { from: 'bar', die: 4 }, 1), /không hợp lệ/i);

// --- điểm bị chặn bởi >= 2 quân địch ---
const blockedPoint = stateWith({ points: customPoints([[8, 3], [5, -2]]), dice: [3] });
assert.deepEqual(legalMoves(blockedPoint, 1), [], 'mọi đích đều bị chặn thì không còn nước');
assert.throws(() => applyMove(blockedPoint, { from: 8, die: 3 }, 1), /không hợp lệ/i);

// --- ăn blot: quân đối phương về bar ---
const blot = stateWith({ points: customPoints([[8, 3], [5, -1]]), dice: [3] });
const captured = applyMove(blot, { from: 8, die: 3 }, 1);
assert.equal(captured.points[7], 2, 'điểm xuất phát còn 2 quân');
assert.equal(captured.points[4], 1, 'quân mình chiếm điểm 5 (một mình)');
assert.equal(captured.bar[2], 1, 'blot đối phương phải về bar');
assert.deepEqual(captured.last_move, { from: 8, to: 5, die: 3, seat: 1 });

// --- doubles: 4 lượt dùng cùng giá trị ---
let doubles = withPending(initialState(), [4, 4]);
assert.deepEqual(doubles.dice.remaining, [], 'pending chưa bị tiêu thụ khi chưa applyMove');
assert.ok(legalMoves(doubles, 1).every((move) => move.die === 4));
doubles = applyMove(doubles, { from: 24, die: 4 }, 1);
assert.equal(doubles.pending_roll, null);
assert.deepEqual(doubles.dice.remaining, [4, 4, 4]);
assert.equal(doubles.current_seat, 1);
doubles = applyMove(doubles, { from: 24, die: 4 }, 1);
assert.deepEqual(doubles.dice.remaining, [4, 4]);
doubles = applyMove(doubles, { from: 13, die: 4 }, 1);
assert.deepEqual(doubles.dice.remaining, [4]);
assert.equal(doubles.current_seat, 1, 'còn xúc xắc đi được thì chưa chuyển ghế');
doubles = applyMove(doubles, { from: 13, die: 4 }, 1);
assert.equal(doubles.current_seat, 2, 'dùng hết 4 lượt doubles thì chuyển ghế');
assert.ok(doubles.dice.remaining.length === 2 || doubles.dice.remaining.length === 4);

// --- audit HIGH: không được bỏ phí xúc xắc nếu vẫn có cách dùng cả hai ---
// Thế audit: 1 quân điểm 7, 1 quân điểm 4, 1 quân điểm 24; đối thủ chặn 22 và 19; dice [5, 2].
const maxDice = stateWith({
  points: customPoints([[24, 1], [7, 1], [4, 1], [22, -2], [19, -2]]),
  dice: [5, 2],
  current_seat: 1
});
assert.equal(legalMoves(maxDice, 1).length, 2, 'chỉ còn 2 nước giữ được tối đa xúc xắc');
assert.equal(legalMoves(maxDice, 1).some((move) => move.from === 7 && Number(move.die) === 2), false,
  'legalMoves không được hiển thị nước bỏ phí xúc xắc');
assert.throws(() => applyMove(maxDice, { from: 7, die: 2 }, 1), /tối đa xúc xắc/i, '7->5:2 bỏ phí die 5 phải bị từ chối');
const chain1 = applyMove(maxDice, { from: 4, die: 2 }, 1);
assert.deepEqual(chain1.dice.remaining, [5]);
const chain2 = applyMove(chain1, { from: 7, die: 5 }, 1);
assert.equal(chain2.points[1], 2, 'chuỗi 4->2:2 rồi 7->2:5 phải được chấp nhận (điểm 2 có 2 quân)');
assert.equal(chain2.current_seat, 2, 'dùng hết xúc xắc thì chuyển lượt');

// --- audit HIGH: chỉ 1 xúc xắc dùng được thì bắt buộc đi con lớn hơn ---
// 9 -> 5 bằng die 4 hoặc 9 -> 7 bằng die 2, nhưng cả hai hướng đều kẹt ở điểm 3.
const singleDice = stateWith({
  points: customPoints([[9, 1], [3, -2], [1, -1]]),
  dice: [4, 2],
  current_seat: 1
});
assert.deepEqual(legalMoves(singleDice, 1), [{ from: 9, to: 5, die: 4 }], 'max = 1 thì chỉ cho nước với die lớn hơn');
assert.throws(() => applyMove(singleDice, { from: 9, die: 2 }, 1), /lớn hơn/i);
const onlyOne = applyMove(singleDice, { from: 9, die: 4 }, 1);
assert.equal(onlyOne.points[4], 1, 'quân phải nằm ở điểm 5');
assert.equal(onlyOne.current_seat, 2, 'hết nước với die còn lại thì tự chuyển lượt');
assert.equal(onlyOne.skipped, false, 'ghế 2 còn nước nên không phải bỏ lượt');
assert.ok(onlyOne.dice.remaining.length === 2 || onlyOne.dice.remaining.length === 4);

// --- đầu lượt không có nước: tự bỏ lượt và có safeguard chống lặp ---
// Ghế 2 nằm hết trên bar, cửa vào 1..6 bị ghế 1 chặn 2 quân mỗi điểm.
const trapped = stateWith({
  points: customPoints([[1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [13, 1]]),
  bar: { 2: 15 },
  dice: [3],
  current_seat: 1
});
const passedTurn = applyMove(trapped, { from: 13, die: 3 }, 1);
assert.equal(passedTurn.current_seat, 1, 'ghế 2 bị chặn bar phải được tự bỏ lượt');
assert.equal(passedTurn.skipped, true);
assert.equal(passedTurn.bar[2], 15, 'quân bar ghế 2 giữ nguyên khi bỏ lượt');
assert.deepEqual(passedTurn.points[9], 1, 'quân ghế 1 đã đi 13 -> 10');

// --- bear-off: chưa vào hết nhà thì cấm ---
const notHome = stateWith({
  points: customPoints([[1, 2], [4, 1], [10, 1]]),
  off: { 1: 11 },
  dice: [4]
});
assert.equal(legalMoves(notHome, 1).some((move) => move.to === 'off'), false);
assert.throws(() => applyMove(notHome, { from: 4, die: 4 }, 1), /không hợp lệ/i, 'còn quân ngoài nhà thì không được bear-off');

// --- bear-off: còn quân trên bar thì cấm ---
const barHome = stateWith({
  points: customPoints([[1, 2], [4, 1]]),
  bar: { 1: 1 },
  off: { 1: 11 },
  dice: [4]
});
assert.deepEqual(legalMoves(barHome, 1).map((move) => move.from), ['bar']);
assert.equal(legalMoves(barHome, 1).some((move) => move.to === 'off'), false);

// --- bear-off hợp lệ: khớp đúng die (chỉ từ điểm khớp) ---
const ready = stateWith({ points: customPoints([[1, 2], [4, 1]]), off: { 1: 12 }, dice: [4] });
assert.deepEqual(legalMoves(ready, 1), [{ from: 4, to: 'off', die: 4 }]);
const bearExact = applyMove(ready, { from: 4, die: 4 }, 1);
assert.equal(bearExact.off[1], 13);
assert.equal(bearExact.points[3], 0);
assert.throws(() => applyMove(ready, { from: 1, die: 4 }, 1), /không hợp lệ/i, 'die khớp điểm 4 thì không được bear-off từ điểm 1');

// --- bear-off hợp lệ: die lớn hơn chỉ áp dụng cho quân xa nhất ---
const overshoot = stateWith({ points: customPoints([[1, 2], [3, 1]]), off: { 1: 12 }, dice: [5] });
assert.deepEqual(legalMoves(overshoot, 1), [{ from: 3, to: 'off', die: 5 }]);
const bearFar = applyMove(overshoot, { from: 3, die: 5 }, 1);
assert.equal(bearFar.off[1], 13, 'die lớn hơn điểm xa nhất thì bear-off quân xa nhất');
assert.throws(() => applyMove(overshoot, { from: 1, die: 5 }, 1), /không hợp lệ/i);
assert.throws(() => applyMove(overshoot, { from: 1, die: 3 }, 1), /không hợp lệ/i, 'die khớp điểm 3 thì chỉ bear-off từ điểm 3');

// --- thắng khi off đủ 15 (ghế 1) ---
const lastOne = stateWith({ points: customPoints([[2, 1]]), off: { 1: 14 }, dice: [2] });
const won = applyMove(lastOne, { from: 2, die: 2 }, 1);
assert.equal(won.off[1], 15);
assert.equal(won.winner_seat, 1);
assert.equal(won.result, 'win');
assert.deepEqual(won.dice.remaining, []);
assert.deepEqual(legalMoves(won, 1), []);
assert.throws(() => applyMove(won, { from: 1, die: 1 }, 2), /đã kết thúc/i);

// --- ghế 2: vào bar ở điểm = die, đi từ thấp lên cao, bear-off ở 25 - die ---
const seat2Pos = stateWith({
  points: customPoints([[1, -1], [10, -2]]),
  bar: { 2: 1 },
  dice: [3, 5],
  current_seat: 2
});
assert.deepEqual(legalMoves(seat2Pos, 2), [{ from: 'bar', to: 3, die: 3 }, { from: 'bar', to: 5, die: 5 }]);
assert.deepEqual(legalMoves(seat2Pos, 1), []);
const seat2Entered = applyMove(seat2Pos, { from: 'bar', die: 3 }, 2);
assert.equal(seat2Entered.bar[2], 0);
assert.equal(seat2Entered.points[2], -1, 'ghế 2 vào bar ở điểm 3');
assert.equal(seat2Entered.current_seat, 2);
const seat2Moved = applyMove(seat2Entered, { from: 1, die: 5 }, 2);
assert.equal(seat2Moved.points[0], 0);
assert.equal(seat2Moved.points[5], -1, 'ghế 2 đi từ điểm 1 lên điểm 6');

const seat2Ready = stateWith({ points: customPoints([[22, -1]]), off: { 2: 14 }, dice: [3], current_seat: 2 });
const seat2Won = applyMove(seat2Ready, { from: 22, die: 3 }, 2);
assert.equal(seat2Won.off[2], 15);
assert.equal(seat2Won.winner_seat, 2);
assert.equal(seat2Won.result, 'win');

console.log('Backgammon engine: tất cả test đều đạt.');
