// Engine Cờ đam — English draughts 8×8, server-authoritative, hàm thuần.
// Bàn 8×8, chỉ ô đen (row + column) % 2 === 1 mới có quân. Seat 1 ('r', đỏ ở
// hàng 5-7) đi lên (row giảm); seat 2 ('b', đen ở hàng 0-2) đi xuống (row tăng).
// Luật riêng của biến thể: bắt buộc ăn, chuỗi ăn phải đi tiếp bằng đúng quân
// vừa ăn, phong cấp kết thúc lượt ngay (kể cả giữa chuỗi), vua chỉ đi/ăn 1 ô.
// Chống kéo dài vô tận (phòng có thể chọn "không giới hạn" thời gian): hòa khi
// 80 ply liên tiếp không ăn quân/không đi tốt, hoặc khi lặp thế 3 lần.
import { clone, assertSeat, error, inBounds } from './shared.js';

export const meta = {
  id: 'checkers',
  label: 'Cờ đam',
  tagline: 'Nhảy qua quân đối phương để ăn; hết quân hoặc hết nước là thua',
  players: 2,
  clock: true,
  hidden: false,
  order: 40
};

const SIZE = 8;
const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const IDLE_PLY_LIMIT = 80;
// Giữ tối đa 3×80 ply gần nhất. Giữa hai lần lặp thế chỉ có thể là nước vua
// không ăn (ăn quân/đi tốt/phong cấp đều làm thế cờ khác đi), mà 80 ply không
// tiến triển đã là hòa, nên hai lần lặp cách nhau tối đa 79 ply. Giới hạn này
// thừa sức phát hiện lặp 3 lần mà không để state phình vô hạn.
const HISTORY_LIMIT = 240;

function isDark(row, column) {
  return (row + column) % 2 === 1;
}

function pieceSeat(piece) {
  if (piece === 'r' || piece === 'R') return 1;
  if (piece === 'b' || piece === 'B') return 2;
  return 0;
}

function isKing(piece) {
  return piece === 'R' || piece === 'B';
}

// Hướng đi hợp lệ của một quân: tốt chỉ tiến, vua đi cả 4 hướng chéo.
function directionsFor(piece) {
  if (isKing(piece)) return DIRECTIONS;
  const forward = pieceSeat(piece) === 1 ? -1 : 1;
  return [[forward, -1], [forward, 1]];
}

// Key thế cờ rút gọn (JSON): board + lượt đi + chain, dùng phát hiện lặp thế.
function positionKey(board, seat, chain) {
  return JSON.stringify([
    Number(seat) || 0,
    chain && Number.isInteger(Number(chain.row)) && Number.isInteger(Number(chain.column))
      ? [Number(chain.row), Number(chain.column)]
      : null,
    board.map((line) => line.map((cell) => cell || '.').join(''))
  ]);
}

// Chịu được state cũ thiếu position_history: khởi tạo mảng rỗng rồi mới ghi.
function appendHistory(history, key) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.push(key);
  return list.length > HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT) : list;
}

function countOccurrences(history, key) {
  let count = 0;
  for (const item of history) if (item === key) count += 1;
  return count;
}

function samePoint(a, b) {
  return Boolean(a) && Boolean(b)
    && Number(a.row) === Number(b.row)
    && Number(a.column) === Number(b.column);
}

// Nước đi chéo 1 ô tới ô trống (không ăn quân).
function stepsFor(board, row, column) {
  const piece = board[row][column];
  if (!piece) return [];
  const from = { row, column };
  const moves = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const to = { row: row + dr, column: column + dc };
    if (!inBounds(board, to.row, to.column) || !isDark(to.row, to.column)) continue;
    if (board[to.row][to.column] !== null) continue;
    moves.push({ from, to });
  }
  return moves;
}

