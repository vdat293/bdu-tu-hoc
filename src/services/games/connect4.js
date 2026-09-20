import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'connect4',
  label: 'Connect 4',
  tagline: 'Nối 4 quân cùng màu theo hàng, cột hoặc chéo',
  players: 2,
  clock: true,
  hidden: false,
  order: 30
};

function emptyConnect4() {
  return { rows: 6, columns: 7, board: Array.from({ length: 6 }, () => Array(7).fill(null)), current_seat: 1, winner_seat: null, result: null };
}

export function initialState() {
  return emptyConnect4();
}

function connect4Win(board, row, column, seat) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of directions) {
    let count = 1;
    const cells = [[row, column]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === seat) {
        count += 1;
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return { won: true, cells };
  }
  return { won: false, cells: [] };
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  // Chỉ nhận số nguyên ở giá trị gốc: không ép kiểu qua Number() để tránh
  // null/''/[]/false biến thành cột 0 hay '3' thành cột 3.
  if (typeof move.column !== 'number' || !Number.isInteger(move.column)) throw error('Cột cờ không hợp lệ.');
  const column = move.column;
  if (column < 0 || column >= 7) throw error('Cột cờ không hợp lệ.');
  const next = clone(state);
  let row = -1;
  for (let r = 5; r >= 0; r -= 1) {
    if (next.board[r][column] === null) { row = r; break; }
  }
  if (row < 0) throw error('Cột cờ đã đầy.');
  next.board[row][column] = Number(seat);
  const check = connect4Win(next.board, row, column, Number(seat));
  if (check.won) {
    next.winner_seat = Number(seat);
    next.result = 'win';
    next.winning_cells = check.cells;
  } else if (next.board.every((line) => line.every((cell) => cell !== null))) {
    next.result = 'draw';
  } else {
    next.current_seat = Number(seat) === 1 ? 2 : 1;
  }
  return next;
}

export function legalMoves(state, seat) {
  if (state.result || state.winner_seat || Number(state.current_seat) !== Number(seat)) return [];
  const moves = [];
  for (let column = 0; column < 7; column += 1) {
    if (state.board[0][column] === null) moves.push({ column });
  }
  return moves;
}

export function stateForViewer(state) {
  return state;
}
