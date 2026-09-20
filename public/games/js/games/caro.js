// UI bàn Cờ caro 15×15 kiểu gomoku: quân tròn đặt tại GIAO ĐIỂM lưới (không
// dùng chữ X/O), phân biệt bằng hai màu phẳng, có điểm sao và đoạn line nối
// đường thắng. Dựng DOM một lần rồi tái sử dụng node;
// luật do server giữ.

const SIZE = 15;
const PREVIEW_SIZE = 7;
const STAR_POINTS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
const PREVIEW_STARS = [[1, 1], [1, 5], [3, 3], [5, 1], [5, 5]];
const PREVIEW_STONES = new Map([
  ['2,2', 'p1'], ['3,3', 'p1'], ['4,4', 'p1'], ['5,5', 'p1'], ['6,6', 'p1'],
  ['1,3', 'p2'], ['2,4', 'p2'], ['3,1', 'p2'], ['4,6', 'p2'], ['5,2', 'p2']
]);

const meta = {
  id: 'caro',
  label: 'Cờ caro',
  tagline: 'Nối 5 quân liên tiếp là thắng'
};

// Toạ độ tâm của giao điểm thứ `index` trên lưới `count` đường (đơn vị %).
function center(index, count) {
  return `${(((index + 0.5) / count) * 100).toFixed(4)}%`;
}

// Art tĩnh cho card trang chủ: bàn 7×7 giao điểm, quân ghế 1 thắng chéo.
function preview() {
  const lines = [];
  for (let i = 0; i < PREVIEW_SIZE; i += 1) {
    lines.push(`<span class="caro-preview-v" style="left:${center(i, PREVIEW_SIZE)}"></span>`);
    lines.push(`<span class="caro-preview-h" style="top:${center(i, PREVIEW_SIZE)}"></span>`);
  }
  const stars = PREVIEW_STARS
    .map(([row, column]) => `<span class="caro-preview-star" style="left:${center(column, PREVIEW_SIZE)};top:${center(row, PREVIEW_SIZE)}"></span>`)
    .join('');
  let cells = '';
  for (let row = 0; row < PREVIEW_SIZE; row += 1) {
    for (let column = 0; column < PREVIEW_SIZE; column += 1) {
      const tone = PREVIEW_STONES.get(`${row},${column}`);
      cells += `<span class="caro-preview-cell">${tone ? `<i class="caro-preview-stone is-${tone}"></i>` : ''}</span>`;
    }
  }
  return `<div class="caro-preview" aria-hidden="true">
    <div class="caro-preview-lines">${lines.join('')}</div>
    <div class="caro-preview-stars">${stars}</div>
    <div class="caro-preview-grid">${cells}</div>
  </div>`;
}

