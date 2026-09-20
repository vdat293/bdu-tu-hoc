import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'caro',
  label: 'Cờ caro',
  tagline: 'Nối 5 quân liên tiếp là thắng',
  players: 2,
  clock: true,
  hidden: false,
  order: 10
};

const SIZE = 15;

function emptyCaro() {
  return {
    size: SIZE,
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    current_seat: 1,
    winner_seat: null,
    result: null,
    move_number: 0
  };
}

export function initialState() {
  return emptyCaro();
}

function checkCaroLine(board, row, column, dr, dc, seat) {
  const size = board.length;
  let count = 1;
  const cells = [[row, column]];

  let rPlus = row + dr;
  let cPlus = column + dc;
  while (rPlus >= 0 && rPlus < size && cPlus >= 0 && cPlus < size && board[rPlus][cPlus] === seat) {
    count += 1;
    cells.push([rPlus, cPlus]);
    rPlus += dr;
    cPlus += dc;
  }

  let rMinus = row - dr;
  let cMinus = column - dc;
  while (rMinus >= 0 && rMinus < size && cMinus >= 0 && cMinus < size && board[rMinus][cMinus] === seat) {
    count += 1;
    cells.push([rMinus, cMinus]);
    rMinus -= dr;
    cMinus -= dc;
  }

  // Luật BDU: đủ 5 quân liên tiếp là thắng ngay, không phụ thuộc việc bị chặn
  // một đầu hay cả hai đầu (6+ quân cũng thắng như trước).
  if (count >= 5) return { won: true, cells };
  return { won: false, cells: [] };
}

function caroWin(board, row, column, seat) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of directions) {
    const check = checkCaroLine(board, row, column, dr, dc, seat);
    if (check.won) return check;
  }
  return { won: false, cells: [] };
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const row = move.row;
  const column = move.column;
  // Chỉ chấp nhận số nguyên thật trên giá trị gốc, KHÔNG ép kiểu ngầm:
  // null / '' / false / '3' đều là payload sai kiểu và bị từ chối.
  if (typeof row !== 'number' || typeof column !== 'number' || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= state.size || column < 0 || column >= state.size || state.board[row][column] !== null) {
    throw error('Ô cờ caro không hợp lệ hoặc đã được đánh.');
  }
  const next = clone(state);
  next.board[row][column] = Number(seat);
  next.move_number += 1;
  const check = caroWin(next.board, row, column, Number(seat));
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
  for (let row = 0; row < state.size; row += 1) {
    for (let column = 0; column < state.size; column += 1) {
      if (state.board[row][column] === null) moves.push({ row, column });
    }
  }
  return moves;
}

export function stateForViewer(state) {
  return state;
}
