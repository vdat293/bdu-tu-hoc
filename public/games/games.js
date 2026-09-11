const GAMES = [
  { id: 'caro', label: 'Cờ caro', icon: '✦', detail: 'Nối 5 ô liên tiếp' },
  { id: 'chess', label: 'Cờ vua', icon: '♞', detail: 'Luật cờ vua quốc tế' },
  { id: 'xiangqi', label: 'Cờ tướng', icon: '帥', detail: 'Bàn cờ 9 × 10' },
  { id: 'go', label: 'Cờ vây', icon: '●', detail: 'Bàn cờ 9 × 9' },
  { id: 'connect4', label: 'Connect 4', icon: '●', detail: 'Nối 4 quân cùng màu' }
];
const GAME_MAP = Object.fromEntries(GAMES.map((game) => [game.id, game]));
const CHESS = { br: '♜', bn: '♞', bb: '♝', bq: '♛', bk: '♚', bp: '♟', wr: '♖', wn: '♘', wb: '♗', wq: '♕', wk: '♔', wp: '♙' };
const XIANGQI = { br: '車', bn: '馬', bb: '象', ba: '士', bk: '將', bc: '砲', bp: '卒', rr: '俥', rn: '傌', rb: '相', ra: '仕', rk: '帥', rc: '炮', rp: '兵' };

const ui = {
  rooms: [],
  filter: 'all',
  room: null,
  moves: [],
  role: 'player', // 'player' | 'spectator'
  socket: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  realtime: 'lobby',
  selected: null,
  challenge: null,
  modal: null,
  toast: '',
  rematchTimer: null,
  rematchRemaining: 0,
  rematchVoted: false,
  hideFinishOverlay: false,
  opponentWantsRematch: false
};

function $(selector) { return document.querySelector(selector); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function session() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const token = storage.getItem('bdu_token');
    if (token) {
      try { return { token, user: JSON.parse(storage.getItem('bdu_user') || '{}') }; } catch { return { token, user: {} }; }
    }
  }
  return null;
}

function authOrRedirect() {
  const current = session();
  if (!current) { render(); return null; }
  return current;
}

function dataValue(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

async function api(path, options = {}) {
  const current = session();
  const headers = new Headers(options.headers || {});
  if (current?.token) headers.set('Authorization', `Bearer ${current.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || payload?.result === false) throw new Error(payload?.message || 'Thao tác không thành công.');
  return dataValue(payload);
}

function gameOf(room) { return GAME_MAP[room?.game_type || room?.game || room?.gameType] || GAMES[0]; }
function roomRef(room) { return room?.room_code || room?.roomCode || room?.id || room?.room_id || ''; }
function roomStatus(room) {
  return room?.status === 'active' ? 'playing' : room?.status === 'finished' ? 'finished' : room?.status === 'expired' ? 'expired' : 'waiting';
}
function statusLabel(status) {
  return status === 'playing' ? 'Đang chơi' : status === 'finished' ? 'Đã kết thúc' : status === 'expired' ? 'Đã hết hạn' : 'Đang chờ đối thủ';
}
function playerName(player, fallback = 'Người chơi') {
  if (!player) return fallback;
  const me = session()?.user;
  if (me && player.mssv && String(player.mssv).toUpperCase() === String(me.mssv || '').toUpperCase()) {
    const myName = me.full_name || me.name || me.ho_ten || me.student_name;
    if (myName && myName.trim()) return myName.trim();
  }
  const name = player.full_name || player.name || player.display_name || player.ho_ten || player.student_name;
  if (name && name.trim() && name.trim() !== player.mssv) return name.trim();
  return player.mssv || fallback;
}
function initials(value) {
  return String(value || 'SV').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}
function dateTime(value) {
  if (!value) return 'chưa đặt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusMeta() {
  if (ui.realtime === 'ready') return ['Đã kết nối realtime', ''];
  if (ui.realtime === 'lobby') return ['Lobby online · realtime bật trong phòng', ''];
  if (ui.realtime === 'reconnecting') return ['Đang kết nối lại…', 'connecting'];
  if (ui.realtime === 'offline') return ['Realtime tạm gián đoạn', 'offline'];
  return ['Đang kết nối realtime…', 'connecting'];
}

function showToast(message) {
  ui.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { ui.toast = ''; render(); }, 3800);
}

function clearRematchCountdown() {
  if (ui.rematchTimer) {
    clearInterval(ui.rematchTimer);
    ui.rematchTimer = null;
  }
  ui.rematchRemaining = 0;
  ui.rematchVoted = false;
  ui.opponentWantsRematch = false;
  ui.hideFinishOverlay = false;
}

function startRematchCountdown(seconds = 10) {
  if (ui.rematchTimer) return;
  ui.rematchRemaining = seconds;
  ui.rematchVoted = false;
  ui.rematchTimer = setInterval(async () => {
    ui.rematchRemaining -= 1;
    if (ui.rematchRemaining <= 0) {
      clearRematchCountdown();
      showToast('Hết 10 giây chờ đánh lại. Phòng đã tự động đóng.');
      if (ui.room && ui.role === 'player') {
        api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/leave`, { method: 'POST' }).catch(() => {});
      }
      ui.room = null;
      ui.challenge = null;
      ui.modal = null;
      ui.realtime = 'lobby';
      if (ui.socket) { try { ui.socket.close(); } catch {} }
      history.pushState({}, '', '/games');
      render();
      loadRooms();
    } else {
      render();
    }
  }, 1000);
}

function pathInfo() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const searchParams = new URLSearchParams(window.location.search);
  const roleParam = searchParams.get('role');
  const spectateParam = searchParams.get('spectate');
  const requestedRole = (roleParam === 'spectator' || spectateParam === '1')
    ? 'spectator'
    : (roleParam === 'player' ? 'player' : 'auto');

  return {
    room: parts[0] === 'games' && parts[1] === 'room' ? parts[2] : '',
    challenge: parts[0] === 'games' && parts[1] === 'challenges' ? parts[2] : '',
    role: requestedRole
  };
}

function roomShareUrls(room) {
  const ref = roomRef(room);
  const base = `${window.location.origin}/games/room/${encodeURIComponent(ref)}`;
  return {
    player: `${base}?role=player`,
    spectator: `${base}?role=spectator`
  };
}

function boardShape(gameId) {
  if (gameId === 'connect4') return [6, 7];
  if (gameId === 'xiangqi') return [10, 9];
  if (gameId === 'go') return [9, 9];
  if (gameId === 'chess') return [8, 8];
  return [15, 15];
}

function roomState(room) { return room?.state || room?.game_state || {}; }
function normalizedBoard(room) {
  const game = gameOf(room);
  const state = roomState(room);
  let board = state.board || state.cells || [];
  if (game.id === 'caro' && Array.isArray(board) && !Array.isArray(board[0]) && board.length === 9) board = [];
  if (!Array.isArray(board) || !Array.isArray(board[0])) {
    const [rows, columns] = boardShape(game.id);
    return Array.from({ length: rows }, () => Array(columns).fill(null));
  }
  return board;
}

function piece(pieceCode, gameId) {
  if (pieceCode === null || pieceCode === undefined || pieceCode === '') return '';
  if (gameId === 'chess') return CHESS[pieceCode] || String(pieceCode);
  if (gameId === 'xiangqi') return XIANGQI[pieceCode] || String(pieceCode);
  if (gameId === 'go') return Number(pieceCode) === 1 ? '●' : Number(pieceCode) === 2 ? '○' : '';
  if (gameId === 'caro') return Number(pieceCode) === 1 ? '✕' : Number(pieceCode) === 2 ? '○' : String(pieceCode);
  if (gameId === 'connect4') return Number(pieceCode) === 1 ? '●' : Number(pieceCode) === 2 ? '●' : String(pieceCode);
  return String(pieceCode);
}

function currentUserIsPlayer(room) {
  const mssv = String(session()?.user?.mssv || '').toUpperCase();
  if (!mssv) return null;
  return (room?.players || []).find((player) => String(player.mssv || '').toUpperCase() === mssv) || null;
}

