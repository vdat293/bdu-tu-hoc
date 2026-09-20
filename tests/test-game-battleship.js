// Test engine Battleship (server-authoritative). Chạy: node tests/test-game-battleship.js
// Không cần DB: engine là hàm thuần, chỉ import từ src/services/games/.
// Lưu ý: auto:true dùng node:crypto; test bơm `state.pending_auto` (field chỉ dành cho test)
// để kiểm tra nhánh auto xác định, còn nhánh random thật được kiểm tra tính hợp lệ nhiều vòng.
import assert from 'node:assert/strict';
import { meta, initialState, applyMove, legalMoves, stateForViewer } from '../src/services/games/battleship.js';

const SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shipCells(ship) {
  const cells = [];
  for (let index = 0; index < ship.length; index += 1) {
    cells.push(ship.horizontal ? [ship.row, ship.column + index] : [ship.row + index, ship.column]);
  }
  return cells;
}

// Hai hạm đội cố định, không chồng lấn, đủ thứ tự độ dài [5,4,3,3,2].
const FLEET_1 = [
  { length: 5, row: 0, column: 0, horizontal: true }, // (0,0)-(0,4)
  { length: 4, row: 2, column: 0, horizontal: true }, // (2,0)-(2,3)
  { length: 3, row: 4, column: 0, horizontal: true }, // (4,0)-(4,2)
  { length: 3, row: 6, column: 0, horizontal: true }, // (6,0)-(6,2)
  { length: 2, row: 8, column: 0, horizontal: true }  // (8,0)-(8,1)
];
const FLEET_2 = [
  { length: 5, row: 0, column: 5, horizontal: true }, // (0,5)-(0,9)
  { length: 4, row: 2, column: 5, horizontal: true }, // (2,5)-(2,8)
  { length: 3, row: 4, column: 5, horizontal: true }, // (4,5)-(4,7)
  { length: 3, row: 6, column: 5, horizontal: true }, // (6,5)-(6,7)
  { length: 2, row: 8, column: 5, horizontal: true }  // (8,5)-(8,6)
];

function placeFleet(state, seat, fleet) {
  return applyMove(state, { place: true, ships: fleet }, seat);
}

// ---------- meta ----------
assert.equal(meta.id, 'battleship');
assert.equal(meta.players, 2);
// Pha đặt tàu không tính giờ nhưng pha bắn có đồng hồ; service bỏ deadline khi
// state.phase === 'placing' nên clock vẫn bật cho battleship.
assert.equal(meta.clock, true, 'battleship có đồng hồ ở pha bắn (pha đặt tàu được miễn)');
// `hidden` trong registry nghĩa là "ẩn khỏi trang chủ"; battleship vẫn phải hiện
// trên UI, còn việc che thông tin nằm ở stateForViewer (độc lập với cờ này).
assert.equal(meta.hidden, false);
assert.equal(meta.order, 5);

// ---------- state khởi tạo ----------
const fresh = initialState();
assert.equal(fresh.phase, 'placing');
assert.equal(fresh.size, SIZE);
assert.equal(fresh.current_seat, 1);
assert.equal(fresh.winner_seat, null);
assert.equal(fresh.result, null);
assert.equal(fresh.move_number, 0);
for (const seat of [1, 2]) {
  assert.equal(fresh.fleets[seat].length, 5, 'mỗi bên phải có đúng 5 tàu');
  assert.deepEqual(fresh.fleets[seat].map((ship) => ship.length), SHIP_LENGTHS);
  assert.ok(fresh.fleets[seat].every((ship) => ship.cells.length === 0 && ship.hits.length === 0 && ship.sunk === false));
  assert.equal(fresh.ready[seat], false);
  assert.deepEqual(fresh.shots[seat], []);
}
// Placing: legalMoves luôn rỗng.
assert.deepEqual(legalMoves(fresh, 1), []);
assert.deepEqual(legalMoves(fresh, 2), []);

