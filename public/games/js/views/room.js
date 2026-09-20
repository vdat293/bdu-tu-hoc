import { GamesApi } from '../api.js';
import { esc, toast, openModal, copyText, formatClock, cornerNotice, playerLabel } from '../ui.js';
import { currentMssv } from '../session.js';
import { gameModule } from '../games/index.js';
import { headerHtml, bindHeader } from '../components/header.js';
import { avatarHtml, titleBadgesHtml, playCinematic, playConfetti, frameInfo, gameTitleEffectFor, gameTitleBadgesHtml } from '../identity.js';
import { RoomRealtime } from '../realtime.js';
import { Sound } from '../sound.js';
import { bindNav } from './home.js';

const REMATCH_WINDOW_SECONDS = 180;
const EMOJIS = ['👍', '😂', '😮', '😭', '🔥', '🎉', '🤝', '😅'];

export function createRoomView({ root, state, code, navigate }) {
  const cleanCode = String(code || '').trim().toUpperCase();
  let room = null;
  let moves = [];
  let chat = [];
  let role = 'spectator';
  let mySeat = null;
  let realtime = null;
  let board = null;
  let boardGameType = null;
  let movePending = false;
  let chatTab = 'moves';
  let chatUnread = 0;
  let clockTimer = null;
  let refreshTimer = null;
  let finishOverlay = null;
  let finishedHandled = false;
  let overlayHidden = false;
  let rematchVoted = false;
  let opponentVoted = false;
  let finishedAt = 0;
  // Tỉ số các ván đã xong trong phòng (giữ qua các lần "Chơi lại").
  const sessionScore = { 1: 0, 2: 0 };
  const announcedPlayers = new Set();
  let firstRoomApplied = false;

  const me = () => currentMssv();
  const ref = (value) => room?.room_code || value;
  const stateOf = (target = room) => target?.state || {};
  const playerBySeat = (seat) => (room?.players || []).find((player) => Number(player.seat) === Number(seat)) || null;
  const opponentSeat = () => (Number(mySeat) === 1 ? 2 : 1);
  const isPlayer = () => role === 'player';
  const isMyTurn = () => isPlayer() && room?.status === 'active' && !stateOf().result && Number(stateOf().current_seat) === Number(mySeat);
  const shareUrl = () => `${window.location.origin}/games/room/${encodeURIComponent(ref(cleanCode))}`;

  async function start() {
    try {
      const joined = await GamesApi.joinRoom(cleanCode);
      applyRoom(joined, { first: true });
    } catch (error) {
      if (error.code === 'ROOM_NOT_FOUND' || error.status === 404) {
        renderMissingRoom();
        return;
      }
      // Phòng cấm khán giả (403) không được để người dùng kẹt ở skeleton chết.
      if (error.code === 'ROOM_FORBIDDEN' || error.status === 403) {
        renderForbiddenRoom(error.message);
        return;
      }
      toast(error.message || 'Không thể vào phòng.', 'error');
    }
    renderSkeleton();
    try {
      const history = await GamesApi.listMoves(ref(cleanCode));
      moves = history?.moves || [];
    } catch {}
    connectRealtime();
    clockTimer = window.setInterval(updateClocks, 250);
    renderAll();
  }

  function teardown() {
    realtime?.disconnect();
    realtime = null;
    window.clearInterval(clockTimer);
    window.clearTimeout(refreshTimer);
    board?.destroy?.();
    board = null;
    finishOverlay?.remove();
    finishOverlay = null;
  }

  function renderMissingRoom() {
    root.innerHTML = `
      ${headerHtml(state)}
      <main class="page">
        <div class="empty-state" style="margin-top:40px">
          <h2>Không tìm thấy phòng</h2>
          <p>Phòng có thể đã đóng hoặc hết hạn. Hãy tạo phòng mới và gửi lại link cho bạn.</p>
          <a class="btn btn-primary" href="/games" data-nav="/games">Về trang chủ</a>
        </div>
      </main>`;
    bindHeader(root);
    bindNav(root, navigate);
  }

  function renderForbiddenRoom(message) {
    root.innerHTML = `
      ${headerHtml(state)}
      <main class="page">
        <div class="empty-state" style="margin-top:40px">
          <h2>Không thể vào phòng</h2>
          <p>${esc(message || 'Phòng này không cho phép khán giả.')}</p>
          <a class="btn btn-primary" href="/games" data-nav="/games">Về trang chủ</a>
        </div>
      </main>`;
    bindHeader(root);
    bindNav(root, navigate);
  }

  function connectRealtime() {
    realtime = new RoomRealtime({
      roomCode: ref(cleanCode),
      onStatus: (status) => {
        if (status === 'auth-error') {
          toast('Phiên đăng nhập đã hết hạn.', 'error');
        }
        renderStatus();
      },
      onEvent: handleRealtimeEvent
    });
    realtime.connect();
  }

  function handleRealtimeEvent(message) {
    switch (message.type) {
      case 'game.snapshot':
        applyRoom(message.data?.room || message.data, { first: !firstRoomApplied });
        renderAll();
        break;
      case 'game.move.applied':
        applyMoveData(message.data);
        break;
      case 'game.turn.timeout':
        if (message.data?.state) {
          applyMoveData({ ...message.data, move: null });
        }
        toast(`Hết thời gian mỗi nước. ${winnerName(message.data?.winner_seat)} thắng.`, 'warning', 6000);
        Sound.play('lose');
        break;
      case 'game.room.forfeited':
        if (message.data?.state) applyMoveData({ ...message.data, move: null });
        toast(message.data?.message || 'Đối thủ đã rời phòng.', 'warning', 6000);
        break;
      case 'game.room.updated':
      case 'game.room.expired':
        scheduleRefresh();
        break;
      case 'game.rematch.requested': {
        const actor = String(message.data?.actor || '').toUpperCase();
        if (actor && actor !== me()) {
          opponentVoted = true;
          toast('Đối thủ muốn chơi lại!', 'info');
          renderFinishOverlay();
        }
        break;
      }
      case 'game.rematch.started':
        moves = [];
        chatUnread = 0;
        finishedHandled = false;
        rematchVoted = false;
        opponentVoted = false;
        finishedAt = 0;
        finishOverlay?.remove();
        finishOverlay = null;
        toast('Ván mới bắt đầu!', 'info');
        scheduleRefresh(0);
        Sound.play('join');
        break;
      case 'game.room.closed':
        toast(message.data?.message || 'Phòng đã đóng.', 'warning', 5000);
        teardown();
        navigate('/games');
        break;
      case 'game.spectators.updated':
        if (room) {
          room.spectator_count = Number(message.data?.spectator_count || 0);
          renderHeaderBar();
        }
        break;
      case 'game.spectator.joined':
        handleSpectatorJoined(message.data);
        break;
      case 'game.chat.message':
        handleChatMessage(message.data);
        break;
      case 'error':
        if (message.code !== 'ROOM_FORBIDDEN') toast(message.message || 'Lỗi realtime.', 'error');
        break;
      default:
        break;
    }
  }

  function applyRoom(next, { first = false } = {}) {
    if (!next) return;
    // Snapshot có thể tới sau broadcast move mới hơn; không được lùi trạng thái.
    if (!first && room && Number(next.state_version || 0) < Number(room.state_version || 0)) return;
    room = next;
    role = next.role === 'player' ? 'player' : 'spectator';
    mySeat = next.viewer_seat === null || next.viewer_seat === undefined ? null : Number(next.viewer_seat);
    if (first || !firstRoomApplied) {
      for (const player of next.players || []) announcedPlayers.add(String(player.mssv).toUpperCase());
      firstRoomApplied = true;
    } else {
      // Phát cinematic khi đối thủ vào phòng, chỉ một lần cho mỗi người. Danh
      // hiệu Game Hub (nếu có) ưu tiên hiệu ứng riêng trước khung avatar.
      for (const player of next.players || []) {
        const key = String(player.mssv).toUpperCase();
        if (key === me() || announcedPlayers.has(key)) continue;
        announcedPlayers.add(key);
        playEntryEffect(player);
        Sound.play('join');
        toast(`${playerLabel(player)} đã vào phòng!`, 'info');
      }
    }
    if (next.status === 'finished' && !finishedHandled) handleFinished();
  }

  function applyMoveData(data) {
    if (!data || !room) return;
    const incomingVersion = Number(data.state_version || 0);
    if (incomingVersion && incomingVersion <= Number(room.state_version || 0)) return;
    if (data.state) {
      room.state = data.state;
      room.state_version = incomingVersion || room.state_version;
      room.status = data.status || room.status;
      room.winner_seat = data.winner_seat === undefined ? room.winner_seat : data.winner_seat;
      room.result = data.result || data.state?.result || room.result;
      room.turn_deadline = data.turn_deadline === undefined ? null : data.turn_deadline;
      if (data.legal_moves !== undefined || data.seat === mySeat) room.legal_moves = data.legal_moves ?? null;
    }
    if (data.move) {
      const number = Number(data.move_number || moves.length + 1);
      if (!moves.some((item) => Number(item.move_number) === number)) {
        moves = [...moves, { move_number: number, actor_mssv: data.actor_mssv, move: data.move, created_at: new Date().toISOString() }];
      }
      Sound.play('move');
    }
    renderAll();
    if (room.status === 'finished') handleFinished();
  }

  function scheduleRefresh(delay = 120) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, delay);
  }

  async function refresh() {
    try {
      const next = await GamesApi.getRoom(ref(cleanCode));
      applyRoom(next);
      renderAll();
    } catch (error) {
      if (error.code === 'ROOM_NOT_FOUND') {
        toast('Phòng đã đóng.', 'warning');
        teardown();
        navigate('/games');
      }
    }
  }

  // Ưu tiên hiệu ứng danh hiệu Game Hub (Vua trò chơi, Đối mềm...) rồi mới tới
  // cinematic theo khung avatar. Thêm danh hiệu mới chỉ cần khai báo ở identity.js.
  function playEntryEffect(player) {
    const titleEffect = gameTitleEffectFor(player);
    if (titleEffect) playCinematic(player, { title: titleEffect });
    else playCinematic(player);
  }

  function handleFinished() {
    if (finishedHandled) return;
    finishedHandled = true;
    finishedAt = Date.now();
    overlayHidden = false;
    const winnerSeat = Number(room.winner_seat || stateOf().winner_seat || 0);
    const iWon = isPlayer() && winnerSeat === Number(mySeat);
    const draw = !winnerSeat || room.result === 'draw';
    if (!draw && (winnerSeat === 1 || winnerSeat === 2)) sessionScore[winnerSeat] += 1;
    if (draw) Sound.play('join');
    else if (iWon) { Sound.play('win'); playConfetti({}); } else Sound.play('lose');
    const winner = winnerSeat ? playerBySeat(winnerSeat) : null;
    if (winner) playEntryEffect(winner);
    renderAll();
  }

  function handleSpectatorJoined(data) {
    if (!data || String(data.mssv).toUpperCase() === me()) return;
    const frame = frameInfo(data.equipped_frame_id);
    cornerNotice(`${avatarHtml(data, { size: 32 })}<span class="corner-text"><b>${esc(data.name || data.mssv)}</b> ${titleBadgesHtml(data.titles, 1)} <i>vào xem</i></span>`);
    if (frame) Sound.play('join');
  }

  function handleChatMessage(data) {
    if (!data) return;
    chat = [...chat.slice(-80), data];
    if (chatTab !== 'chat') chatUnread += 1;
    if (String(data.mssv).toUpperCase() !== me()) Sound.play('chat');
    renderChat();
    renderSideTabs();
  }

  // ---------- render ----------
  function renderSkeleton() {
    root.innerHTML = `
      ${headerHtml(state)}
      <main class="page page--wide">
        <div class="room-screen">
          <div class="room-topbar">
            <a class="icon-button" href="/games" data-nav="/games" title="Về trang chủ">←</a>
            <div class="room-title"><strong data-room-title>Đang tải phòng…</strong><span data-room-subtitle></span></div>
            <span class="grow"></span>
            <span class="room-status-pill" data-room-status><i></i><span>Đang kết nối…</span></span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="sound" title="Bật/tắt âm thanh">${Sound.enabled ? '🔊' : '🔇'}</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="leave">Rời phòng</button>
          </div>
          <div data-spectator-banner></div>
          <div data-share-screen></div>
          <div class="room-layout" data-play-screen hidden>
            <div class="room-main">
              <div class="match-scoreboard" data-scoreboard></div>
              <div class="board-stage" data-board-stage><div class="game-board-slot" data-board-slot></div></div>
              <div class="turn-hint" data-turn-hint></div>
              <div class="board-toolbar" data-toolbar></div>
            </div>
            <aside class="sidebar">
              <div class="side-panel">
                <div class="side-tabs" data-side-tabs></div>
                <div class="side-panel-body" data-side-body></div>
              </div>
            </aside>
          </div>
        </div>
      </main>`;
    bindHeader(root);
    bindNav(root, navigate);
    root.querySelector('[data-action="leave"]')?.addEventListener('click', confirmLeave);
    root.querySelector('[data-action="sound"]')?.addEventListener('click', (event) => {
      const enabled = Sound.toggle();
      event.currentTarget.textContent = enabled ? '🔊' : '🔇';
    });
  }

  function renderAll() {
    if (!root.querySelector('[data-play-screen]')) return;
    renderHeaderBar();
    renderSpectatorBanner();
    renderShareOrPlay();
    if (room?.status !== 'waiting' || !isPlayer()) {
      renderScoreboard();
      renderTurnHint();
      renderToolbar();
      renderBoard();
    }
    renderMoves();
    renderChat();
    renderSideTabs();
    renderFinishOverlay();
    updateClocks();
  }

  function renderHeaderBar() {
    const title = room ? (state.games.find((game) => game.id === room.game_type)?.label || gameModule(room.game_type)?.meta?.label || room.game_type) : 'Phòng chơi';
    const titleNode = root.querySelector('[data-room-title]');
    if (titleNode) titleNode.textContent = title;
    const subtitle = root.querySelector('[data-room-subtitle]');
    if (subtitle) {
      const codeText = room ? `Mã phòng ${room.room_code}` : '';
      const spectators = room && Number(room.spectator_count) > 0 ? ` · ${room.spectator_count} người xem` : '';
      subtitle.textContent = `${codeText}${spectators}`;
    }
    const pill = root.querySelector('[data-room-status]');
    if (pill && realtime) {
      const map = {
        ready: ['is-live', 'Đã kết nối'],
        connecting: ['', 'Đang kết nối…'],
        reconnecting: ['is-offline', 'Đang kết nối lại…'],
        'auth-error': ['is-offline', 'Phiên hết hạn'],
        closed: ['', 'Đã đóng']
      };
      const [className, label] = map[realtime.status] || ['', 'Đang kết nối…'];
      pill.className = `room-status-pill ${className}`;
      pill.querySelector('span').textContent = label;
    }
  }

  function renderSpectatorBanner() {
    const host = root.querySelector('[data-spectator-banner]');
    if (!host) return;
    const isSpectator = room && role === 'spectator';
    host.innerHTML = isSpectator
      ? `<div class="spectator-banner">👀 Bạn đang xem trực tiếp · ${room.players.length}/2 người chơi${Number(room.spectator_count) > 0 ? ` · ${room.spectator_count} khán giả` : ''}</div>`
      : '';
  }

  function renderShareOrPlay() {
    const shareHost = root.querySelector('[data-share-screen]');
    const play = root.querySelector('[data-play-screen]');
    const waiting = room && room.status === 'waiting' && isPlayer();
    play.hidden = waiting;
    if (!waiting) {
      shareHost.innerHTML = '';
      return;
    }
    const opponent = playerBySeat(2);
    shareHost.innerHTML = `
      <section class="share-screen">
        <div class="share-card">
          <span class="kicker">${esc(gameModule(room.game_type)?.meta?.label || room.game_type)}</span>
          <h1>Chia sẻ liên kết này với một người bạn</h1>
          <p>Người mở link đầu tiên sẽ là đối thủ của bạn. Những người vào sau sẽ xem trực tiếp.</p>
          <div class="share-link">
            <input type="text" readonly value="${esc(shareUrl())}" data-share-input aria-label="Liên kết mời">
            <button type="button" class="btn btn-primary" data-action="copy-link">Sao chép</button>
          </div>
          <div class="share-players">
            ${playerCardHtml(playerBySeat(1), { compact: true })}
            <span class="share-vs">VS</span>
            ${opponent ? playerCardHtml(opponent, { compact: true }) : '<div class="player-card player-card--empty player-card--seat-2" style="min-width:190px"><span class="seat-dot"></span><span class="player-copy"><span class="player-name">Đang chờ đối thủ…</span></span></div>'}
          </div>
          <div class="share-hint"><span class="waiting-dots"><i></i><i></i><i></i></span> Đang chờ đối thủ mở link…</div>
          <div class="share-foot">
            <span class="faint tiny">Thời gian mỗi nước: ${room.turn_seconds ? formatClock(room.turn_seconds) + ' giây' : 'không giới hạn'} · Khán giả: ${room.allow_spectators ? 'cho phép' : 'không'}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="leave-share">Rời khỏi phòng</button>
          </div>
        </div>
      </section>`;
    shareHost.querySelector('[data-action="copy-link"]')?.addEventListener('click', async () => {
      try {
        await copyText(shareUrl());
        toast('Đã sao chép liên kết mời.', 'info');
      } catch {
        toast('Không thể sao chép, hãy chọn và copy thủ công.', 'warning');
      }
    });
    shareHost.querySelector('[data-share-input]')?.addEventListener('focus', (event) => event.target.select());
    shareHost.querySelector('[data-action="leave-share"]')?.addEventListener('click', confirmLeave);
  }

  // Bảng tỉ số phía trên bàn: đối thủ (trái) · tỉ số chuỗi ván (giữa) · mình (phải).
  // Khán giả thấy ghế 1 và ghế 2.
  function renderScoreboard() {
    const host = root.querySelector('[data-scoreboard]');
    if (!host) return;
    const self = playerBySeat(mySeat) || {
      name: state.presentation?.name || state.userName || 'Bạn',
      mssv: me(),
      seat: mySeat,
      avatar_url: state.presentation?.avatar_url || null,
      equipped_frame_id: state.presentation?.equipped_frame_id || null,
      titles: state.presentation?.selected_titles || [],
      stats: { wins: 0 },
      game_titles: []
    };
    const left = isPlayer() ? playerBySeat(opponentSeat()) : playerBySeat(1);
    const right = isPlayer() ? self : playerBySeat(2);
    const leftSeat = Number(left?.seat || (isPlayer() ? opponentSeat() : 1));
    const rightSeat = Number(right?.seat || (isPlayer() ? mySeat : 2));
    const currentSeat = Number(stateOf().current_seat || 0);
    host.innerHTML = `
      ${left
        ? playerCardHtml(left, { active: room.status === 'active' && currentSeat === leftSeat, winner: Number(room.winner_seat) === leftSeat })
        : '<div class="player-card player-card--empty"><span class="seat-dot"></span><span class="player-copy"><span class="player-name">Đang chờ đối thủ…</span></span></div>'}
      <div class="match-score" aria-label="Tỉ số các ván trong phòng">
        <span class="match-score-num">${sessionScore[leftSeat] || 0}<i>:</i>${sessionScore[rightSeat] || 0}</span>
        <span class="match-score-label">Tỉ số</span>
      </div>
      ${right
        ? playerCardHtml(right, { active: room.status === 'active' && currentSeat === rightSeat, winner: Number(room.winner_seat) === rightSeat, isMe: isPlayer() })
        : '<div class="player-card player-card--empty player-card--seat-2"><span class="seat-dot"></span><span class="player-copy"><span class="player-name">Ghế trống</span></span></div>'}`;
  }

  function playerCardHtml(player, { active = false, winner = false, isMe = false, compact = false } = {}) {
    if (!player) return '';
    const seat = Number(player.seat || 0);
    const frames = (player.titles || []);
    const gameTitles = player.game_titles || [];
    const wins = Number(player.stats?.wins || 0);
    const hasClock = room.status === 'active' && room.turn_seconds > 0 && !stateOf().result;
    const showClock = hasClock && Number(stateOf().current_seat) === seat && !compact;
    return `
      <div class="player-card player-card--seat-${seat}${active ? ' player-card--active' : ''}${winner ? ' player-card--winner' : ''}">
        ${avatarHtml(player, { size: compact ? 40 : 46 })}
        <div class="player-copy">
          <span class="player-name"><span>${esc(playerLabel(player))}</span>${isMe ? '<span class="player-you">(bạn)</span>' : winner ? '<span class="player-you">🏆</span>' : ''}</span>
          <span class="player-meta">
            ${titleBadgesHtml(frames, compact ? 1 : 2)}
            ${compact ? '' : gameTitleBadgesHtml(gameTitles, 1)}
            ${!frames.length && !gameTitles.length ? `<span>${seat === 1 ? 'Quân 1' : 'Quân 2'}</span>` : ''}
            <span class="player-wins" title="Tổng số trận thắng tại Game Hub">👑 ${wins}</span>
          </span>
        </div>
        <span class="seat-dot"></span>
        <span class="clock-ring${showClock ? '' : ' is-idle'}" data-clock-seat="${seat}" style="--clock-progress:1"><b>--</b></span>
      </div>`;
  }

  function renderTurnHint() {
    const host = root.querySelector('[data-turn-hint]');
    if (!host || !room) return;
    const state_ = stateOf();
    if (room.status === 'waiting') {
      host.innerHTML = 'Đang chờ đối thủ vào phòng…';
      return;
    }
    if (room.status === 'finished' || state_.result) {
      const winnerSeat = Number(room.winner_seat || state_.winner_seat || 0);
      const map = { timeout: ' hết thời gian', forfeit: ' bỏ cuộc', resigned: ' đầu hàng' };
      host.innerHTML = state_.result === 'draw'
        ? 'Ván đấu kết thúc với tỉ số hòa.'
        : `${esc(winnerName(winnerSeat))} thắng${map[room.result] || ''}.`;
      return;
    }
    const current = playerBySeat(state_.current_seat);
    if (isMyTurn()) host.innerHTML = '<strong>Lượt của bạn</strong>';
    else if (role === 'spectator') host.innerHTML = `Đang xem · lượt của <strong>${esc(playerLabel(current))}</strong>`;
    else host.innerHTML = `Lượt của <strong>${esc(playerLabel(current))}</strong>`;
  }

  function renderToolbar() {
    const host = root.querySelector('[data-toolbar]');
    if (!host || !room) return;
    const finished = room.status === 'finished' || Boolean(stateOf().result);
    host.innerHTML = `
      <span class="grow"></span>
      ${finished && overlayHidden ? '<button type="button" class="btn btn-ghost btn-sm" data-action="show-finish">Xem kết quả</button>' : ''}
      ${isPlayer() && !finished ? '<button type="button" class="btn btn-danger btn-sm" data-action="resign">Đầu hàng</button>' : ''}
      <span class="faint tiny">Mã phòng ${esc(room.room_code)}</span>`;
    host.querySelector('[data-action="show-finish"]')?.addEventListener('click', () => {
      overlayHidden = false;
      renderFinishOverlay();
      renderToolbar();
    });
    host.querySelector('[data-action="resign"]')?.addEventListener('click', () => {
      openModal({
        title: 'Đầu hàng?',
        bodyHtml: '<p>Bạn sẽ thua ngay ván này. Đối thủ được tính thắng.</p>',
        footHtml: '<button type="button" class="btn btn-ghost" data-modal-close>Ở lại</button><button type="button" class="btn btn-danger" data-action="confirm-resign">Đầu hàng</button>',
        onMount(backdrop, close) {
          backdrop.querySelector('[data-action="confirm-resign"]')?.addEventListener('click', () => {
            close();
            submitMove({ resign: true });
          });
        }
      });
    });
  }

  function renderBoard() {
    const slot = root.querySelector('[data-board-slot]');
    const stage = root.querySelector('[data-board-stage]');
    if (!slot || !room) return;
    stage.dataset.game = room.game_type;
    const module = gameModule(room.game_type);
    if (!module) {
      slot.innerHTML = '<div class="empty-state"><h3>Game đang được hoàn thiện</h3><p>Bàn chơi của trò chơi này chưa sẵn sàng trong bản này. Các phần khác của phòng vẫn hoạt động.</p></div>';
      return;
    }
    if (!board || boardGameType !== room.game_type) {
      slot.innerHTML = '';
      boardGameType = room.game_type;
      board = module.mount(slot, {
        onMove: (move) => submitMove(move),
        showToast: (message, variant) => toast(message, variant || 'warning'),
        sound: (name) => Sound.play(name)
      });
    }
    const stage_ = root.querySelector('[data-board-stage]');
    stage_?.classList.toggle('is-opponent-turn', room.status === 'active' && !isMyTurn() && isPlayer());
    board.update?.({
      state: stateOf(),
      mySeat,
      role,
      interactive: isMyTurn() && !movePending,
      legalMoves: room.legal_moves || null,
      lastMove: moves.at(-1)?.move || null,
      status: room.status,
      winnerSeat: room.winner_seat === null || room.winner_seat === undefined ? stateOf().winner_seat : room.winner_seat,
      players: room.players || [],
      roomCode: room.room_code,
      turnSeconds: room.turn_seconds
    });
  }

  async function submitMove(move) {
    if (movePending || !isPlayer()) return;
    if (room.status !== 'active') return;
    movePending = true;
    renderBoard();
    const clientMoveId = window.crypto?.randomUUID?.() || `mv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const data = await GamesApi.move(ref(cleanCode), move, clientMoveId);
      applyMoveData(data);
    } catch (error) {
      toast(error.message || 'Nước đi không hợp lệ.', 'error');
    } finally {
      movePending = false;
      renderBoard();
    }
  }

  function renderMoves() {
    const body = root.querySelector('[data-side-body]');
    if (!body || chatTab !== 'moves') return;
    if (!moves.length) {
      body.innerHTML = '<p class="faint tiny">Chưa có nước đi nào.</p>';
      return;
    }
    body.innerHTML = `<ul class="move-list">${moves.slice(-60).map((item, index, list) => {
      const actor = (room?.players || []).find((player) => String(player.mssv).toUpperCase() === String(item.actor_mssv || '').toUpperCase());
      return `<li class="${index === list.length - 1 ? 'is-latest' : ''}">
        <span class="move-index">${Number(item.move_number)}</span>
        <span class="move-actor">${esc(playerLabel(actor) || item.actor_mssv || '')}</span>
        <span class="faint tiny">${esc(describeMove(item.move, room?.game_type))}</span>
      </li>`;
    }).join('')}</ul>`;
  }

  function renderChat() {
    const body = root.querySelector('[data-side-body]');
    if (!body || chatTab !== 'chat') return;
    const listHtml = chat.length ? chat.map((message) => chatItemHtml(message)).join('') : '<p class="faint tiny">Chưa có tin nhắn. Hãy gửi lời chào 👋</p>';
    const existingList = body.querySelector('[data-chat-list]');
    // Giữ nguyên ô nhập khi chỉ có tin nhắn mới tới, tránh giật con trỏ của người đang gõ.
    if (existingList && body.querySelector('[data-chat-form]')) {
      existingList.innerHTML = listHtml;
      existingList.scrollTop = existingList.scrollHeight;
      return;
    }
    body.innerHTML = `
      <div class="chat-list" data-chat-list>${listHtml}</div>
      ${room?.allow_chat === false ? '<p class="faint tiny">Phòng đã tắt chat.</p>' : `
        <div class="emoji-row">${EMOJIS.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-label="Gửi ${emoji}">${emoji}</button>`).join('')}</div>
        <form class="chat-form" data-chat-form>
          <input type="text" maxlength="200" placeholder="Nhắn nhanh…" aria-label="Nội dung tin nhắn" autocomplete="off">
          <button type="submit" class="btn btn-primary btn-sm">Gửi</button>
        </form>`}`;
    const list = body.querySelector('[data-chat-list]');
    if (list) list.scrollTop = list.scrollHeight;
    body.querySelectorAll('[data-emoji]').forEach((button) => button.addEventListener('click', () => sendChat('emoji', button.dataset.emoji)));
    body.querySelector('[data-chat-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendChat('text', text);
    });
  }

  function chatItemHtml(message) {
    const mine = String(message.mssv).toUpperCase() === me();
    const emoji = message.kind === 'emoji';
    return `
      <div class="chat-item${mine ? ' is-me' : ''}${emoji ? ' is-emoji' : ''}">
        ${emoji ? '' : avatarHtml({ name: message.name, avatar_url: message.avatar_url, equipped_frame_id: message.equipped_frame_id }, { size: 26 })}
        <div>
          ${emoji ? '' : `<div class="chat-meta">${esc(message.name || message.mssv || '')}</div>`}
          <div class="chat-bubble">${esc(message.text)}</div>
        </div>
      </div>`;
  }

  function sendChat(kind, text) {
    if (room?.allow_chat === false) {
      toast('Phòng này đã tắt chat.', 'warning');
      return;
    }
    if (!realtime?.sendChat(kind, text)) {
      toast('Mất kết nối realtime, thử lại sau.', 'warning');
    }
  }

  function renderSideTabs() {
    const host = root.querySelector('[data-side-tabs]');
    if (!host) return;
    host.innerHTML = `
      <button type="button" data-tab="moves" aria-selected="${chatTab === 'moves'}">Nước đi</button>
      <button type="button" data-tab="chat" aria-selected="${chatTab === 'chat'}">Chat${chatUnread > 0 ? `<span class="tab-badge">${chatUnread}</span>` : ''}</button>`;
    host.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
      chatTab = button.dataset.tab;
      if (chatTab === 'chat') chatUnread = 0;
      renderSideTabs();
      if (chatTab === 'chat') renderChat(); else renderMoves();
    }));
  }

  function renderFinishOverlay() {
    if (!room || room.status !== 'finished') {
      finishOverlay?.remove();
      finishOverlay = null;
      return;
    }
    if (overlayHidden) {
      finishOverlay?.remove();
      finishOverlay = null;
      return;
    }
    const winnerSeat = Number(room.winner_seat || stateOf().winner_seat || 0);
    const draw = !winnerSeat || room.result === 'draw' || stateOf().result === 'draw';
    const iWon = isPlayer() && !draw && winnerSeat === Number(mySeat);
    const winner = winnerSeat ? playerBySeat(winnerSeat) : null;
    const remaining = Math.max(0, REMATCH_WINDOW_SECONDS - Math.floor((Date.now() - finishedAt) / 1000));
    if (!finishOverlay) {
      finishOverlay = document.createElement('div');
      finishOverlay.className = 'finish-overlay';
      document.body.appendChild(finishOverlay);
    }
    finishOverlay.innerHTML = `
      <div class="finish-card">
        ${winner ? avatarHtml(winner, { size: 74 }) : '<span style="font-size:44px">🤝</span>'}
        <span class="finish-badge${draw ? ' is-draw' : iWon ? '' : ' is-loss'}">${draw ? 'Hòa' : iWon ? 'Bạn thắng' : 'Bạn thua'}</span>
        <h2>${draw ? 'Ván đấu hòa' : `${esc(playerLabel(winner))} thắng`}</h2>
        ${winner ? `<div>${titleBadgesHtml(winner.titles || [], 3)}</div>` : ''}
        <span class="finish-timer">Phòng sẽ tự đóng sau ${formatClock(remaining)} nếu không ai chơi lại.</span>
        ${opponentVoted ? '<span class="finish-note">🔥 Đối thủ muốn chơi lại!</span>' : ''}
        <div class="finish-actions">
          ${isPlayer() ? `<button type="button" class="btn btn-primary" data-action="rematch" ${rematchVoted ? 'disabled' : ''}>${rematchVoted ? 'Đang chờ đối thủ…' : 'Chơi lại'}</button>` : ''}
          <button type="button" class="btn btn-ghost" data-action="hide-overlay">Xem lại bàn</button>
          <button type="button" class="btn btn-ghost" data-action="home">Về trang chủ</button>
        </div>
      </div>`;
    finishOverlay.querySelector('[data-action="rematch"]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        const data = await GamesApi.rematch(ref(cleanCode));
        if (data?.ready) {
          toast('Ván mới bắt đầu!', 'info');
          scheduleRefresh(0);
        } else {
          rematchVoted = true;
          renderFinishOverlay();
        }
      } catch (error) {
        toast(error.message || 'Không thể gửi yêu cầu chơi lại.', 'error');
        renderFinishOverlay();
      }
    });
    finishOverlay.querySelector('[data-action="hide-overlay"]')?.addEventListener('click', () => {
      overlayHidden = true;
      renderFinishOverlay();
      renderToolbar();
    });
    finishOverlay.querySelector('[data-action="home"]')?.addEventListener('click', () => {
      teardown();
      navigate('/games');
    });
  }

  function updateClocks() {
    if (!room || room.status !== 'active' || !room.turn_seconds) return;
    const currentSeat = Number(stateOf().current_seat || 0);
    const deadline = room.turn_deadline ? new Date(room.turn_deadline).getTime() : 0;
    root.querySelectorAll('[data-clock-seat]').forEach((ring) => {
      const seat = Number(ring.dataset.clockSeat);
      if (seat !== currentSeat || !deadline) {
        ring.classList.add('is-idle');
        return;
      }
      const remaining = Math.max(0, (deadline - Date.now()) / 1000);
      const progress = Math.max(0, Math.min(1, remaining / Number(room.turn_seconds)));
      ring.classList.remove('is-idle');
      ring.classList.toggle('is-low', remaining <= 10);
      ring.style.setProperty('--clock-progress', String(progress));
      ring.querySelector('b').textContent = formatClock(remaining);
    });
  }

  function renderStatus() {
    renderHeaderBar();
  }

  function winnerName(seat) {
    const player = playerBySeat(seat);
    return playerLabel(player) || (seat === 1 ? 'Người chơi 1' : 'Người chơi 2');
  }

  function confirmLeave() {
    if (!isPlayer()) {
      teardown();
      navigate('/games');
      return;
    }
    openModal({
      title: 'Rời khỏi phòng?',
      bodyHtml: room?.status === 'active'
        ? '<p>Ván đang chơi: bạn sẽ bị xử thua và đối thủ được tính thắng.</p>'
        : '<p>Phòng sẽ đóng và link mời không còn hiệu lực.</p>',
      footHtml: '<button type="button" class="btn btn-ghost" data-modal-close>Ở lại</button><button type="button" class="btn btn-danger" data-action="confirm-leave">Rời phòng</button>',
      onMount(backdrop, close) {
        backdrop.querySelector('[data-action="confirm-leave"]')?.addEventListener('click', async () => {
          close();
          try { await GamesApi.leaveRoom(ref(cleanCode)); } catch {}
          teardown();
          navigate('/games');
        });
      }
    });
  }

  return { start, teardown };
}

