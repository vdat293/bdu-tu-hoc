// Engine Battleship (server-authoritative), bàn 10×10, mỗi bên 5 tàu dài [5,4,3,3,2].
// - Pha "placing": mỗi ghế gửi MỘT lệnh { place: true, ships: [{row,column,horizontal}...] }
//   hoặc { auto: true }. KHÔNG dùng assertSeat theo current_seat vì cả hai ghế có thể
//   đặt cùng lúc; engine tự chặn khi ghế đã ready.
// - Pha "playing": lệnh { row, column }; trúng/trượt ghi vào shots, tàu chìm khi đủ ô trúng,
//   thắng khi cả 5 tàu địch chìm.
// - Toạ độ đầu vào không bao giờ được ép kiểu: chỉ nhận `typeof === 'number'` và
//   `Number.isInteger` trên giá trị gốc (null/''/true/'3' đều bị từ chối).
// - stateForViewer che toạ độ tàu CHƯA chìm của đối thủ (với cả người chơi lẫn khán giả),
//   chỉ lộ cells khi tàu đã chìm; shots là thông tin công khai.
// - Auto dùng node:crypto. Test có thể bơm `state.pending_auto = [{row,column,horizontal}×5]`
//   để auto cho kết quả xác định (pending_auto bị xoá sau khi dùng và không lọt vào view).
import { randomInt } from 'node:crypto';
import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'battleship',
  label: 'Battleship',
  tagline: 'Bắn chìm cả 5 tàu địch trước đối thủ',
  players: 2,
  clock: true,
  hidden: false,
  order: 5
};

const SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

function keyOf(row, column) {
  return `${row},${column}`;
}

function cellsFor(row, column, length, horizontal) {
  const cells = [];
  for (let index = 0; index < length; index += 1) {
    cells.push(horizontal ? [row, column + index] : [row + index, column]);
  }
  return cells;
}

function emptyFleet() {
  return SHIP_LENGTHS.map((length) => ({ length, cells: [], hits: [], sunk: false }));
}

export function initialState() {
  return {
    phase: 'placing',
    size: SIZE,
    fleets: { 1: emptyFleet(), 2: emptyFleet() },
    ready: { 1: false, 2: false },
    shots: { 1: [], 2: [] },
    current_seat: 1,
    winner_seat: null,
    result: null,
    move_number: 0
  };
}

// ---------- validate đặt tàu ----------

function buildShip(input, length, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw error(`Tàu thứ ${index + 1} không hợp lệ.`);
  }
  // Chỉ nhận số nguyên thật (không ép kiểu): null/''/true/'3' đều bị chặn.
  const { row, column } = input;
  if (typeof row !== 'number' || !Number.isInteger(row) || typeof column !== 'number' || !Number.isInteger(column)) {
    throw error(`Tàu thứ ${index + 1} cần toạ độ số nguyên.`);
  }
  if (typeof input.horizontal !== 'boolean') {
    throw error(`Tàu thứ ${index + 1} cần trường horizontal (true/false).`);
  }
  const lastRow = input.horizontal ? row : row + length - 1;
  const lastColumn = input.horizontal ? column + length - 1 : column;
  if (row < 0 || column < 0 || lastRow >= SIZE || lastColumn >= SIZE) {
    throw error(`Tàu thứ ${index + 1} không nằm trong bàn.`);
  }
  return {
    length,
    cells: cellsFor(row, column, length, input.horizontal),
    hits: [],
    sunk: false
  };
}

function fleetFromInput(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIP_LENGTHS.length) {
    throw error(`Cần đúng ${SHIP_LENGTHS.length} tàu theo thứ tự độ dài ${SHIP_LENGTHS.join('-')}.`);
  }
  const taken = new Set();
  return SHIP_LENGTHS.map((length, index) => {
    const ship = buildShip(ships[index], length, index);
    for (const [row, column] of ship.cells) {
      const key = keyOf(row, column);
      if (taken.has(key)) throw error(`Tàu thứ ${index + 1} chồng lấn tàu khác.`);
      taken.add(key);
    }
    return ship;
  });
}

// ---------- auto xếp tàu bằng crypto ----------