// ---------- validate đặt tàu ----------
assert.throws(() => placeFleet(fresh, 1, FLEET_1.slice(0, 4)), /5 tàu/i, 'thiếu tàu phải bị chặn');
assert.throws(
  () => placeFleet(fresh, 1, [...FLEET_1.slice(0, 4), { row: 0, column: 0, horizontal: true }]),
  /chồng lấn/i,
  'tàu chồng lấn phải bị chặn'
);
assert.throws(
  () => placeFleet(fresh, 1, [{ row: 0, column: 6, horizontal: true }, ...FLEET_1.slice(1)]),
  /trong bàn/i,
  'tàu vượt biên ngang phải bị chặn'
);
assert.throws(
  () => placeFleet(fresh, 1, [{ row: 6, column: 0, horizontal: false }, ...FLEET_1.slice(1)]),
  /trong bàn/i,
  'tàu vượt biên dọc phải bị chặn'
);
assert.throws(
  () => placeFleet(fresh, 1, [{ row: 0.5, column: 0, horizontal: true }, ...FLEET_1.slice(1)]),
  /số nguyên/i,
  'toạ độ không nguyên phải bị chặn'
);
assert.throws(
  () => placeFleet(fresh, 1, [{ row: 0, column: 0, horizontal: 'yes' }, ...FLEET_1.slice(1)]),
  /horizontal/i,
  'horizontal sai kiểu phải bị chặn'
);
// Không ép kiểu toạ độ: null/''/true/'3'/false đều phải bị chặn ở cả row lẫn column.
for (const bad of [null, '', true, '3', false]) {
  assert.throws(
    () => placeFleet(fresh, 1, [{ row: bad, column: 0, horizontal: true }, ...FLEET_1.slice(1)]),
    /số nguyên/i,
    `row ${JSON.stringify(bad)} phải bị chặn (không ép kiểu)`
  );
  assert.throws(
    () => placeFleet(fresh, 1, [{ row: 0, column: bad, horizontal: true }, ...FLEET_1.slice(1)]),
    /số nguyên/i,
    `column ${JSON.stringify(bad)} phải bị chặn (không ép kiểu)`
  );
}
assert.doesNotThrow(() => placeFleet(fresh, 1, FLEET_1), 'hạm đội hợp lệ phải đặt được');

// ---------- chuyển pha ----------
const placed1 = placeFleet(fresh, 1, FLEET_1);
assert.equal(placed1.ready[1], true);
assert.equal(placed1.ready[2], false);
assert.equal(placed1.phase, 'placing', 'còn một ghế chưa đặt thì chưa sang playing');
assert.equal(placed1.current_seat, 2, 'ghế 2 là người cần đặt kế tiếp');
assert.equal(placed1.move_number, 1);
assert.equal(fresh.ready[1], false, 'applyMove không được mutate state gốc');
assert.equal(fresh.fleets[1][0].cells.length, 0);

// Mỗi ghế chỉ đặt được một lần.
assert.throws(() => placeFleet(placed1, 1, FLEET_1), /đặt tàu rồi/i);

const playing = placeFleet(placed1, 2, FLEET_2);
assert.equal(playing.phase, 'playing');
assert.equal(playing.current_seat, 1, 'ghế 1 đi trước khi vào playing');
assert.equal(playing.ready[1], true);
assert.equal(playing.ready[2], true);

// Cả hai ghế cùng đặt được: không phụ thuộc current_seat trong pha placing.
const seat2First = placeFleet(fresh, 2, FLEET_2);
assert.equal(seat2First.ready[2], true);
assert.equal(seat2First.current_seat, 1, 'ghế 1 vẫn là người cần đặt');
const outOfOrder = placeFleet(seat2First, 1, FLEET_1);
assert.equal(outOfOrder.phase, 'playing');
assert.equal(outOfOrder.current_seat, 1);

// ---------- auto:true ----------
// pending_auto là hook test: cho kết quả xác định thay vì random crypto.
const injected = clone(fresh);
injected.pending_auto = FLEET_2;
const autoInjected = applyMove(injected, { auto: true }, 1);
assert.equal(autoInjected.pending_auto, null, 'pending_auto phải bị xoá sau khi dùng');
assert.deepEqual(autoInjected.fleets[1].map((ship) => ship.cells), FLEET_2.map(shipCells));
assert.equal(autoInjected.ready[1], true);

