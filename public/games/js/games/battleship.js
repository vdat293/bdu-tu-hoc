// UI Battleship — hai pha đặt tàu / bắn. Toàn bộ dữ liệu vẽ ra đều lấy từ
// view.state đã được server che theo ghế: fleets[đối thủ] chỉ có length, số hits,
// sunk và cells của tàu đã chìm. UI không cache/suy đoán toạ độ tàu địch.

const meta = {
  id: 'battleship',
  label: 'Battleship',
  tagline: 'Bắn chìm cả 5 tàu địch trước đối thủ'
};

const SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

function shipCellsOf(row, column, length, horizontal) {
  const cells = [];
  for (let index = 0; index < length; index += 1) {
    cells.push(horizontal ? [row, column + index] : [row + index, column]);
  }
  return cells;
}

function preview() {
  const ships = new Set();
  const addShip = (row, column, length, horizontal = true) => {
    for (const [cellRow, cellColumn] of shipCellsOf(row, column, length, horizontal)) {
      ships.add(`${cellRow},${cellColumn}`);
    }
  };
  addShip(0, 0, 5);
  addShip(2, 4, 4);
  addShip(4, 1, 3);
  addShip(6, 5, 3, false);
  addShip(8, 7, 2);
  const hits = new Set(['0,1', '2,5', '4,1']);
  const misses = new Set(['1,8', '3,3', '5,6', '7,2', '9,1', '8,9']);
  return `<div class="bs-preview" aria-hidden="true">${Array.from({ length: SIZE * SIZE }, (_, index) => {
    const row = Math.floor(index / SIZE);
    const column = index % SIZE;
    const key = `${row},${column}`;
    const ship = ships.has(key) ? ' is-ship' : '';
    const mark = hits.has(key) ? ' is-hit' : misses.has(key) ? ' is-miss' : '';
    return `<span class="bs-preview-cell${ship}${mark}"></span>`;
  }).join('')}</div>`;
}