function renderBoard(room) {
  const game = gameOf(room);
  const state = roomState(room);
  const board = normalizedBoard(room);
  const [rows, columns] = boardShape(game.id);
  const currentSeat = Number(state.current_seat || state.turn || 0);
  const me = currentUserIsPlayer(room);
  const isSpectator = ui.role === 'spectator' || !me;
  const winnerSeat = Number(state.winner_seat || room.winner_seat || 0);
  const isFinished = roomStatus(room) === 'finished' || Boolean(state.result);
  const canPlay = !isSpectator && !isFinished && me && currentSeat === Number(me.seat);
  const lastMove = ui.moves.at(-1)?.move || ui.moves.at(-1)?.payload || null;
  const winningCells = state.winning_cells || [];
  const isWinningCell = (r, c) => winningCells.some(([wr, wc]) => wr === r && wc === c);

  const cells = board.slice(0, rows).map((line, row) => Array.from({ length: columns }, (_, column) => {
    const value = line?.[column];
    const isSelected = ui.selected?.row === row && ui.selected?.column === column;
    const isLastMove = game.id === 'connect4'
      ? Number(lastMove?.column) === column
      : (
          (Number(lastMove?.row) === row && Number(lastMove?.column) === column) ||
          (Number(lastMove?.to?.row) === row && Number(lastMove?.to?.column) === column)
        );
    const isWin = isWinningCell(row, column);
    const isStar = (game.id === 'caro' && [3, 7, 11].includes(row) && [3, 7, 11].includes(column)) || (game.id === 'go' && [2, 6].includes(row) && [2, 6].includes(column));

    // Dark checkered cell ONLY for chess
    const isCheckeredDark = game.id === 'chess' && ((row + column) % 2 === 1);

    // Piece color classification
    let pieceColorClass = '';
    if (value) {
      if (typeof value === 'string') {
        if (value.startsWith('r')) pieceColorClass = 'piece-red';
        else if (value.startsWith('b')) pieceColorClass = 'piece-black';
        else if (value.startsWith('w')) pieceColorClass = 'piece-white';
      } else if (Number(value) === 1) {
        pieceColorClass = 'one';
      } else if (Number(value) === 2) {
        pieceColorClass = 'two';
      }
    }

    // Special Xiangqi markings (river, palace diagonals, watermarks)
    let xqClass = '';
    let xqContent = '';
    if (game.id === 'xiangqi') {
      if (row === 4) xqClass += ' xq-river-top';
      if (row === 5) xqClass += ' xq-river-bottom';

      if (row >= 0 && row <= 2 && column >= 3 && column <= 5) {
        xqClass += ' xq-palace xq-palace-top';
      } else if (row >= 7 && row <= 9 && column >= 3 && column <= 5) {
        xqClass += ' xq-palace xq-palace-bottom';
      }

      if ((row === 0 || row === 7) && column === 3) xqClass += ' xq-diag-se';
      else if ((row === 0 || row === 7) && column === 5) xqClass += ' xq-diag-sw';
      else if ((row === 1 || row === 8) && column === 4) xqClass += ' xq-diag-cross';
      else if ((row === 2 || row === 9) && column === 3) xqClass += ' xq-diag-ne';
      else if ((row === 2 || row === 9) && column === 5) xqClass += ' xq-diag-nw';

      // Traditional River Calligraphy on row 4 / 5
      if (!value) {
        if (row === 4 && column === 2) xqContent = '<span class="xq-river-text">楚河</span>';
        else if (row === 5 && column === 6) xqContent = '<span class="xq-river-text">漢界</span>';
      }
    }

    return `<button class="cell ${isCheckeredDark ? 'dark' : ''} ${isSelected ? 'selected' : ''} ${isLastMove ? 'last-move' : ''} ${isWin ? 'winning-cell' : ''} ${isStar && !value ? 'star-point' : ''} ${pieceColorClass} ${xqClass}" ${canPlay ? '' : 'disabled'} data-row="${row}" data-column="${column}" aria-label="${escapeHtml(game.label)}, hàng ${row + 1}, cột ${column + 1}${value ? `, quân ${escapeHtml(piece(value, game.id))}` : ', ô trống'}">${xqContent}<span class="piece">${escapeHtml(piece(value, game.id))}</span></button>`;
  }).join('')).join('');

  const [label] = statusMeta();
  const colLabels = Array.from({ length: columns }, (_, index) => index + 1).map((value) => `<span>${value}</span>`).join('');
  const rowLabels = Array.from({ length: rows }, (_, index) => `<span>${index + 1}</span>`).join('');

  const winnerPlayer = winnerSeat ? (room?.players || []).find((p) => Number(p.seat) === winnerSeat) : null;
  const winnerName = winnerPlayer ? playerName(winnerPlayer, `Bàn ${winnerSeat}`) : (winnerSeat ? `Bàn ${winnerSeat}` : '');
  const currentPlayer = currentSeat ? (room?.players || []).find((p) => Number(p.seat) === currentSeat) : null;
  const currentTurnPlayerName = currentPlayer ? playerName(currentPlayer, `Bàn ${currentSeat}`) : (currentSeat ? `Bàn ${currentSeat}` : '');

  const statusNotice = isFinished
    ? (isSpectator
        ? (winnerSeat ? `🏆 ${escapeHtml(winnerName)} đã chiến thắng!` : 'Ván cờ kết thúc với kết quả Hòa!')
        : (winnerSeat === Number(me?.seat)
            ? '🎉 CHÚC MỪNG BẠN ĐÃ CHIẾN THẮNG!'
            : (winnerSeat ? `Bạn đã thua trận trước ${escapeHtml(winnerName)}.` : 'Ván cờ kết thúc với kết quả Hòa!')))
    : isSpectator
      ? 'Chế độ khán giả · chỉ xem trực tiếp'
      : canPlay
        ? 'Chạm ô để đi quân'
        : roomStatus(room) === 'waiting'
          ? 'Chờ đối thủ vào phòng'
          : `Đang chờ lượt của ${escapeHtml(currentTurnPlayerName)}`;

  return `
    ${isSpectator ? `
      <div class="spectator-banner">
        <span class="spectator-badge">👁️ BẠN ĐANG Ở CHẾ ĐỘ KHÁN GIẢ</span>
        <span>Theo dõi ván đấu realtime · Bàn cờ ở chế độ chỉ đọc</span>
      </div>
    ` : ''}
    <div class="board-toolbar ${isFinished ? 'board-toolbar--finished' : ''}">
      <span class="turn-dot ${isFinished ? 'finished' : ''}"></span>
      <span class="turn">${isFinished ? (winnerSeat ? `🏆 Thắng cuộc: ${escapeHtml(winnerName)}` : '🏆 Ván cờ hòa') : (currentSeat ? `Lượt đi: ${escapeHtml(currentTurnPlayerName)}` : label)}</span>
      <span class="spacer"></span>
      <strong class="turn-status-text ${isFinished ? (winnerSeat === Number(me?.seat) ? 'status-won' : 'status-lost') : ''}">${statusNotice}</strong>
    </div>
    <div class="board-stage-wrapper">
      <div class="board-stage board-stage--${game.id}" style="--columns:${columns};--rows:${rows}">
        <div class="board-corner"></div>
        <div class="board-coordinates board-coordinates--top">${colLabels}</div>
        <div class="board-coordinates board-coordinates--side">${rowLabels}</div>
        <div class="board ${game.id}" role="grid">${cells}</div>
      </div>
      ${isFinished ? renderBoardFinishOverlay(room, winnerSeat, winnerPlayer, winnerName, me, isSpectator) : ''}
    </div>
    <p class="board-note">Nước đi được máy chủ kiểm tra và xác nhận trước khi phát tới mọi người.</p>
  `;
}

