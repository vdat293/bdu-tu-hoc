// UI bàn Cờ vua theo hợp đồng module: bàn 8×8 có toạ độ a–h/1–8, chọn quân →
// highlight các ô đến được từ view.legalMoves do server cung cấp → gửi nước đi
// qua api.onMove; nước tới hàng cuối của tốt mở bộ chọn phong cấp.
// Module thuần DOM, không tự tính luật đi, tái sử dụng node khi update.

const meta = {
  id: 'chess',
  label: 'Cờ vua',
  tagline: 'Luật quốc tế, có phong cấp và chiếu hết'
};

const FILES = 'abcdefgh';
// Glyph đặc dùng chung cho cả hai màu; màu tô bằng class is-white / is-black.
const GLYPHS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PROMOTION_CHOICES = [
  { code: 'q', label: 'Hậu' },
  { code: 'r', label: 'Xe' },
  { code: 'b', label: 'Tượng' },
  { code: 'n', label: 'Mã' }
];

function squareName(row, column) {
  return `${FILES[column] || '?'}${8 - row}`;
}

function samePoint(a, b) {
  return Boolean(a) && Boolean(b) && Number(a.row) === Number(b.row) && Number(a.column) === Number(b.column);
}

function isPoint(value) {
  return Boolean(value) && Number.isInteger(Number(value.row)) && Number.isInteger(Number(value.column));
}

function lastPoints(lastMove) {
  if (!lastMove || typeof lastMove !== 'object') return { from: null, to: null };
  return { from: isPoint(lastMove.from) ? lastMove.from : null, to: isPoint(lastMove.to) ? lastMove.to : null };
}

function preview() {
  // Art tĩnh cho card trang chủ: thế khai cuộc thu nhỏ, không chứa dữ liệu người dùng.
  const pieces = new Map([
    ['0:0', 'br'], ['0:1', 'bn'], ['0:2', 'bb'], ['0:3', 'bq'], ['0:4', 'bk'], ['0:5', 'bb'], ['0:6', 'bn'], ['0:7', 'br'],
    ['1:0', 'bp'], ['1:4', 'bp'], ['1:7', 'bp'],
    ['6:3', 'wp'], ['6:4', 'wp'],
    ['7:0', 'wr'], ['7:4', 'wk'], ['7:3', 'wq']
  ]);
  let cells = '';
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const code = pieces.get(`${row}:${column}`) || null;
      const glyph = code ? `<span class="chess-piece ${code[0] === 'w' ? 'is-white' : 'is-black'}" style="animation-delay:${(row * 8 + column) * 14}ms">${GLYPHS[code[1]] || ''}</span>` : '';
      cells += `<span class="chess-preview-square ${(row + column) % 2 === 0 ? 'is-light' : 'is-dark'}">${glyph}</span>`;
    }
  }
  return `<div class="chess-preview" aria-hidden="true">${cells}</div>`;
}