// pending_auto cũng đi qua validate nghiêm: toạ độ sai kiểu bị chặn, không ép kiểu.
const badPending = clone(fresh);
badPending.pending_auto = [{ row: '3', column: 0, horizontal: true }, ...FLEET_1.slice(1)];
assert.throws(() => applyMove(badPending, { auto: true }, 1), /số nguyên/i, 'pending_auto sai kiểu phải bị chặn');

// Random thật (crypto): nhiều vòng, luôn hợp lệ, không chồng lấn trong cùng hạm đội.
for (let round = 0; round < 25; round += 1) {
  let autoState = applyMove(initialState(), { auto: true }, 1);
  autoState = applyMove(autoState, { auto: true }, 2);
  assert.equal(autoState.phase, 'playing');
  for (const seat of [1, 2]) {
    const fleet = autoState.fleets[seat];
    assert.equal(fleet.length, 5);
    assert.deepEqual(fleet.map((ship) => ship.length), SHIP_LENGTHS);
    const taken = new Set();
    for (const ship of fleet) {
      assert.equal(ship.cells.length, ship.length);
      for (const [row, column] of ship.cells) {
        assert.ok(
          Number.isInteger(row) && Number.isInteger(column) && row >= 0 && row < SIZE && column >= 0 && column < SIZE,
          'ô tàu auto phải nằm trong bàn'
        );
        const key = `${row},${column}`;
        assert.ok(!taken.has(key), 'tàu auto trong cùng hạm đội không được chồng lấn');
        taken.add(key);
      }
    }
  }
}

// ---------- bắn: lượt, toạ độ, ô đã bắn ----------
let game = placeFleet(placeFleet(initialState(), 1, FLEET_1), 2, FLEET_2);
assert.equal(legalMoves(game, 1).length, 100);
assert.deepEqual(legalMoves(game, 2), [], 'chưa tới lượt thì legalMoves rỗng');

assert.throws(() => applyMove(game, { row: 0, column: 5 }, 2), /lượt/i, 'bắn sai lượt phải bị chặn');
for (const move of [
  { row: -1, column: 0 },
  { row: 10, column: 0 },
  { row: 0, column: 10 },
  { row: 1.5, column: 2 },
  { row: 'x', column: 2 },
  {}
]) {
  assert.throws(() => applyMove(game, move, 1), /không hợp lệ|trên bàn/i, `nước ${JSON.stringify(move)} phải bị chặn`);
}

// Không ép kiểu toạ độ bắn: null/''/true/'3'/false ở row hoặc column đều bị chặn.
for (const bad of [null, '', true, '3', false]) {
  assert.throws(
    () => applyMove(game, { row: bad, column: 4 }, 1),
    /không hợp lệ/i,
    `row ${JSON.stringify(bad)} phải bị chặn khi bắn`
  );
  assert.throws(
    () => applyMove(game, { row: 4, column: bad }, 1),
    /không hợp lệ/i,
    `column ${JSON.stringify(bad)} phải bị chặn khi bắn`
  );
}

// Ghế 1 bắn trúng tàu 5 ô của ghế 2 tại (0,5).
let afterShot = applyMove(game, { row: 0, column: 5 }, 1);
assert.deepEqual(afterShot.shots[1], [[0, 5, 'hit']]);
assert.equal(afterShot.current_seat, 2);
assert.equal(afterShot.fleets[2][0].hits.length, 1);
assert.equal(afterShot.fleets[2][0].sunk, false);
assert.deepEqual(legalMoves(afterShot, 1), [], 'vừa bắn xong thì hết lượt');
assert.equal(legalMoves(afterShot, 2).length, 100, 'ghế 2 chưa bắn ô nào nên còn đủ 100 lựa chọn');

// Ghế 2 bắn trượt vào vùng biển ghế 1.
afterShot = applyMove(afterShot, { row: 1, column: 5 }, 2);
assert.deepEqual(afterShot.shots[2], [[1, 5, 'miss']]);
assert.equal(afterShot.current_seat, 1);
assert.equal(afterShot.move_number, 4, '2 nước đặt tàu + 2 nước bắn');
assert.equal(legalMoves(afterShot, 1).length, 99, 'ghế 1 đã bắn 1 ô nên còn 99 lựa chọn');