function renderBoardFinishOverlay(room, winnerSeat, winnerPlayer, winnerName, me, isSpectator) {
  const game = gameOf(room);
  const state = roomState(room);
  const players = roomPlayers(room);
  const p1 = (players || []).find((p) => Number(p.seat) === 1);
  const p2 = (players || []).find((p) => Number(p.seat) === 2);
  const p1Name = playerName(p1, 'Bàn 1 (Chủ phòng)');
  const p2Name = playerName(p2, 'Bàn 2 (Đối thủ)');
  const isP1Winner = winnerSeat === 1;
  const isP2Winner = winnerSeat === 2;
  const isDraw = !winnerSeat;

  const isMeWinner = me && winnerSeat === Number(me.seat);
  const isMeLoser = me && winnerSeat && winnerSeat !== Number(me.seat);

  const trophyIcon = isMeWinner ? '🏆' : isMeLoser ? '⚔️' : isDraw ? '🤝' : '👑';

  // Minimized floating bar docked at bottom-center of board
  if (ui.hideFinishOverlay) {
    return `
      <div class="board-finish-minimized pg-minimized-bar">
        <span class="minimized-badge">${trophyIcon} ${winnerSeat ? `🏆 ${escapeHtml(winnerName)} Thắng` : '🤝 Ván hòa'}</span>
        <span class="pg-mini-countdown">⏳ ${ui.rematchRemaining > 0 ? ui.rematchRemaining : 0}s</span>
        ${!isSpectator ? `
          <button type="button" class="button button-primary button-xs ${ui.rematchVoted ? 'disabled' : ''}" data-action="request-rematch" ${ui.rematchVoted ? 'disabled' : ''}>
            ${ui.rematchVoted ? '✓ Đã sẵn sàng (1/2)' : (ui.opponentWantsRematch ? '🔥 Chơi lại!' : '⚔️ Chơi lại')}
          </button>
        ` : ''}
        <button type="button" class="button button-secondary button-xs" data-action="toggle-finish-overlay">📊 Mở kết quả ↗</button>
      </div>
    `;
  }

  // Outcome headline and detail subline
  let headline = '';
  if (isSpectator) {
    headline = winnerSeat ? `🏆 ${escapeHtml(winnerName)} CHIẾN THẮNG!` : '🤝 VÁN CỜ HÒA!';
  } else if (isMeWinner) {
    headline = '🎉 CHIẾN THẮNG!';
  } else if (isMeLoser) {
    headline = 'THẤT BẠI';
  } else {
    headline = 'VÁN CỜ HÒA';
  }

  let subline = '';
  if (state.resigned_seat) {
    const resignedPlayer = (players || []).find((p) => Number(p.seat) === Number(state.resigned_seat));
    const resignedName = resignedPlayer ? playerName(resignedPlayer, `Bàn ${state.resigned_seat}`) : `Bàn ${state.resigned_seat}`;
    subline = `${escapeHtml(resignedName)} đã đầu hàng ván đấu.`;
  } else if (game.id === 'caro' && winnerSeat) {
    subline = 'Đã tạo thành công chuỗi 5 quân cờ liên tiếp!';
  } else if (state.score_detail) {
    subline = state.score_detail;
  } else if (winnerSeat) {
    subline = `Người chơi ${escapeHtml(winnerName)} đã xuất sắc giành chiến thắng.`;
  } else {
    subline = 'Trận đấu kết thúc với kết quả bất phân thắng bại.';
  }

  // Piece descriptors per game
  let p1PieceTag = 'Bàn 1 (Chủ phòng)';
  let p2PieceTag = 'Bàn 2 (Đối thủ)';
  if (game.id === 'caro') {
    p1PieceTag = 'Quân X · Bàn 1';
    p2PieceTag = 'Quân O · Bàn 2';
  } else if (game.id === 'chess') {
    p1PieceTag = 'Quân Trắng (♔) · Bàn 1';
    p2PieceTag = 'Quân Đen (♚) · Bàn 2';
  } else if (game.id === 'xiangqi') {
    p1PieceTag = 'Quân Đỏ (帥) · Bàn 1';
    p2PieceTag = 'Quân Đen (將) · Bàn 2';
  } else if (game.id === 'go') {
    p1PieceTag = 'Quân Đen (●) · Bàn 1';
    p2PieceTag = 'Quân Trắng (○) · Bàn 2';
  } else if (game.id === 'connect4') {
    p1PieceTag = 'Quân Xanh · Bàn 1';
    p2PieceTag = 'Quân Đỏ · Bàn 2';
  }

  return `
    <div class="board-finish-overlay pg-finish-overlay ${isMeWinner ? 'won' : isMeLoser ? 'lost' : 'draw'}">
      <div class="board-finish-card pg-modal">
        <button type="button" class="pg-modal-close" data-action="toggle-finish-overlay" aria-label="Xem lại bàn cờ" title="Xem lại bàn cờ">×</button>

        <div class="board-finish-icon pg-trophy-icon">${trophyIcon}</div>
        <h2 class="board-finish-headline pg-headline">${headline}</h2>
        <p class="board-finish-subline pg-subline">${escapeHtml(subline)}</p>

        <!-- PaperGames Dual Matchup Cards -->
        <div class="pg-matchup">
          <div class="pg-player-card ${isP1Winner ? 'winner' : (isP2Winner ? 'loser' : 'draw')}">
            <div class="pg-avatar-wrapper">
              ${isP1Winner ? '<span class="pg-crown">👑</span>' : ''}
              <span class="pg-avatar p1-color">${initials(p1Name)}</span>
            </div>
            <strong class="pg-player-name" title="${escapeHtml(p1Name)}">${escapeHtml(p1Name)}</strong>
            <span class="pg-player-role">${escapeHtml(p1PieceTag)}</span>
            <span class="pg-result-badge ${isP1Winner ? 'win' : (isP2Winner ? 'loss' : 'draw')}">
              ${isP1Winner ? 'THẮNG' : (isP2Winner ? 'THUA' : 'HÒA')}
            </span>
          </div>

          <div class="pg-vs-box">
            <span class="pg-vs-badge">VS</span>
            <span class="pg-game-label">${escapeHtml(game.label)}</span>
          </div>

          <div class="pg-player-card ${isP2Winner ? 'winner' : (isP1Winner ? 'loser' : 'draw')}">
            <div class="pg-avatar-wrapper">
              ${isP2Winner ? '<span class="pg-crown">👑</span>' : ''}
              <span class="pg-avatar p2-color">${initials(p2Name)}</span>
            </div>
            <strong class="pg-player-name" title="${escapeHtml(p2Name)}">${escapeHtml(p2Name)}</strong>
            <span class="pg-player-role">${escapeHtml(p2PieceTag)}</span>
            <span class="pg-result-badge ${isP2Winner ? 'win' : (isP1Winner ? 'loss' : 'draw')}">
              ${isP2Winner ? 'THẮNG' : (isP1Winner ? 'THUA' : 'HÒA')}
            </span>
          </div>
        </div>

        ${winnerSeat ? `
          <div class="board-finish-winner-pill pg-winner-summary">
            <span class="board-finish-avatar">${initials(winnerName)}</span>
            <div class="board-finish-winner-info">
              <strong class="board-finish-winner-name">${escapeHtml(winnerName)}</strong>
              <span class="board-finish-winner-badge">🏆 Quán quân trận đấu · Bàn ${winnerSeat}${winnerPlayer?.mssv && winnerPlayer.mssv !== winnerName ? ` (${escapeHtml(winnerPlayer.mssv)})` : ''}</span>
            </div>
          </div>
        ` : ''}

        <!-- Rematch & Countdown Section directly inside modal -->
        <div class="pg-rematch-container">
          <div class="pg-countdown-strip">
            <span class="pg-countdown-pulse"></span>
            <span>Tự động rời phòng sau: <strong class="rematch-timer-num">${ui.rematchRemaining > 0 ? ui.rematchRemaining : 0}s</strong></span>
          </div>

          <div class="pg-rematch-status-text ${ui.opponentWantsRematch && !ui.rematchVoted ? 'highlight-fire' : ''}">
            ${isSpectator
              ? '👁️ Bạn đang xem trực tiếp. Đang chờ hai đấu thủ quyết định chơi lại...'
              : (ui.opponentWantsRematch && !ui.rematchVoted)
                ? '🔥 <strong>Đối thủ muốn chơi lại!</strong> Bấm "Chơi lại ngay" để vào ván mới!'
                : ui.rematchVoted
                  ? '⏳ <strong>Bạn đã sẵn sàng (1/2)!</strong> Đang chờ đối thủ đồng ý...'
                  : 'Bạn có muốn phục thù hoặc đấu thêm ván nữa không?'}
          </div>

          <div class="board-finish-actions rematch-actions pg-buttons-group">
            ${!isSpectator ? `
              <button type="button" class="button button-primary pg-btn-rematch ${ui.rematchVoted ? 'voted disabled' : (ui.opponentWantsRematch ? 'pulse-fire' : '')}" data-action="request-rematch" ${ui.rematchVoted ? 'disabled' : ''}>
                ${ui.rematchVoted ? '✓ Đã sẵn sàng (1/2)' : (ui.opponentWantsRematch ? '🔥 Chấp nhận chơi lại ngay!' : '⚔️ Chơi lại')}
              </button>
            ` : ''}
            <button type="button" class="button button-secondary pg-btn-inspect" data-action="toggle-finish-overlay">
              👁️ Xem lại bàn cờ
            </button>
            <button type="button" class="button button-danger-light pg-btn-leave" data-action="leave-room">
              🚪 Rời phòng
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWaitingOpponent(room) {
  const game = gameOf(room);
  const ref = roomRef(room);
  const urls = roomShareUrls(room);
  const isPrivate = room.visibility === 'private' || room.allow_spectators === false;
  const isSpectator = ui.role === 'spectator';

  return `
    <div class="waiting-stage">
      <div class="waiting-radar">
        <div class="waiting-pulse"></div>
        <div class="waiting-spinner"></div>
        <span class="waiting-icon">${game.icon}</span>
      </div>
      <div class="waiting-title">
        <span class="waiting-badge-live"><i class="dot-blink"></i> ĐANG CHỜ ĐỐI THỦ</span>
        <h2>Đang chờ đối thủ vào phòng...</h2>
        <p class="waiting-desc">Bàn cờ sẽ tự động xuất hiện ngay khi đối thủ tham gia trận đấu. Chia sẻ link bên dưới để mời bạn bè.</p>
      </div>

      <div class="waiting-tags">
        <span class="meta-tag">Mã phòng: <strong>#${escapeHtml(ref)}</strong></span>
        <span class="meta-tag">Môn: <strong>${escapeHtml(game.label)}</strong></span>
        <span class="meta-tag ${isPrivate ? 'meta-tag-private' : 'meta-tag-public'}">
          ${isPrivate ? '🔒 Đánh riêng tư (Khóa khán giả)' : '🌐 Phòng công khai'}
        </span>
      </div>

      <div class="waiting-links">
        <div class="share-box share-box--player">
          <div class="share-box-content">
            <div class="share-box-header">
              <span class="share-icon">⚔️</span>
              <div>
                <strong>Link mời Đối thủ (Vào đánh trực tiếp)</strong>
                <small>Gửi link này cho bạn bè để ngồi vào ghế đối thủ và bắt đầu ván cờ</small>
              </div>
            </div>
            <div class="share-url-row">
              <input type="text" readonly value="${escapeHtml(urls.player)}" class="share-url-input" />
              <button class="button button-primary" data-action="copy-opponent-link" data-url="${escapeHtml(urls.player)}">
                Sao chép link đối thủ
              </button>
            </div>
          </div>
        </div>

        ${!isPrivate ? `
          <div class="share-box share-box--spectator">
            <div class="share-box-content">
              <div class="share-box-header">
                <span class="share-icon">👁️</span>
                <div>
                  <strong>Link mời Khán giả (Chỉ xem)</strong>
                  <small>Gửi link này cho bạn bè muốn theo dõi trực tiếp, không thể đánh cờ</small>
                </div>
              </div>
              <div class="share-url-row">
                <input type="text" readonly value="${escapeHtml(urls.spectator)}" class="share-url-input" />
                <button class="button button-secondary" data-action="copy-spectator-link" data-url="${escapeHtml(urls.spectator)}">
                  Sao chép link khán giả
                </button>
              </div>
            </div>
          </div>
        ` : `
          <div class="share-box share-box--locked">
            <span class="share-icon">🔒</span>
            <div>
              <strong>Chế độ riêng tư được kích hoạt</strong>
              <small>Phòng này không cho phép khán giả theo dõi. Chỉ đối thủ có link vào đánh mới truy cập được.</small>
            </div>
          </div>
        `}
      </div>

      ${!isSpectator ? `
        <div class="waiting-extra-actions">
          <button class="button button-secondary" data-action="open-challenge">
            📣 Đăng thách đấu lên Confession
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function roomPlayers(room) { return Array.isArray(room?.players) ? room.players : []; }
function renderStatusBar() {
  const [label, tone] = statusMeta();
  return `<div class="status-bar"><span class="status ${tone}"><i></i>${label}</span><span class="divider"></span><span>${ui.rooms.length} phòng đang hiển thị</span><span class="spacer"></span><span>VPS lưu snapshot & lịch sử nước đi</span></div>`;
}

function roomCard(room) {
  const game = gameOf(room);
  const status = roomStatus(room);
  const count = Number(room.player_count ?? room.players?.length ?? 0);
  const spectators = Number(room.spectator_count || 0);
  const ref = roomRef(room);
  const isPrivate = room.visibility === 'private' || room.allow_spectators === false;

  const actionButtons = status === 'waiting'
    ? `
      <div class="room-card-actions">
        <button class="btn-card-play" data-action="open-room" data-room="${escapeHtml(ref)}" data-role="player">⚔️ Thách đấu</button>
        ${!isPrivate ? `<button class="btn-card-watch" data-action="open-room" data-room="${escapeHtml(ref)}" data-role="spectator">👁️ Xem</button>` : ''}
      </div>
    `
    : `
      <div class="room-card-actions">
        <button class="btn-card-watch" data-action="open-room" data-room="${escapeHtml(ref)}" data-role="spectator">👁️ Xem trực tiếp →</button>
      </div>
    `;

  return `
    <article class="room-card">
      <div class="room-card-top">
        <span>${game.icon}</span>
        <span>${game.label.toUpperCase()}</span>
        <span class="room-pill ${isPrivate ? 'pill-private' : 'pill-public'}">
          ${isPrivate ? '🔒 Riêng tư' : '🌐 Công khai'}
        </span>
        <span class="room-status ${status}"><i></i>${statusLabel(status)}</span>
      </div>
      <div class="room-card-body">
        <div class="room-title">
          <h3>${escapeHtml(room.name || `Phòng ${game.label}`)}</h3>
          <span class="room-code">#${escapeHtml(ref)}</span>
        </div>
        <p class="room-desc">${escapeHtml(game.detail)}${spectators ? ` · ${spectators} đang xem` : ''}</p>
        <div class="room-footer">
          <span>${count}/2 người chơi</span>
          ${actionButtons}
        </div>
      </div>
    </article>
  `;
}

function lobbyHtml() {
  const current = session();
  if (!current) {
    return `
      <div class="login-gate">
        <span class="eyebrow">BDU GAME LOUNGE</span>
        <h1>Đăng nhập để chơi</h1>
        <p>Phòng chơi online dùng chính phiên BDU của bạn để ghi nhận người chơi và bảo vệ nước đi.</p>
        <a class="button button-primary" href="/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}">Đăng nhập BDU ↗</a>
      </div>
    `;
  }
  const filtered = ui.rooms.filter((room) => ui.filter === 'all' || gameOf(room).id === ui.filter);
  return `
    <header class="hero">
      <div>
        <span class="eyebrow">BDU GAME LOUNGE · SITE RIÊNG · ONLINE</span>
        <h1>Chơi một ván,<br /><em>gặp một người.</em></h1>
        <p>Phòng board game realtime dành cho sinh viên BDU. Mở trận, gửi lời thách đấu và xem từng nước đi được máy chủ xác nhận.</p>
        <div class="hero-actions">
          <button class="button button-primary" data-action="open-create">Mở phòng chơi ↗</button>
          <button class="button button-secondary" data-action="focus-join">Nhập mã phòng <span>⌘J</span></button>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-shape one"></div>
        <div class="hero-shape two"></div>
        <div class="hero-tile back"><span>ROUND 02</span><strong>SYNC</strong><small>SERVER SIDE</small></div>
        <div class="hero-tile front"><span>05 GAMES</span><strong>PLAY</strong><small>YOUR MOVE</small></div>
        <span class="hero-spark">+</span>
        <span class="hero-spark bottom">○</span>
      </div>
    </header>
    ${renderStatusBar()}
    <div class="toolbar">
      <div>
        <span class="eyebrow">OPEN ROOMS</span>
        <h2>Chọn một phòng</h2>
      </div>
      <div class="toolbar-actions">
        <form class="join-form" id="join-form">
          <span>↗</span>
          <input id="join-input" placeholder="Nhập ID hoặc dán link phòng" aria-label="ID hoặc link phòng" />
          <button type="submit">Vào phòng</button>
        </form>
        <button class="button button-secondary" data-action="open-create">+ Tạo phòng</button>
      </div>
    </div>
    <div class="filters" role="tablist" aria-label="Lọc game">
      <button class="filter ${ui.filter === 'all' ? 'active' : ''}" data-filter="all">Tất cả <span>${ui.rooms.length}</span></button>
      ${GAMES.map((game) => `<button class="filter ${ui.filter === game.id ? 'active' : ''}" data-filter="${game.id}">${game.icon} ${game.label}</button>`).join('')}
    </div>
    ${ui.loadError ? `
      <div class="error">
        <h3>Chưa tải được phòng chơi</h3>
        <p>${escapeHtml(ui.loadError)}</p>
        <button class="button button-secondary" data-action="reload-rooms">Thử lại</button>
      </div>
    ` : filtered.length ? `
      <div class="room-grid">${filtered.map(roomCard).join('')}</div>
    ` : `
      <div class="empty">
        <div class="empty-mark">✦</div>
        <h3>Chưa có phòng đang mở</h3>
        <p>Tạo phòng đầu tiên, sau đó chia sẻ link mời cho đối thủ.</p>
        <button class="button button-primary" data-action="open-create">Tạo phòng đầu tiên ↗</button>
      </div>
    `}
    <section class="catalog">
      <div class="section-head">
        <span class="eyebrow">THE BOARD COLLECTION</span>
        <h2>Chọn môn cờ bạn muốn chơi</h2>
      </div>
      <div class="catalog-grid">
        ${GAMES.map((game) => `<button class="catalog-card ${ui.filter === game.id ? 'selected' : ''}" data-filter="${game.id}"><b>${game.icon}</b><strong>${game.label}</strong><small>${game.detail}</small></button>`).join('')}
      </div>
    </section>
    <section class="how">
      <div>
        <span class="eyebrow">BUILT FOR LIVE PLAY</span>
        <h2>Một phòng.<br />Một nguồn sự thật.</h2>
      </div>
      <div class="how-grid">
        <article><span>01</span><strong>Máy chủ quyết định</strong><p>Nước đi được kiểm tra, khóa và lưu trên PostgreSQL trước khi phát tới tất cả người xem.</p></article>
        <article><span>02</span><strong>Reconnect an toàn</strong><p>Mất mạng không làm mất lượt. Kết nối lại sẽ lấy snapshot mới nhất.</p></article>
        <article><span>03</span><strong>Xem không bỏ sót</strong><p>Khán giả vào trễ vẫn thấy đúng bàn cờ hiện tại, không chỉ event mới.</p></article>
      </div>
    </section>
  `;
}

function renderRoom() {
  const room = ui.room;
  const game = gameOf(room);
  const state = roomState(room);
  const status = roomStatus(room);
  const players = roomPlayers(room);
  const isWaitingOpponent = status === 'waiting' || players.length < 2;
  const isPrivate = room.visibility === 'private' || room.allow_spectators === false;
  const urls = roomShareUrls(room);
  const winnerSeat = Number(state.winner_seat || room.winner_seat || 0);
  const isFinished = status === 'finished' || Boolean(state.result);

  if (isFinished && !ui.rematchTimer) {
    startRematchCountdown(10);
  }

  const winnerPlayer = winnerSeat ? (players || []).find((p) => Number(p.seat) === winnerSeat) : null;
  const winnerName = winnerPlayer ? playerName(winnerPlayer, `Bàn ${winnerSeat}`) : `Bàn ${winnerSeat}`;
  const resignNote = state.resigned_seat ? ' (đối thủ đầu hàng)' : '';
  const scoreNote = state.score_detail ? ` · ${state.score_detail}` : '';

  const result = state.result
    ? (winnerSeat ? `${winnerName} chiến thắng!${resignNote}${scoreNote}` : state.result === 'expired' ? 'Phòng đã hết hạn' : `Ván đấu hòa${scoreNote}`)
    : status === 'playing'
      ? 'Trận đấu đang diễn ra'
      : status === 'expired'
        ? 'Phòng đã hết hạn'
        : status === 'finished'
          ? 'Trận đấu đã kết thúc'
          : 'Đang chờ đối thủ vào phòng';

  const moves = ui.moves.length ? ui.moves : (Array.isArray(state.moves) ? state.moves : []);

  return `
    <div class="room-page">
      <button class="back-link" data-action="back-lobby">← Về lobby</button>
      <header class="room-head">
        <div>
          <span class="eyebrow">${game.label.toUpperCase()} · PHÒNG #${escapeHtml(roomRef(room))} · ${isPrivate ? '🔒 RIÊNG TƯ' : '🌐 CÔNG KHAI'}</span>
          <h1>${escapeHtml(room.name || `Phòng ${game.label}`)}</h1>
          <p>Mã phòng <strong>${escapeHtml(roomRef(room))}</strong> · ${ui.role === 'spectator' ? '👁️ Bạn đang xem realtime (Khán giả)' : '⚔️ Bạn đang tham gia ván đấu (Đấu thủ)'} · hết hạn ${dateTime(room.expires_at)}</p>
        </div>
        <div class="room-head-actions">
          <button class="button button-primary" data-action="copy-opponent-link" data-url="${escapeHtml(urls.player)}">⚔️ Link đối thủ</button>
          ${!isPrivate ? `<button class="button button-secondary" data-action="copy-spectator-link" data-url="${escapeHtml(urls.spectator)}">👁️ Link khán giả</button>` : ''}
          ${ui.role !== 'spectator' && status === 'waiting' ? '<button class="button button-secondary" data-action="open-challenge">Mời thách đấu</button>' : ''}
          ${!isFinished && ui.role === 'player' && status === 'playing' ? '<button class="button button-secondary button-resign" data-action="resign">🏳️ Đầu hàng</button>' : ''}
          <button class="button button-danger" data-action="back-lobby">Rời phòng</button>
        </div>
      </header>

      <div class="room-layout">
        <main class="board-panel">
          <div class="room-top-bar">
            <span>Chế độ: 2 người chơi · ${ui.role === 'spectator' ? 'Khán giả xem trực tiếp' : 'Ván online'}</span>
            <span>Nước đi: ${state.move_number || moves.length || 0}</span>
          </div>
          ${(() => {
            const seat1Player = (players || []).find((p) => Number(p.seat) === 1);
            const seat1Name = playerName(seat1Player, 'Bàn 1');
            const seat1Sub = seat1Player?.mssv && seat1Player.mssv !== seat1Name ? `${seat1Player.mssv} · ` : '';
            return `
              <div class="seat ${winnerSeat === 1 ? 'seat-winner' : (isFinished && winnerSeat === 2 ? 'seat-loser' : '')}">
                <div class="seat-info">
                  <span class="seat-avatar">${initials(seat1Name)}</span>
                  <span>
                    <strong>${escapeHtml(seat1Name)}</strong>
                    <small>${escapeHtml(seat1Sub)}Bàn 1 (Chủ phòng) · ${isFinished ? (winnerSeat === 1 ? '👑 Chiến thắng' : winnerSeat === 2 ? 'Thua cuộc' : 'Hòa ván') : (state.current_seat === 1 ? 'đang đi' : 'đã chờ')}</small>
                  </span>
                </div>
                <span class="seat-score ${winnerSeat === 1 ? 'win' : (isFinished && winnerSeat === 2 ? 'loss' : (isFinished ? 'draw' : ''))}">
                  ${winnerSeat === 1 ? 'THẮNG' : (isFinished && winnerSeat === 2 ? 'THUA' : (isFinished ? 'HÒA' : '—'))}
                </span>
              </div>
            `;
          })()}

          ${isWaitingOpponent ? renderWaitingOpponent(room) : renderBoard(room)}

          ${(() => {
            const seat2Player = (players || []).find((p) => Number(p.seat) === 2);
            const seat2Name = playerName(seat2Player, status === 'waiting' ? 'Đang chờ đối thủ...' : 'Bàn 2');
            const seat2Sub = seat2Player?.mssv && seat2Player.mssv !== seat2Name ? `${seat2Player.mssv} · ` : '';
            return `
              <div class="seat ${winnerSeat === 2 ? 'seat-winner' : (isFinished && winnerSeat === 1 ? 'seat-loser' : '')}">
                <div class="seat-info">
                  <span class="seat-avatar alt">${initials(seat2Name)}</span>
                  <span>
                    <strong>${escapeHtml(seat2Name)}</strong>
                    <small>${escapeHtml(seat2Sub)}Bàn 2 (Đối thủ) · ${isFinished ? (winnerSeat === 2 ? '👑 Chiến thắng' : winnerSeat === 1 ? 'Thua cuộc' : 'Hòa ván') : (state.current_seat === 2 ? 'đang đi' : 'đã chờ')}</small>
                  </span>
                </div>
                <span class="seat-score ${winnerSeat === 2 ? 'win' : (isFinished && winnerSeat === 1 ? 'loss' : (isFinished ? 'draw' : ''))}">
                  ${winnerSeat === 2 ? 'THẮNG' : (isFinished && winnerSeat === 1 ? 'THUA' : (isFinished ? 'HÒA' : '—'))}
                </span>
              </div>
            `;
          })()}

          ${game.id === 'go' && ui.role === 'player' && status === 'playing' ? '<button class="button button-secondary board-pass" data-action="pass-go">Bỏ lượt (cờ vây)</button>' : ''}
        </main>

        <aside class="side-panel">
          <section class="side-card dark">
            <span class="eyebrow">MATCH STATUS</span>
            <h2>${result}</h2>
            <p>${ui.role === 'spectator' ? 'Bạn đang ở chế độ khán giả. Mọi người trong phòng đều thấy cùng một snapshot.' : 'Mỗi nước đi được máy chủ kiểm tra rồi phát tới người chơi và khán giả.'}</p>
          </section>
          <section class="side-card">
            <div class="section-head">
              <h2>Trong phòng</h2>
              <span>${players.length}/2 người chơi</span>
            </div>
            <ul class="player-list">
              ${players.map((player) => {
                const name = playerName(player);
                const sub = player.mssv && player.mssv !== name ? `${player.mssv} · ` : '';
                return `
                  <li>
                    <span class="seat-avatar ${Number(player.seat) === 2 ? 'alt' : ''}">${initials(name)}</span>
                    <span>
                      <strong>${escapeHtml(name)}</strong>
                      <small>${escapeHtml(sub)}Bàn ${player.seat} ${Number(player.seat) === 1 ? '(Chủ phòng)' : '(Đối thủ)'}</small>
                    </span>
                    <i class="dot"></i>
                  </li>
                `;
              }).join('') || '<li>Đang chờ snapshot người chơi.</li>'}
            </ul>
          </section>
          <section class="side-card">
            <div class="section-head">
              <h2>Lịch sử nước đi</h2>
              <span>${state.move_number || moves.length || 0}</span>
            </div>
            <div class="moves">
              ${moves.slice(-10).map((move, index) => `
                <div>
                  <span>${String(index + 1).padStart(2, '0')}</span>
                  <strong>${escapeHtml(move.notation || move.label || JSON.stringify(move.move || move))}</strong>
                  <small>${dateTime(move.created_at)}</small>
                </div>
              `).join('') || '<p>Chưa có nước đi nào.</p>'}
            </div>
          </section>
          <section class="side-card">
            <span class="eyebrow">SPECTATOR MODE</span>
            <h2>${Number(room.spectator_count || 0)} người đang xem</h2>
            <p>${isPrivate ? 'Phòng riêng tư: Không cho phép khán giả bên ngoài xem.' : 'Link khán giả cho phép người ngoài theo dõi realtime nhưng không thể thao tác.'}</p>
            ${!isPrivate ? `
              <button class="button button-secondary" data-action="copy-spectator-link" data-url="${escapeHtml(urls.spectator)}">Sao chép link khán giả</button>
            ` : ''}
          </section>
        </aside>
      </div>
    </div>
  `;
}

function challengeHtml() {
  const challenge = ui.challenge;
  if (!challenge) return '';
  const expired = challenge.status !== 'pending' || (challenge.expires_at && new Date(challenge.expires_at).getTime() <= Date.now());
  return `
    <div class="login-gate">
      <span class="eyebrow">CHALLENGE DROP · ${escapeHtml(gameOf(challenge).label)}</span>
      <h1>${expired ? 'Lời thách đấu đã hết hạn' : 'Bạn được mời vào trận'}</h1>
      <p>${expired ? 'Link này không còn nhận người chơi. Hãy quay lại Game Lounge để mở một phòng mới.' : `Phòng #${escapeHtml(challenge.room_code)} · lời mời có hiệu lực đến ${dateTime(challenge.expires_at)}.`}</p>
      <div class="hero-actions">
        ${expired
          ? '<a class="button button-secondary" href="/games">Về Game Lounge</a>'
          : '<button class="button button-primary" data-action="accept-challenge">Nhận lời thách đấu ↗</button><a class="button button-secondary" href="/games">Xem lobby</a>'}
      </div>
    </div>
  `;
}

function modalHtml() {
  if (ui.modal === 'create') {
    return `
      <div class="overlay">
        <section class="modal">
          <div class="modal-head">
            <div>
              <span class="eyebrow">NEW MATCH</span>
              <h2>Mở một phòng chơi</h2>
            </div>
            <button class="modal-close" data-action="close-modal" aria-label="Đóng">×</button>
          </div>
          <p class="modal-intro">Phòng được lưu trên máy chủ VPS. Sau khi tạo, bạn sẽ nhận link mời đối thủ và link khán giả để chia sẻ.</p>
          <form id="create-form">
            <label class="field">Chọn game
              <div class="choice-grid">
                ${GAMES.map((game, index) => `
                  <button type="button" class="choice ${index === 0 ? 'selected' : ''}" data-choice-game="${game.id}">
                    <b>${game.icon}</b>
                    <span><strong>${game.label}</strong><small>${game.detail}</small></span>
                    <i>${index === 0 ? '✓' : ''}</i>
                  </button>
                `).join('')}
              </div>
            </label>
            <input type="hidden" id="create-game" value="caro" />
            <label class="field">Tên phòng
              <input id="create-name" maxlength="80" placeholder="Ví dụ: Kèo caro sau giờ học" />
            </label>
            <div class="field-row">
              <label class="field">Chế độ phòng
                <select id="create-visibility">
                  <option value="public" selected>🌐 Công khai — Hiện ở sảnh, cho khán giả xem</option>
                  <option value="private">🔒 Riêng tư — Ẩn khỏi sảnh, KHÔNG cho khán giả xem</option>
                </select>
              </label>
              <label class="field">Thời hạn
                <select id="create-ttl">
                  <option value="7200">2 giờ</option>
                  <option value="86400">24 giờ</option>
                  <option value="172800">2 ngày</option>
                </select>
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="button button-secondary" data-action="close-modal">Huỷ</button>
              <button class="button button-primary" type="submit">Tạo phòng & nhận mã ↗</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  if (ui.modal === 'challenge') {
    return `
      <div class="overlay">
        <section class="modal">
          <div class="modal-head">
            <div>
              <span class="eyebrow">CHALLENGE DROP</span>
              <h2>Mời đối thủ vào trận</h2>
            </div>
            <button class="modal-close" data-action="close-modal" aria-label="Đóng">×</button>
          </div>
          <p class="modal-intro">Tạo lời mời ngắn hạn cho phòng #${escapeHtml(roomRef(ui.room))}. Bạn có thể đăng thẳng lên Confession.</p>
          <form id="challenge-form">
            <label class="field">Lời mời hết hạn sau
              <select id="challenge-ttl">
                <option value="900">15 phút</option>
                <option value="3600">1 giờ</option>
                <option value="86400" selected>24 giờ</option>
                <option value="604800">7 ngày</option>
              </select>
            </label>
            <label class="check">
              <input id="challenge-confession" type="checkbox" checked />
              <span>Đăng thách đấu lên Confession (bài sẽ tự ẩn khi challenge hết hạn).</span>
            </label>
            <div id="challenge-result"></div>
            <div class="modal-actions stack">
              <button type="submit" class="button button-primary">Tạo lời mời ↗</button>
              <button type="button" class="button button-secondary" data-action="close-modal">Đóng</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  return '';
}

function render() {
  const app = $('#games-app');
  if (!app) return;
  const current = session();
  app.innerHTML = `
    <div class="site-shell">
      <nav class="site-nav">
        <a class="brand" href="/games">
          <span class="brand-mark">✦</span>
          <span class="brand-copy">
            <strong>BDU GAME LOUNGE</strong>
            <span>Independent play space</span>
          </span>
        </a>
        <div class="nav-meta">
          <a href="/">← Portal sinh viên</a>
          ${current ? `
            <span class="user-pill">
              <span class="user-avatar">${initials(current.user?.name || current.user?.mssv)}</span>
              ${escapeHtml(current.user?.name || current.user?.mssv || 'Sinh viên')}
            </span>
          ` : '<a href="/login?returnTo=%2Fgames">Đăng nhập BDU ↗</a>'}
        </div>
      </nav>
      <main class="site-main">
        ${ui.challenge && !ui.room ? challengeHtml() : ui.room ? renderRoom() : lobbyHtml()}
      </main>
      <footer class="site-footer">BDU Game Lounge · Phòng chơi online realtime · State được lưu trên máy chủ VPS và có thể khôi phục sau reconnect.</footer>
      ${modalHtml()}
      ${ui.toast ? `<div class="toast">${escapeHtml(ui.toast)}</div>` : ''}
    </div>
  `;
  bind();
}

async function loadRooms() {
  const current = authOrRedirect();
  if (!current) return;
  try {
    const result = await api(`/api/entertainment/rooms${ui.filter !== 'all' ? `?gameType=${encodeURIComponent(ui.filter)}` : ''}`);
    ui.rooms = Array.isArray(result) ? result : result?.rooms || [];
    ui.loadError = '';
    ui.realtime = 'lobby';
    render();
  } catch (error) {
    ui.loadError = error.message;
    ui.realtime = 'offline';
    render();
  }
}

function normalizeJoin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    return url.searchParams.get('room') || url.searchParams.get('roomId') || url.pathname.split('/').filter(Boolean).at(-1) || raw;
  } catch {
    return raw.replace(/^#?(room[:/\s-]*)/i, '').trim();
  }
}

async function loadMoves(room) {
  const ref = roomRef(room);
  if (!ref) return;
  try {
    const result = await api(`/api/entertainment/rooms/${encodeURIComponent(ref)}/moves`);
    ui.moves = Array.isArray(result) ? result : result?.moves || [];
  } catch {
    ui.moves = [];
  }
}

async function openRoom(ref, requestedRole = 'auto', inviteCode = '') {
  const current = authOrRedirect();
  if (!current) return;
  const target = normalizeJoin(ref);
  if (!target) return showToast('Mã phòng không hợp lệ.');

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const effectiveRole = requestedRole !== 'auto'
      ? requestedRole
      : (searchParams.get('role') || (searchParams.get('spectate') === '1' ? 'spectator' : 'auto'));

    let room = await api(`/api/entertainment/rooms/${encodeURIComponent(target)}${effectiveRole === 'spectator' ? '?role=spectator' : ''}`);
    const me = currentUserIsPlayer(room);

    let isSpectator = false;
    if (effectiveRole === 'spectator') {
      isSpectator = true;
    } else if (effectiveRole === 'player') {
      if (!me && roomStatus(room) === 'waiting') {
        room = await api(`/api/entertainment/rooms/${encodeURIComponent(target)}/join`, {
          method: 'POST',
          body: { inviteCode: inviteCode || searchParams.get('code') || undefined }
        });
      }
      isSpectator = false;
    } else {
      // auto role:
      if (me) {
        isSpectator = false;
      } else if (roomStatus(room) === 'waiting' && (room.players || []).length < 2) {
        room = await api(`/api/entertainment/rooms/${encodeURIComponent(target)}/join`, {
          method: 'POST',
          body: { inviteCode: inviteCode || searchParams.get('code') || undefined }
        });
        isSpectator = false;
      } else {
        isSpectator = true;
      }
    }

    ui.room = room;
    ui.moves = [];
    ui.role = isSpectator ? 'spectator' : 'player';
    ui.selected = null;
    clearRematchCountdown();
    await loadMoves(room);

    const targetUrl = `/games/room/${encodeURIComponent(roomRef(room) || target)}${isSpectator ? '?role=spectator' : '?role=player'}`;
    if (window.location.pathname + window.location.search !== targetUrl) {
      history.pushState({}, '', targetUrl);
    }
    connectRealtime();
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function createRoom(event) {
  event.preventDefault();
  const current = authOrRedirect();
  if (!current) return;
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const visibility = $('#create-visibility').value;
    const result = await api('/api/entertainment/rooms', {
      method: 'POST',
      body: {
        gameType: $('#create-game').value,
        visibility,
        ttlSeconds: Number($('#create-ttl').value),
        name: $('#create-name').value.trim() || undefined,
        allowSpectators: visibility !== 'private'
      }
    });
    ui.modal = null;
    await openRoom(roomRef(result), 'player');
  } catch (error) {
    showToast(error.message);
    submit.disabled = false;
  }
}

async function submitMove(move) {
  if (!ui.room) return;
  const clientMoveId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  ui.selected = null;
  try {
    const result = await api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/moves`, {
      method: 'POST',
      body: { move, clientMoveId }
    });
    ui.room = {
      ...ui.room,
      ...(result?.state ? { state: result.state } : {}),
      status: result?.status || (result?.state?.result ? 'finished' : ui.room.status),
      state_version: result?.state_version || ui.room.state_version,
      winner_seat: result?.winner_seat !== undefined ? result.winner_seat : (result?.state?.winner_seat ?? ui.room.winner_seat),
      result: result?.result || result?.state?.result || ui.room.result
    };
    await loadMoves(ui.room);
    if (ui.room.status === 'finished' || result?.state?.result || result?.result) {
      startRematchCountdown(10);
    }
    render();
  } catch (error) {
    showToast(error.message);
  }
}

