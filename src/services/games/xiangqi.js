import { clone, assertSeat, error, inBounds } from './shared.js';

export const meta = {
  id: 'xiangqi',
  label: 'Cờ tướng',
  tagline: 'Bàn cờ 9 × 10 với sông và cung tướng',
  players: 2,
  clock: true,
  hidden: true,
  order: 60
};

function xiangqiBoard() {
  return [
    ['br', 'bn', 'bb', 'ba', 'bk', 'ba', 'bb', 'bn', 'br'],
    Array(9).fill(null),
    [null, 'bc', null, null, null, null, null, 'bc', null],
    ['bp', null, 'bp', null, 'bp', null, 'bp', null, 'bp'],
    Array(9).fill(null),
    Array(9).fill(null),
    ['rp', null, 'rp', null, 'rp', null, 'rp', null, 'rp'],
    [null, 'rc', null, null, null, null, null, 'rc', null],
    Array(9).fill(null),
    ['rr', 'rn', 'rb', 'ra', 'rk', 'ra', 'rb', 'rn', 'rr']
  ];
}

export function initialState() {
  return { board: xiangqiBoard(), current_seat: 1, winner_seat: null, result: null, move_number: 0 };
}

function pieceColor(piece) {
  return piece?.[0] || null;
}

function pathCount(board, from, to) {
  const dr = Math.sign(to[0] - from[0]);
  const dc = Math.sign(to[1] - from[1]);
  let count = 0;
  let r = from[0] + dr;
  let c = from[1] + dc;
  while (r !== to[0] || c !== to[1]) {
    if (board[r][c]) count += 1;
    r += dr;
    c += dc;
  }
  return count;
}

function inPalace(row, col, color) {
  return col >= 3 && col <= 5 && (color === 'r' ? row >= 7 : row <= 2);
}

export function moveIsLegal(board, from, to, color) {
  if (from[0] === to[0] && from[1] === to[1]) return false;
  if (!inBounds(board, from[0], from[1]) || !inBounds(board, to[0], to[1])) return false;
  const piece = board[from[0]][from[1]];
  const target = board[to[0]][to[1]];
  if (!piece || pieceColor(piece) !== color || target?.[0] === color) return false;
  const type = piece[1];
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  if (type === 'r') return (dr === 0 || dc === 0) && pathCount(board, from, to) === 0;
  if (type === 'c') return (dr === 0 || dc === 0) && pathCount(board, from, to) === (target ? 1 : 0);
  if (type === 'n') return (adr === 2 && adc === 1 && !board[from[0] + Math.sign(dr)][from[1]]) || (adr === 1 && adc === 2 && !board[from[0]][from[1] + Math.sign(dc)]);
  if (type === 'b') return adr === 2 && adc === 2 && ((color === 'r' && to[0] >= 5) || (color === 'b' && to[0] <= 4)) && !board[from[0] + dr / 2][from[1] + dc / 2];
  if (type === 'a') return adr === 1 && adc === 1 && inPalace(to[0], to[1], color);
  if (type === 'k') return ((adr + adc === 1 && inPalace(to[0], to[1], color)) || (dc === 0 && target?.[1] === 'k' && pathCount(board, from, to) === 0));
  if (type === 'p') return color === 'r' ? ((dr === -1 && dc === 0) || (from[0] <= 4 && dr === 0 && adc === 1)) : ((dr === 1 && dc === 0) || (from[0] >= 5 && dr === 0 && adc === 1));
  return false;
}

function kingsFaceEachOther(board) {
  let rKing = null;
  let bKing = null;
  for (let r = 0; r < 10; r += 1) {
    for (let c = 3; c <= 5; c += 1) {
      if (board[r][c] === 'rk') rKing = [r, c];
      if (board[r][c] === 'bk') bKing = [r, c];
    }
  }
  if (!rKing || !bKing) return false;
  if (rKing[1] !== bKing[1]) return false;
  const col = rKing[1];
  const minRow = Math.min(rKing[0], bKing[0]);
  const maxRow = Math.max(rKing[0], bKing[0]);
  for (let r = minRow + 1; r < maxRow; r += 1) {
    if (board[r][col] !== null) return false;
  }
  return true;
}

function applyOnBoard(board, from, to) {
  const next = board.map((row) => [...row]);
  next[to[0]][to[1]] = next[from[0]][from[1]];
  next[from[0]][from[1]] = null;
  return next;
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const from = [Number(move.from?.row), Number(move.from?.column)];
  const to = [Number(move.to?.row), Number(move.to?.column)];
  const color = Number(seat) === 1 ? 'r' : 'b';
  const piece = state.board[from[0]]?.[from[1]];
  if (!piece || !moveIsLegal(state.board, from, to, color)) throw error('Nước đi cờ tướng không hợp lệ.');
  const next = clone(state);
  const target = next.board[to[0]][to[1]];
  next.board[to[0]][to[1]] = piece;
  next.board[from[0]][from[1]] = null;
  next.move_number += 1;

  if (kingsFaceEachOther(next.board)) {
    throw error('Nước đi phạm luật: Hai tướng không được đối mặt trực tiếp (lộ mặt tướng).', 400, 'FLYING_GENERAL');
  }

  if (target?.[1] === 'k') {
    next.winner_seat = Number(seat);
    next.result = 'win';
    next.winning_cells = [to];
  } else {
    const opponentColor = color === 'r' ? 'b' : 'r';
    const hasOpponentKing = next.board.some((row) => row.some((cell) => cell === `${opponentColor}k`));
    if (!hasOpponentKing) {
      next.winner_seat = Number(seat);
      next.result = 'win';
      next.winning_cells = [to];
    } else {
      next.current_seat = Number(seat) === 1 ? 2 : 1;
    }
  }
  return next;
}

export function legalMoves(state, seat) {
  if (state.result || state.winner_seat || Number(state.current_seat) !== Number(seat)) return [];
  const color = Number(seat) === 1 ? 'r' : 'b';
  const moves = [];
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const piece = state.board[row][column];
      if (!piece || piece[0] !== color) continue;
      for (let r = 0; r < 10; r += 1) {
        for (let c = 0; c < 9; c += 1) {
          if (!moveIsLegal(state.board, [row, column], [r, c], color)) continue;
          if (kingsFaceEachOther(applyOnBoard(state.board, [row, column], [r, c]))) continue;
          moves.push({ from: { row, column }, to: { row: r, column: c } });
        }
      }
    }
  }
  return moves;
}

export function stateForViewer(state) {
  return state;
}
