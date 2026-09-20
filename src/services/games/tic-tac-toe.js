import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'tic_tac_toe',
  label: 'Tic Tac Toe',
  tagline: 'Ba ô liên tiếp là thắng',
  players: 2,
  clock: true,
  hidden: false,
  order: 20
};

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function emptyTicTacToe() {
  return { board: Array(9).fill(null), current_seat: 1, winner_seat: null, result: null };
}

export function initialState() {
  return emptyTicTacToe();
}

function finishIfLine(board, indexes, seat, winLength = 3) {
  const values = indexes.map((index) => board[index]);
  for (let i = 0; i <= values.length - winLength; i += 1) {
    if (values.slice(i, i + winLength).every((value) => value === seat)) return true;
  }
  return false;
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  // Không tin client: chỉ nhận index là số nguyên trong 0..8, ô còn trống.
  const index = move.index;
  if (!Number.isInteger(index) || index < 0 || index >= 9 || state.board[index] !== null) throw error('Ô cờ không hợp lệ hoặc đã được đánh.');
  const next = clone(state);
  next.board[index] = Number(seat);
  const winningLine = WIN_LINES.find((line) => finishIfLine(next.board, line, Number(seat)));
  if (winningLine) {
    next.winner_seat = Number(seat);
    next.result = 'win';
    // winning_cells theo [row, column] đúng hợp đồng; UI tự quy đổi sang index.
    next.winning_cells = winningLine.map((cell) => [Math.floor(cell / 3), cell % 3]);
  } else if (next.board.every((cell) => cell !== null)) {
    next.result = 'draw';
  } else {
    next.current_seat = Number(seat) === 1 ? 2 : 1;
  }
  return next;
}

export function legalMoves(state, seat) {
  if (state.result || state.winner_seat || Number(state.current_seat) !== Number(seat)) return [];
  const moves = [];
  for (let index = 0; index < state.board.length; index += 1) {
    if (state.board[index] === null) moves.push({ index });
  }
  return moves;
}

export function stateForViewer(state) {
  return state;
}
