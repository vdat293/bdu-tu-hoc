import crypto from 'node:crypto';
import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { CommunityService } from './community.service.js';
import { Chess } from 'chess.js';

const GAME_TYPES = new Set(['caro', 'tic_tac_toe', 'chess', 'xiangqi', 'go', 'connect4']);
const ROOM_STATUSES = new Set(['waiting', 'active', 'finished', 'expired', 'cancelled']);
const DEFAULT_ROOM_TTL_SECONDS = 2 * 60 * 60;
const MIN_ROOM_TTL_SECONDS = 60;
const MAX_ROOM_TTL_SECONDS = 24 * 60 * 60;
const MAX_PAGE_SIZE = 100;

function cleanMssv(value) {
  return String(value ?? '').trim().toUpperCase();
}

function error(message, status = 400, code = 'GAME_INVALID') {
  const result = new Error(message);
  result.status = status;
  result.code = code;
  return result;
}

function normalizedGameType(value) {
  const gameType = String(value ?? '').trim().toLowerCase();
  if (!GAME_TYPES.has(gameType)) throw error('Loại trò chơi không được hỗ trợ.', 400, 'GAME_TYPE_INVALID');
  return gameType;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ttlSeconds(value) {
  const ttl = positiveInteger(value, DEFAULT_ROOM_TTL_SECONDS);
  if (ttl < MIN_ROOM_TTL_SECONDS || ttl > MAX_ROOM_TTL_SECONDS) {
    throw error(`Thời hạn phòng phải từ ${MIN_ROOM_TTL_SECONDS} đến ${MAX_ROOM_TTL_SECONDS} giây.`);
  }
  return ttl;
}

function challengeTtlSeconds(value) {
  const ttl = positiveInteger(value, 30 * 60);
  if (ttl < 60 || ttl > 7 * 24 * 60 * 60) {
    throw error('Thời hạn challenge phải từ 60 giây đến 7 ngày.');
  }
  return ttl;
}

function randomRoomCode() {
  return crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, 'X');
}

function randomInviteCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeRoomRef(value) {
  const ref = String(value ?? '').trim();
  if (!ref || ref.length > 32 || !/^[A-Za-z0-9_-]+$/.test(ref)) throw error('Mã phòng không hợp lệ.', 400, 'ROOM_INVALID');
  return ref.toUpperCase();
}

function playerColor(seat) {
  return Number(seat) === 1 ? 'white' : 'black';
}

function emptyTicTacToe() {
  return { board: Array(9).fill(null), current_seat: 1, winner_seat: null, result: null };
}

function emptyCaro() {
  const size = 15;
  return { size, board: Array.from({ length: size }, () => Array(size).fill(null)), current_seat: 1, winner_seat: null, result: null, move_number: 0 };
}

function emptyConnect4() {
  return { rows: 6, columns: 7, board: Array.from({ length: 6 }, () => Array(7).fill(null)), current_seat: 1, winner_seat: null, result: null };
}

function chessBoard() {
  return [
    ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
    Array(8).fill('bp'), Array(8).fill(null), Array(8).fill(null),
    Array(8).fill(null), Array(8).fill(null), Array(8).fill('wp'),
    ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
  ];
}

function emptyChess() {
  return { board: chessBoard(), fen: new Chess().fen(), current_seat: 1, winner_seat: null, result: null, move_number: 0 };
}

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

function emptyXiangqi() {
  return { board: xiangqiBoard(), current_seat: 1, winner_seat: null, result: null, move_number: 0 };
}

function emptyGo() {
  const size = 9;
  return { size, board: Array.from({ length: size }, () => Array(size).fill(null)), current_seat: 1, winner_seat: null, result: null, consecutive_passes: 0, previous_board: null };
}