// Ô đã bắn không được bắn lại.
assert.throws(() => applyMove(afterShot, { row: 0, column: 5 }, 1), /đã bắn/i);
assert.throws(() => applyMove(afterShot, { row: 1, column: 5 }, 2), /lượt/i, 'sai lượt vẫn bị chặn trước cả ô đã bắn');

// ---------- chìm tàu & thắng khi hạ đủ 5 tàu ----------
// Ghế 2 bắn trượt vào các ô chắc chắn không chứa tàu ghế 1 để không lật ngược kết quả.
const missPool = [];
{
  const occupied = new Set(FLEET_1.flatMap(shipCells).map(([row, column]) => `${row},${column}`));
  for (let row = SIZE - 1; row >= 0; row -= 1) {
    for (let column = SIZE - 1; column >= 0; column -= 1) {
      if (!occupied.has(`${row},${column}`)) missPool.push([row, column]);
    }
  }
}

let sequence = placeFleet(placeFleet(initialState(), 1, FLEET_1), 2, FLEET_2);
let missIndex = 0;
for (let shipIndex = 0; shipIndex < SHIP_LENGTHS.length; shipIndex += 1) {
  const cells = shipCells(FLEET_2[shipIndex]);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
    const [row, column] = cells[cellIndex];
    sequence = applyMove(sequence, { row, column }, 1);
    const enemyShip = sequence.fleets[2][shipIndex];
    assert.equal(enemyShip.hits.length, cellIndex + 1, `tàu ${shipIndex + 1} phải ghi đủ hits`);
    const shouldSink = cellIndex === cells.length - 1;
    assert.equal(enemyShip.sunk, shouldSink, `tàu ${shipIndex + 1} sunk=${shouldSink}`);
    if (!sequence.result) {
      const [missRow, missColumn] = missPool[missIndex];
      missIndex += 1;
      sequence = applyMove(sequence, { row: missRow, column: missColumn }, 2);
    }
  }
}
assert.equal(sequence.result, 'win');
assert.equal(sequence.winner_seat, 1);
assert.equal(sequence.shots[1].length, 17, 'tổng số ô của 5 tàu địch = 17');
assert.ok(sequence.shots[1].every((shot) => shot[2] === 'hit'));

// Ván đã kết thúc: không ai bắn được nữa.
assert.throws(() => applyMove(sequence, { row: 9, column: 9 }, 2), /đã kết thúc/i);
assert.deepEqual(legalMoves(sequence, 1), []);
assert.deepEqual(legalMoves(sequence, 2), []);

// ---------- stateForViewer: che toạ độ tàu chưa chìm ----------
let reveal = placeFleet(placeFleet(initialState(), 1, FLEET_1), 2, FLEET_2);
reveal = applyMove(reveal, { row: 8, column: 5 }, 1); // trúng ô 1 của tàu 2 ô
reveal = applyMove(reveal, { row: 9, column: 0 }, 2); // ghế 2 bắn trượt
reveal = applyMove(reveal, { row: 8, column: 6 }, 1); // chìm tàu 2 ô của ghế 2
assert.equal(reveal.fleets[2][4].sunk, true);
assert.equal(reveal.current_seat, 2);

const viewer1 = stateForViewer(reveal, 1);
const viewer2 = stateForViewer(reveal, 2);
const spectator = stateForViewer(reveal, null);

// Ghế 1 thấy hạm đội mình đầy đủ, hạm đội địch bị che.
assert.deepEqual(viewer1.fleets[1].map((ship) => ship.cells), FLEET_1.map(shipCells), 'thấy đủ toạ độ tàu mình');
assert.ok(Array.isArray(viewer1.fleets[1][0].hits), 'tàu mình trả hits dạng mảng toạ độ');
assert.deepEqual(
  viewer1.fleets[2][4],
  { length: 2, hits: 2, sunk: true, cells: [[8, 5], [8, 6]] },
  'tàu địch đã chìm phải lộ đúng toạ độ'
);
assert.deepEqual(
  viewer1.fleets[2][0],
  { length: 5, hits: 0, sunk: false, cells: [] },
  'tàu địch chưa chìm chỉ trả length/hits/sunk, cells rỗng'
);
assert.equal(typeof viewer1.fleets[2][0].hits, 'number');