function mount(root, api) {
  root.innerHTML = `
    <div class="bs-game">
      <div class="bs-tools" data-tools hidden>
        <div class="bs-fleet" data-fleet aria-label="Các tàu cần đặt"></div>
        <div class="bs-buttons">
          <button type="button" class="bs-btn" data-action="rotate">Hướng: Ngang</button>
          <button type="button" class="bs-btn" data-action="undo">Hoàn tác</button>
          <button type="button" class="bs-btn" data-action="auto">Đặt ngẫu nhiên</button>
          <button type="button" class="bs-btn bs-btn--go" data-action="ready">Sẵn sàng</button>
        </div>
        <p class="bs-note" data-note></p>
      </div>
      <div class="bs-boards">
        <section class="bs-panel" data-panel="placing" hidden>
          <h4 class="bs-title">Hạm đội của bạn<span class="bs-title-hint">chạm ô để đặt tàu theo thứ tự</span></h4>
          <div class="bs-board" data-board="placing" role="grid" aria-label="Lưới đặt tàu của bạn"></div>
        </section>
        <section class="bs-panel" data-panel="attack" hidden>
          <h4 class="bs-title" data-title="attack">Vùng biển đối thủ</h4>
          <div class="bs-board" data-board="attack" role="grid" aria-label="Vùng biển đối thủ"></div>
        </section>
        <section class="bs-panel" data-panel="home" hidden>
          <h4 class="bs-title" data-title="home">Hạm đội của bạn</h4>
          <div class="bs-board" data-board="home" role="grid" aria-label="Hạm đội của bạn"></div>
        </section>
      </div>
      <p class="bs-wait" data-wait hidden></p>
    </div>`;

  function buildGrid(host) {
    const cells = [];
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'bs-cell';
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        cell.disabled = true;
        cell.setAttribute('aria-label', `Hàng ${row + 1}, cột ${column + 1}`);
        host.appendChild(cell);
        cells.push(cell);
      }
    }
    return cells;
  }

  const nodes = {
    tools: root.querySelector('[data-tools]'),
    fleet: root.querySelector('[data-fleet]'),
    note: root.querySelector('[data-note]'),
    wait: root.querySelector('[data-wait]'),
    panels: {
      placing: root.querySelector('[data-panel="placing"]'),
      attack: root.querySelector('[data-panel="attack"]'),
      home: root.querySelector('[data-panel="home"]')
    },
    titles: {
      attack: root.querySelector('[data-title="attack"]'),
      home: root.querySelector('[data-title="home"]')
    },
    grids: {
      placing: buildGrid(root.querySelector('[data-board="placing"]')),
      attack: buildGrid(root.querySelector('[data-board="attack"]')),
      home: buildGrid(root.querySelector('[data-board="home"]'))
    },
    buttons: {
      rotate: root.querySelector('[data-action="rotate"]'),
      undo: root.querySelector('[data-action="undo"]'),
      auto: root.querySelector('[data-action="auto"]'),
      ready: root.querySelector('[data-action="ready"]')
    }
  };

  const chips = SHIP_LENGTHS.map((length) => {
    const chip = document.createElement('span');
    chip.className = 'bs-chip';
    chip.textContent = `${length} ô`;
    nodes.fleet.appendChild(chip);
    return chip;
  });

  let view = {};
  let phase = 'placing';
  let mySeat = null;
  let isPlayerNow = false;
  let interactiveNow = false;
  let readyNow = false;
  let placedShips = [];
  let orientation = 'h';
  let lastShotCount = -1;
  let prevPhase = null;
  let prevReady = null;

  function stateNow() {
    return view.state && typeof view.state === 'object' ? view.state : {};
  }

  function shotsOf(seat) {
    const shots = stateNow().shots;
    return seat && Array.isArray(shots?.[seat]) ? shots[seat] : [];
  }

  function shotAt(seat, row, column) {
    return shotsOf(seat).some((shot) => Number(shot[0]) === row && Number(shot[1]) === column);
  }

  function canArrange() {
    return phase === 'placing' && isPlayerNow && interactiveNow && !readyNow;
  }

  function occupiedKeys() {
    const keys = new Set();
    placedShips.forEach((ship, index) => {
      for (const [row, column] of shipCellsOf(ship.row, ship.column, SHIP_LENGTHS[index], ship.horizontal)) {
        keys.add(`${row},${column}`);
      }
    });
    return keys;
  }

  function renderTools() {
    nodes.tools.hidden = !(phase === 'placing' && isPlayerNow && !readyNow);
    const arrange = canArrange();
    nodes.buttons.rotate.disabled = !arrange;
    nodes.buttons.undo.disabled = !arrange || placedShips.length === 0;
    nodes.buttons.auto.disabled = !arrange;
    nodes.buttons.ready.disabled = !arrange || placedShips.length !== SHIP_LENGTHS.length;
    nodes.buttons.rotate.textContent = orientation === 'h' ? 'Hướng: Ngang' : 'Hướng: Dọc';
    nodes.note.textContent = arrange
      ? 'Chạm ô bắt đầu của tàu kế tiếp; tàu không được chồng lên nhau.'
      : 'Đang chờ đối thủ đặt tàu…';
  }

  function renderPanels() {
    const playing = phase === 'playing';
    nodes.panels.placing.hidden = !(phase === 'placing' && isPlayerNow);
    nodes.panels.attack.hidden = !playing;
    nodes.panels.home.hidden = !playing;
    nodes.titles.attack.textContent = isPlayerNow ? 'Vùng biển đối thủ' : 'Vùng biển Người chơi 1';
    nodes.titles.home.textContent = isPlayerNow ? 'Hạm đội của bạn' : 'Vùng biển Người chơi 2';
  }

  function renderStatus() {
    let text = '';
    if (phase === 'placing') {
      if (isPlayerNow && (readyNow || !interactiveNow)) text = 'Đang chờ đối thủ đặt tàu…';
      else if (!isPlayerNow) text = 'Hai người chơi đang đặt tàu…';
    } else if (!isPlayerNow) {
      text = 'Bạn đang xem trận đấu.';
    }
    nodes.wait.hidden = !text;
    nodes.wait.textContent = text;
  }

  function renderSound() {
    const shots = mySeat ? shotsOf(mySeat) : [];
    if (lastShotCount === -1) {
      lastShotCount = shots.length;
      return;
    }
    if (shots.length < lastShotCount) {
      lastShotCount = shots.length; // ván mới
      return;
    }
    if (shots.length > lastShotCount) {
      for (let index = lastShotCount; index < shots.length; index += 1) {
        if (Array.isArray(shots[index]) && shots[index][2] === 'hit') {
          api.sound?.('capture');
          break;
        }
      }
      lastShotCount = shots.length;
    }
  }

  function renderPlacing() {
    const serverFleet = readyNow && mySeat && Array.isArray(stateNow().fleets?.[mySeat]) ? stateNow().fleets[mySeat] : null;
    const occupied = new Map();
    if (serverFleet && serverFleet.some((ship) => Array.isArray(ship.cells) && ship.cells.length)) {
      serverFleet.forEach((ship, shipIndex) => {
        for (const cell of ship.cells || []) occupied.set(`${cell[0]},${cell[1]}`, shipIndex);
      });
    } else {
      placedShips.forEach((ship, index) => {
        for (const [row, column] of shipCellsOf(ship.row, ship.column, SHIP_LENGTHS[index], ship.horizontal)) {
          occupied.set(`${row},${column}`, index);
        }
      });
    }
    const arrange = canArrange();
    const doneCount = serverFleet ? SHIP_LENGTHS.length : placedShips.length;
    const lastPlaced = arrange && placedShips.length ? placedShips.length - 1 : -1;
    nodes.grids.placing.forEach((cell, index) => {
      const row = Math.floor(index / SIZE);
      const column = index % SIZE;
      const owner = occupied.get(`${row},${column}`);
      const classes = ['bs-cell'];
      if (owner !== undefined) classes.push('is-ship');
      if (owner === lastPlaced) classes.push('is-last');
      cell.className = classes.join(' ');
      cell.disabled = !arrange;
      cell.setAttribute('aria-label', `Hàng ${row + 1}, cột ${column + 1}${owner !== undefined ? ', có tàu' : ''}`);
    });
    chips.forEach((chip, index) => {
      const classes = ['bs-chip'];
      if (index < doneCount) classes.push('is-done');
      if (index === placedShips.length && arrange) classes.push('is-current');
      chip.className = classes.join(' ');
    });
  }

  function renderPlayingGrid(cells, fleet, incomingShots, { canFire = false, lastCell = null } = {}) {
    const shotMap = new Map();
    for (const shot of incomingShots) {
      shotMap.set(`${Number(shot[0])},${Number(shot[1])}`, shot[2] === 'hit' ? 'hit' : 'miss');
    }
    const shipCells = new Set();
    const sunkCells = new Set();
    const hitCells = new Set();
    for (const ship of fleet || []) {
      const keyCells = (ship.cells || []).map((cell) => `${Number(cell[0])},${Number(cell[1])}`);
      for (const key of keyCells) {
        shipCells.add(key);
        if (ship.sunk) sunkCells.add(key);
      }
      // Tàu của mình trả hits dạng mảng toạ độ; tàu địch bị che chỉ trả số hits.
      if (Array.isArray(ship.hits)) {
        for (const cell of ship.hits) hitCells.add(`${Number(cell[0])},${Number(cell[1])}`);
      }
    }
    cells.forEach((cell, index) => {
      const row = Math.floor(index / SIZE);
      const column = index % SIZE;
      const key = `${row},${column}`;
      const shot = shotMap.get(key) || null;
      const isHit = shot === 'hit' || hitCells.has(key);
      const classes = ['bs-cell'];
      if (shipCells.has(key)) classes.push('is-ship');
      if (isHit) classes.push('is-hit');
      if (shot === 'miss') classes.push('is-miss');
      if (sunkCells.has(key)) classes.push('is-sunk');
      if (lastCell && lastCell.row === row && lastCell.column === column) classes.push('is-last');
      cell.className = classes.join(' ');
      cell.disabled = !(canFire && !shot);
      const suffix = shot === 'hit' || isHit ? ', bị bắn trúng' : shot === 'miss' ? ', đã bắn trượt' : '';
      cell.setAttribute('aria-label', `Hàng ${row + 1}, cột ${column + 1}${sunkCells.has(key) ? ', tàu đã chìm' : ''}${suffix}`);
    });
  }

  function lastCellFor(incomingShots, lastCell) {
    if (!lastCell) return null;
    return incomingShots.some((shot) => Number(shot[0]) === lastCell.row && Number(shot[1]) === lastCell.column)
      ? lastCell
      : null;
  }

  function renderPlaying() {
    if (phase !== 'playing') return;
    const state = stateNow();
    const enemySeat = mySeat === 1 ? 2 : 1;
    const attackSeat = isPlayerNow ? enemySeat : 1;
    const homeSeat = isPlayerNow ? mySeat : 2;
    const attackShots = shotsOf(isPlayerNow ? mySeat : 2);
    const homeShots = shotsOf(isPlayerNow ? enemySeat : 1);
    const move = view.lastMove;
    const lastCell = move && Number.isInteger(Number(move.row)) && Number.isInteger(Number(move.column))
      ? { row: Number(move.row), column: Number(move.column) }
      : null;
    const fleets = state.fleets || {};
    renderPlayingGrid(nodes.grids.attack, fleets[attackSeat], attackShots, {
      canFire: interactiveNow && isPlayerNow && !state.result && !view.winnerSeat,
      lastCell: lastCellFor(attackShots, lastCell)
    });
    renderPlayingGrid(nodes.grids.home, fleets[homeSeat], homeShots, {
      canFire: false,
      lastCell: lastCellFor(homeShots, lastCell)
    });
  }

  function placeLocalShip(row, column) {
    if (placedShips.length >= SHIP_LENGTHS.length) {
      api.showToast?.('Đã đủ 5 tàu, bấm Sẵn sàng.', 'info');
      return;
    }
    const length = SHIP_LENGTHS[placedShips.length];
    const cells = shipCellsOf(row, column, length, orientation === 'h');
    const inBoard = cells.every(([cellRow, cellColumn]) => (
      cellRow >= 0 && cellRow < SIZE && cellColumn >= 0 && cellColumn < SIZE
    ));
    const free = inBoard && cells.every(([cellRow, cellColumn]) => !occupiedKeys().has(`${cellRow},${cellColumn}`));
    if (!free) {
      api.showToast?.('Không đủ chỗ cho tàu này ở hướng hiện tại.', 'warning');
      return;
    }
    placedShips.push({ row, column, horizontal: orientation === 'h' });
    api.sound?.('move');
    renderTools();
    renderPlacing();
  }

  root.querySelector('[data-board="placing"]').addEventListener('click', (event) => {
    const cell = event.target.closest('.bs-cell');
    if (!cell || !canArrange()) return;
    placeLocalShip(Number(cell.dataset.row), Number(cell.dataset.column));
  });

  root.querySelector('[data-board="attack"]').addEventListener('click', (event) => {
    const cell = event.target.closest('.bs-cell');
    if (!cell || cell.disabled || phase !== 'playing' || !interactiveNow || !isPlayerNow) return;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    if (shotAt(mySeat, row, column)) return;
    const legal = view.legalMoves;
    if (Array.isArray(legal) && !legal.some((move) => Number(move?.row) === row && Number(move?.column) === column)) {
      api.showToast?.('Nước bắn không hợp lệ.', 'warning');
      return;
    }
    api.onMove?.({ row, column });
  });

  nodes.buttons.rotate.addEventListener('click', () => {
    if (!canArrange()) return;
    orientation = orientation === 'h' ? 'v' : 'h';
    renderTools();
  });

  nodes.buttons.undo.addEventListener('click', () => {
    if (!canArrange()) return;
    placedShips.pop();
    renderTools();
    renderPlacing();
  });

  nodes.buttons.auto.addEventListener('click', () => {
    if (!canArrange()) return;
    api.onMove?.({ auto: true });
  });

  nodes.buttons.ready.addEventListener('click', () => {
    if (!canArrange() || placedShips.length !== SHIP_LENGTHS.length) return;
    api.onMove?.({
      place: true,
      ships: placedShips.map((ship) => ({ row: ship.row, column: ship.column, horizontal: ship.horizontal }))
    });
  });

  function update(nextView) {
    view = nextView && typeof nextView === 'object' ? nextView : {};
    const state = stateNow();
    phase = state.phase === 'playing' ? 'playing' : 'placing';
    const seat = Number(view.mySeat);
    mySeat = seat === 1 || seat === 2 ? seat : null;
    isPlayerNow = view.role === 'player' && mySeat !== null;
    interactiveNow = view.interactive === true;
    readyNow = Boolean(state.ready && mySeat ? state.ready[mySeat] : false);

    const phaseChanged = prevPhase !== null && prevPhase !== phase;
    if (phaseChanged || (prevReady === true && !readyNow)) {
      placedShips = [];
      orientation = 'h';
      lastShotCount = -1;
    }
    prevPhase = phase;
    prevReady = readyNow;

    renderTools();
    renderPanels();
    renderStatus();
    renderSound();
    renderPlacing();
    renderPlaying();
  }

  return {
    update,
    destroy() {
      root.innerHTML = '';
      placedShips = [];
      view = {};
    }
  };
}

export default { meta, preview, mount };