export function initialState(gameType) {
  switch (normalizedGameType(gameType)) {
    case 'caro': return emptyCaro();
    case 'tic_tac_toe': return emptyTicTacToe();
    case 'connect4': return emptyConnect4();
    case 'chess': return emptyChess();
    case 'xiangqi': return emptyXiangqi();
    case 'go': return emptyGo();
    default: throw error('Loại trò chơi không được hỗ trợ.');
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSeat(state, move, seat) {
  if (state.result || state.winner_seat) throw error('Ván đấu đã kết thúc.', 409, 'GAME_FINISHED');
  if (Number(state.current_seat) !== Number(seat)) throw error('Chưa đến lượt của bạn.', 409, 'NOT_YOUR_TURN');
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw error('Nước đi không hợp lệ.');
}

function finishIfLine(board, indexes, seat, winLength = 3) {
  const values = indexes.map((index) => board[index]);
  for (let i = 0; i <= values.length - winLength; i += 1) {
    if (values.slice(i, i + winLength).every((value) => value === seat)) return true;
  }
  return false;
}

function applyTicTacToe(state, move, seat) {
  assertSeat(state, move, seat);
  const index = Number(move.index);
  if (!Number.isInteger(index) || index < 0 || index >= 9 || state.board[index] !== null) throw error('Ô cờ không hợp lệ hoặc đã được đánh.');
  const next = clone(state);
  next.board[index] = Number(seat);
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  if (lines.some((line) => finishIfLine(next.board, line, Number(seat)))) {
    next.winner_seat = Number(seat); next.result = 'win';
  } else if (next.board.every((cell) => cell !== null)) {
    next.result = 'draw';
  } else next.current_seat = Number(seat) === 1 ? 2 : 1;
  return next;
}

function checkCaroLine(board, row, column, dr, dc, seat) {
  const opponent = Number(seat) === 1 ? 2 : 1;
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
  const blockedPlus = rPlus >= 0 && rPlus < size && cPlus >= 0 && cPlus < size && board[rPlus][cPlus] === opponent;

  let rMinus = row - dr;
  let cMinus = column - dc;
  while (rMinus >= 0 && rMinus < size && cMinus >= 0 && cMinus < size && board[rMinus][cMinus] === seat) {
    count += 1;
    cells.push([rMinus, cMinus]);
    rMinus -= dr;
    cMinus -= dc;
  }
  const blockedMinus = rMinus >= 0 && rMinus < size && cMinus >= 0 && cMinus < size && board[rMinus][cMinus] === opponent;

  // Luật chuẩn cờ Caro Việt Nam:
  // - 5 con liên tiếp KHÔNG bị đối phương chặn ở cả 2 đầu -> THẮNG.
  // - 5 con liên tiếp bị đối phương chặn ở cả 2 đầu -> CHƯA THẮNG (phải từ 6 con trở lên mới phá chặn).
  // - Từ 6 con liên tiếp trở lên -> THẮNG.
  if (count >= 6) return { won: true, cells };
  if (count === 5 && !(blockedPlus && blockedMinus)) return { won: true, cells };
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

function applyCaro(state, move, seat) {
  assertSeat(state, move, seat);
  const row = Number(move.row); const column = Number(move.column);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= state.size || column < 0 || column >= state.size || state.board[row][column] !== null) throw error('Ô cờ caro không hợp lệ hoặc đã được đánh.');
  const next = clone(state); next.board[row][column] = Number(seat); next.move_number += 1;
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

function connect4Win(board, row, column, seat) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of directions) {
    let count = 1;
    const cells = [[row, column]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign; let c = column + dc * sign;
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

function applyConnect4(state, move, seat) {
  assertSeat(state, move, seat);
  const column = Number(move.column);
  if (!Number.isInteger(column) || column < 0 || column >= 7) throw error('Cột cờ không hợp lệ.');
  const next = clone(state);
  let row = -1;
  for (let r = 5; r >= 0; r -= 1) if (next.board[r][column] === null) { row = r; break; }
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

function inBounds(board, row, col) { return row >= 0 && row < board.length && col >= 0 && col < board[0].length; }
function chessColor(piece) { return piece?.[0] || null; }
function pathClear(board, from, to, dr, dc) {
  let r = from[0] + dr; let c = from[1] + dc;
  while (r !== to[0] || c !== to[1]) { if (board[r][c]) return false; r += dr; c += dc; }
  return true;
}

function chessMoveIsLegal(board, from, to, color, promotion) {
  if (from[0] === to[0] && from[1] === to[1]) return false;
  if (!inBounds(board, from[0], from[1]) || !inBounds(board, to[0], to[1])) return false;
  const piece = board[from[0]][from[1]]; const target = board[to[0]][to[1]];
  if (!piece || chessColor(piece) !== color || (target && chessColor(target) === color) || target?.[1] === 'k') return false;
  const type = piece[1]; const dr = to[0] - from[0]; const dc = to[1] - from[1];
  const adr = Math.abs(dr); const adc = Math.abs(dc);
  if (type === 'p') {
    const direction = color === 'w' ? -1 : 1; const start = color === 'w' ? 6 : 1;
    if (dc === 0 && !target && dr === direction) return true;
    if (dc === 0 && !target && from[0] === start && dr === direction * 2 && !board[from[0] + direction][from[1]]) return true;
    return adc === 1 && dr === direction && Boolean(target);
  }
  if (type === 'n') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
  if (type === 'b') return adr === adc && pathClear(board, from, to, Math.sign(dr), Math.sign(dc));
  if (type === 'r') return (dr === 0 || dc === 0) && pathClear(board, from, to, Math.sign(dr), Math.sign(dc));
  if (type === 'q') return ((dr === 0 || dc === 0) || adr === adc) && pathClear(board, from, to, Math.sign(dr), Math.sign(dc));
  if (type === 'k') return adr <= 1 && adc <= 1;
  return Boolean(promotion); // keeps the validator forward-compatible with a future piece code.
}

function boardToFen(board, currentSeat) {
  const ranks = board.map((rank) => {
    let empty = 0; let text = '';
    for (const code of rank) {
      if (!code) { empty += 1; continue; }
      if (empty) { text += empty; empty = 0; }
      text += code[0] === 'w' ? code[1].toUpperCase() : code[1].toLowerCase();
    }
    if (empty) text += empty;
    return text;
  });
  return `${ranks.join('/')} ${Number(currentSeat) === 2 ? 'b' : 'w'} - - 0 1`;
}

function applyChess(state, move, seat) {
  assertSeat(state, move, seat);
  const files = 'abcdefgh';
  const square = (point) => `${files[Number(point?.column)] || ''}${8 - Number(point?.row)}`;
  const from = square(move.from); const to = square(move.to);
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) throw error('Nước đi cờ vua không hợp lệ.');
  let chess;
  try { chess = new Chess(state.fen || boardToFen(state.board, state.current_seat)); } catch { throw error('Trạng thái cờ vua trên máy chủ không hợp lệ.', 500, 'CHESS_STATE_INVALID'); }
  const pieceFrom = chess.get(from);
  const isPawnPromotion = pieceFrom?.type === 'p' && ((chess.turn() === 'w' && to[1] === '8') || (chess.turn() === 'b' && to[1] === '1'));
  const promotion = (move.promotion ? String(move.promotion).toLowerCase() : undefined) || (isPawnPromotion ? 'q' : undefined);
  if (promotion && !['q', 'r', 'b', 'n'].includes(promotion)) throw error('Quân phong cấp không hợp lệ.');
  let played;
  try { played = chess.move({ from, to, ...(promotion ? { promotion } : {}) }); } catch { throw error('Nước đi cờ vua không hợp lệ.'); }
  const next = clone(state);
  next.board = chess.board().map((rank) => rank.map((item) => item ? `${item.color}${item.type}` : null));
  next.fen = chess.fen();
  next.move_number += 1;
  next.last_notation = played.san;
  if (chess.isCheckmate()) {
    next.winner_seat = Number(seat);
    next.result = 'win';
  } else if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition?.() || chess.isInsufficientMaterial?.()) {
    next.result = 'draw';
  } else {
    next.current_seat = Number(seat) === 1 ? 2 : 1;
  }
  return next;
}

function xiangqiPieceColor(piece) { return piece?.[0] || null; }
function xiangqiPathCount(board, from, to) {
  const dr = Math.sign(to[0] - from[0]); const dc = Math.sign(to[1] - from[1]); let count = 0;
  let r = from[0] + dr; let c = from[1] + dc;
  while (r !== to[0] || c !== to[1]) { if (board[r][c]) count += 1; r += dr; c += dc; }
  return count;
}
function inPalace(row, col, color) { return col >= 3 && col <= 5 && (color === 'r' ? row >= 7 : row <= 2); }

function xiangqiMoveIsLegal(board, from, to, color) {
  if (from[0] === to[0] && from[1] === to[1]) return false;
  if (!inBounds(board, from[0], from[1]) || !inBounds(board, to[0], to[1])) return false;
  const piece = board[from[0]][from[1]]; const target = board[to[0]][to[1]];
  if (!piece || xiangqiPieceColor(piece) !== color || target?.[0] === color) return false;
  const type = piece[1]; const dr = to[0] - from[0]; const dc = to[1] - from[1]; const adr = Math.abs(dr); const adc = Math.abs(dc);
  if (type === 'r') return (dr === 0 || dc === 0) && xiangqiPathCount(board, from, to) === 0;
  if (type === 'c') return (dr === 0 || dc === 0) && xiangqiPathCount(board, from, to) === (target ? 1 : 0);
  if (type === 'n') return (adr === 2 && adc === 1 && !board[from[0] + Math.sign(dr)][from[1]]) || (adr === 1 && adc === 2 && !board[from[0]][from[1] + Math.sign(dc)]);
  if (type === 'b') return adr === 2 && adc === 2 && ((color === 'r' && to[0] >= 5) || (color === 'b' && to[0] <= 4)) && !board[from[0] + dr / 2][from[1] + dc / 2];
  if (type === 'a') return adr === 1 && adc === 1 && inPalace(to[0], to[1], color);
  if (type === 'k') return ((adr + adc === 1 && inPalace(to[0], to[1], color)) || (dc === 0 && target?.[1] === 'k' && xiangqiPathCount(board, from, to) === 0));
  if (type === 'p') return color === 'r' ? ((dr === -1 && dc === 0) || (from[0] <= 4 && dr === 0 && adc === 1)) : ((dr === 1 && dc === 0) || (from[0] >= 5 && dr === 0 && adc === 1));
  return false;
}

function xiangqiKingsFaceEachOther(board) {
  let rKing = null;
  let bKing = null;
  for (let r = 0; r < 10; r++) {
    for (let c = 3; c <= 5; c++) {
      if (board[r][c] === 'rk') rKing = [r, c];
      if (board[r][c] === 'bk') bKing = [r, c];
    }
  }
  if (!rKing || !bKing) return false;
  if (rKing[1] !== bKing[1]) return false;
  const col = rKing[1];
  const minRow = Math.min(rKing[0], bKing[0]);
  const maxRow = Math.max(rKing[0], bKing[0]);
  for (let r = minRow + 1; r < maxRow; r++) {
    if (board[r][col] !== null) return false;
  }
  return true;
}

function applyXiangqi(state, move, seat) {
  assertSeat(state, move, seat);
  const from = [Number(move.from?.row), Number(move.from?.column)]; const to = [Number(move.to?.row), Number(move.to?.column)]; const color = Number(seat) === 1 ? 'r' : 'b';
  const piece = state.board[from[0]]?.[from[1]];
  if (!piece || !xiangqiMoveIsLegal(state.board, from, to, color)) throw error('Nước đi cờ tướng không hợp lệ.');
  const next = clone(state); const target = next.board[to[0]][to[1]]; next.board[to[0]][to[1]] = piece; next.board[from[0]][from[1]] = null; next.move_number += 1;
  
  if (xiangqiKingsFaceEachOther(next.board)) {
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

function goNeighbors(row, col, size) { return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size); }
function goGroup(board, row, col) {
  const color = board[row][col]; const group = []; const seen = new Set(); const stack = [[row, col]];
  while (stack.length) { const [r, c] = stack.pop(); const key = `${r}:${c}`; if (seen.has(key) || board[r][c] !== color) continue; seen.add(key); group.push([r, c]); stack.push(...goNeighbors(r, c, board.length)); }
  return group;
}
function goHasLiberty(board, group) { return group.some(([r, c]) => goNeighbors(r, c, board.length).some(([nr, nc]) => board[nr][nc] === null)); }

function calculateGoScore(board, size) {
  let blackStones = 0;
  let whiteStones = 0;
  const emptyIntersections = [];
  const visited = Array.from({ length: size }, () => Array(size).fill(false));

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === 1) blackStones++;
      else if (board[r][c] === 2) whiteStones++;
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
      territorySize++;
      for (const [nr, nc] of goNeighbors(cr, cc, size)) {
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

function applyGo(state, move, seat) {
  assertSeat(state, move, seat);
  const next = clone(state); const size = next.size;
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
  const row = Number(move.row); const column = Number(move.column);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= size || column < 0 || column >= size || next.board[row][column] !== null) throw error('Điểm cờ vây không hợp lệ.');
  const previous = JSON.stringify(next.board); next.board[row][column] = Number(seat); const opponent = Number(seat) === 1 ? 2 : 1;
  for (const [nr, nc] of goNeighbors(row, column, size)) if (next.board[nr][nc] === opponent) { const group = goGroup(next.board, nr, nc); if (!goHasLiberty(next.board, group)) group.forEach(([r, c]) => { next.board[r][c] = null; }); }
  const ownGroup = goGroup(next.board, row, column);
  if (!goHasLiberty(next.board, ownGroup)) throw error('Nước đi tự sát không được phép.');
  if (next.previous_board && JSON.stringify(next.board) === next.previous_board) throw error('Nước đi vi phạm luật Ko.');
  next.previous_board = previous; next.consecutive_passes = 0; next.current_seat = Number(seat) === 1 ? 2 : 1; return next;
}

export function applyMove(gameType, state, move, seat) {
  if (move?.resign === true) {
    assertSeat(state, move, seat);
    const opponentSeat = Number(seat) === 1 ? 2 : 1;
    const next = clone(state);
    next.winner_seat = opponentSeat;
    next.result = 'win';
    next.resigned_seat = Number(seat);
    return next;
  }
  switch (normalizedGameType(gameType)) {
    case 'caro': return applyCaro(state, move, seat);
    case 'tic_tac_toe': return applyTicTacToe(state, move, seat);
    case 'connect4': return applyConnect4(state, move, seat);
    case 'chess': return applyChess(state, move, seat);
    case 'xiangqi': return applyXiangqi(state, move, seat);
    case 'go': return applyGo(state, move, seat);
    default: throw error('Loại trò chơi không được hỗ trợ.');
  }
}

function mapPlayer(row) {
  const name = row.full_name || row.name || row.mssv;
  return {
    mssv: row.mssv,
    name,
    full_name: name,
    seat: Number(row.seat),
    color: playerColor(row.seat),
    joined_at: row.joined_at
  };
}
function mapRoom(row, players = [], spectatorCount = 0, includeState = true) {
  return {
    id: String(row.id), room_code: row.room_code, name: row.name || null, game_type: row.game_type, visibility: row.visibility,
    allow_spectators: row.allow_spectators !== false, status: row.status,
    created_by_mssv: row.created_by_mssv, state_version: Number(row.state_version || 0), state: includeState ? row.state : undefined,
    winner_seat: row.winner_seat === null ? null : Number(row.winner_seat), result: row.result || null,
    expires_at: row.expires_at, last_activity_at: row.last_activity_at, created_at: row.created_at, updated_at: row.updated_at,
    players, spectator_count: Number(spectatorCount || 0)
  };
}

async function roomAndPlayers(roomRef, client = null, lock = false) {
  const runner = client || { query };
  const suffix = lock ? ' FOR UPDATE' : '';
  const room = await runner.query(`SELECT * FROM game_rooms WHERE room_code = $1 OR id::text = $1 LIMIT 1${suffix}`, [normalizeRoomRef(roomRef)]);
  if (!room.rowCount) throw error('Không tìm thấy phòng.', 404, 'ROOM_NOT_FOUND');
  const players = await runner.query(`
    SELECT p.mssv, p.seat, p.joined_at, COALESCE(NULLIF(s.full_name, ''), p.mssv) AS full_name
    FROM game_room_players p
    LEFT JOIN students s ON s.mssv = p.mssv
    WHERE p.room_id = $1 AND p.left_at IS NULL
    ORDER BY p.seat
  `, [room.rows[0].id]);
  return { room: room.rows[0], players: players.rows };
}

async function ensureStudent(client, mssv) {
  await client.query(`INSERT INTO students (mssv, full_name, is_active) VALUES ($1, '', FALSE) ON CONFLICT (mssv) DO NOTHING`, [mssv]);
}

function assertDatabase() { if (!isDatabaseConfigured()) throw error('Database chưa được cấu hình.', 503, 'GAME_DATABASE_NOT_CONFIGURED'); }

export const EntertainmentGameService = {
  async createRoom({ mssv, gameType, visibility = 'public', name = null, allowSpectators = true, ttlSeconds: requestedTtl }) {
    assertDatabase(); const owner = cleanMssv(mssv); if (!owner) throw error('MSSV người tạo là bắt buộc.', 401, 'AUTH_REQUIRED');
    const type = normalizedGameType(gameType);
    const cleanVisibility = String(visibility).toLowerCase() === 'private' ? 'private' : 'public';
    const finalAllowSpectators = cleanVisibility === 'private' ? false : (allowSpectators !== false);
    const cleanName = String(name || '').trim().slice(0, 80) || null;
    const ttl = ttlSeconds(requestedTtl);
    return transaction(async (client) => {
      await ensureStudent(client, owner);
      let room; for (let attempt = 0; attempt < 3; attempt += 1) {
        try { room = await client.query(`INSERT INTO game_rooms (room_code, name, game_type, visibility, allow_spectators, created_by_mssv, state, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW() + ($8 * INTERVAL '1 second')) RETURNING *`, [randomRoomCode(), cleanName, type, cleanVisibility, finalAllowSpectators, owner, JSON.stringify(initialState(type)), ttl]); break; } catch (err) { if (err.code !== '23505' || attempt === 2) throw err; }
      }
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, 1)', [room.rows[0].id, owner]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [owner]);
      const fullName = studentNameRes.rows[0]?.full_name || owner;
      return mapRoom(room.rows[0], [{ mssv: owner, full_name: fullName, seat: 1, joined_at: new Date().toISOString() }].map(mapPlayer), 0, true);
    });
  },

  async getRoom(roomRef, { mssv = null, role = null, includeState = true } = {}) {
    assertDatabase(); await this.expireStale(); const { room, players } = await roomAndPlayers(roomRef);
    const cleanUser = cleanMssv(mssv);
    const isPlayer = players.some((p) => p.mssv === cleanUser);
    const isHost = room.created_by_mssv === cleanUser;
    const isPrivate = room.visibility === 'private' || room.allow_spectators === false;

    if (isPrivate) {
      if (role === 'spectator' && !isPlayer) {
        throw error('Phòng này được đặt ở chế độ riêng tư, không cho phép khán giả theo dõi.', 403, 'ROOM_PRIVATE_NO_SPECTATORS');
      }
      if (!isPlayer && !isHost && (room.status !== 'waiting' || players.length >= 2)) {
        throw error('Phòng riêng tư này đã đủ người chơi và không cho phép khán giả xem.', 403, 'ROOM_FORBIDDEN');
      }
    }
    const spectatorCount = typeof this.getSpectatorCount === 'function'
      ? this.getSpectatorCount(room.room_code, players.map((p) => p.mssv))
      : 0;
    return mapRoom(room, players.map(mapPlayer), spectatorCount, includeState);
  },

  async listRooms({ mssv = null, gameType = null, status = null, limit = 50, offset = 0 } = {}) {
    assertDatabase(); await this.expireStale(); const params = []; const conditions = [`r.status IN ('waiting', 'active')`];
    if (gameType) { params.push(normalizedGameType(gameType)); conditions.push(`r.game_type = $${params.length}`); }
    if (status) { const cleanStatus = String(status).toLowerCase(); if (!ROOM_STATUSES.has(cleanStatus)) throw error('Trạng thái phòng không hợp lệ.'); params.push(cleanStatus); conditions.push(`r.status = $${params.length}`); }
    params.push(Math.min(MAX_PAGE_SIZE, Math.max(1, positiveInteger(limit, 50)))); const limitIndex = params.length;
    params.push(Math.max(0, Number.parseInt(offset, 10) || 0)); const offsetIndex = params.length;
    const result = await query(`SELECT r.*, COUNT(p.mssv)::int AS player_count FROM game_rooms r LEFT JOIN game_room_players p ON p.room_id = r.id AND p.left_at IS NULL WHERE ${conditions.join(' AND ')} AND (r.visibility = 'public' OR r.created_by_mssv = $${params.length + 1}) GROUP BY r.id ORDER BY r.status ASC, r.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, [...params, cleanMssv(mssv) || null]);
    const rooms = result.rows.map((row) => ({ ...mapRoom(row, [], 0, false), player_count: Number(row.player_count || 0) }));
    return { rooms, limit: params[limitIndex - 1], offset: params[offsetIndex - 1] };
  },

  async joinRoom(roomRef, mssv, { inviteCode = null } = {}) {
    assertDatabase(); const player = cleanMssv(mssv); if (!player) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true); const room = found.room; const players = found.players;
      if (room.status !== 'waiting') throw error('Phòng không còn ở trạng thái chờ người chơi.', 409, 'ROOM_NOT_JOINABLE');
      if (room.visibility === 'private') {
        const hasPendingChallenges = await client.query(
          `SELECT 1 FROM game_challenges WHERE room_id = $1 AND status = 'pending' AND expires_at > NOW()`,
          [room.id]
        );
        if (hasPendingChallenges.rowCount > 0 && inviteCode) {
          const invite = await client.query(
            `SELECT 1 FROM game_challenges WHERE room_id = $1 AND (invite_code_hash = $2 OR (accepted_by_mssv = $3 AND status = 'accepted')) AND status IN ('pending', 'accepted') AND expires_at > NOW()`,
            [room.id, sha256(inviteCode || ''), player]
          );
          if (!invite.rowCount && !players.some((item) => item.mssv === player)) {
            throw error('Mã mời thách đấu không hợp lệ hoặc đã hết hạn.', 403, 'ROOM_FORBIDDEN');
          }
        }
      }
      const existing = players.find((item) => item.mssv === player);
      if (existing) return mapRoom(room, players.map(mapPlayer));
      if (players.length >= 2) throw error('Phòng đã đủ người chơi.', 409, 'ROOM_FULL');
      await ensureStudent(client, player); const seat = players.some((item) => Number(item.seat) === 1) ? 2 : 1;
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, $3)', [room.id, player, seat]);
      if (inviteCode) {
        await client.query(`UPDATE game_challenges SET status = 'accepted', accepted_by_mssv = $3, accepted_at = NOW(), updated_at = NOW() WHERE room_id = $1 AND invite_code_hash = $2 AND status = 'pending'`, [room.id, sha256(inviteCode), player]);
      }
      const updated = await client.query(`UPDATE game_rooms SET status = 'active', updated_at = NOW(), last_activity_at = NOW() WHERE id = $1 RETURNING *`, [room.id]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [player]);
      const fullName = studentNameRes.rows[0]?.full_name || player;
      return mapRoom(updated.rows[0], [...players, { mssv: player, full_name: fullName, seat, joined_at: new Date().toISOString() }].map(mapPlayer));
    });
  },

  async makeMove(roomRef, mssv, move, { clientMoveId = null } = {}) {
    assertDatabase(); const actor = cleanMssv(mssv); if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true); const room = found.room; const players = found.players; const player = players.find((item) => item.mssv === actor);
      if (!player) throw error('Bạn không phải người chơi trong phòng này.', 403, 'PLAYER_FORBIDDEN');
      if (room.status !== 'active') throw error('Phòng chưa bắt đầu hoặc đã kết thúc.', 409, 'ROOM_NOT_ACTIVE');
      const cleanClientMoveId = clientMoveId ? String(clientMoveId).trim().slice(0, 128) : null;
      if (cleanClientMoveId) {
        const duplicate = await client.query('SELECT move_number, move, resulting_state FROM game_room_moves WHERE room_id = $1 AND client_move_id = $2', [room.id, cleanClientMoveId]);
        if (duplicate.rowCount) return { id: String(room.id), room_code: room.room_code, move_number: Number(duplicate.rows[0].move_number), move: duplicate.rows[0].move, state: duplicate.rows[0].resulting_state, state_version: Number(duplicate.rows[0].move_number), idempotent: true, status: room.status };
      }
      const nextState = applyMove(room.game_type, room.state, move, Number(player.seat)); const moveNumber = Number(room.state_version) + 1;
      const nextStatus = nextState.result ? 'finished' : 'active';
      const updated = await client.query(`UPDATE game_rooms SET state = $2::jsonb, state_version = $3, status = $4, winner_seat = $5, result = $6, finished_at = CASE WHEN $4 = 'finished' THEN NOW() ELSE NULL END, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [room.id, JSON.stringify(nextState), moveNumber, nextStatus, nextState.winner_seat, nextState.result]);
      await client.query(`INSERT INTO game_room_moves (room_id, move_number, actor_mssv, move, resulting_state, client_move_id) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`, [room.id, moveNumber, actor, JSON.stringify(move), JSON.stringify(nextState), cleanClientMoveId]);
      if (nextStatus === 'finished') {
        this.startRematchCountdown(room.room_code);
      }
      return { id: String(room.id), room_code: room.room_code, move_number: moveNumber, move, state: nextState, state_version: moveNumber, status: updated.rows[0].status, winner_seat: nextState.winner_seat, result: nextState.result, actor_mssv: actor, seat: Number(player.seat), idempotent: false };
    });
  },

  clearRematchTimer(roomCode) {
    if (this.rematchTimers?.has(roomCode)) {
      clearTimeout(this.rematchTimers.get(roomCode));
      this.rematchTimers.delete(roomCode);
    }
  },

  startRematchCountdown(roomRef) {
    const code = normalizeRoomRef(roomRef);
    this.clearRematchTimer(code);
    if (!this.rematchTimers) this.rematchTimers = new Map();

    const timer = setTimeout(async () => {
      this.rematchTimers?.delete(code);
      this.rematchRequests?.delete(code);
      try {
        const { room } = await roomAndPlayers(code);
        if (room && room.status === 'finished') {
          await query(`DELETE FROM game_rooms WHERE id = $1`, [room.id]);
          if (typeof this.onRoomClosed === 'function') {
            this.onRoomClosed(code, {
              reason: 'rematch_timeout',
              message: 'Hết 10 giây chờ đánh lại. Phòng đã tự động đóng.'
            });
          }
        }
      } catch {}
    }, 12_000);
    timer.unref?.();
    this.rematchTimers.set(code, timer);
  },

  async leaveRoom(roomRef, mssv) {
    assertDatabase();
    const actor = cleanMssv(mssv);
    if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');
    return transaction(async (client) => {
      const found = await roomAndPlayers(roomRef, client, true);
      const room = found.room;
      const players = found.players;
      const isPlayer = players.some((item) => item.mssv === actor);

      if (!isPlayer) {
        return { room_code: room.room_code, is_player: false, deleted: false, actor };
      }

      await client.query(`DELETE FROM game_rooms WHERE id = $1`, [room.id]);
      this.clearRematchTimer(room.room_code);
      this.rematchRequests?.delete(room.room_code);

      return {
        id: String(room.id),
        room_code: room.room_code,
        is_player: true,
        deleted: true,
        actor
      };
    });
  },

  async requestRematch(roomRef, mssv) {
    assertDatabase();
    const actor = cleanMssv(mssv);
    if (!actor) throw error('MSSV người chơi là bắt buộc.', 401, 'AUTH_REQUIRED');

    const found = await roomAndPlayers(roomRef);
    const room = found.room;
    const players = found.players;
    const player = players.find((item) => item.mssv === actor);
    if (!player) throw error('Bạn không phải người chơi trong phòng này.', 403, 'PLAYER_FORBIDDEN');
    if (room.status !== 'finished') throw error('Chỉ có thể yêu cầu đánh lại khi ván đấu đã kết thúc.', 400, 'REMATCH_NOT_ALLOWED');

    const code = room.room_code;
    if (!this.rematchRequests) this.rematchRequests = new Map();
    let votes = this.rematchRequests.get(code);
    if (!votes) {
      votes = new Set();
      this.rematchRequests.set(code, votes);
    }
    votes.add(actor);

    if (votes.size >= 2) {
      this.clearRematchTimer(code);
      this.rematchRequests.delete(code);

      return transaction(async (client) => {
        const nextState = initialState(room.game_type);
        const nextVersion = Number(room.state_version) + 1;
        const updated = await client.query(
          `UPDATE game_rooms SET state = $2::jsonb, state_version = $3, status = 'active', winner_seat = NULL, result = NULL, finished_at = NULL, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
          [room.id, JSON.stringify(nextState), nextVersion]
        );
        await client.query(`DELETE FROM game_room_moves WHERE room_id = $1`, [room.id]);
        return {
          room_code: code,
          ready: true,
          room: mapRoom(updated.rows[0], players.map(mapPlayer), 0, true)
        };
      });
    }

    return {
      room_code: code,
      ready: false,
      votes: [...votes],
      actor
    };
  },

  async createChallenge(roomRef, mssv, { challengedMssv = null, expiresInSeconds = null, postToConfession = false, confessionAnonymous = true } = {}) {
    assertDatabase(); const creator = cleanMssv(mssv); const target = challengedMssv ? cleanMssv(challengedMssv) : null; const ttl = challengeTtlSeconds(expiresInSeconds);
    const inviteCode = randomInviteCode(); const challengeId = crypto.randomUUID();
    const result = await transaction(async (client) => {
      const { room, players } = await roomAndPlayers(roomRef, client, true); if (!players.some((item) => item.mssv === creator)) throw error('Chỉ người chơi trong phòng mới được tạo challenge.', 403, 'PLAYER_FORBIDDEN');
      if (room.status !== 'waiting') throw error('Chỉ có thể tạo challenge khi phòng đang chờ đối thủ.', 409, 'ROOM_NOT_JOINABLE');
      if (target === creator) throw error('Không thể tự thách đấu chính mình.');
      if (target) await ensureStudent(client, target);
      await client.query(`INSERT INTO game_challenges (id, room_id, created_by_mssv, challenged_mssv, invite_code_hash, expires_at) VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 second'))`, [challengeId, room.id, creator, target, sha256(inviteCode), ttl]);
      return { id: challengeId, room, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    });
    let confessionPost = null;
    if (postToConfession) {
      const publicBase = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
      const inviteUrl = `${publicBase || ''}/games/challenges/${result.id}?code=${encodeURIComponent(inviteCode)}`;
      confessionPost = await CommunityService.createPost({ authorMssv: creator, title: `Thách đấu ${result.room.game_type}`, content: `Mời tham gia phòng ${result.room.room_code}. Link mời có hạn đến ${result.expiresAt}: ${inviteUrl}`, scope: 'school', isAnonymous: Boolean(confessionAnonymous), category: 'confession' });
      await query('UPDATE game_challenges SET confession_post_id = $2, updated_at = NOW() WHERE id = $1', [result.id, confessionPost.id]);
    }
    return { id: result.id, room_code: result.room.room_code, game_type: result.room.game_type, invite_code: inviteCode, expires_at: result.expiresAt, confession_post_id: confessionPost?.id || null };
  },

  async getChallenge(challengeId) {
    assertDatabase(); await this.expireStale();
    const result = await query(`
      SELECT c.id, c.status, c.expires_at, c.created_at, c.confession_post_id,
        r.room_code, r.game_type, r.status AS room_status
      FROM game_challenges c
      JOIN game_rooms r ON r.id = c.room_id
      WHERE c.id = $1
      LIMIT 1
    `, [String(challengeId)]);
    if (!result.rowCount) throw error('Không tìm thấy challenge.', 404, 'CHALLENGE_NOT_FOUND');
    const row = result.rows[0];
    return {
      id: String(row.id), status: row.status, expires_at: row.expires_at, created_at: row.created_at,
      room_code: row.room_code, game_type: row.game_type, room_status: row.room_status,
      confession_post_id: row.confession_post_id ? String(row.confession_post_id) : null
    };
  },

  async acceptChallenge(challengeId, mssv, inviteCode = null) {
    assertDatabase(); const player = cleanMssv(mssv);
    return transaction(async (client) => {
      const challenge = await client.query(`SELECT c.*, r.room_code, r.status AS room_status FROM game_challenges c JOIN game_rooms r ON r.id = c.room_id WHERE c.id = $1 FOR UPDATE`, [String(challengeId)]);
      if (!challenge.rowCount) throw error('Không tìm thấy challenge.', 404, 'CHALLENGE_NOT_FOUND'); const row = challenge.rows[0];
      if (row.status !== 'pending' || new Date(row.expires_at).getTime() <= Date.now()) throw error('Challenge đã hết hạn hoặc không còn hiệu lực.', 410, 'CHALLENGE_EXPIRED');
      if (row.challenged_mssv && row.challenged_mssv !== player) throw error('Challenge này dành cho sinh viên khác.', 403, 'CHALLENGE_FORBIDDEN');
      if (!inviteCode || row.invite_code_hash !== sha256(inviteCode)) throw error('Mã mời không hợp lệ.', 403, 'CHALLENGE_FORBIDDEN');
      await client.query(`UPDATE game_challenges SET status = 'accepted', accepted_by_mssv = $2, accepted_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id, player]);
      const room = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [row.room_id]);
      if (!room.rowCount || room.rows[0].status !== 'waiting') throw error('Phòng không còn ở trạng thái chờ người chơi.', 409, 'ROOM_NOT_JOINABLE');
      const players = await client.query(`
        SELECT p.mssv, p.seat, p.joined_at, COALESCE(NULLIF(s.full_name, ''), p.mssv) AS full_name
        FROM game_room_players p
        LEFT JOIN students s ON s.mssv = p.mssv
        WHERE p.room_id = $1 AND p.left_at IS NULL
        ORDER BY p.seat FOR UPDATE
      `, [row.room_id]);
      if (players.rows.some((item) => item.mssv === player)) return mapRoom(room.rows[0], players.rows.map(mapPlayer));
      if (players.rows.length >= 2) throw error('Phòng đã đủ người chơi.', 409, 'ROOM_FULL');
      await ensureStudent(client, player); const seat = players.rows.some((item) => Number(item.seat) === 1) ? 2 : 1;
      await client.query('INSERT INTO game_room_players (room_id, mssv, seat) VALUES ($1, $2, $3)', [row.room_id, player, seat]);
      const studentNameRes = await client.query('SELECT full_name FROM students WHERE mssv = $1', [player]);
      const fullName = studentNameRes.rows[0]?.full_name || player;
      const updated = await client.query(`UPDATE game_rooms SET status = 'active', updated_at = NOW(), last_activity_at = NOW() WHERE id = $1 RETURNING *`, [row.room_id]);
      return mapRoom(updated.rows[0], [...players.rows, { mssv: player, full_name: fullName, seat, joined_at: new Date().toISOString() }].map(mapPlayer));
    });
  },

  async expireStale() {
    if (!isDatabaseConfigured()) return { challenges: [], rooms: [] };
    const expiredChallenges = await query(`UPDATE game_challenges SET status = 'expired', updated_at = NOW() WHERE status = 'pending' AND expires_at <= NOW() RETURNING id, room_id, confession_post_id`);
    const expiredRooms = await query(`UPDATE game_rooms SET status = 'expired', result = 'expired', updated_at = NOW(), finished_at = COALESCE(finished_at, NOW()) WHERE status IN ('waiting', 'active') AND expires_at <= NOW() RETURNING id, room_code`);
    for (const row of expiredChallenges.rows) if (row.confession_post_id) await query(`UPDATE community_posts SET deleted_at = COALESCE(deleted_at, NOW()), deleted_by_mssv = NULL, delete_reason = 'challenge_expired', updated_at = NOW() WHERE id = $1`, [row.confession_post_id]);
    const challengeEvents = [];
    for (const row of expiredChallenges.rows) {
      const room = await query('SELECT room_code FROM game_rooms WHERE id = $1', [row.room_id]);
      challengeEvents.push({ id: String(row.id), room_id: String(row.room_id), room_code: room.rows[0]?.room_code || null });
    }
    return { challenges: challengeEvents, rooms: expiredRooms.rows.map((row) => ({ id: String(row.id), room_code: row.room_code })) };
  },

  async listMoves(roomRef, { after = 0, limit = 100 } = {}) {
    assertDatabase(); const { room } = await roomAndPlayers(roomRef); const safeAfter = Math.max(0, Number.parseInt(after, 10) || 0); const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(limit, 10) || 100));
    const result = await query(`SELECT move_number, actor_mssv, move, resulting_state, created_at FROM game_room_moves WHERE room_id = $1 AND move_number > $2 ORDER BY move_number ASC LIMIT $3`, [room.id, safeAfter, safeLimit]);
    return { room_code: room.room_code, moves: result.rows.map((row) => ({ move_number: Number(row.move_number), actor_mssv: row.actor_mssv, move: row.move, state: row.resulting_state, created_at: row.created_at })) };
  },

  start({ onEvent } = {}) {
    this.stop(); this.expiryTimer = setInterval(async () => { try { const expired = await this.expireStale(); if (onEvent) { expired.challenges.forEach((item) => onEvent({ type: 'challenge.expired', data: item })); expired.rooms.forEach((item) => onEvent({ type: 'room.expired', data: item })); } } catch (err) { console.error('[entertainment] expiry sweep failed:', err.message); } }, 15_000); this.expiryTimer.unref?.(); return this;
  },

  stop() { if (this.expiryTimer) clearInterval(this.expiryTimer); this.expiryTimer = null; }
};

EntertainmentGameService.expiryTimer = null;
export const EntertainmentGameInternals = { GAME_TYPES, ROOM_STATUSES, initialState, applyMove, normalizedGameType, normalizeRoomRef, challengeTtlSeconds, ttlSeconds };
