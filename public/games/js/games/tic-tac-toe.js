// Game mẫu cho hợp đồng module: bàn 3×3, tái sử dụng DOM node, highlight nước
// đi hợp lệ / nước vừa đánh / hàng thắng. Các game khác copy cấu trúc này.

const meta = {
  id: 'tic_tac_toe',
  label: 'Tic Tac Toe',
  tagline: 'Ba ô liên tiếp là thắng'
};

const MARK_BY_SEAT = { 1: '✕', 2: '○' };

function preview() {
  const marks = ['✕', '', '○', '', '✕', '', '○', '', '✕'];
  return `
    <div class="ttt-preview" aria-hidden="true">
      ${marks.map((mark, index) => `<span class="${mark === '✕' ? 'is-x' : mark === '○' ? 'is-o' : ''}" style="animation-delay:${index * 60}ms">${mark}</span>`).join('')}
    </div>`;
}

// winning_cells chuẩn là [[row, column], ...]; chấp nhận thêm index trần để
// tương thích với state cũ. Trả về Set index 0..8 để tô sáng.
function winningIndexes(cells) {
  const indexes = (cells || []).map((cell) => {
    if (Array.isArray(cell)) return Number(cell[0]) * 3 + Number(cell[1]);
    return Number(cell);
  });
  return new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < 9));
}

function mount(root, api) {
  root.innerHTML = `
    <div class="ttt-board" role="grid" aria-label="Bàn Tic Tac Toe">
      ${Array.from({ length: 9 }, (_, index) => `<button type="button" class="ttt-cell is-empty" role="gridcell" data-index="${index}" aria-label="Ô ${index + 1}, còn trống"></button>`).join('')}
    </div>`;
  const board = root.querySelector('.ttt-board');
  const cells = [...root.querySelectorAll('.ttt-cell')];
  let view = {};

  cells.forEach((cell, index) => {
    cell.addEventListener('click', () => {
      if (!view.interactive) return;
      const allowed = !Array.isArray(view.legalMoves) || view.legalMoves.some((move) => Number(move?.index) === index);
      if (!allowed) {
        api.showToast?.('Ô này không hợp lệ.', 'warning');
        return;
      }
      api.onMove?.({ index });
    });
  });

  function update(nextView) {
    view = nextView || {};
    const state = view.state || {};
    const boardValues = Array.isArray(state.board) ? state.board : [];
    const winning = winningIndexes(state.winning_cells);
    const lastIndex = Number.isInteger(Number(view.lastMove?.index)) ? Number(view.lastMove.index) : -1;
    const finished = view.status === 'finished' || Boolean(state.result) || Boolean(view.winnerSeat);
    const myTurn = Boolean(view.interactive);

    // Khóa bàn rõ ràng khi là khán giả / chưa tới lượt; giữ hàng thắng nổi bật.
    board.classList.toggle('is-locked', !myTurn);
    board.classList.toggle('is-finished', finished);

    cells.forEach((cell, index) => {
      const value = boardValues[index] ?? null;
      const isLast = lastIndex === index && value !== null;
      const playable = myTurn && value === null;
      cell.textContent = MARK_BY_SEAT[value] || '';
      cell.className = [
        'ttt-cell',
        value === 1 ? 'is-p1' : value === 2 ? 'is-p2' : 'is-empty',
        winning.has(index) ? 'is-winning' : '',
        isLast ? 'is-last' : '',
        playable ? 'is-playable' : ''
      ].filter(Boolean).join(' ');
      cell.disabled = !playable;
      const suffix = value === null ? 'còn trống' : value === 1 ? 'đã đánh X' : 'đã đánh O';
      cell.setAttribute('aria-label', `Ô ${index + 1}, ${suffix}${winning.has(index) ? ', nằm trong hàng thắng' : ''}`);
    });
  }

  return {
    update,
    destroy() { root.innerHTML = ''; }
  };
}

export default { meta, preview, mount };
