import { Chess } from 'chess.js';
import { clone, assertSeat, error } from './shared.js';

export const meta = {
  id: 'chess',
  label: 'Cờ vua',
  tagline: 'Luật cờ vua quốc tế, có phong cấp và chiếu hết',
  players: 2,
  clock: true,
  hidden: false,
  order: 50
};

const FILES = 'abcdefgh';
// Giới hạn lịch sử thế cờ để payload phòng/broadcast không phình theo ván dài.
const HISTORY_LIMIT = 300;
const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

function chessBoard() {
  return [
    ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
    Array(8).fill('bp'), Array(8).fill(null), Array(8).fill(null),
    Array(8).fill(null), Array(8).fill(null), Array(8).fill('wp'),
    ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
  ];
}

// Khoá lặp thế = 4 trường đầu của FEN (bỏ halfmove/fullmove). Engine dựng lại
// ván cờ từ FEN sau mỗi nước nên phải tự đếm lịch sử mới nhận diện được lặp thế.
function repetitionKey(fen) {
  return String(fen || '').split(' ').slice(0, 4).join(' ');
}

export function initialState() {
  const chess = new Chess();
  const fen = chess.fen();
  return {
    board: chessBoard(),
    fen,
    position_history: [repetitionKey(fen)],
    current_seat: 1,
    winner_seat: null,
    result: null,
    move_number: 0
  };
}

function boardToFen(board, currentSeat) {
  const ranks = board.map((rank) => {
    let empty = 0;
    let text = '';
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

// Chỉ nhận toạ độ đúng kiểu số nguyên; null/''/true/'3' đều bị từ chối thay vì
// bị ép về 0 như trước.
function square(point) {
  if (!Number.isInteger(point?.row) || !Number.isInteger(point?.column)) return null;
  return `${FILES[point.column] || ''}${8 - point.row}`;
}

function chessFromState(state) {
  try {
    return new Chess(state.fen || boardToFen(state.board, state.current_seat));
  } catch {
    throw error('Trạng thái cờ vua trên máy chủ không hợp lệ.', 500, 'CHESS_STATE_INVALID');
  }
}

export function applyMove(state, move, seat) {
  assertSeat(state, move, seat);
  const from = square(move.from);
  const to = square(move.to);
  if (!from || !to || !/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) throw error('Nước đi cờ vua không hợp lệ.');
  const chess = chessFromState(state);
  const pieceFrom = chess.get(from);
  const isPawnPromotion = pieceFrom?.type === 'p' && ((chess.turn() === 'w' && to[1] === '8') || (chess.turn() === 'b' && to[1] === '1'));
  // Gửi promotion cho nước không phải tốt tới hàng cuối là payload sai, không bỏ qua im lặng.
  if (move.promotion && !isPawnPromotion) throw error('Quân phong cấp không hợp lệ.');
  const promotion = isPawnPromotion
    ? (move.promotion ? String(move.promotion).toLowerCase() : 'q')
    : undefined;
  if (promotion && !PROMOTION_PIECES.includes(promotion)) throw error('Quân phong cấp không hợp lệ.');
  let played;
  try {
    played = chess.move({ from, to, ...(promotion ? { promotion } : {}) });
  } catch {
    throw error('Nước đi cờ vua không hợp lệ.');
  }
  const next = clone(state);
  next.board = chess.board().map((rank) => rank.map((item) => (item ? `${item.color}${item.type}` : null)));
  next.fen = chess.fen();
  // Lịch sử thế cờ: state cũ thiếu field thì coi như bắt đầu từ thế hiện tại.
  const key = repetitionKey(next.fen);
  if (!Array.isArray(next.position_history)) next.position_history = [];
  if (!next.position_history.length) next.position_history.push(repetitionKey(state.fen || boardToFen(state.board, state.current_seat)));
  next.position_history.push(key);
  if (next.position_history.length > HISTORY_LIMIT) next.position_history = next.position_history.slice(-HISTORY_LIMIT);
  next.move_number += 1;
  next.last_notation = played.san;
  const repetitions = next.position_history.filter((item) => item === key).length;
  if (chess.isCheckmate()) {
    next.winner_seat = Number(seat);
    next.result = 'win';
  } else if (chess.isDraw() || repetitions >= 3) {
    next.result = 'draw';
  } else {
    next.current_seat = Number(seat) === 1 ? 2 : 1;
  }
  return next;
}

export function legalMoves(state, seat) {
  if (state.result || state.winner_seat || Number(state.current_seat) !== Number(seat)) return [];
  const chess = chessFromState(state);
  const moves = [];
  for (const item of chess.moves({ verbose: true })) {
    moves.push({
      from: { row: 8 - Number(item.from[1]), column: FILES.indexOf(item.from[0]) },
      to: { row: 8 - Number(item.to[1]), column: FILES.indexOf(item.to[0]) },
      ...(item.promotion ? { promotion: item.promotion } : {})
    });
  }
  return moves;
}

export function stateForViewer(state) {
  // Cờ vua công khai toàn bộ thế cờ, chỉ bỏ lịch sử thế cờ nội bộ khỏi payload.
  const view = clone(state);
  delete view.position_history;
  return view;
}