function fits(length, row, column, horizontal, taken) {
  if (row < 0 || column < 0) return false;
  const lastRow = horizontal ? row : row + length - 1;
  const lastColumn = horizontal ? column + length - 1 : column;
  if (lastRow >= SIZE || lastColumn >= SIZE) return false;
  for (let index = 0; index < length; index += 1) {
    const cellRow = horizontal ? row : row + index;
    const cellColumn = horizontal ? column + index : column;
    if (taken.has(keyOf(cellRow, cellColumn))) return false;
  }
  return true;
}

function randomSpot(length, taken) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const horizontal = randomInt(2) === 1;
    const row = randomInt(SIZE);
    const column = randomInt(SIZE);
    if (fits(length, row, column, horizontal, taken)) return { row, column, horizontal };
  }
  // Dự phòng quét tuần tự: bàn 10×10 luôn còn chỗ cho tàu kế tiếp nên không bao giờ treo.
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      for (const horizontal of [true, false]) {
        if (fits(length, row, column, horizontal, taken)) return { row, column, horizontal };
      }
    }
  }
  throw error('Không thể xếp hạm đội ngẫu nhiên.');
}

function randomFleet() {
  const taken = new Set();
  const ships = [];
  for (const length of SHIP_LENGTHS) {
    const spot = randomSpot(length, taken);
    const ship = {
      length,
      cells: cellsFor(spot.row, spot.column, length, spot.horizontal),
      hits: [],
      sunk: false
    };
    for (const [row, column] of ship.cells) taken.add(keyOf(row, column));
    ships.push(ship);
  }
  return ships;
}

// ---------- applyMove ----------

function applyPlacement(state, move, seat) {
  if (state.ready?.[seat]) throw error('Bạn đã đặt tàu rồi.', 409, 'FLEET_ALREADY_PLACED');
  let fleet;
  if (move.auto === true) {
    fleet = Array.isArray(state.pending_auto) ? fleetFromInput(state.pending_auto) : randomFleet();
  } else if (move.place === true) {
    fleet = fleetFromInput(move.ships);
  } else {
    throw error('Pha đặt tàu chỉ nhận lệnh place hoặc auto.');
  }
  const next = clone(state);
  next.pending_auto = null;
  next.fleets[seat] = fleet;
  next.ready[seat] = true;
  next.move_number = Number(next.move_number || 0) + 1;
  if (next.ready[1] && next.ready[2]) {
    next.phase = 'playing';
    next.current_seat = 1;
  } else {
    // Ghế chưa ready kế tiếp nhận "lượt" để UI room bật tương tác đặt tàu.
    next.current_seat = next.ready[1] ? 2 : 1;
  }
  return next;
}

function applyShot(state, move, seat) {
  assertSeat(state, move, seat);
  // Chỉ nhận số nguyên thật (không ép kiểu): null/''/true/'3' đều bị chặn.
  const { row, column } = move;
  if (typeof row !== 'number' || !Number.isInteger(row) || typeof column !== 'number' || !Number.isInteger(column)) {
    throw error('Toạ độ bắn không hợp lệ.');
  }
  if (row < 0 || row >= SIZE || column < 0 || column >= SIZE) {
    throw error('Ô bắn không nằm trên bàn.');
  }
  if ((state.shots[seat] || []).some((shot) => Number(shot[0]) === row && Number(shot[1]) === column)) {
    throw error('Ô này đã bắn rồi.', 409, 'CELL_ALREADY_SHOT');
  }
  const next = clone(state);
  const enemySeat = seat === 1 ? 2 : 1;
  const enemyFleet = next.fleets[enemySeat] || [];
  let target = null;
  for (const ship of enemyFleet) {
    if (ship.cells.some((cell) => Number(cell[0]) === row && Number(cell[1]) === column)) {
      target = ship;
      break;
    }
  }
  next.shots[seat] = [...(next.shots[seat] || []), [row, column, target ? 'hit' : 'miss']];
  next.move_number = Number(next.move_number || 0) + 1;
  if (target) {
    if (!target.hits.some((hit) => Number(hit[0]) === row && Number(hit[1]) === column)) {
      target.hits.push([row, column]);
    }
    target.sunk = target.hits.length >= target.cells.length;
  }
  const allSunk = enemyFleet.length === SHIP_LENGTHS.length && enemyFleet.every((ship) => ship.sunk);
  if (allSunk) {
    next.winner_seat = seat;
    next.result = 'win';
  } else {
    next.current_seat = enemySeat;
  }
  return next;
}

