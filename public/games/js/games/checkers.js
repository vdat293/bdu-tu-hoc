// UI Cờ đam (checkers) cho site /games — bàn 8×8, chỉ ô đen chơi được.
// Hợp đồng: export default { meta, preview(), mount(root, api) }.
// DOM được dựng một lần trong mount; update() chỉ đổi class/aria nên quân không
// "nhảy" lại mỗi lần state đổi. Toạ độ dùng { row, column } khớp engine.

const SIZE = 8;

const meta = {
  id: 'checkers',
  label: 'Cờ đam',
  tagline: 'Nhảy qua quân đối phương để ăn; hết quân hoặc hết nước là thua'
};

function pieceSeat(piece) {
  if (piece === 'r' || piece === 'R') return 1;
  if (piece === 'b' || piece === 'B') return 2;
  return 0;
}

function isKing(piece) {
  return piece === 'R' || piece === 'B';
}

// Thế cờ mẫu cho card trang chủ: đủ 24 quân, có sẵn 1 vua mỗi bên.
function previewPieces() {
  const pieces = new Map();
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if ((row + column) % 2 !== 1) continue;
      if (row <= 2) pieces.set(`${row},${column}`, row === 2 && column === 1 ? 'B' : 'b');
      else if (row >= 5) pieces.set(`${row},${column}`, row === 5 && column === 2 ? 'R' : 'r');
    }
  }
  return pieces;
}

const PREVIEW_PIECES = previewPieces();

function preview() {
  const cells = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const dark = (row + column) % 2 === 1;
      const piece = dark ? PREVIEW_PIECES.get(`${row},${column}`) || null : null;
      const classes = ['chk-preview-cell', dark ? 'is-dark' : 'is-light'];
      if (piece) {
        classes.push('has-piece', pieceSeat(piece) === 1 ? 'is-p1' : 'is-p2');
        if (isKing(piece)) classes.push('is-king');
      }
      cells.push(`<span class="${classes.join(' ')}" style="animation-delay:${(row * SIZE + column) * 6}ms"></span>`);
    }
  }
  return `<div class="chk-preview" aria-hidden="true">${cells.join('')}</div>`;
}