function mount(root, api = {}) {
  const stars = STAR_POINTS
    .map(([row, column]) => `<span class="caro-star" style="left:${center(column, SIZE)};top:${center(row, SIZE)}"></span>`)
    .join('');
  const buttons = [];
  for (let index = 0; index < SIZE * SIZE; index += 1) {
    const row = Math.floor(index / SIZE);
    const column = index % SIZE;
    buttons.push(`<button type="button" class="caro-cell" role="gridcell" data-row="${row}" data-column="${column}" aria-label="Giao điểm hàng ${row + 1}, cột ${column + 1}"><span class="caro-stone"></span></button>`);
  }
  root.innerHTML = `
    <div class="caro-wrap">
      <div class="caro-board" role="grid" aria-label="Bàn Cờ caro 15×15">
        <div class="caro-lines" aria-hidden="true"></div>
        <div class="caro-stars" aria-hidden="true">${stars}</div>
        <div class="caro-winline" aria-hidden="true" hidden></div>
        <div class="caro-grid">${buttons.join('')}</div>
      </div>
    </div>`;

  const boardEl = root.querySelector('.caro-board');
  const winLine = root.querySelector('.caro-winline');
  const cells = [...root.querySelectorAll('.caro-cell')];
  let view = {};

  function allowed(row, column) {
    if (!Array.isArray(view.legalMoves)) return true;
    return view.legalMoves.some((move) => Number(move?.row) === row && Number(move?.column) === column);
  }

  function emit(row, column) {
    if (!view.interactive) return;
    const board = view.state?.board;
    const value = Array.isArray(board) ? (board[row]?.[column] ?? null) : null;
    if (value !== null) return;
    if (!allowed(row, column)) {
      api.showToast?.('Giao điểm này không hợp lệ.', 'warning');
      return;
    }
    api.onMove?.({ row, column });
  }

  cells.forEach((cell) => {
    cell.addEventListener('click', () => emit(Number(cell.dataset.row), Number(cell.dataset.column)));
  });

  function endpoints(winning) {
    const rows = winning.map((cell) => Number(cell[0]));
    const columns = winning.map((cell) => Number(cell[1]));
    const min = rows.every((row) => row === rows[0])
      ? columns.indexOf(Math.min(...columns))
      : rows.indexOf(Math.min(...rows));
    const max = rows.every((row) => row === rows[0])
      ? columns.indexOf(Math.max(...columns))
      : rows.indexOf(Math.max(...rows));
    return [winning[min], winning[max]];
  }

  function drawWinLine(winningCells) {
    const winning = Array.isArray(winningCells)
      ? winningCells.filter((cell) => Array.isArray(cell) && Number.isInteger(Number(cell[0])) && Number.isInteger(Number(cell[1])))
      : [];
    if (winning.length < 2) {
      winLine.hidden = true;
      return;
    }
    const [start, end] = endpoints(winning);
    const row1 = Number(start[0]);
    const column1 = Number(start[1]);
    const row2 = Number(end[0]);
    const column2 = Number(end[1]);
    const dx = column2 - column1;
    const dy = row2 - row1;
    winLine.hidden = false;
    winLine.style.left = center(column1, SIZE);
    winLine.style.top = center(row1, SIZE);
    winLine.style.width = `${(Math.hypot(dx, dy) / SIZE) * 100}%`;
    winLine.style.transform = `translateY(-50%) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
  }

  function update(nextView) {
    view = nextView || {};
    const state = view.state || {};
    const board = Array.isArray(state.board) ? state.board : [];
    const winning = new Set();
    for (const cell of state.winning_cells || []) {
      if (Array.isArray(cell)) winning.add(`${Number(cell[0])},${Number(cell[1])}`);
    }
    const last = view.lastMove || {};
    const lastRow = Number.isInteger(Number(last.row)) ? Number(last.row) : -1;
    const lastColumn = Number.isInteger(Number(last.column)) ? Number(last.column) : -1;
    const tone = Number(view.mySeat) === 2 ? 'p2' : 'p1';
    const isOpponentTurn = view.role === 'player'
      && view.status === 'active'
      && Number(view.mySeat) > 0
      && Number(state.current_seat) > 0
      && Number(state.current_seat) !== Number(view.mySeat);

    cells.forEach((cell) => {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      const value = board[row]?.[column] ?? null;
      const playable = Boolean(view.interactive) && value === null;
      const classes = ['caro-cell'];
      if (value === 1) classes.push('is-p1');
      if (value === 2) classes.push('is-p2');
      if (winning.has(`${row},${column}`)) classes.push('is-winning');
      if (row === lastRow && column === lastColumn) classes.push('is-last');
      if (playable) classes.push('is-playable');
      cell.className = classes.join(' ');
      cell.disabled = !playable;
      if (playable) cell.dataset.tone = tone; else delete cell.dataset.tone;
    });

    boardEl.classList.toggle('is-locked', !view.interactive);
    boardEl.classList.toggle('is-opponent-turn', isOpponentTurn);
    drawWinLine(state.winning_cells);
  }

  return {
    update,
    destroy() {
      root.innerHTML = '';
    }
  };
}

export default { meta, preview, mount };