function onCellClick(event) {
  const cell = event.target.closest('.cell');
  if (!cell || !ui.room || ui.role === 'spectator') return;
  const game = gameOf(ui.room);
  const row = Number(cell.dataset.row);
  const column = Number(cell.dataset.column);
  if (game.id === 'tic_tac_toe') {
    return submitMove({ index: row * 3 + column });
  }
  if (game.id === 'connect4' || game.id === 'caro' || game.id === 'go') {
    return submitMove(game.id === 'connect4' ? { column } : { row, column });
  }

  const board = normalizedBoard(ui.room);
  const targetPiece = board?.[row]?.[column];
  const me = currentUserIsPlayer(ui.room);
  const myColorPrefix = game.id === 'xiangqi'
    ? (Number(me?.seat) === 1 ? 'r' : 'b')
    : (Number(me?.seat) === 1 ? 'w' : 'b');

  if (!ui.selected) {
    if (targetPiece && typeof targetPiece === 'string' && targetPiece.startsWith(myColorPrefix)) {
      ui.selected = { row, column };
      render();
    }
    return;
  }
  if (ui.selected.row === row && ui.selected.column === column) {
    ui.selected = null;
    render();
    return;
  }
  if (targetPiece && typeof targetPiece === 'string' && targetPiece.startsWith(myColorPrefix)) {
    ui.selected = { row, column };
    render();
    return;
  }
  submitMove({ from: ui.selected, to: { row, column } });
}

