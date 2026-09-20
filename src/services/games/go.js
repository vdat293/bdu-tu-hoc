import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'go',
  label: 'Cờ vây',
  tagline: 'Bàn cờ 9 × 9, tính điểm theo đất và quân',
  players: 2,
  clock: true,
  hidden: true,
  order: 70
};

const SIZE = 9;

export function initialState() {
  return {
    size: SIZE,
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    current_seat: 1,
    winner_seat: null,
    result: null,
    consecutive_passes: 0,
    previous_board: null
  };
}

function neighbors(row, col, size) {
  return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size);
}

function group(board, row, col) {
  const color = board[row][col];
  const cells = [];
  const seen = new Set();
  const stack = [[row, col]];
  while (stack.length) {
    const [r, c] = stack.pop();
    const key = `${r}:${c}`;
    if (seen.has(key) || board[r][c] !== color) continue;
    seen.add(key);
    cells.push([r, c]);
    stack.push(...neighbors(r, c, board.length));
  }
  return cells;
}

function hasLiberty(board, cells) {
  return cells.some(([r, c]) => neighbors(r, c, board.length).some(([nr, nc]) => board[nr][nc] === null));
}

function calculateGoScore(board, size) {
  let blackStones = 0;
  let whiteStones = 0;
  const emptyIntersections = [];
  const visited = Array.from({ length: size }, () => Array(size).fill(false));

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (board[r][c] === 1) blackStones += 1;
      else if (board[r][c] === 2) whiteStones += 1;
      else emptyIntersections.push([r, c]);
    }
  }

  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (const [r, c] of emptyIntersections) {
    if (visited[r][c]) continue;
    const queue = [[r, c]];
    visited[r][c] = true;
    let territorySize = 0;
    const borderingColors = new Set();

    while (queue.length) {
      const [cr, cc] = queue.shift();
      territorySize += 1;
      for (const [nr, nc] of neighbors(cr, cc, size)) {
        if (board[nr][nc] === null) {
          if (!visited[nr][nc]) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        } else {
          borderingColors.add(board[nr][nc]);
        }
      }
    }

    if (borderingColors.size === 1) {
      if (borderingColors.has(1)) blackTerritory += territorySize;
      else if (borderingColors.has(2)) whiteTerritory += territorySize;
    }
  }

  const komi = 5.5; // Komi cho người cầm quân Trắng (bàn 9x9) để phân định thắng thua
  const blackScore = blackStones + blackTerritory;
  const whiteScore = whiteStones + whiteTerritory + komi;

  return {
    blackScore,
    whiteScore,
    winnerSeat: blackScore > whiteScore ? 1 : 2,
    detail: `Đen: ${blackScore} mục · Trắng: ${whiteScore} mục (gồm ${komi} mục komi)`
  };
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const next = clone(state);
  const size = next.size;
  if (move.pass === true) {
    next.consecutive_passes += 1;
    if (next.consecutive_passes >= 2) {
      const scoring = calculateGoScore(next.board, size);
      next.winner_seat = scoring.winnerSeat;
      next.result = 'win';
      next.score_detail = scoring.detail;
      return next;
    }
    next.current_seat = Number(seat) === 1 ? 2 : 1;
    return next;
  }
  const row = Number(move.row);
  const column = Number(move.column);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= size || column < 0 || column >= size || next.board[row][column] !== null) {
    throw error('Điểm cờ vây không hợp lệ.');
  }
  const previous = JSON.stringify(next.board);
  next.board[row][column] = Number(seat);
  const opponent = Number(seat) === 1 ? 2 : 1;
  for (const [nr, nc] of neighbors(row, column, size)) {
    if (next.board[nr][nc] === opponent) {
      const captured = group(next.board, nr, nc);
      if (!hasLiberty(next.board, captured)) captured.forEach(([r, c]) => { next.board[r][c] = null; });
    }
  }
  const ownGroup = group(next.board, row, column);
  if (!hasLiberty(next.board, ownGroup)) throw error('Nước đi tự sát không được phép.');
  if (next.previous_board && JSON.stringify(next.board) === next.previous_board) throw error('Nước đi vi phạm luật Ko.');
  next.previous_board = previous;
  next.consecutive_passes = 0;
  next.current_seat = Number(seat) === 1 ? 2 : 1;
  return next;
}

export function legalMoves(state, seat) {
  if (state.result || state.winner_seat || Number(state.current_seat) !== Number(seat)) return [];
  const moves = [{ pass: true }];
  for (let row = 0; row < state.size; row += 1) {
    for (let column = 0; column < state.size; column += 1) {
      if (state.board[row][column] !== null) continue;
      try {
        const probe = clone(state);
        probe.current_seat = Number(seat);
        applyMove(probe, { row, column }, seat);
        moves.push({ row, column });
      } catch {
        // Nước tự sát hoặc vi phạm luật Ko: không gợi ý cho người chơi.
      }
    }
  }
  return moves;
}

export function stateForViewer(state) {
  return state;
}
