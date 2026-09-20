// UI Backgammon — bàn 24 điểm (12 trên / 12 dưới), bar giữa, 2 khay về đích,
// xúc xắc vẽ theo state.dice.remaining. DOM dựng một lần, update chỉ đổi class
// và nội dung nên animation không chạy lại. CSS scope bằng tiền tố .bkg-.
// Luồng chơi: chọn quân (điểm / bar) -> highlight đích -> click đích gửi
// api.onMove({ from: 'bar' | điểm, die }) đúng hợp đồng engine.
import { esc, playerLabel } from '../ui.js';

const meta = {
  id: 'backgammon',
  label: 'Backgammon',
  tagline: 'Đua 15 quân về nhà — không có doubling cube'
};

// Bố cục chuẩn nhìn từ ghế 1: trên 13..24, dưới 12..1; bar ở giữa.
const QUADRANTS = [
  ['tl', [13, 14, 15, 16, 17, 18], 'top'],
  ['tr', [19, 20, 21, 22, 23, 24], 'top'],
  ['bl', [12, 11, 10, 9, 8, 7], 'bottom'],
  ['br', [6, 5, 4, 3, 2, 1], 'bottom']
];

// Vị trí nốt xúc xắc trên lưới 3×3.
const PIPS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

function dieMarkup(value) {
  const on = new Set(PIPS[value] || []);
  return `<span class="bkg-pips">${Array.from({ length: 9 }, (_, index) => `<i class="${on.has(index) ? 'is-on' : ''}"></i>`).join('')}</span>`;
}

function checkerMarkup(seat, count, cap = 5) {
  const className = Number(seat) === 1 ? 'is-p1' : 'is-p2';
  let html = '';
  for (let index = 0; index < Math.min(count, cap); index += 1) html += `<span class="bkg-checker ${className}"></span>`;
  return html;
}

function preview() {
  const columns = Array.from({ length: 6 }, (_, index) => `
    <span class="bkg-preview-col">
      <i class="bkg-preview-tri is-top ${index % 2 ? 'is-dark' : 'is-light'}"></i>
      <i class="bkg-preview-mid"></i>
      <i class="bkg-preview-tri is-bottom ${index % 2 ? 'is-light' : 'is-dark'}"></i>
    </span>`).join('');
  return `<div class="bkg-preview" aria-hidden="true">${columns}</div>`;
}

