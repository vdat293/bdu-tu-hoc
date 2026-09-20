// UI Connect 4: bàn 7 cột × 6 hàng cho module game của site /games.
// Hợp đồng: export default { meta, preview(), mount(root, api) }.
// DOM được dựng một lần trong mount; update() chỉ đổi class/aria nên animation
// quân rơi chỉ chạy khi thực sự có quân mới.

const ROWS = 6;
const COLUMNS = 7;

const meta = {
  id: 'connect4',
  label: 'Connect 4',
  tagline: 'Nối 4 quân cùng màu theo hàng, cột hoặc chéo'
};

// Art 7×6 cho card trang chủ: thế cờ mẫu với hàng chéo thắng của quân 1.
const PREVIEW_ART = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 2, 0],
  [0, 0, 1, 0, 2, 0, 0],
  [0, 0, 0, 1, 2, 2, 0]
];

function preview() {
  const holes = PREVIEW_ART.flat().map((value, index) => {
    const stone = value === 1 ? ' is-p1' : value === 2 ? ' is-p2' : '';
    return `<span class="c4-preview-hole${stone}" style="animation-delay:${index * 10}ms"></span>`;
  }).join('');
  return `<div class="c4-preview" aria-hidden="true">${holes}</div>`;
}

function mount(root, api) {
  root.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'c4-board';
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', 'Bàn Connect 4: 7 cột, 6 hàng');
  const columnNodes = [];
  const cells = [];

  for (let column = 0; column < COLUMNS; column += 1) {
    const columnNode = document.createElement('div');
    columnNode.className = 'c4-col';
    columnNode.dataset.column = String(column);
    for (let row = 0; row < ROWS; row += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'c4-cell';
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute('role', 'gridcell');
      const stone = document.createElement('span');
      stone.className = 'c4-stone';
      stone.setAttribute('aria-hidden', 'true');
      cell.appendChild(stone);
      columnNode.appendChild(cell);
      cells.push(cell);
    }
    columnNodes.push(columnNode);
    board.appendChild(columnNode);
  }
  root.appendChild(board);

  let view = {};
  let hoverColumn = -1;
  let previousBoard = null;

  const rowsOf = () => (Array.isArray(view.state?.board) ? view.state.board : []);
  const interactive = () => Boolean(view.interactive);
  const cellValue = (rows, row, column) => {
    const line = rows[row];
    const value = Array.isArray(line) ? line[column] : null;
    return value === 1 || value === 2 ? value : null;
  };

  // Hàng thấp nhất còn trống của cột (quân rơi tới đây); -1 nếu cột đã đầy.
  function landingRow(column, rows) {
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (cellValue(rows, row, column) === null) return row;
    }
    return -1;
  }

  // Hàng trên cùng đang có quân của cột (để đánh dấu nước vừa đi).
  function topStoneRow(column, rows) {
    for (let row = 0; row < ROWS; row += 1) {
      if (cellValue(rows, row, column) !== null) return row;
    }
    return -1;
  }

  const dropAllowed = (column, rows) => !view.legalMoves
    || view.legalMoves.some((move) => Number(move?.column) === column);

  function render() {
    const rows = rowsOf();
    const winning = new Set();
    for (const cell of Array.isArray(view.state?.winning_cells) ? view.state.winning_cells : []) {
      if (Array.isArray(cell)) winning.add(`${Number(cell[0])},${Number(cell[1])}`);
    }
    const lastColumn = view.lastMove && Number.isInteger(Number(view.lastMove.column))
      ? Number(view.lastMove.column)
      : -1;
    const lastRow = lastColumn >= 0 ? topStoneRow(lastColumn, rows) : -1;
    const seat = Number(view.mySeat) === 2
      || (view.mySeat === null || view.mySeat === undefined) && Number(view.state?.current_seat) === 2
      ? 2
      : 1;
    const locked = !interactive();
    board.classList.toggle('is-locked', locked);
    board.setAttribute('aria-disabled', locked ? 'true' : 'false');

    columnNodes.forEach((node, column) => {
      const landing = landingRow(column, rows);
      node.classList.toggle('is-full', landing < 0);
      node.classList.toggle('is-hover', interactive() && landing >= 0 && hoverColumn === column);
    });

    for (const cell of cells) {
      const column = Number(cell.dataset.column);
      const row = Number(cell.dataset.row);
      const value = cellValue(rows, row, column);
      const landing = landingRow(column, rows);
      const ghost = interactive() && value === null && hoverColumn === column && landing === row;
      const stone = cell.firstElementChild;

      // Chỉ animate quân thực sự mới xuất hiện (bỏ qua lần update đầu tiên để
      // người xem vào giữa ván không thấy cả bàn cùng rơi).
      const before = previousBoard ? cellValue(previousBoard, row, column) : null;
      if (value !== null && before === null && previousBoard) {
        cell.classList.remove('is-dropping');
        void cell.offsetWidth;
        cell.style.setProperty('--c4-fall', String(row + 1));
        cell.classList.add('is-dropping');
        stone.addEventListener('animationend', () => cell.classList.remove('is-dropping'), { once: true });
      }

      cell.classList.toggle('is-win', winning.has(`${row},${column}`));
      cell.classList.toggle('is-last', lastColumn === column && lastRow === row);
      cell.classList.toggle('is-ghost', ghost);
      stone.classList.toggle('has-stone', value !== null || ghost);
      stone.classList.toggle('is-p1', value === 1 || (ghost && seat === 1));
      stone.classList.toggle('is-p2', value === 2 || (ghost && seat === 2));
      cell.disabled = locked;
      cell.setAttribute(
        'aria-label',
        `Cột ${column + 1}, hàng ${row + 1}${value ? `, quân ${value}` : ''}`
      );
    }
    previousBoard = rows.map((line) => (Array.isArray(line) ? [...line] : []));
  }

  board.addEventListener('click', (event) => {
    const cell = event.target.closest ? event.target.closest('.c4-cell') : null;
    if (!cell || !board.contains(cell)) return;
    if (!interactive()) return;
    const column = Number(cell.dataset.column);
    const rows = rowsOf();
    if (landingRow(column, rows) < 0 || !dropAllowed(column, rows)) {
      api.showToast?.('Cột này không thể thả quân.', 'warning');
      return;
    }
    api.onMove?.({ column });
  });

  function onHover(event, column) {
    if (!interactive()) return;
    if (column === hoverColumn) return;
    hoverColumn = column;
    render();
  }

  board.addEventListener('pointerover', (event) => {
    const cell = event.target.closest ? event.target.closest('.c4-cell') : null;
    if (!cell) return;
    onHover(event, Number(cell.dataset.column));
  });
  board.addEventListener('pointerout', (event) => {
    const cell = event.target.closest ? event.target.closest('.c4-cell') : null;
    if (!cell) return;
    if (event.relatedTarget && cell.contains(event.relatedTarget)) return;
    onHover(event, -1);
  });
  board.addEventListener('focusin', (event) => {
    const cell = event.target.closest ? event.target.closest('.c4-cell') : null;
    if (!cell) return;
    onHover(event, Number(cell.dataset.column));
  });
  board.addEventListener('focusout', () => onHover(null, -1));

  return {
    update(nextView) {
      view = nextView || {};
      if (!interactive()) hoverColumn = -1;
      render();
    },
    destroy() {
      root.innerHTML = '';
    }
  };
}

export default { meta, preview, mount };