// Mô tả nước đi cho lịch sử: chỉ hiển thị thông tin công khai, không lộ dữ liệu ẩn.
function describeMove(move, gameType) {
  if (!move || typeof move !== 'object') return '';
  if (move.resign === true) return 'Đầu hàng';
  if (move.pass === true) return 'Bỏ lượt';
  if (move.place) return 'Đặt đội tàu';
  if (move.roll !== undefined) return 'Tung xúc xắc';
  if (gameType === 'backgammon') {
    const from = move.from === 'bar' ? 'Bar' : `Điểm ${Number(move.from)}`;
    return `${from} · xúc xắc ${Number(move.die) || '?'}`;
  }
  if (Number.isInteger(Number(move.index))) return `Ô ${Number(move.index) + 1}`;
  if (Number.isInteger(Number(move.column)) && !move.from) return `Cột ${Number(move.column) + 1}`;
  if (move.from && move.to) return `${square(move.from, gameType)} → ${square(move.to, gameType)}`;
  if (Number.isInteger(Number(move.row)) && Number.isInteger(Number(move.column))) return `${square(move, gameType)}`;
  return 'Nước đi';
}

function square(point, gameType) {
  if (!point || typeof point !== 'object') return '';
  const row = Number(point.row);
  const column = Number(point.column);
  if (!Number.isInteger(row) || !Number.isInteger(column)) return '';
  if (gameType === 'chess') return `${'abcdefgh'[column] || '?'}${8 - row}`;
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}