// JSON góc nhìn ghế 1 không được chứa bất kỳ toà độ nào của tàu địch chưa chìm.
const json1 = JSON.stringify(viewer1);
for (const [row, column] of shipCells(FLEET_2[0])) {
  assert.ok(!json1.includes(`[${row},${column}]`), `viewer ghế 1 lộ toạ độ [${row},${column}] của tàu chưa chìm`);
}
// Shots vẫn công khai cho cả hai ghế.
assert.deepEqual(viewer1.shots[1], [[8, 5, 'hit'], [8, 6, 'hit']]);
assert.deepEqual(viewer1.shots[2], [[9, 0, 'miss']]);

// Ghế 2 đối xứng.
assert.deepEqual(viewer2.fleets[2].map((ship) => ship.cells), FLEET_2.map(shipCells));
assert.deepEqual(viewer2.fleets[1][0], { length: 5, hits: 0, sunk: false, cells: [] });
const json2 = JSON.stringify(viewer2);
for (const [row, column] of shipCells(FLEET_1[0])) {
  assert.ok(!json2.includes(`[${row},${column}]`), `viewer ghế 2 lộ toạ độ [${row},${column}] của tàu chưa chìm`);
}

// Khán giả: cả hai hạm đội đều bị che như trên.
assert.deepEqual(spectator.fleets[1][0], { length: 5, hits: 0, sunk: false, cells: [] });
assert.deepEqual(spectator.fleets[2][4], { length: 2, hits: 2, sunk: true, cells: [[8, 5], [8, 6]] });
const jsonSpectator = JSON.stringify(spectator);
for (const [row, column] of [...shipCells(FLEET_1[1]), ...shipCells(FLEET_2[1])]) {
  assert.ok(!jsonSpectator.includes(`[${row},${column}]`), `khán giả lộ toạ độ [${row},${column}] của tàu chưa chìm`);
}
assert.deepEqual(spectator.shots[1], [[8, 5, 'hit'], [8, 6, 'hit']]);
assert.deepEqual(spectator.shots[2], [[9, 0, 'miss']]);

// stateForViewer không mutate state gốc và phải deep-clone.
const beforeView = clone(reveal);
stateForViewer(reveal, 1);
stateForViewer(reveal, 2);
stateForViewer(reveal, null);
assert.deepEqual(reveal, beforeView, 'stateForViewer không được sửa state gốc');
viewer1.fleets[1][0].cells[0][0] = 99;
assert.equal(reveal.fleets[1][0].cells[0][0], 0, 'viewer phải là bản clone sâu (không reference)');
viewer1.shots[1][0][0] = 99;
assert.equal(reveal.shots[1][0][0], 8, 'shots trong viewer cũng phải clone');

// Pha placing cũng che: ghế 2 chưa đặt thì ghế 1 chỉ thấy length/hits/sunk.
const placingView = stateForViewer(fresh, 1);
assert.equal(placingView.phase, 'placing');
assert.deepEqual(placingView.fleets[2][0], { length: 5, hits: 0, sunk: false, cells: [] });

// pending_auto (hook test) không được lọt vào view.
const pending = clone(fresh);
pending.pending_auto = FLEET_2;
const pendingJson = JSON.stringify(stateForViewer(pending, 1));
assert.ok(!pendingJson.includes('pending_auto'), 'pending_auto không được lọt vào view');
for (const [row, column] of shipCells(FLEET_2[0])) {
  assert.ok(!pendingJson.includes(`[${row},${column}]`), `pending_auto lộ toạ độ [${row},${column}]`);
}

console.log('battleship engine: OK — đặt tàu (validate/auto crypto/pending_auto), chuyển pha, bắn trúng-trượt-chìm, thắng hạ 5 tàu, che state theo ghế cho người chơi & khán giả.');
