// Engine Backgammon — server-authoritative, KHÔNG dùng doubling cube.
// Quy ước: points[i] = điểm (i+1); dương = quân ghế 1, âm = quân ghế 2.
// Ghế 1 đi từ điểm cao về điểm thấp (nhà 1..6), ghế 2 đi từ điểm thấp lên cao (nhà 19..24).
// Xúc xắc sinh bằng node:crypto; test có thể bơm state.pending_roll = [d1, d2] để xác định.
import { randomInt } from 'node:crypto';
import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'backgammon',
  label: 'Backgammon',
  tagline: 'Đua 15 quân về nhà — không có doubling cube',
  players: 2,
  clock: false,
  hidden: false,
  order: 45
};

const CHECKERS_PER_SEAT = 15;
// Chặn lặp vô hạn khi cả hai ghế liên tục không có nước hợp lệ.
const MAX_AUTO_PASSES = 4;

function opponentOf(seat) {
  return Number(seat) === 1 ? 2 : 1;
}

function signOf(seat) {
  return Number(seat) === 1 ? 1 : -1;
}

function homeRange(seat) {
  return Number(seat) === 1 ? [1, 6] : [19, 24];
}

// Thế xếp chuẩn đối xứng: ghế 1 có 2 quân điểm 24, 5 điểm 13, 3 điểm 8, 5 điểm 6;
// ghế 2 có 2 ở 12, 5 ở 1, 3 ở 17, 5 ở 19.
function startingPoints() {
  const points = Array(24).fill(0);
  points[23] = 2;   // điểm 24 — seat 1
  points[12] = 5;   // điểm 13 — seat 1
  points[7] = 3;    // điểm 8  — seat 1
  points[5] = 5;    // điểm 6  — seat 1
  points[11] = -2;  // điểm 12 — seat 2
  points[0] = -5;   // điểm 1  — seat 2
  points[16] = -3;  // điểm 17 — seat 2
  points[18] = -5;  // điểm 19 — seat 2
  return points;
}

function expandDice(values) {
  const a = Number(values[0]);
  const b = Number(values[1]);
  if (a === b) return [a, a, a, a]; // doubles được dùng 4 lượt
  return [a, b];
}

function rollDice() {
  return expandDice([randomInt(1, 7), randomInt(1, 7)]);
}

