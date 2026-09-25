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
const COLUMN_LABELS = Array.from({ length: SIZE }, (_, index) => String.fromCharCode(65 + index));

function shipCellsOf(row, column, length, horizontal) {
  const cells = [];
  for (let index = 0; index < length; index += 1) {
    cells.push(horizontal ? [row, column + index] : [row + index, column]);
  }
  return cells;
}

function coordinateOf(row, column) {
  return `${COLUMN_LABELS[column] || '?'}${row + 1}`;
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
      <section class="bs-prep-card" data-prep hidden aria-live="polite" aria-atomic="true">
        <div class="bs-prep-head">
          <div>
            <span class="bs-eyebrow">Chuẩn bị hạm đội</span>
            <strong data-prep-title>Hai bên cùng sẵn sàng để bắt đầu</strong>
          </div>
          <span class="bs-prep-count" data-prep-count>0/2</span>
        </div>
        <p class="bs-prep-copy" data-prep-copy></p>
        <div class="bs-readiness" data-readiness aria-label="Trạng thái sẵn sàng của hai người chơi"></div>
        <span class="bs-prep-note">Pha chuẩn bị không tính thời gian.</span>
      </section>
      <div class="bs-feedback" data-feedback role="status" aria-live="polite" aria-atomic="true" hidden></div>
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
          <div class="bs-panel-head">
            <h4 class="bs-title">Hạm đội của bạn<span class="bs-title-hint">chạm ô để đặt tàu theo thứ tự</span></h4>
            <span class="bs-panel-status" data-placing-status></span>
          </div>
          <div class="bs-ship-tracker" data-fleet="placing" aria-label="Tiến độ hạm đội của bạn"></div>
          <div class="bs-board" data-board="placing" role="grid" aria-rowcount="10" aria-colcount="10" aria-label="Lưới đặt tàu của bạn"></div>
        </section>
        <section class="bs-panel" data-panel="attack" hidden>
          <div class="bs-panel-head">
            <h4 class="bs-title" data-title="attack">Vùng biển đối thủ</h4>
            <span class="bs-panel-status" data-attack-status></span>
          </div>
          <div class="bs-ship-tracker" data-fleet="attack" aria-label="Tiến độ hạm đội đối thủ"></div>
          <div class="bs-legend" aria-label="Chú thích bản đồ">
            <span><i class="bs-legend-mark bs-legend-mark--hit"></i>Trúng</span>
            <span><i class="bs-legend-mark bs-legend-mark--miss"></i>Trượt</span>
            <span><i class="bs-legend-mark bs-legend-mark--sunk"></i>Đã chìm</span>
          </div>
          <div class="bs-board" data-board="attack" role="grid" aria-rowcount="10" aria-colcount="10" aria-label="Vùng biển đối thủ"></div>
        </section>
        <section class="bs-panel" data-panel="home" hidden>
          <div class="bs-panel-head">
            <h4 class="bs-title" data-title="home">Hạm đội của bạn</h4>
            <span class="bs-panel-status" data-home-status></span>
          </div>
          <div class="bs-ship-tracker" data-fleet="home" aria-label="Tiến độ hạm đội của bạn"></div>
          <div class="bs-board" data-board="home" role="grid" aria-rowcount="10" aria-colcount="10" aria-label="Hạm đội của bạn"></div>
        </section>
      </div>
      <p class="bs-wait" data-wait hidden></p>
    </div>`;

  function buildGrid(host) {
    const cells = [];
    const corner = document.createElement('span');
    corner.className = 'bs-axis-corner';
    corner.setAttribute('aria-hidden', 'true');
    host.appendChild(corner);
    COLUMN_LABELS.forEach((label) => {
      const axis = document.createElement('span');
      axis.className = 'bs-axis-label bs-axis-label--column';
      axis.textContent = label;
      axis.setAttribute('aria-hidden', 'true');
      host.appendChild(axis);
    });
    for (let row = 0; row < SIZE; row += 1) {
      const rowLabel = document.createElement('span');
      rowLabel.className = 'bs-axis-label bs-axis-label--row';
      rowLabel.textContent = String(row + 1);
      rowLabel.setAttribute('aria-hidden', 'true');
      host.appendChild(rowLabel);
      for (let column = 0; column < SIZE; column += 1) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'bs-cell';
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        cell.dataset.coordinate = coordinateOf(row, column);
        cell.disabled = true;
        cell.title = coordinateOf(row, column);
        cell.setAttribute('aria-label', `Ô ${coordinateOf(row, column)}`);
        cell.setAttribute('aria-rowindex', String(row + 1));
        cell.setAttribute('aria-colindex', String(column + 1));
        host.appendChild(cell);
        cells.push(cell);
      }
    }
    return cells;
  }

  const nodes = {
    prep: root.querySelector('[data-prep]'),
    prepCount: root.querySelector('[data-prep-count]'),
    prepCopy: root.querySelector('[data-prep-copy]'),
    readiness: root.querySelector('[data-readiness]'),
    feedback: root.querySelector('[data-feedback]'),
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
    statuses: {
      placing: root.querySelector('[data-placing-status]'),
      attack: root.querySelector('[data-attack-status]'),
      home: root.querySelector('[data-home-status]')
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

  const readinessNodes = [1, 2].map((seat) => {
    const item = document.createElement('span');
    item.className = 'bs-readiness-item';
    item.dataset.seat = String(seat);
    nodes.readiness.appendChild(item);
    return item;
  });

  const trackerNodes = {
    placing: root.querySelector('[data-fleet="placing"]'),
    attack: root.querySelector('[data-fleet="attack"]'),
    home: root.querySelector('[data-fleet="home"]')
  };
  const trackers = Object.fromEntries(Object.entries(trackerNodes).map(([key, host]) => {
    const items = SHIP_LENGTHS.map((length, index) => {
      const item = document.createElement('span');
      item.className = 'bs-ship-chip';
      item.dataset.ship = String(index);
      item.textContent = `Tàu ${index + 1} · ${length} ô`;
      host.appendChild(item);
      return item;
    });
    return [key, items];
  }));

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
  let previousGameSnapshot = null;
  let currentFeedback = null;
  let feedbackTimer = null;

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

  function playerName(seat) {
    const player = (view.players || []).find((item) => Number(item?.seat) === Number(seat));
    return player ? (player.name || player.full_name || player.mssv || `Người chơi ${seat}`) : `Người chơi ${seat}`;
  }

  function shipHits(ship) {
    return Array.isArray(ship?.hits) ? ship.hits.length : Number(ship?.hits || 0);
  }

  function fleetFor(seat) {
    const fleet = stateNow().fleets?.[seat];
    return Array.isArray(fleet) ? fleet : [];
  }

  function renderPrep() {
    const placing = phase === 'placing';
    nodes.prep.hidden = !placing;
    if (!placing) return;
    const ready = stateNow().ready || {};
    const readyCount = [1, 2].filter((seat) => Boolean(ready[seat])).length;
    nodes.prepCount.textContent = `${readyCount}/2 sẵn sàng`;
    const ownReady = Boolean(ready[mySeat]);
    const bothReady = Boolean(ready[1] && ready[2]);
    if (bothReady) {
      nodes.prepCopy.textContent = 'Cả hai đã sẵn sàng — ván đấu bắt đầu ngay!';
    } else if (!isPlayerNow) {
      nodes.prepCopy.textContent = 'Hai người chơi có thể chuẩn bị hạm đội cùng lúc.';
    } else if (ownReady) {
      nodes.prepCopy.textContent = 'Bạn đã sẵn sàng. Đang chờ đối thủ hoàn tất hạm đội.';
    } else {
      nodes.prepCopy.textContent = 'Xếp đủ 5 tàu rồi bấm “Sẵn sàng”. Không cần chờ lượt của nhau.';
    }
    readinessNodes.forEach((item, index) => {
      const seat = index + 1;
      const isReady = Boolean(ready[seat]);
      item.className = `bs-readiness-item${isReady ? ' is-ready' : ''}`;
      item.textContent = `${playerName(seat)} · ${isReady ? 'Đã sẵn sàng' : 'Đang chuẩn bị'}`;
      item.setAttribute('aria-label', item.textContent);
    });
  }

  function renderTools() {
    nodes.tools.hidden = !(phase === 'placing' && isPlayerNow && !readyNow);
    const arrange = canArrange();
    nodes.buttons.rotate.disabled = !arrange;
    nodes.buttons.undo.disabled = !arrange || placedShips.length === 0;
    nodes.buttons.auto.disabled = !arrange;
    nodes.buttons.ready.disabled = !arrange || placedShips.length !== SHIP_LENGTHS.length;
    nodes.buttons.rotate.textContent = orientation === 'h' ? 'Hướng: Ngang' : 'Hướng: Dọc';
    nodes.buttons.ready.textContent = readyNow ? 'Đã sẵn sàng' : 'Sẵn sàng';
    nodes.note.textContent = arrange
      ? 'Chạm ô bắt đầu của tàu kế tiếp; tàu không được chồng lên nhau.'
      : readyNow
        ? 'Đã sẵn sàng — chờ đối thủ.'
        : 'Bạn có thể đặt tàu ngay.';
  }

  function renderTracker(key, fleet, { own = false } = {}) {
    const ships = Array.isArray(fleet) ? fleet : [];
    trackers[key].forEach((item, index) => {
      const ship = ships[index] || {};
      const length = Number(ship.length) || SHIP_LENGTHS[index];
      const hits = Math.min(length, Math.max(0, shipHits(ship)));
      const sunk = Boolean(ship.sunk);
      const remaining = Math.max(0, length - hits);
      item.className = `bs-ship-chip${sunk ? ' is-sunk' : hits > 0 ? ' is-damaged' : ''}`;
      const status = sunk ? 'đã chìm' : hits > 0 ? `còn ${remaining} ô` : 'chưa trúng';
      item.textContent = `Tàu ${index + 1} · ${length} ô · ${status}`;
      item.setAttribute('aria-label', `${own ? 'Tàu của bạn' : 'Tàu đối thủ'} ${index + 1}, ${length} ô, ${status}`);
    });
  }

  function renderPanels() {
    const playing = phase === 'playing';
    const placing = phase === 'placing';
    nodes.panels.placing.hidden = !placing;
    nodes.panels.attack.hidden = !playing;
    nodes.panels.home.hidden = !playing;
    if (placing) {
      nodes.titles.attack.textContent = '';
      nodes.titles.home.textContent = '';
      nodes.statuses.placing.textContent = isPlayerNow
        ? (readyNow ? 'Đã sẵn sàng' : `${placedShips.length}/5 tàu`)
        : 'Đang chuẩn bị';
    } else {
      nodes.titles.attack.textContent = isPlayerNow ? 'Vùng biển đối thủ' : 'Vùng biển Người chơi 1';
      nodes.titles.home.textContent = isPlayerNow ? 'Hạm đội của bạn' : 'Vùng biển Người chơi 2';
      nodes.statuses.attack.textContent = interactiveNow && isPlayerNow ? 'Lượt của bạn' : 'Chờ đối thủ';
      nodes.statuses.home.textContent = 'Theo dõi hạm đội';
    }
  }

  function renderStatus() {
    let text = '';
    if (phase === 'placing') {
      if (!isPlayerNow) text = 'Hai người chơi đang chuẩn bị hạm đội…';
      else if (readyNow) text = 'Đã sẵn sàng — đang chờ đối thủ…';
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
      lastShotCount = shots.length;
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
      cell.setAttribute('aria-label', `Ô ${coordinateOf(row, column)}${owner !== undefined ? ', có tàu của bạn' : ''}`);
    });
    chips.forEach((chip, index) => {
      const classes = ['bs-chip'];
      if (index < doneCount) classes.push('is-done');
      if (index === placedShips.length && arrange) classes.push('is-current');
      chip.className = classes.join(' ');
    });
    renderTracker('placing', serverFleet || (isPlayerNow ? placedShips.map((ship, index) => ({ length: SHIP_LENGTHS[index], hits: [] })) : []), { own: isPlayerNow });
  }

  function renderPlayingGrid(cells, fleet, incomingShots, { canFire = false, lastCell = null, justSunkKeys = new Set(), revealOnlySunk = false } = {}) {
    const shotMap = new Map();
    for (const shot of incomingShots) {
      shotMap.set(`${Number(shot[0])},${Number(shot[1])}`, shot[2] === 'hit' ? 'hit' : 'miss');
    }
    const shipCells = new Set();
    const sunkCells = new Set();
    const hitCells = new Set();
    for (const ship of fleet || []) {
      const keyCells = (ship.cells || [])
        .filter(() => !revealOnlySunk || ship.sunk)
        .map((cell) => `${Number(cell[0])},${Number(cell[1])}`);
      for (const key of keyCells) {
        shipCells.add(key);
        if (ship.sunk) sunkCells.add(key);
      }
      if (Array.isArray(ship.hits) && (!revealOnlySunk || ship.sunk)) {
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
      if (justSunkKeys.has(key)) classes.push('is-just-sunk');
      if (lastCell && lastCell.row === row && lastCell.column === column) classes.push('is-last');
      cell.className = classes.join(' ');
      cell.disabled = !(canFire && !shot);
      const suffix = sunkCells.has(key)
        ? ', tàu đã chìm'
        : shot === 'hit' || isHit
          ? ', bị bắn trúng'
          : shot === 'miss'
            ? ', đã bắn trượt'
            : '';
      cell.setAttribute('aria-label', `Ô ${coordinateOf(row, column)}${suffix}`);
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
    const feedbackCell = currentFeedback?.cell || null;
    const lastCell = feedbackCell || (move && Number.isInteger(Number(move.row)) && Number.isInteger(Number(move.column))
      ? { row: Number(move.row), column: Number(move.column) }
      : null);
    const justSunkKeys = currentFeedback?.kind === 'sunk' ? currentFeedback.keys : new Set();
    const attackJustSunkKeys = currentFeedback?.kind === 'sunk' && currentFeedback.seat === attackSeat
      ? justSunkKeys
      : new Set();
    const homeJustSunkKeys = currentFeedback?.kind === 'sunk' && currentFeedback.seat === homeSeat
      ? justSunkKeys
      : new Set();
    const fleets = state.fleets || {};
    renderTracker('attack', fleets[attackSeat], { own: false });
    renderTracker('home', fleets[homeSeat], { own: isPlayerNow });
    renderPlayingGrid(nodes.grids.attack, fleets[attackSeat], attackShots, {
      canFire: interactiveNow && isPlayerNow && !state.result && !view.winnerSeat,
      lastCell: lastCellFor(attackShots, lastCell),
      justSunkKeys: attackJustSunkKeys,
      revealOnlySunk: true
    });
    renderPlayingGrid(nodes.grids.home, fleets[homeSeat], homeShots, {
      canFire: false,
      lastCell: lastCellFor(homeShots, lastCell),
      justSunkKeys: homeJustSunkKeys
    });
  }

  function gameSnapshot() {
    const snapshot = {
      version: Number(stateNow().move_number || 0),
      shots: new Map(),
      sunk: new Map()
    };
    for (const seat of [1, 2]) {
      for (const [index, shot] of shotsOf(seat).entries()) {
        if (!Array.isArray(shot)) continue;
        snapshot.shots.set(`${seat}:${Number(shot[0])},${Number(shot[1])}`, {
          seat,
          row: Number(shot[0]),
          column: Number(shot[1]),
          result: shot[2] === 'hit' ? 'hit' : 'miss'
        });
      }
      fleetFor(seat).forEach((ship, index) => {
        const identity = `${seat}:${index}`;
        snapshot.sunk.set(identity, {
          seat,
          index,
          length: Number(ship.length) || SHIP_LENGTHS[index],
          sunk: Boolean(ship.sunk),
          cells: new Set((ship.sunk ? ship.cells || [] : []).map((cell) => `${Number(cell[0])},${Number(cell[1])}`))
        });
      });
    }
    return snapshot;
  }

  function detectFeedback() {
    const current = gameSnapshot();
    const previous = previousGameSnapshot;
    previousGameSnapshot = current;
    if (!previous || current.version < previous.version) {
      currentFeedback = null;
      return;
    }
    const newlySunk = [];
    for (const [identity, ship] of current.sunk) {
      const before = previous.sunk.get(identity);
      if (ship.sunk && before?.sunk !== true) newlySunk.push({ identity, ...ship });
    }
    const newShots = [];
    for (const [key, shot] of current.shots) {
      if (!previous.shots.has(key)) newShots.push(shot);
    }
    if (newlySunk.length) {
      const ship = newlySunk.at(-1);
      const isOwnFleet = ship.seat === mySeat;
      const text = isPlayerNow && isOwnFleet
        ? 'Tàu của bạn đã bị bắn chìm!'
        : isPlayerNow
          ? `Bắn chìm! Tàu ${ship.index + 1} (${ship.length} ô) đã bị tiêu diệt.`
          : `Một tàu vừa bị bắn chìm!`;
      currentFeedback = {
        kind: 'sunk',
        seat: ship.seat,
        text,
        cell: newShots.at(-1) || null,
        keys: new Set(ship.cells)
      };
      return;
    }
    if (newShots.length) {
      const shot = newShots.at(-1);
      currentFeedback = {
        kind: shot.result === 'hit' ? 'hit' : 'miss',
        text: shot.result === 'hit' ? 'Bắn trúng!' : 'Bắn trượt.',
        cell: shot,
        keys: new Set()
      };
      return;
    }
    currentFeedback = null;
  }

  function showFeedback(feedback) {
    if (!feedback) return;
    nodes.feedback.textContent = feedback.text;
    nodes.feedback.className = `bs-feedback is-${feedback.kind}`;
    nodes.feedback.hidden = false;
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      nodes.feedback.hidden = true;
      nodes.feedback.textContent = '';
      nodes.feedback.className = 'bs-feedback';
    }, feedback.kind === 'sunk' ? 2600 : 1500);
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
      previousGameSnapshot = null;
      currentFeedback = null;
    }
    detectFeedback();
    renderTools();
    renderPanels();
    renderPrep();
    renderStatus();
    renderSound();
    renderPlacing();
    renderPlaying();
    showFeedback(currentFeedback);
    prevPhase = phase;
    prevReady = readyNow;
  }

  return {
    update,
    destroy() {
      window.clearTimeout(feedbackTimer);
      feedbackTimer = null;
      root.innerHTML = '';
      placedShips = [];
      previousGameSnapshot = null;
      currentFeedback = null;
      view = {};
    }
  };
}

export default { meta, preview, mount };
