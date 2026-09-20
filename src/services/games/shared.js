// Tiện ích dùng chung cho các module engine trong src/services/games/.
// Mọi engine đều chạy phía server; client chỉ gửi "ý định", server kiểm tra lại.

export function error(message, status = 400, code = 'GAME_INVALID') {
  const result = new Error(message);
  result.status = status;
  result.code = code;
  return result;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function assertSeat(state, move, seat) {
  if (state.result || state.winner_seat) throw error('Ván đấu đã kết thúc.', 409, 'GAME_FINISHED');
  if (Number(state.current_seat) !== Number(seat)) throw error('Chưa đến lượt của bạn.', 409, 'NOT_YOUR_TURN');
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw error('Nước đi không hợp lệ.');
}

export function inBounds(board, row, col) {
  return row >= 0 && row < board.length && col >= 0 && col < board[0].length;
}