function mount(root, api) {
  const handlers = api || {};
  root.innerHTML = '';

  const board = document.createElement('div');
  board.className = 'chk-board';
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', 'Bàn cờ đam 8×8');

  const cells = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `chk-cell ${(row + column) % 2 === 1 ? 'is-dark' : 'is-light'}`;
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute('role', 'gridcell');
      cell.disabled = true;
      const piece = document.createElement('span');
      piece.className = 'chk-piece is-empty';
      piece.setAttribute('aria-hidden', 'true');
      cell.appendChild(piece);
      board.appendChild(cell);
      cells.push(cell);
    }
  }
  root.appendChild(board);

  let view = {};
  let selected = null;
  let lastSoundKey = '';

  const rowsOf = () => (Array.isArray(view.state?.board) ? view.state.board : []);
  const valueAt = (row, column) => {
    const line = rowsOf()[row];
    const value = Array.isArray(line) ? line[column] : null;
    return typeof value === 'string' && value ? value : null;
  };
  const samePoint = (a, b) => Boolean(a) && Boolean(b)
    && Number(a.row) === Number(b.row)
    && Number(a.column) === Number(b.column);
  const pointOf = (point) => ({ row: Number(point.row), column: Number(point.column) });
  const movesFrom = (from) => (Array.isArray(view.legalMoves) ? view.legalMoves : [])
    .filter((move) => samePoint(move?.from, from));
  const mySeat = () => Number(view.mySeat) || Number(view.state?.current_seat) || 0;
  const chainPoint = () => {
    const chain = view.state?.chain;
    if (!chain || !Number.isInteger(Number(chain.row)) || !Number.isInteger(Number(chain.column))) return null;
    return { row: Number(chain.row), column: Number(chain.column) };
  };
  const coordLabel = (row, column) => `${String.fromCharCode(65 + column)}${SIZE - row}`;

  function render() {
    const chain = chainPoint();
    const interactive = Boolean(view.interactive);
    // Đang giữa chuỗi ăn: chỉ quân bị buộc đi tiếp được chọn.
    if (!interactive) selected = null;
    else if (chain) selected = { row: chain.row, column: chain.column };

    const selectedMoves = selected ? movesFrom(selected) : [];
    const targets = new Map(selectedMoves.map((move) => [`${Number(move.to.row)},${Number(move.to.column)}`, move]));
    const lastFrom = view.lastMove?.from || null;
    const lastTo = view.lastMove?.to || null;
    const seat = mySeat();
    const finished = Boolean(view.status === 'finished' || view.state?.result || view.winnerSeat);

    board.classList.toggle('is-locked', !interactive);
    board.classList.toggle('is-finished', finished);
    board.setAttribute('aria-disabled', interactive ? 'false' : 'true');

    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      const piece = valueAt(row, column);
      const key = `${row},${column}`;
      const targetMove = targets.get(key);
      const isTarget = Boolean(targetMove);
      const isCaptureTarget = isTarget && Math.abs(Number(targetMove.to.row) - Number(targetMove.from.row)) === 2;
      const isSelected = Boolean(piece) && samePoint(selected, { row, column });
      const isChain = Boolean(chain) && samePoint(chain, { row, column });
      const selectable = interactive && !chain && Boolean(piece)
        && pieceSeat(piece) === seat && movesFrom({ row, column }).length > 0;

      cell.firstElementChild.className = [
        'chk-piece',
        piece ? (pieceSeat(piece) === 1 ? 'is-p1' : 'is-p2') : 'is-empty',
        piece && isKing(piece) ? 'is-king' : '',
        isSelected ? 'is-selected' : ''
      ].filter(Boolean).join(' ');

      const classes = ['chk-cell', (row + column) % 2 === 1 ? 'is-dark' : 'is-light'];
      if (isSelected) classes.push('is-selected');
      if (isChain) classes.push('is-chain');
      if (isTarget) classes.push('is-target');
      if (isCaptureTarget) classes.push('is-capture');
      if (samePoint(lastFrom, { row, column })) classes.push('is-last-from');
      if (samePoint(lastTo, { row, column })) classes.push('is-last-to');
      cell.className = classes.join(' ');
      cell.disabled = !interactive || !(isTarget || selectable || isChain);

      const pieceLabel = piece
        ? `${pieceSeat(piece) === 1 ? 'quân đỏ' : 'quân đen'}${isKing(piece) ? ', vua' : ''}`
        : 'ô trống';
      const actionLabel = isTarget ? `, có thể ${isCaptureTarget ? 'ăn quân' : 'đi'} tới` : '';
      cell.setAttribute('aria-label', `${coordLabel(row, column)}, ${pieceLabel}${actionLabel}`);
    }
  }

  board.addEventListener('click', (event) => {
    if (!view.interactive) return;
    const target = event.target?.closest ? event.target.closest('.chk-cell') : null;
    if (!target || !board.contains(target)) return;
    const point = { row: Number(target.dataset.row), column: Number(target.dataset.column) };
    const piece = valueAt(point.row, point.column);
    const chain = chainPoint();

    const chosen = (selected ? movesFrom(selected) : []).find((move) => samePoint(move.to, point));
    if (chosen) {
      selected = null;
      render();
      handlers.onMove?.({ from: pointOf(chosen.from), to: pointOf(chosen.to) });
      return;
    }

    if (chain) {
      // Không được kết thúc lượt giữa chuỗi ăn.
      if (!samePoint(point, chain)) {
        handlers.showToast?.('Đang trong chuỗi ăn, phải đi tiếp bằng quân vừa ăn.', 'warning');
      }
      return;
    }

    if (piece && pieceSeat(piece) === mySeat()) {
      if (movesFrom(point).length) selected = samePoint(selected, point) ? null : point;
      else {
        selected = null;
        handlers.showToast?.('Quân này không có nước đi hợp lệ.', 'warning');
      }
      render();
      return;
    }

    if (selected) {
      selected = null;
      render();
      return;
    }
    handlers.showToast?.('Hãy chọn một quân của bạn.', 'warning');
  });

  return {
    update(nextView) {
      view = nextView || {};
      const last = view.lastMove;
      if (last?.from && last?.to) {
        const key = `${last.from.row},${last.from.column}>${last.to.row},${last.to.column}`;
        if (key !== lastSoundKey) {
          lastSoundKey = key;
          // Nước nhảy ăn cách 2 hàng; room đã phát sound 'move' chung nên ở đây
          // chỉ phát thêm tiếng ăn quân.
          if (Math.abs(Number(last.to.row) - Number(last.from.row)) === 2) handlers.sound?.('capture');
        }
      } else {
        lastSoundKey = '';
      }
      render();
    },
    destroy() {
      root.innerHTML = '';
    }
  };
}

export default { meta, preview, mount };