export function applyMove(state, move, seat) {
  const userSeat = Number(seat);
  if (userSeat !== 1 && userSeat !== 2) throw error('Ghế người chơi không hợp lệ.');
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw error('Nước đi không hợp lệ.');
  if (state?.result || state?.winner_seat) throw error('Ván đấu đã kết thúc.', 409, 'GAME_FINISHED');
  if (state?.phase === 'placing') return applyPlacement(state, move, userSeat);
  if (state?.phase !== 'playing') throw error('Trạng thái ván đấu không hợp lệ.');
  return applyShot(state, move, userSeat);
}

// ---------- legalMoves ----------

export function legalMoves(state, seat) {
  const userSeat = Number(seat);
  if (userSeat !== 1 && userSeat !== 2) return [];
  if (state?.result || state?.winner_seat) return [];
  if (state?.phase !== 'playing') return [];
  if (Number(state.current_seat) !== userSeat) return [];
  const shotKeys = new Set(
    (state.shots?.[userSeat] || []).map((shot) => keyOf(Number(shot[0]), Number(shot[1])))
  );
  const moves = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (!shotKeys.has(keyOf(row, column))) moves.push({ row, column });
    }
  }
  return moves;
}

// ---------- stateForViewer (che thông tin ẩn) ----------

function fullShip(ship) {
  return {
    length: Number(ship.length) || (ship.cells || []).length,
    cells: (ship.cells || []).map((cell) => [Number(cell[0]), Number(cell[1])]),
    hits: (ship.hits || []).map((cell) => [Number(cell[0]), Number(cell[1])]),
    sunk: Boolean(ship.sunk)
  };
}

// Hạm đội đối thủ: chỉ lộ độ dài, số ô đã trúng, trạng thái chìm và toạ độ khi tàu đã chìm.
function maskShip(ship) {
  const hits = Array.isArray(ship.hits) ? ship.hits : [];
  const sunk = Boolean(ship.sunk);
  return {
    length: Number(ship.length) || (ship.cells || []).length,
    hits: hits.length,
    sunk,
    cells: sunk ? (ship.cells || []).map((cell) => [Number(cell[0]), Number(cell[1])]) : []
  };
}

function viewShots(shots) {
  return (shots || []).map((shot) => [Number(shot[0]), Number(shot[1]), shot[2] === 'hit' ? 'hit' : 'miss']);
}

export function stateForViewer(state, seat) {
  const viewer = Number(seat);
  const hasSeat = viewer === 1 || viewer === 2;
  const fleetView = (owner) => {
    const fleet = Array.isArray(state?.fleets?.[owner]) ? state.fleets[owner] : [];
    return hasSeat && viewer === owner ? fleet.map(fullShip) : fleet.map(maskShip);
  };
  const currentSeat = state?.current_seat;
  return {
    phase: state?.phase === 'playing' ? 'playing' : 'placing',
    size: Number(state?.size) || SIZE,
    fleets: { 1: fleetView(1), 2: fleetView(2) },
    ready: { 1: Boolean(state?.ready?.[1]), 2: Boolean(state?.ready?.[2]) },
    shots: { 1: viewShots(state?.shots?.[1]), 2: viewShots(state?.shots?.[2]) },
    current_seat: currentSeat === null || currentSeat === undefined ? null : Number(currentSeat),
    winner_seat: state?.winner_seat === null || state?.winner_seat === undefined ? null : Number(state.winner_seat),
    result: state?.result || null,
    move_number: Number(state?.move_number || 0)
  };
}

// Bản công khai của nước đi để lưu lịch sử và broadcast: toạ độ hạm đội lúc đặt
// tàu là thông tin mật, không bao giờ được rời server sau khi đã nằm trong state.
export function redactMove(move) {
  if (!move || typeof move !== 'object') return move;
  if (move.place === true || move.auto === true) return { place: true };
  return move;
}