async function createChallenge(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/challenges`, {
      method: 'POST',
      body: {
        expiresInSeconds: Number($('#challenge-ttl').value),
        postToConfession: $('#challenge-confession').checked,
        confessionAnonymous: true
      }
    });
    const link = `${window.location.origin}/games/challenges/${encodeURIComponent(result.id)}?code=${encodeURIComponent(result.invite_code)}`;
    showToast('Đã tạo lời mời thách đấu.');
    const resultBox = $('#challenge-result');
    if (resultBox) {
      resultBox.innerHTML = `
        <div class="challenge-result">
          <strong>Link mời đã sẵn sàng · hết hạn ${dateTime(result.expires_at)}</strong>
          <code>${escapeHtml(link)}</code>
          <button type="button" class="button button-secondary" data-action="copy-challenge" data-link="${escapeHtml(link)}">Sao chép link</button>
        </div>
      `;
      resultBox.querySelector('[data-action="copy-challenge"]')?.addEventListener('click', () => copy(link));
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function acceptChallenge() {
  const challenge = ui.challenge;
  if (!challenge) return;
  const code = new URLSearchParams(window.location.search).get('code') || '';
  try {
    const room = await api(`/api/entertainment/challenges/${encodeURIComponent(challenge.id)}/accept`, {
      method: 'POST',
      body: { code }
    });
    await openRoom(roomRef(room), 'player');
  } catch (error) {
    showToast(error.message);
  }
}

async function loadChallenge(id) {
  const current = authOrRedirect();
  if (!current) return;
  try {
    ui.challenge = await api(`/api/entertainment/challenges/${encodeURIComponent(id)}`);
    render();
  } catch (error) {
    ui.challenge = { status: 'expired', room_code: '', game_type: 'caro', message: error.message };
    render();
  }
}

function connectRealtime() {
  if (!ui.room || !session()?.token) return;
  if (ui.socket) { try { ui.socket.close(); } catch {} }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
  ui.socket = socket;
  ui.realtime = 'connecting';
  ui.reconnectAttempt = 0;
  render();

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'auth', token: session().token }));
  });

  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'auth.ok') {
      ui.realtime = 'ready';
      socket.send(JSON.stringify({ type: 'subscribe', room: `game:${roomRef(ui.room)}` }));
      render();
      return;
    }
    if (message.type === 'game.snapshot') {
      ui.room = message.data?.room || message.data || ui.room;
      loadMoves(ui.room).then(render);
      return;
    }
    if (message.type === 'game.move.applied') {
      if (message.data?.state) {
        ui.room = {
          ...ui.room,
          state: message.data.state,
          status: message.data.status || (message.data.state?.result ? 'finished' : ui.room.status),
          state_version: message.data.state_version || ui.room.state_version,
          winner_seat: message.data.winner_seat !== undefined ? message.data.winner_seat : (message.data.state?.winner_seat ?? ui.room.winner_seat),
          result: message.data.result || message.data.state?.result || ui.room.result
        };
      }
      const incomingMove = message.data?.move
        ? { move: message.data.move, move_number: message.data.move_number, created_at: message.occurredAt }
        : null;
      if (incomingMove && Number(incomingMove.move_number || 0) > ui.moves.length) {
        ui.moves = [...ui.moves, incomingMove];
      }
      if (ui.room.status === 'finished' || message.data?.state?.result || message.data?.result) {
        startRematchCountdown(10);
      }
      render();
      return;
    }
    if (message.type === 'game.spectators.updated') {
      if (ui.room && (message.room_code === roomRef(ui.room) || message.room_code === ui.room.id)) {
        ui.room.spectator_count = Number(message.spectator_count || 0);
        render();
      }
      return;
    }
    if (message.type === 'game.room.closed') {
      clearRematchCountdown();
      showToast(message.data?.message || 'Một trong hai đối thủ đã rời phòng. Phòng đã tự động đóng.');
      ui.room = null;
      ui.challenge = null;
      ui.modal = null;
      ui.realtime = 'lobby';
      if (ui.socket) { try { ui.socket.close(); } catch {} }
      history.pushState({}, '', '/games');
      render();
      loadRooms();
      return;
    }
    if (message.type === 'game.rematch.requested') {
      const myMssv = session()?.user?.mssv;
      if (message.data?.actor && myMssv && String(message.data.actor).toUpperCase() !== String(myMssv).toUpperCase()) {
        ui.opponentWantsRematch = true;
      }
      if (message.data?.votes && Array.isArray(message.data.votes)) {
        if (myMssv && message.data.votes.map((v) => String(v).toUpperCase()).includes(String(myMssv).toUpperCase())) {
          ui.rematchVoted = true;
        }
      }
      if (!ui.rematchVoted) {
        showToast('🔥 Đối thủ muốn chơi lại! Bấm "Chơi lại" để bắt đầu ván mới.');
      }
      render();
      return;
    }
    if (message.type === 'game.rematch.started') {
      clearRematchCountdown();
      ui.moves = [];
      ui.selected = null;
      ui.opponentWantsRematch = false;
      ui.rematchVoted = false;
      ui.hideFinishOverlay = false;
      showToast('🎉 Ván mới bắt đầu! Hai đối thủ đã sẵn sàng.');
      refreshRoom();
      return;
    }
    if (message.type === 'game.room.updated') {
      refreshRoom();
      return;
    }
    if (message.type === 'game.room.expired') {
      refreshRoom();
    }
  });

  socket.addEventListener('close', () => {
    if (ui.socket !== socket) return;
    ui.realtime = 'reconnecting';
    render();
    window.clearTimeout(ui.reconnectTimer);
    ui.reconnectAttempt += 1;
    const delay = Math.min(30000, 500 * (2 ** Math.min(6, ui.reconnectAttempt - 1)));
    ui.reconnectTimer = window.setTimeout(() => {
      refreshRoom().then(connectRealtime);
    }, delay);
  });
}

async function refreshRoom() {
  if (!ui.room) return;
  try {
    const roleParam = ui.role === 'spectator' ? '?role=spectator' : '';
    ui.room = await api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}${roleParam}`);
    await loadMoves(ui.room);
    if (ui.room.status === 'finished' || roomState(ui.room).result) {
      startRematchCountdown(10);
    }
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('Sao chép link này:', text);
  }
}