// Nước nhảy qua 1 quân đối phương liền kề tới ô trống ngay sau (ăn 1 quân).
function jumpsFor(board, row, column) {
  const piece = board[row][column];
  if (!piece) return [];
  const seat = pieceSeat(piece);
  const from = { row, column };
  const moves = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const victim = { row: row + dr, column: column + dc };
    const to = { row: row + 2 * dr, column: column + 2 * dc };
    if (!inBounds(board, to.row, to.column)) continue;
    const target = board[victim.row][victim.column];
    if (!target || pieceSeat(target) === seat) continue;
    if (board[to.row][to.column] !== null) continue;
    moves.push({ from, to, captured: victim });
  }
  return moves;
}

function collectSteps(board, seat) {
  const moves = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (!isDark(row, column)) continue;
      if (pieceSeat(board[row][column]) !== Number(seat)) continue;
      moves.push(...stepsFor(board, row, column));
    }
  }
  return moves;
}

function collectJumps(board, seat) {
  const moves = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (!isDark(row, column)) continue;
      if (pieceSeat(board[row][column]) !== Number(seat)) continue;
      moves.push(...jumpsFor(board, row, column));
    }
  }
  return moves;
}

function plainMove(move) {
  return {
    from: { row: move.from.row, column: move.from.column },
    to: { row: move.to.row, column: move.to.column }
  };
}

function parsePoint(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(`${label} không hợp lệ.`);
  const row = Number(value.row);
  const column = Number(value.column);
  if (!Number.isInteger(row) || !Number.isInteger(column)) throw error(`${label} không hợp lệ.`);
  return { row, column };
}

export function initialState() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (!isDark(row, column)) continue;
      if (row <= 2) board[row][column] = 'b';
      else if (row >= 5) board[row][column] = 'r';
    }
  }
  return {
    size: SIZE,
    board,
    current_seat: 1,
    chain: null,
    winner_seat: null,
    result: null,
    move_number: 0,
    last_move: null,
    idle_ply: 0,
    position_history: [positionKey(board, 1, null)]
  };
}

// Kết thúc lượt: thắng khi đối phương hết quân hoặc hết nước (ưu tiên cao nhất);
// nếu không thì kiểm tra hòa do 80 ply không tiến triển hoặc lặp thế 3 lần.
function endTurn(next, seatNumber) {
  next.chain = null;
  const opponent = seatNumber === 1 ? 2 : 1;
  const opponentJumps = collectJumps(next.board, opponent);
  const opponentSteps = opponentJumps.length ? [] : collectSteps(next.board, opponent);
  if (!opponentJumps.length && !opponentSteps.length) {
    next.winner_seat = seatNumber;
    next.result = 'win';
    next.current_seat = seatNumber;
    return next;
  }
  next.current_seat = opponent;
  // Chỉ ghi lịch sử khi lượt đã kết thúc (không giữa chuỗi ăn) và key gồm cả chain.
  const key = positionKey(next.board, opponent, next.chain);
  const history = appendHistory(next.position_history, key);
  next.position_history = history;
  if ((Number(next.idle_ply) || 0) >= IDLE_PLY_LIMIT || countOccurrences(history, key) >= 3) {
    next.winner_seat = null;
    next.result = 'draw';
  }
  return next;
}

function promoteIfNeeded(piece, row) {
  if (piece === 'r' && row === 0) return 'R';
  if (piece === 'b' && row === SIZE - 1) return 'B';
  return piece;
}

function applyJump(state, from, to, captured, seatNumber) {
  const next = clone(state);
  const piece = next.board[from.row][from.column];
  next.board[from.row][from.column] = null;
  next.board[to.row][to.column] = piece;
  next.board[captured.row][captured.column] = null;
  next.move_number = Number(next.move_number || 0) + 1;
  next.idle_ply = 0; // Ăn quân (kể cả trong chuỗi) luôn là tiến triển.
  next.last_move = {
    from: { row: from.row, column: from.column },
    to: { row: to.row, column: to.column },
    captured: [{ row: captured.row, column: captured.column }]
  };

  const promoted = promoteIfNeeded(piece, to.row);
  if (promoted !== piece) {
    // Phong cấp kết thúc lượt ngay, kể cả khi còn nước ăn tiếp.
    next.board[to.row][to.column] = promoted;
    return endTurn(next, seatNumber);
  }
  if (jumpsFor(next.board, to.row, to.column).length) {
    // Còn nước ăn tiếp: giữ nguyên lượt, khóa quân vừa ăn để đi tiếp.
    next.chain = { row: to.row, column: to.column };
    next.current_seat = seatNumber;
    return next;
  }
  return endTurn(next, seatNumber);
}

