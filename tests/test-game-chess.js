// Test engine Cờ vua: chạy thuần node, không DB, không mạng.
// Bao phủ: nước hợp lệ, nước sai luật, sai lượt, chiếu hết (fool's mate),
// hòa (stalemate, thiếu quân, lặp thế 3 lần, luật 50 nước), phong cấp,
// nhập thành, bắt tốt qua đường và legalMoves khai cuộc.
import assert from 'node:assert/strict';
import { initialState, applyMove, legalMoves, stateForViewer, meta } from '../src/services/games/chess.js';

// Toạ độ theo hàng/cột: hàng 0 = hạng 8 (phía đen), cột 0 = cột a.
const E2 = { row: 6, column: 4 };
const E4 = { row: 4, column: 4 };
const E7 = { row: 1, column: 4 };
const E5 = { row: 3, column: 4 };

// --- meta ---
assert.equal(meta.id, 'chess');
assert.equal(meta.order, 50);
assert.equal(meta.clock, true);
assert.equal(meta.hidden, false);
assert.equal(meta.players, 2);

// --- nước hợp lệ e2-e4 cập nhật board + fen + last_notation ---
const fresh = initialState();
const snapshot = JSON.stringify(fresh);
assert.deepEqual(fresh.board[6][4], 'wp');
assert.equal(fresh.current_seat, 1);