function bind() {
  $('#join-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    openRoom($('#join-input').value, 'auto');
  });

  $('#create-form')?.addEventListener('submit', createRoom);
  $('#challenge-form')?.addEventListener('submit', createChallenge);
  $('.board')?.addEventListener('click', onCellClick);

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    ui.filter = button.dataset.filter;
    render();
    if (!ui.room) loadRooms();
  }));

  document.querySelectorAll('[data-choice-game]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-choice-game]').forEach((item) => {
      item.classList.remove('selected');
      item.querySelector('i').textContent = '';
    });
    button.classList.add('selected');
    button.querySelector('i').textContent = '✓';
    $('#create-game').value = button.dataset.choiceGame;
  }));

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (action === 'open-create') {
      ui.modal = 'create';
      render();
    } else if (action === 'open-challenge') {
      ui.modal = 'challenge';
      render();
    } else if (action === 'close-modal') {
      ui.modal = null;
      render();
    } else if (action === 'focus-join') {
      $('#join-input')?.focus();
    } else if (action === 'open-room') {
      openRoom(button.dataset.room, button.dataset.role || 'auto');
    } else if (action === 'toggle-finish-overlay') {
      ui.hideFinishOverlay = !ui.hideFinishOverlay;
      render();
    } else if (action === 'back-lobby' || action === 'leave-room') {
      clearRematchCountdown();
      ui.hideFinishOverlay = false;
      if (ui.room && ui.role === 'player') {
        api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/leave`, { method: 'POST' }).catch(() => {});
      }
      ui.room = null;
      ui.challenge = null;
      ui.modal = null;
      ui.realtime = 'lobby';
      if (ui.socket) { try { ui.socket.close(); } catch {} }
      history.pushState({}, '', '/games');
      render();
      loadRooms();
    } else if (action === 'request-rematch') {
      if (!ui.room || ui.role !== 'player' || ui.rematchVoted) return;
      ui.rematchVoted = true;
      render();
      try {
        const result = await api(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/rematch`, { method: 'POST' });
        if (result.ready) {
          clearRematchCountdown();
          ui.room = result.room || ui.room;
          ui.moves = [];
          ui.opponentWantsRematch = false;
          ui.rematchVoted = false;
          ui.hideFinishOverlay = false;
          showToast('🎉 Ván mới bắt đầu! Hai đối thủ đã sẵn sàng.');
          render();
        } else {
          showToast('Đã gửi yêu cầu chơi lại. Đang chờ đối thủ đồng ý...');
        }
      } catch (error) {
        ui.rematchVoted = false;
        showToast(error.message);
        render();
      }
    } else if (action === 'copy-opponent-link') {
      const url = button.dataset.url || roomShareUrls(ui.room).player;
      await copy(url);
      showToast('⚔️ Đã sao chép link mời đối thủ! Gửi cho bạn bè để thi đấu.');
    } else if (action === 'copy-spectator-link') {
      const url = button.dataset.url || roomShareUrls(ui.room).spectator;
      await copy(url);
      showToast('👁️ Đã sao chép link dành cho khán giả! Người nhận chỉ có thể xem ván đấu.');
    } else if (action === 'copy-challenge') {
      await copy(button.dataset.link);
      showToast('Đã sao chép link thách đấu.');
    } else if (action === 'accept-challenge') {
      acceptChallenge();
    } else if (action === 'pass-go') {
      submitMove({ pass: true });
    } else if (action === 'resign') {
      if (!ui.room || ui.role !== 'player' || roomStatus(ui.room) !== 'playing') return;
      if (!confirm('Bạn có chắc chắn muốn đầu hàng ván đấu này không?')) return;
      submitMove({ resign: true });
    } else if (action === 'reload-rooms') {
      loadRooms();
    }
  }));
}

window.addEventListener('popstate', () => {
  clearRematchCountdown();
  ui.room = null;
  ui.challenge = null;
  const info = pathInfo();
  render();
  if (info.room) openRoom(info.room, info.role);
  else if (info.challenge) loadChallenge(info.challenge);
  else loadRooms();
});

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    $('#join-input')?.focus();
  }
  if (event.key === 'Escape' && ui.modal) {
    ui.modal = null;
    render();
  }
});

window.addEventListener('beforeunload', () => {
  if (ui.room && ui.role === 'player') {
    const token = session()?.token;
    if (token) {
      try {
        fetch(`/api/entertainment/rooms/${encodeURIComponent(roomRef(ui.room))}/leave`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          keepalive: true
        });
      } catch {}
    }
  }
});

(async function boot() {
  const info = pathInfo();
  render();
  if (!session()) return;
  if (info.room) await openRoom(info.room, info.role);
  else if (info.challenge) await loadChallenge(info.challenge);
  else await loadRooms();
}());