function mount(root, api = {}) {
  root.innerHTML = `
    <div class="chess-board" data-chess-board>
      <div class="chess-grid" role="grid" aria-label="Bàn cờ vua"></div>
      <div class="chess-promotion" data-chess-promotion aria-label="Chọn quân phong cấp" hidden></div>
    </div>`;
  const boardEl = root.querySelector('[data-chess-board]');
  const gridEl = root.querySelector('.chess-grid');
  const promotionEl = root.querySelector('[data-chess-promotion]');

  const squares = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const square = document.createElement('button');
      square.type = 'button';
      square.className = `chess-square ${(row + column) % 2 === 0 ? 'is-light' : 'is-dark'}`;
      square.dataset.row = String(row);
      square.dataset.column = String(column);
      square.dataset.square = squareName(row, column);
      square.setAttribute('role', 'gridcell');

      const piece = document.createElement('span');
      piece.className = 'chess-piece';
      piece.setAttribute('aria-hidden', 'true');

      const fileCoord = document.createElement('span');
      fileCoord.className = 'chess-coord chess-coord--file';
      fileCoord.setAttribute('aria-hidden', 'true');
      fileCoord.textContent = FILES[column];

      const rankCoord = document.createElement('span');
      rankCoord.className = 'chess-coord chess-coord--rank';
      rankCoord.setAttribute('aria-hidden', 'true');
      rankCoord.textContent = String(8 - row);

      square.append(piece, fileCoord, rankCoord);
      square.addEventListener('click', () => handleClick(row, column));
      gridEl.appendChild(square);
      squares.push({ square, piece, fileCoord, rankCoord });
    }
  }

  promotionEl.innerHTML = PROMOTION_CHOICES.map((choice) => (
    `<button type="button" class="chess-promotion-btn" data-promotion="${choice.code}" aria-label="Phong cấp ${choice.label}">`
    + `<span class="chess-piece" aria-hidden="true">${GLYPHS[choice.code]}</span></button>`
  )).join('');
  promotionEl.querySelectorAll('[data-promotion]').forEach((button) => {
    button.addEventListener('click', () => choosePromotion(button.dataset.promotion));
  });

  let view = {};
  let selected = null;
  let pendingPromotion = null;

  function pieceAt(row, column) {
    const board = view.state?.board;
    const line = Array.isArray(board) ? board[row] : null;
    return Array.isArray(line) ? line[column] || null : null;
  }

  function ownPiece(code) {
    if (!code) return false;
    const seat = Number(view.mySeat);
    if (seat === 1) return code[0] === 'w';
    if (seat === 2) return code[0] === 'b';
    return false;
  }

  function movesFrom(point) {
    if (!Array.isArray(view.legalMoves)) return [];
    return view.legalMoves.filter((move) => samePoint(move.from, point));
  }

  function promotes(from, to, code) {
    return (code === 'wp' && Number(to.row) === 0) || (code === 'bp' && Number(to.row) === 7);
  }

  function submit(from, to) {
    selected = null;
    render();
    api.onMove?.({ from, to });
  }

  function openPromotion(from, to) {
    pendingPromotion = { from, to };
    selected = null;
    render();
  }

  function choosePromotion(code) {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    pendingPromotion = null;
    promotionEl.hidden = true;
    api.onMove?.({ from, to, promotion: code });
    render();
  }

  function handleClick(row, column) {
    if (!view.interactive || pendingPromotion) return;
    const point = { row, column };
    const detected = pieceAt(row, column);
    const hasLegalList = Array.isArray(view.legalMoves);

    if (selected && !samePoint(selected, point)) {
      const moving = pieceAt(selected.row, selected.column);
      const matches = hasLegalList ? movesFrom(selected).filter((move) => samePoint(move.to, point)) : null;
      // Không có legalMoves từ server thì vẫn cho gửi, server sẽ từ chối nếu sai.
      const legalTarget = hasLegalList ? matches.length > 0 : !ownPiece(detected);
      if (legalTarget) {
        if (promotes(selected, point, moving) || (matches && matches.some((move) => move.promotion))) {
          openPromotion(selected, point);
        } else {
          submit(selected, point);
        }
        return;
      }
    }

    if (ownPiece(detected)) {
      if (hasLegalList && view.legalMoves.length > 0 && movesFrom(point).length === 0) {
        selected = null;
        api.showToast?.('Quân này không có nước đi hợp lệ.', 'warning');
      } else {
        selected = point;
      }
    } else {
      selected = null;
    }
    render();
  }

  function renderPromotion() {
    if (!pendingPromotion || !view.interactive) {
      promotionEl.hidden = true;
      return;
    }
    promotionEl.hidden = false;
    const { to } = pendingPromotion;
    const size = boardEl.clientWidth || 0;
    const squareSize = size > 0 ? size / 8 : 40;
    const panelWidth = squareSize * 4;
    // Toạ độ thị giác: bàn lật khi người xem là ghế 2.
    const flipped = Number(view.mySeat) === 2;
    const visualRow = flipped ? 7 - to.row : to.row;
    const visualColumn = flipped ? 7 - to.column : to.column;
    const left = Math.max(0, Math.min(visualColumn * squareSize - squareSize * 1.5, Math.max(0, size - panelWidth)));
    const top = visualRow * squareSize + (visualRow >= 6 ? -squareSize * 1.25 : squareSize * 1.25);
    promotionEl.style.left = `${Math.round(left)}px`;
    promotionEl.style.top = `${Math.round(top)}px`;
  }

  function render() {
    const board = view.state?.board;
    const flipped = Number(view.mySeat) === 2;
    const destinations = new Map();
    if (selected && Array.isArray(view.legalMoves)) {
      for (const move of view.legalMoves) {
        if (!samePoint(move.from, selected) || !move.to) continue;
        destinations.set(`${Number(move.to.row)}:${Number(move.to.column)}`, Boolean(move.promotion));
      }
    }
    const last = lastPoints(view.lastMove);
    boardEl.classList.toggle('is-viewer-2', flipped);
    boardEl.classList.toggle('is-interactive', Boolean(view.interactive));

    squares.forEach((entry, index) => {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const code = pieceAt(row, column);
      entry.square.style.order = flipped ? String(63 - index) : '';

      if (code && GLYPHS[code[1]]) {
        entry.piece.textContent = GLYPHS[code[1]];
        entry.piece.className = `chess-piece ${code[0] === 'w' ? 'is-white' : 'is-black'}`;
      } else {
        entry.piece.textContent = '';
        entry.piece.className = 'chess-piece';
      }

      const classes = ['chess-square', (row + column) % 2 === 0 ? 'is-light' : 'is-dark'];
      if (code) classes.push('has-piece');
      if (view.interactive) classes.push('is-playable');
      if (selected && samePoint(selected, { row, column })) classes.push('is-selected');
      if (destinations.has(`${row}:${column}`)) classes.push(code ? 'is-capture' : 'is-target');
      if (last.from && samePoint(last.from, { row, column })) classes.push('is-last-from');
      if (last.to && samePoint(last.to, { row, column })) classes.push('is-last-to');
      entry.square.className = classes.join(' ');
      entry.square.disabled = !view.interactive;
      entry.square.setAttribute('aria-label', `Ô ${squareName(row, column)}${code ? (code[0] === 'w' ? ', quân trắng' : ', quân đen') : ''}`);

      // Toạ độ canh theo hướng nhìn: trắng ở dưới (mặc định) hoặc lật khi xem ghế 2.
      entry.fileCoord.classList.toggle('is-shown', flipped ? row === 0 : row === 7);
      entry.rankCoord.classList.toggle('is-shown', flipped ? column === 7 : column === 0);
    });

    renderPromotion();
  }

  function update(nextView) {
    view = nextView || {};
    if (!view.interactive) {
      selected = null;
      pendingPromotion = null;
    }
    render();
  }

  return {
    update,
    destroy() { root.innerHTML = ''; }
  };
}

export default { meta, preview, mount };