function applyStep(state, from, to, seatNumber) {
  const next = clone(state);
  const piece = next.board[from.row][from.column];
  next.board[from.row][from.column] = null;
  next.board[to.row][to.column] = promoteIfNeeded(piece, to.row);
  next.move_number = Number(next.move_number || 0) + 1;
  // Đi tốt (kể cả phong cấp) là tiến triển; vua đi không ăn thì tăng idle_ply.
  next.idle_ply = piece === 'r' || piece === 'b' ? 0 : (Number(state.idle_ply) || 0) + 1;
  next.last_move = {
    from: { row: from.row, column: from.column },
    to: { row: to.row, column: to.column }
  };
  return endTurn(next, seatNumber);
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const seatNumber = Number(seat);
  const from = parsePoint(move.from, 'Ô xuất phát');
  const to = parsePoint(move.to, 'Ô đến');

  // Không tin client: kiểm tra toạ độ, màu ô, quân và chủ sở hữu.
  if (!inBounds(state.board, from.row, from.column) || !inBounds(state.board, to.row, to.column)) {
    throw error('Nước đi nằm ngoài bàn.');
  }
  if (!isDark(from.row, from.column) || !isDark(to.row, to.column)) {
    throw error('Chỉ được đi trên ô đen.');
  }
  const piece = state.board[from.row][from.column];
  if (!piece) throw error('Ô xuất phát không có quân.');
  if (pieceSeat(piece) !== seatNumber) throw error('Không phải quân của bạn.');

  const chain = state.chain;
  if (chain) {
    // Đang giữa chuỗi ăn: bắt buộc đi tiếp bằng đúng quân vừa ăn.
    if (!samePoint(chain, from)) {
      throw error('Đang giữa chuỗi ăn: phải đi tiếp bằng đúng quân vừa ăn.', 409, 'CHAIN_REQUIRED');
    }
    const jump = jumpsFor(state.board, from.row, from.column).find((candidate) => samePoint(candidate.to, to));
    if (!jump) throw error('Nước nối chuỗi ăn không hợp lệ.');
    return applyJump(state, from, to, jump.captured, seatNumber);
  }

  // Bắt buộc ăn: nếu có bất kỳ nước ăn nào thì nước không ăn bị từ chối.
  const jumps = collectJumps(state.board, seatNumber);
  const jump = jumps.find((candidate) => samePoint(candidate.from, from) && samePoint(candidate.to, to));
  if (jumps.length && !jump) throw error('Bắt buộc ăn quân: bạn đang có nước ăn hợp lệ.', 409, 'CAPTURE_REQUIRED');
  if (jump) return applyJump(state, from, to, jump.captured, seatNumber);

  const step = stepsFor(state.board, from.row, from.column).find((candidate) => samePoint(candidate.to, to));
  if (!step) throw error('Nước đi không hợp lệ.');
  return applyStep(state, from, to, seatNumber);
}

// Nước hợp lệ theo luật: tôn trọng bắt buộc ăn, chuỗi đang dở và phong cấp.
export function legalMoves(state, seat) {
  if (!state || state.result || state.winner_seat) return [];
  if (Number(state.current_seat) !== Number(seat)) return [];
  const board = state.board;
  const chain = state.chain;
  if (chain && Number.isInteger(Number(chain.row)) && Number.isInteger(Number(chain.column))) {
    return jumpsFor(board, Number(chain.row), Number(chain.column)).map(plainMove);
  }
  const jumps = collectJumps(board, seat);
  if (jumps.length) return jumps.map(plainMove);
  return collectSteps(board, seat).map(plainMove);
}

export function stateForViewer(state) {
  // Không che thông tin (game công khai) nhưng bỏ lịch sử thế cờ nội bộ để
  // payload phòng/broadcast không phình theo số nước đi.
  const view = clone(state);
  delete view.position_history;
  return view;
}