function mount(root, api) {
  root.innerHTML = `
    <div class="bkg-wrap">
      <p class="bkg-status" data-status role="status"></p>
      <div class="bkg-scroll">
        <div class="bkg-board" data-board role="group" aria-label="Bàn Backgammon">
          <button type="button" class="bkg-tray bkg-tray--seat2" data-tray="2" aria-label="Khay về ghế 2">
            <span class="bkg-tray-stack" data-tray-stack="2"></span>
            <span class="bkg-tray-count" data-tray-count="2">0</span>
          </button>
          <div class="bkg-quad bkg-quad--tl" data-quad="tl"></div>
          <div class="bkg-bar" data-bar>
            <button type="button" class="bkg-bar-zone" data-bar-zone="2" aria-label="Quân chờ ghế 2">
              <span class="bkg-bar-stack" data-bar-stack="2"></span>
              <span class="bkg-bar-count" data-bar-count="2">0</span>
            </button>
            <button type="button" class="bkg-bar-zone" data-bar-zone="1" aria-label="Quân chờ ghế 1">
              <span class="bkg-bar-stack" data-bar-stack="1"></span>
              <span class="bkg-bar-count" data-bar-count="1">0</span>
            </button>
          </div>
          <div class="bkg-quad bkg-quad--tr" data-quad="tr"></div>
          <button type="button" class="bkg-tray bkg-tray--seat1" data-tray="1" aria-label="Khay về ghế 1">
            <span class="bkg-tray-stack" data-tray-stack="1"></span>
            <span class="bkg-tray-count" data-tray-count="1">0</span>
          </button>
          <div class="bkg-quad bkg-quad--bl" data-quad="bl"></div>
          <div class="bkg-quad bkg-quad--br" data-quad="br"></div>
        </div>
      </div>
      <div class="bkg-dice" data-dice>
        <span class="bkg-dice-label" data-dice-label>Xúc xắc</span>
        <span class="bkg-dice-list" data-dice-list></span>
      </div>
    </div>`;

  const els = {
    status: root.querySelector('[data-status]'),
    board: root.querySelector('[data-board]'),
    dice: root.querySelector('[data-dice]'),
    diceLabel: root.querySelector('[data-dice-label]'),
    diceList: root.querySelector('[data-dice-list]')
  };

  // Dựng 24 điểm một lần, update chỉ đổi class/nội dung.
  const pointButtons = new Map();
  const quadrantHosts = new Map([...root.querySelectorAll('[data-quad]')].map((host) => [host.dataset.quad, host]));
  for (const [key, points, variant] of QUADRANTS) {
    const host = quadrantHosts.get(key);
    for (const point of points) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.point = String(point);
      button.dataset.variant = variant;
      button.className = `bkg-point bkg-point--${variant}`;
      button.innerHTML = '<span class="bkg-stack" data-stack></span><span class="bkg-tri" aria-hidden="true"></span><span class="bkg-count" data-count hidden></span>';
      button.addEventListener('click', () => onPointClick(point));
      host.appendChild(button);
      pointButtons.set(point, button);
    }
  }

  const barZones = new Map([...root.querySelectorAll('[data-bar-zone]')].map((zone) => [Number(zone.dataset.barZone), zone]));
  const trays = new Map([...root.querySelectorAll('[data-tray]')].map((tray) => [Number(tray.dataset.tray), tray]));
  for (const [seat, zone] of barZones) zone.addEventListener('click', () => onBarClick(seat));
  for (const [seat, tray] of trays) tray.addEventListener('click', () => onTrayClick(seat));

  let view = {};
  let selectedFrom = null;
  let selectedDie = null;
  let interactiveNow = false;
  let mySeatNow = null;

  function legalList() {
    const list = Array.isArray(view.legalMoves) ? view.legalMoves : [];
    return list.filter((move) => move && move.from !== undefined && move.die !== undefined);
  }

  function sourceKey(from) {
    return from === 'bar' ? 'bar' : String(Number(from));
  }

  function movesFrom(from) {
    const key = sourceKey(from);
    return legalList().filter((move) => sourceKey(move.from) === key);
  }

  function movesTo(from, to) {
    return movesFrom(from).filter((move) => (to === 'off' ? move.to === 'off' : Number(move.to) === Number(to)));
  }

  // Ưu tiên nước khớp xúc xắc đang chọn; nếu không có thì dùng mọi con còn lại.
  function chosenMoves(from, to) {
    let matches = movesTo(from, to);
    if (selectedDie !== null) {
      const byDie = matches.filter((move) => Number(move.die) === selectedDie);
      if (byDie.length) matches = byDie;
    }
    return matches;
  }

  function seatAt(point) {
    const value = Number(view.state?.points?.[point - 1] || 0);
    return value > 0 ? 1 : value < 0 ? 2 : 0;
  }

  function barCount(seat) {
    return Number(view.state?.bar?.[seat] || 0);
  }

  function offCount(seat) {
    return Number(view.state?.off?.[seat] || 0);
  }

  function diceValues() {
    const dice = view.state?.dice?.remaining;
    if (!Array.isArray(dice)) return [];
    return dice.map(Number).filter((value) => value >= 1 && value <= 6);
  }

  function opponentLabel() {
    const players = Array.isArray(view.players) ? view.players : [];
    const opponent = players.find((player) => Number(player?.seat) >= 1 && Number(player?.seat) <= 2 && Number(player?.seat) !== mySeatNow);
    return opponent ? playerLabel(opponent) : 'đối thủ';
  }

  function trySend(from, to) {
    const matches = chosenMoves(from, to);
    if (!matches.length) return false;
    const move = matches[0];
    const moverSeat = Number(view.mySeat) || Number(view.state?.current_seat) || 1;
    let captured = false;
    if (move.to !== 'off') {
      const value = Number(view.state?.points?.[Number(move.to) - 1] || 0);
      if (Math.abs(value) === 1) captured = (value > 0 ? 1 : 2) !== moverSeat;
    }
    api.onMove?.({ from: move.from === 'bar' ? 'bar' : Number(move.from), die: Number(move.die) });
    api.sound?.(captured ? 'capture' : 'move');
    selectedFrom = null;
    selectedDie = null;
    return true;
  }

  function selectSource(from) {
    const all = movesFrom(from);
    if (!all.length) return false;
    if (selectedDie !== null && !all.some((move) => Number(move.die) === selectedDie)) selectedDie = null;
    selectedFrom = sourceKey(selectedFrom) === sourceKey(from) ? null : (from === 'bar' ? 'bar' : Number(from));
    return true;
  }

  function onPointClick(point) {
    if (!interactiveNow) return;
    if (selectedFrom !== null && trySend(selectedFrom, point)) return;
    if (seatAt(point) === mySeatNow && selectSource(point)) {
      paint();
      return;
    }
    api.showToast?.(selectedFrom !== null ? 'Đích đến không hợp lệ cho quân đang chọn.' : 'Quân này không có nước đi hợp lệ.', 'warning');
  }

  function onBarClick(seat) {
    if (!interactiveNow || Number(seat) !== mySeatNow) return;
    if (selectSource('bar')) {
      paint();
      return;
    }
    api.showToast?.('Chưa thể vào bàn từ bar với xúc xắc hiện tại.', 'warning');
  }

  function onTrayClick(seat) {
    if (!interactiveNow || Number(seat) !== mySeatNow) return;
    if (selectedFrom !== null && trySend(selectedFrom, 'off')) return;
    api.showToast?.(selectedFrom !== null ? 'Quân đang chọn chưa thể bear-off.' : 'Chọn quân hợp lệ trước khi bear-off.', 'warning');
  }

  function onDieClick(value) {
    if (!interactiveNow || !diceValues().includes(value)) return;
    selectedDie = selectedDie === value ? null : value;
    paint();
  }

  function paint() {
    const state = view.state || {};
    const points = Array.isArray(state.points) ? state.points : [];
    const dice = diceValues();
    const turnSeat = Number(state.current_seat) || 1;
    const mySeat = Number(view.mySeat) || null;
    const finished = view.status === 'finished' || Boolean(state.result) || Boolean(state.winner_seat) || Boolean(view.winnerSeat);
    const winner = view.winnerSeat ?? state.winner_seat ?? null;
    interactiveNow = Boolean(view.interactive) && !finished;
    mySeatNow = mySeat;
    const myTurn = mySeat !== null && turnSeat === mySeat;

    if (selectedDie !== null && !dice.includes(selectedDie)) selectedDie = null;
    if (selectedFrom !== null && !movesFrom(selectedFrom).length) selectedFrom = null;

    let statusHtml;
    if (finished) {
      if (winner && mySeat) statusHtml = winner === mySeat ? '<strong>Bạn đã thắng!</strong>' : '<strong>Bạn đã thua.</strong>';
      else statusHtml = winner ? `Ghế ${Number(winner)} thắng ván này.` : 'Ván đấu đã kết thúc.';
    } else if (view.status === 'waiting') {
      statusHtml = 'Đang chờ đối thủ vào phòng…';
    } else if (view.role === 'spectator') {
      statusHtml = `Đang xem · lượt ghế ${turnSeat}`;
    } else if (!interactiveNow) {
      statusHtml = myTurn ? 'Đang đồng bộ nước đi…' : `Đang chờ <strong>${esc(opponentLabel())}</strong> đi…`;
    } else if (state.skipped) {
      statusHtml = 'Đối thủ không có nước — bạn được tiếp tục lượt.';
    } else {
      statusHtml = 'Lượt của bạn — chọn quân, rồi chọn đích.';
    }
    els.status.innerHTML = statusHtml;
    els.status.classList.toggle('is-finished', finished);
    els.status.classList.toggle('is-mine', interactiveNow);
    els.board.classList.toggle('is-locked', !interactiveNow);

    for (const [point, button] of pointButtons) {
      const value = Number(points[point - 1] || 0);
      const seat = value > 0 ? 1 : value < 0 ? 2 : 0;
      const count = Math.abs(value);
      const stack = button.querySelector('[data-stack]');
      const stackSig = `${seat}:${count}`;
      if (stack.dataset.sig !== stackSig) {
        stack.dataset.sig = stackSig;
        stack.innerHTML = count ? checkerMarkup(seat, count) : '';
      }
      const badge = button.querySelector('[data-count]');
      const showBadge = count > 5;
      const badgeText = showBadge ? String(count) : '';
      if (badge.textContent !== badgeText) badge.textContent = badgeText;
      badge.hidden = !showBadge;

      const isSource = interactiveNow && seat === mySeat && movesFrom(point).length > 0;
      const isTarget = interactiveNow && selectedFrom !== null && chosenMoves(selectedFrom, point).length > 0;
      const isSelected = selectedFrom !== null && sourceKey(selectedFrom) === String(point);
      button.className = [
        'bkg-point',
        button.dataset.variant === 'bottom' ? 'bkg-point--bottom' : 'bkg-point--top',
        seat === 1 ? 'is-p1' : seat === 2 ? 'is-p2' : 'is-empty',
        isSource ? 'is-source' : '',
        isTarget ? 'is-target' : '',
        isSelected ? 'is-selected' : ''
      ].filter(Boolean).join(' ');
      button.disabled = !interactiveNow;
      const labelParts = [`Điểm ${point}`, count ? `${count} quân ghế ${seat}` : 'trống'];
      if (isSource) labelParts.push(isSelected ? 'đang chọn' : 'có thể chọn');
      if (isTarget) labelParts.push('đích hợp lệ');
      button.setAttribute('aria-label', labelParts.join(', '));
    }

    for (const [seat, zone] of barZones) {
      const count = barCount(seat);
      const stack = zone.querySelector('[data-bar-stack]');
      const stackSig = `bar:${seat}:${count}`;
      if (stack.dataset.sig !== stackSig) {
        stack.dataset.sig = stackSig;
        stack.innerHTML = count ? checkerMarkup(seat, count, 4) : '';
      }
      const badge = zone.querySelector('[data-bar-count]');
      if (badge.textContent !== String(count)) badge.textContent = String(count);
      const mine = Number(seat) === mySeat;
      const isSource = interactiveNow && mine && movesFrom('bar').length > 0;
      const isSelected = selectedFrom === 'bar' && mine;
      zone.className = [
        'bkg-bar-zone',
        seat === 1 ? 'is-p1' : 'is-p2',
        count ? 'has-checkers' : '',
        isSource ? 'is-source' : '',
        isSelected ? 'is-selected' : ''
      ].filter(Boolean).join(' ');
      zone.disabled = !interactiveNow || !mine;
      zone.setAttribute('aria-label', `Quân chờ ghế ${seat}: ${count}`);
    }

    for (const [seat, tray] of trays) {
      const count = offCount(seat);
      const stack = tray.querySelector('[data-tray-stack]');
      const stackSig = `off:${seat}:${count}`;
      if (stack.dataset.sig !== stackSig) {
        stack.dataset.sig = stackSig;
        stack.innerHTML = count ? checkerMarkup(seat, count) : '';
      }
      const badge = tray.querySelector('[data-tray-count]');
      if (badge.textContent !== String(count)) badge.textContent = String(count);
      const mine = Number(seat) === mySeat;
      const isTarget = interactiveNow && selectedFrom !== null && chosenMoves(selectedFrom, 'off').length > 0;
      tray.className = [
        'bkg-tray',
        seat === 1 ? 'bkg-tray--seat1 is-p1' : 'bkg-tray--seat2 is-p2',
        count >= 15 ? 'is-complete' : '',
        isTarget ? 'is-target' : ''
      ].filter(Boolean).join(' ');
      tray.disabled = !interactiveNow || !mine;
      tray.setAttribute('aria-label', `Khay về ghế ${seat}: ${count}/15 quân`);
    }

    paintDice(dice, interactiveNow, myTurn, finished);
  }

  function paintDice(dice, interactive, myTurn, finished) {
    const groups = [];
    for (const value of dice) {
      const found = groups.find((group) => group.value === value);
      if (found) found.count += 1;
      else groups.push({ value, count: 1 });
    }
    els.diceLabel.textContent = finished || view.role === 'spectator' ? 'Xúc xắc' : myTurn ? 'Xúc xắc của bạn' : 'Xúc xắc đối thủ';
    els.dice.classList.toggle('is-opponent', !finished && !myTurn);
    const signature = groups.map((group) => `${group.value}x${group.count}`).join(',');
    if (els.diceList.dataset.sig !== signature) {
      els.diceList.dataset.sig = signature;
      els.diceList.innerHTML = groups.length
        ? groups.map((group) => `<button type="button" class="bkg-die" data-die="${group.value}" aria-label="Xúc xắc ${group.value}${group.count > 1 ? `, còn ${group.count} lượt` : ''}">${dieMarkup(group.value)}${group.count > 1 ? `<span class="bkg-die-count">×${group.count}</span>` : ''}</button>`).join('')
        : '<span class="bkg-dice-empty">—</span>';
      for (const button of els.diceList.querySelectorAll('.bkg-die')) {
        button.addEventListener('click', () => onDieClick(Number(button.dataset.die)));
      }
    }
    for (const button of els.diceList.querySelectorAll('.bkg-die')) {
      const value = Number(button.dataset.die);
      button.disabled = !interactive;
      button.classList.toggle('is-selected', value === selectedDie);
    }
  }

  function update(nextView) {
    view = nextView || {};
    paint();
  }

  return {
    update,
    destroy() { root.innerHTML = ''; }
  };
}

export default { meta, preview, mount };