let state = applyMove(fresh, { from: E2, to: E4 }, 1);
assert.equal(state.board[4][4], 'wp', 'tốt trắng phải nằm ở e4');
assert.equal(state.board[6][4], null, 'ô e2 phải trống sau khi đi');
assert.equal(state.last_notation, 'e4');
assert.equal(state.move_number, 1);
assert.equal(state.current_seat, 2);
assert.equal(state.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
assert.notEqual(state.fen, fresh.fen, 'fen phải đổi sau nước đi');
assert.equal(JSON.stringify(fresh), snapshot, 'applyMove không được mutate state gốc');
assert.equal(stateForViewer(state, 1).position_history, undefined, 'cờ vua công khai state nhưng bỏ lịch sử thế cờ nội bộ');

// --- nước sai luật bị chặn ---
assert.throws(() => applyMove(fresh, { from: E2, to: { row: 3, column: 4 } }, 1), /không hợp lệ/i, 'tốt không thể đi 3 ô');
assert.throws(() => applyMove(fresh, { from: E7, to: E5 }, 1), /không hợp lệ/i, 'không được đi quân đối phương');
assert.throws(() => applyMove(fresh, { from: { row: 8, column: 0 }, to: E4 }, 1), /không hợp lệ/i, 'toạ độ ngoài bàn bị chặn');
// square() không được ép kiểu: null/''/true/'3' phải bị từ chối, không thành a8/b7...
assert.throws(() => applyMove(fresh, { from: null, to: E4 }, 1), /không hợp lệ/i, 'from null không được ép thành a8');
assert.throws(() => applyMove(fresh, { from: { row: '', column: 4 }, to: E4 }, 1), /không hợp lệ/i, 'chuỗi rỗng không được ép thành 0');
assert.throws(() => applyMove(fresh, { from: { row: true, column: 4 }, to: E4 }, 1), /không hợp lệ/i, 'boolean không được ép thành số');
assert.throws(() => applyMove(fresh, { from: { row: '3', column: 4 }, to: E4 }, 1), /không hợp lệ/i, 'chuỗi số không được chấp nhận');
assert.throws(() => applyMove(fresh, { from: 'e2', to: E4 }, 1), /không hợp lệ/i, 'payload sai kiểu bị chặn');
assert.throws(() => applyMove(fresh, { from: E2, to: E4, promotion: 'k' }, 1), /phong cấp/i, 'phong cấp sai quân bị chặn');
assert.throws(() => applyMove(fresh, { from: E2, to: E4, promotion: 'q' }, 1), /phong cấp/i, 'promotion cho nước không phong cấp bị chặn');
// Sau khi trắng đi e4 (lượt đen), đen không thể đi tốt trắng ở e4.
assert.throws(() => applyMove(state, { from: E4, to: { row: 3, column: 4 } }, 2), /không hợp lệ/i, 'ô đích không đúng luật');
// Ô trống: trắng quay lại e2-e4 khi đang là lượt đen (sai lượt).
assert.throws(() => applyMove(state, { from: E2, to: E4 }, 1), (err) => err.code === 'NOT_YOUR_TURN');

// --- sai lượt bị chặn (đen đi trước) ---
assert.throws(() => applyMove(fresh, { from: E7, to: E5 }, 2), (err) => {
  assert.equal(err.code, 'NOT_YOUR_TURN');
  assert.equal(err.status, 409);
  return true;
}, 'ghế 2 không được đi khi chưa đến lượt');

// --- legalMoves: 20 nước khai cuộc, rỗng khi không phải lượt ---
const opening = legalMoves(fresh, 1);
assert.equal(opening.length, 20, 'thế khai cuộc đúng 20 nước hợp lệ');
assert.ok(
  opening.some((move) => move.from.row === 6 && move.from.column === 4 && move.to.row === 4 && move.to.column === 4),
  'legalMoves phải có e2-e4'
);
assert.deepEqual(legalMoves(fresh, 2), [], 'không phải lượt thì không gợi ý nước đi');
assert.deepEqual(legalMoves(state, 1), [], 'ghế vừa đi xong không còn nước đi');
assert.equal(legalMoves(state, 2).length, 20, 'lượt đen cũng có đủ 20 nước');

// --- chiếu hết: fool's mate (f2-f3, e7-e5, g2-g4, Qd8-h4#) ---
let mate = initialState();
mate = applyMove(mate, { from: { row: 6, column: 5 }, to: { row: 5, column: 5 } }, 1); // f2-f3
mate = applyMove(mate, { from: E7, to: E5 }, 2); // e7-e5
mate = applyMove(mate, { from: { row: 6, column: 6 }, to: { row: 4, column: 6 } }, 1); // g2-g4
mate = applyMove(mate, { from: { row: 0, column: 3 }, to: { row: 4, column: 7 } }, 2); // Qd8-h4#
assert.equal(mate.last_notation, 'Qh4#');
assert.equal(mate.result, 'win');
assert.equal(mate.winner_seat, 2, 'fool\'s mate: đen thắng');
assert.deepEqual(legalMoves(mate, 1), [], 'hết ván thì không còn nước đi');
assert.throws(() => applyMove(mate, { from: { row: 0, column: 4 }, to: { row: 1, column: 4 } }, 1), /đã kết thúc/i, 'ván đã kết thúc không nhận nước đi');

// --- hòa do stalemate: trắng Qg5-g6, đen hết nước nhưng không bị chiếu ---
let stalemate = initialState();
stalemate.fen = '7k/8/5K2/6Q1/8/8/8/8 w - - 0 1';
stalemate.current_seat = 1;
stalemate = applyMove(stalemate, { from: { row: 3, column: 6 }, to: { row: 2, column: 6 } }, 1);
assert.equal(stalemate.last_notation, 'Qg6');
assert.equal(stalemate.result, 'draw');
assert.equal(stalemate.winner_seat, null);

// --- hòa do không đủ quân: vua trắng đi nước duy nhất, còn K vs K ---
let bare = initialState();
bare.fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
bare.current_seat = 1;
bare = applyMove(bare, { from: { row: 7, column: 0 }, to: { row: 7, column: 1 } }, 1);
assert.equal(bare.result, 'draw', 'K vs K là hòa do không đủ quân để chiếu hết');
assert.equal(bare.winner_seat, null);

// --- phong cấp: đủ 4 lựa chọn, chọn Xe thì board thành wr ---
let promote = initialState();
promote.fen = '8/P7/8/8/8/8/8/K6k w - - 0 1';
promote.current_seat = 1;
const promoMoves = legalMoves(promote, 1).filter(
  (move) => move.from.row === 1 && move.from.column === 0 && move.to.row === 0 && move.to.column === 0
);
assert.deepEqual(promoMoves.map((move) => move.promotion).sort(), ['b', 'n', 'q', 'r'], 'tốt tới hàng cuối có đủ 4 lựa chọn phong cấp');
assert.throws(
  () => applyMove(promote, { from: { row: 1, column: 0 }, to: { row: 0, column: 0 }, promotion: 'k' }, 1),
  /phong cấp/i
);
const promoted = applyMove(promote, { from: { row: 1, column: 0 }, to: { row: 0, column: 0 }, promotion: 'r' }, 1);
assert.equal(promoted.board[0][0], 'wr');
assert.equal(promoted.result, null, 'phong cấp xong ván vẫn tiếp tục');
assert.equal(promoted.current_seat, 2);
// Client bỏ trống promotion ở nước phong cấp thật thì mặc định thành Hậu.
const autoQueen = applyMove(promote, { from: { row: 1, column: 0 }, to: { row: 0, column: 0 } }, 1);
assert.equal(autoQueen.board[0][0], 'wq', 'bỏ trống promotion mặc định là Hậu');
assert.match(autoQueen.last_notation, /^a8=Q\+?$/, 'SAN mặc định a8=Q (có thể kèm +)');

// --- hòa do lặp thế 3 lần: Nf3 Nf6 Ng1 Ng8 lặp 2 vòng (8 ply) ---
const knightDance = [
  [{ row: 7, column: 6 }, { row: 5, column: 5 }], // Ng1-f3
  [{ row: 0, column: 6 }, { row: 2, column: 5 }], // Ng8-f6
  [{ row: 5, column: 5 }, { row: 7, column: 6 }], // Nf3-g1
  [{ row: 2, column: 5 }, { row: 0, column: 6 }]  // Nf6-g8
];
let repetition = initialState();
assert.equal(repetition.position_history.length, 1, 'initialState khởi tạo lịch sử 1 thế');
const startKey = repetition.position_history[0];
let ply = 0;
for (let cycle = 0; cycle < 2; cycle += 1) {
  for (const [from, to] of knightDance) {
    repetition = applyMove(repetition, { from, to }, ply % 2 === 0 ? 1 : 2);
    ply += 1;
    if (ply === 4) {
      assert.equal(repetition.result, null, 'thế đầu mới lặp 2 lần thì chưa hòa');
      assert.equal(repetition.position_history.filter((key) => key === startKey).length, 2);
    }
  }
}
assert.equal(repetition.position_history.length, 9, 'mỗi nước đi push thêm 1 thế');
assert.equal(repetition.position_history.filter((key) => key === startKey).length, 3);
assert.equal(repetition.result, 'draw', 'lặp thế 3 lần phải hòa');
assert.equal(repetition.winner_seat, null);
assert.deepEqual(legalMoves(repetition, 2), [], 'ván hòa không còn nước đi');

// State cũ thiếu position_history vẫn phải chạy được, tự seed từ thế hiện tại.
const legacy = initialState();
delete legacy.position_history;
const legacyNext = applyMove(legacy, { from: E2, to: E4 }, 1);
assert.equal(legacyNext.position_history.length, 2, 'state cũ thiếu lịch sử được seed an toàn');
assert.equal(legacyNext.result, null);

// --- nhập thành: trắng cờ ngắn sau khi đã giải phóng f1/g1 ---
let castle = initialState();
castle = applyMove(castle, { from: E2, to: E4 }, 1); // e4
castle = applyMove(castle, { from: { row: 1, column: 0 }, to: { row: 2, column: 0 } }, 2); // a6
castle = applyMove(castle, { from: { row: 7, column: 6 }, to: { row: 5, column: 5 } }, 1); // Nf3
castle = applyMove(castle, { from: { row: 2, column: 0 }, to: { row: 3, column: 0 } }, 2); // a5
castle = applyMove(castle, { from: { row: 7, column: 5 }, to: { row: 4, column: 2 } }, 1); // Bc4
castle = applyMove(castle, { from: { row: 3, column: 0 }, to: { row: 4, column: 0 } }, 2); // a4
castle = applyMove(castle, { from: { row: 7, column: 4 }, to: { row: 7, column: 6 } }, 1); // O-O
assert.equal(castle.last_notation, 'O-O');
assert.equal(castle.board[7][6], 'wk', 'vua trắng sang g1');
assert.equal(castle.board[7][5], 'wr', 'xe trắng sang f1');
assert.equal(castle.board[7][4], null);
assert.equal(castle.board[7][7], null);

// --- bắt tốt qua đường: trắng e5xd6 sau khi đen d7-d5 ---
let enPassant = initialState();
enPassant = applyMove(enPassant, { from: E2, to: E4 }, 1); // e4
enPassant = applyMove(enPassant, { from: { row: 1, column: 0 }, to: { row: 2, column: 0 } }, 2); // a6
enPassant = applyMove(enPassant, { from: E4, to: { row: 3, column: 4 } }, 1); // e5
enPassant = applyMove(enPassant, { from: { row: 1, column: 3 }, to: { row: 3, column: 3 } }, 2); // d5
assert.equal(enPassant.fen.split(' ')[3], 'd6', 'fen phải ghi ô bắt tốt qua đường d6');
enPassant = applyMove(enPassant, { from: { row: 3, column: 4 }, to: { row: 2, column: 3 } }, 1); // exd6
assert.equal(enPassant.last_notation, 'exd6');
assert.equal(enPassant.board[2][3], 'wp', 'tốt trắng đứng ở d6');
assert.equal(enPassant.board[3][3], null, 'tốt đen bị bắt qua đường biến mất');

// --- luật 50 nước: FEN có halfmove 99, đi xe (không ăn quân/đi tốt) -> hòa ---
let fifty = initialState();
fifty.fen = '7k/8/8/8/8/8/8/KR6 w - - 99 1';
fifty.current_seat = 1;
fifty.position_history = ['7k/8/8/8/8/8/8/KR6 w - -'];
fifty = applyMove(fifty, { from: { row: 7, column: 1 }, to: { row: 6, column: 1 } }, 1); // Rb2
assert.equal(fifty.fen.split(' ')[4], '100');
assert.equal(fifty.result, 'draw', 'đủ 50 nước không ăn quân/đi tốt là hòa');
assert.equal(fifty.winner_seat, null);

console.log('OK chess engine: nước hợp lệ/sai luật/sai lượt, payload toạ độ chặt, fool\'s mate, hòa stalemate + thiếu quân + lặp thế 3 lần + 50 nước, phong cấp, nhập thành, bắt tốt qua đường, 20 nước khai cuộc.');