function isDie(value) {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function sanitizeDice(remaining) {
  if (!Array.isArray(remaining)) return [];
  return remaining.map(Number).filter(isDie);
}

function readPendingRoll(state) {
  const pending = state.pending_roll;
  if (pending === null || pending === undefined) return null;
  if (!Array.isArray(pending) || pending.length !== 2) throw error('Xúc xắc chờ không hợp lệ.');
  const values = pending.map(Number);
  if (!values.every(isDie)) throw error('Xúc xắc chờ không hợp lệ.');
  return expandDice(values);
}

export function initialState() {
  const state = {
    points: startingPoints(),
    bar: { 1: 0, 2: 0 },
    off: { 1: 0, 2: 0 },
    dice: { remaining: [] },
    current_seat: 1,
    pending_roll: null,
    winner_seat: null,
    result: null,
    move_number: 0,
    last_move: null,
    skipped: false
  };
  state.dice = { remaining: rollDice() };
  // Phòng xa: thế mở màn luôn có nước, nhưng nếu không thì tự bỏ lượt an toàn.
  if (!anyMoveWithDice(state, 1, state.dice.remaining)) endTurn(state);
  return state;
}

function barCount(state, seat) {
  return Number(state.bar?.[seat] || 0);
}

function offCount(state, seat) {
  return Number(state.off?.[seat] || 0);
}

function seatCountAt(state, point, seat) {
  const value = Number(state.points?.[point - 1] || 0);
  return Number(seat) === 1 ? Math.max(0, value) : Math.max(0, -value);
}

function opponentCountAt(state, point, seat) {
  return seatCountAt(state, point, opponentOf(seat));
}

// Điểm đến hợp lệ: trong bàn và không bị chặn bởi >= 2 quân đối phương.
function canLand(state, seat, point) {
  if (!Number.isInteger(point) || point < 1 || point > 24) return false;
  return opponentCountAt(state, point, seat) < 2;
}

// Ghế 1 vào bar ở điểm 25-die (19..24); ghế 2 vào ở điểm die (1..6).
function entryPoint(seat, die) {
  return Number(seat) === 1 ? 25 - Number(die) : Number(die);
}

// Ghế 1 đi lùi (trừ die), ghế 2 đi tới (cộng die).
function destinationPoint(seat, from, die) {
  return Number(seat) === 1 ? Number(from) - Number(die) : Number(from) + Number(die);
}

// Khoảng cách tới khay off: ghế 1 = số điểm; ghế 2 = 25 - số điểm.
function distanceToOff(seat, point) {
  return Number(seat) === 1 ? Number(point) : 25 - Number(point);
}

function allInHome(state, seat) {
  if (barCount(state, seat) > 0) return false;
  const [lo, hi] = homeRange(seat);
  for (let point = 1; point <= 24; point += 1) {
    if (point >= lo && point <= hi) continue;
    if (seatCountAt(state, point, seat) > 0) return false;
  }
  return true;
}

// Các điểm được phép bear-off với con xúc xắc `die` (rỗng nếu không đủ điều kiện).
// Luật chuẩn: khớp đúng khoảng cách, hoặc die lớn hơn khoảng cách xa nhất thì
// được bear-off quân ở điểm xa nhất (khi không có quân nào khớp đúng die).
function bearOffPoints(state, seat, die) {
  if (!allInHome(state, seat)) return [];
  const [lo, hi] = homeRange(seat);
  const occupied = [];
  let maxDistance = 0;
  for (let point = lo; point <= hi; point += 1) {
    if (seatCountAt(state, point, seat) <= 0) continue;
    occupied.push(point);
    maxDistance = Math.max(maxDistance, distanceToOff(seat, point));
  }
  if (!occupied.length) return [];
  const exact = occupied.filter((point) => distanceToOff(seat, point) === die);
  if (exact.length) return exact;
  if (die > maxDistance) return occupied.filter((point) => distanceToOff(seat, point) === maxDistance);
  return [];
}

// Mọi nước hợp lệ với một con xúc xắc. Nếu còn quân trên bar thì bắt buộc vào bar.
function movesForDie(state, seat, die) {
  const moves = [];
  if (barCount(state, seat) > 0) {
    const to = entryPoint(seat, die);
    if (canLand(state, seat, to)) moves.push({ from: 'bar', to, die: Number(die) });
    return moves;
  }
  const offPoints = bearOffPoints(state, seat, die);
  for (let point = 1; point <= 24; point += 1) {
    if (seatCountAt(state, point, seat) <= 0) continue;
    const to = destinationPoint(seat, point, die);
    if (to >= 1 && to <= 24) {
      if (canLand(state, seat, to)) moves.push({ from: point, to, die: Number(die) });
      continue;
    }
    if (offPoints.includes(point)) moves.push({ from: point, to: 'off', die: Number(die) });
  }
  return moves;
}

function anyMoveWithDice(state, seat, dice) {
  const values = [...new Set(sanitizeDice(dice))];
  return values.some((die) => movesForDie(state, seat, die).length > 0);
}

// --- Luật "phải dùng tối đa xúc xắc" ---
// Bàn thu gọn cho DFS (không cần current_seat/move_number/last_move...).
function cloneBoard(state) {
  return {
    points: (Array.isArray(state.points) ? state.points : []).slice(),
    bar: { 1: barCount(state, 1), 2: barCount(state, 2) },
    off: { 1: offCount(state, 1), 2: offCount(state, 2) }
  };
}

function boardKey(board, seat, dice) {
  return [
    seat,
    board.points.join(','),
    `${board.bar[1]},${board.bar[2]}`,
    `${board.off[1]},${board.off[2]}`,
    [...dice].sort((a, b) => a - b).join(',')
  ].join('|');
}

function removeDie(dice, die) {
  const next = dice.slice();
  const index = next.indexOf(Number(die));
  if (index >= 0) next.splice(index, 1);
  return next;
}

// Thực thi một nước ĐÃ hợp lệ trên bàn thu gọn (mutate bàn, không mutate state gốc).
function commitMove(board, seat, move) {
  const current = Number(seat);
  if (move.from === 'bar') board.bar[current] = barCount(board, current) - 1;
  else board.points[Number(move.from) - 1] -= signOf(current);
  if (move.to === 'off') {
    board.off[current] = offCount(board, current) + 1;
    return;
  }
  const opponent = opponentOf(current);
  if (opponentCountAt(board, Number(move.to), current) === 1) {
    board.points[Number(move.to) - 1] = 0;
    board.bar[opponent] = barCount(board, opponent) + 1;
  }
  board.points[Number(move.to) - 1] = Number(board.points[Number(move.to) - 1] || 0) + signOf(current);
}

// DFS có memo: số xúc xắc tối đa có thể dùng từ vị thế hiện tại (tối đa 4 con).
function maxUsableFrom(board, seat, dice, memo) {
  if (!dice.length) return 0;
  const key = boardKey(board, seat, dice);
  if (memo.has(key)) return memo.get(key);
  let best = 0;
  for (const die of [...new Set(dice)]) {
    for (const move of movesForDie(board, seat, die)) {
      const next = cloneBoard(board);
      commitMove(next, seat, move);
      const value = 1 + maxUsableFrom(next, seat, removeDie(dice, die), memo);
      if (value > best) best = value;
      if (best === dice.length) break;
    }
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

function maxUsableDice(state, seat, dice = sanitizeDice(state?.dice?.remaining), memo = new Map()) {
  return maxUsableFrom(cloneBoard(state), Number(seat), sanitizeDice(dice), memo);
}

// Chọn nước đúng luật tối đa xúc xắc:
// - mỗi nước phải giữ maxAfter = maxBefore - 1 (không bỏ phí xúc xắc còn lại);
// - khi chỉ dùng được 1 xúc xắc mà cả hai giá trị đều đi được -> bắt buộc con lớn hơn.
function selectMoves(state, seat, dice) {
  const clean = sanitizeDice(dice);
  const values = [...new Set(clean)];
  const memo = new Map();
  const maxBefore = maxUsableDice(state, seat, clean, memo);
  let forcedDie = null;
  if (maxBefore === 1 && values.length === 2) {
    const playable = values.filter((die) => movesForDie(state, seat, die).length > 0);
    if (playable.length === 2) forcedDie = Math.max(...playable);
  }
  const moves = [];
  for (const die of values) {
    if (forcedDie !== null && die !== forcedDie) continue;
    for (const move of movesForDie(state, seat, die)) {
      const next = cloneBoard(state);
      commitMove(next, seat, move);
      if (maxUsableFrom(next, seat, removeDie(clean, die), memo) === maxBefore - 1) moves.push(move);
    }
  }
  return { maxBefore, forcedDie, moves };
}

// Đầu lượt: pending_roll (test bơm) được dùng rồi xoá; nếu không còn xúc xắc thì
// sinh xúc xắc mới bằng crypto.
function beginTurn(state) {
  const pending = readPendingRoll(state);
  if (pending) {
    state.dice = { remaining: pending };
    state.pending_roll = null;
    return;
  }
  const remaining = sanitizeDice(state.dice?.remaining);
  if (!remaining.length) state.dice = { remaining: rollDice() };
  else state.dice = { remaining };
}

// Kết thúc lượt: chuyển ghế, sinh xúc xắc, tự bỏ lượt nếu ghế mới không có nước.
// MAX_AUTO_PASSES bảo đảm vòng lặp luôn dừng.
function endTurn(state) {
  let passed = false;
  state.dice = { remaining: [] };
  for (let attempt = 0; attempt < MAX_AUTO_PASSES; attempt += 1) {
    state.current_seat = opponentOf(state.current_seat);
    state.dice = { remaining: rollDice() };
    if (anyMoveWithDice(state, state.current_seat, state.dice.remaining)) break;
    passed = true;
  }
  state.skipped = passed;
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const current = Number(seat);
  const next = clone(state);
  beginTurn(next);

  const remaining = next.dice.remaining;
  const die = Number(move?.die);
  if (!isDie(die) || !remaining.includes(die)) {
    throw error('Xúc xắc không hợp lệ hoặc đã dùng hết.');
  }

  let from = move?.from;
  if (from !== 'bar') {
    from = Number(from);
    if (!Number.isInteger(from) || from < 1 || from > 24) throw error('Điểm xuất phát không hợp lệ.');
    if (seatCountAt(next, from, current) <= 0) throw error('Không có quân của bạn ở điểm này.');
    if (barCount(next, current) > 0) throw error('Phải đưa quân từ bar vào bàn trước.');
  }

  const raw = movesForDie(next, current, die).find((candidate) => candidate.from === from);
  if (!raw) throw error('Nước đi không hợp lệ.');

  // Không tin client: nước đi phải giữ luật dùng tối đa xúc xắc.
  const selection = selectMoves(next, current, remaining);
  if (selection.forcedDie !== null && die !== selection.forcedDie) {
    throw error('Chỉ dùng được một xúc xắc nên phải đi con lớn hơn.');
  }
  const legal = selection.moves.find((candidate) => candidate.from === from && Number(candidate.die) === die);
  if (!legal) throw error('Phải dùng tối đa xúc xắc — không được bỏ phí xúc xắc còn lại.');

  // Di chuyển quân.
  commitMove(next, current, legal);

  // Đánh dấu đã dùng một con xúc xắc.
  remaining.splice(remaining.indexOf(die), 1);
  next.move_number = Number(next.move_number || 0) + 1;
  next.last_move = { from, to: legal.to, die, seat: current };
  next.skipped = false;

  if (offCount(next, current) >= CHECKERS_PER_SEAT) {
    next.winner_seat = current;
    next.result = 'win';
    next.dice = { remaining: [] };
    return next;
  }

  // Phải dùng tối đa xúc xắc: còn con nào đi được thì chưa kết thúc lượt.
  if (next.dice.remaining.length === 0 || !anyMoveWithDice(next, current, next.dice.remaining)) {
    endTurn(next);
  }
  return next;
}

function effectiveDice(state) {
  const pending = readPendingRoll(state);
  if (pending) return pending;
  return sanitizeDice(state.dice?.remaining);
}

export function legalMoves(state, seat) {
  const current = Number(seat);
  if (!state || state.result || state.winner_seat) return [];
  if (Number(state.current_seat) !== current) return [];
  return selectMoves(state, current, effectiveDice(state)).moves;
}

export function stateForViewer(state) {
  const view = clone(state);
  // Hook xúc xắc chỉ dành cho test engine, không được lộ ra client.
  delete view.pending_roll;
  return view;
}
