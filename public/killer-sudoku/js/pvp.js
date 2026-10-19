/**
 * Killer Sudoku Realtime PvP Client Module
 * Kết nối WebSocket thi đấu Solo 1v1 thời gian thực
 */

(function () {
  'use strict';

  let ws = null;
  let isInPvP = false;
  let currentRoom = null;
  let currentDifficulty = 'easy';
  let isHost = false;

  const dom = {};

  function initPvP() {
    cacheDom();
    bindEvents();
  }

  function cacheDom() {
    dom.btnOpenPvP = document.getElementById('btnOpenPvP');
    dom.pvpModal = document.getElementById('pvpModal');
    dom.btnClosePvP = document.getElementById('btnClosePvP');

    dom.pvpTabs = document.querySelectorAll('.pvp-tab-btn');
    dom.pvpPanes = document.querySelectorAll('.pvp-tab-pane');

    // Quick Match
    dom.btnStartQuickMatch = document.getElementById('btnStartQuickMatch');
    dom.pvpMyNickname = document.getElementById('pvpMyNickname');

    // Create Room
    dom.btnCreateRoomSubmit = document.getElementById('btnCreateRoomSubmit');
    dom.pvpHostNickname = document.getElementById('pvpHostNickname');

    // Join Room
    dom.btnJoinRoomSubmit = document.getElementById('btnJoinRoomSubmit');
    dom.pvpJoinNickname = document.getElementById('pvpJoinNickname');
    dom.pvpRoomCodeInput = document.getElementById('pvpRoomCodeInput');

    // Lobby Screen
    dom.pvpLobbyScreen = document.getElementById('pvpLobbyScreen');
    dom.displayRoomCode = document.getElementById('displayRoomCode');
    dom.btnCopyRoomCode = document.getElementById('btnCopyRoomCode');
    dom.lobbyPlayer1Name = document.getElementById('lobbyPlayer1Name');
    dom.lobbyPlayer2Name = document.getElementById('lobbyPlayer2Name');
    dom.lobbyPlayer2Status = document.getElementById('lobbyPlayer2Status');
    dom.btnCancelPvP = document.getElementById('btnCancelPvP');
    dom.btnReadyPvP = document.getElementById('btnReadyPvP');

    // Countdown
    dom.pvpCountdownOverlay = document.getElementById('pvpCountdownOverlay');
    dom.pvpCountdownNumber = document.getElementById('pvpCountdownNumber');

    // Match HUD Bar
    dom.pvpHudBar = document.getElementById('pvpHudBar');
    dom.pvpMyName = document.getElementById('pvpMyName');
    dom.pvpMyMistakes = document.getElementById('pvpMyMistakes');
    dom.pvpMyProgress = document.getElementById('pvpMyProgress');
    dom.pvpMyCells = document.getElementById('pvpMyCells');
    dom.pvpMyPercent = document.getElementById('pvpMyPercent');

    dom.pvpOppName = document.getElementById('pvpOppName');
    dom.pvpOppMistakes = document.getElementById('pvpOppMistakes');
    dom.pvpOppProgress = document.getElementById('pvpOppProgress');
    dom.pvpOppCells = document.getElementById('pvpOppCells');
    dom.pvpOppPercent = document.getElementById('pvpOppPercent');
    dom.pvpTimer = document.getElementById('pvpTimer');

    // Result Modal
    dom.pvpResultModal = document.getElementById('pvpResultModal');
    dom.pvpResultIcon = document.getElementById('pvpResultIcon');
    dom.pvpResultTitle = document.getElementById('pvpResultTitle');
    dom.pvpResultDesc = document.getElementById('pvpResultDesc');
    dom.pvpResultMyStats = document.getElementById('pvpResultMyStats');
    dom.pvpResultOppStats = document.getElementById('pvpResultOppStats');
    dom.btnPvPRematch = document.getElementById('btnPvPRematch');
    dom.btnPvPLeaveGame = document.getElementById('btnPvPLeaveGame');
  }

  function getPlayerName() {
    const saved = localStorage.getItem('killer_pvp_name');
    if (saved) return saved;
    const defaultName = 'SinhViên_' + Math.floor(100 + Math.random() * 900);
    localStorage.setItem('killer_pvp_name', defaultName);
    return defaultName;
  }

  function savePlayerName(name) {
    if (name && name.trim()) {
      localStorage.setItem('killer_pvp_name', name.trim());
    }
  }

  function bindEvents() {
    if (dom.btnOpenPvP) {
      dom.btnOpenPvP.addEventListener('click', () => {
        openPvPModal();
      });
    }

    if (dom.btnClosePvP) {
      dom.btnClosePvP.addEventListener('click', () => {
        closePvPModal();
      });
    }

    // Tab switching in PvP Modal
    dom.pvpTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-pvp-tab');
        dom.pvpTabs.forEach((t) => t.classList.toggle('active', t === tab));
        dom.pvpPanes.forEach((p) => p.classList.toggle('active', p.id === target));
        if (dom.pvpLobbyScreen) dom.pvpLobbyScreen.classList.add('hidden');
      });
    });

    // Difficulty selection in tabs
    document.querySelectorAll('.pvp-diff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parent = btn.parentElement;
        parent.querySelectorAll('.pvp-diff-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentDifficulty = btn.getAttribute('data-diff') || 'easy';
      });
    });

    // Quick Match submit
    if (dom.btnStartQuickMatch) {
      dom.btnStartQuickMatch.addEventListener('click', () => {
        const name = (dom.pvpMyNickname && dom.pvpMyNickname.value.trim()) || getPlayerName();
        savePlayerName(name);
        connectWebSocket(() => {
          sendAction('QUICK_MATCH', { playerName: name, difficulty: currentDifficulty, mode: 'same_map' });
        });
      });
    }

    // Create Room submit
    if (dom.btnCreateRoomSubmit) {
      dom.btnCreateRoomSubmit.addEventListener('click', () => {
        const name = (dom.pvpHostNickname && dom.pvpHostNickname.value.trim()) || getPlayerName();
        savePlayerName(name);
        const modeInput = document.querySelector('input[name="pvpMapMode"]:checked');
        const mode = modeInput ? modeInput.value : 'same_map';

        connectWebSocket(() => {
          sendAction('CREATE_ROOM', { playerName: name, mode, difficulty: currentDifficulty, isPrivate: true });
        });
      });
    }

    // Join Room submit
    if (dom.btnJoinRoomSubmit) {
      dom.btnJoinRoomSubmit.addEventListener('click', () => {
        const name = (dom.pvpJoinNickname && dom.pvpJoinNickname.value.trim()) || getPlayerName();
        savePlayerName(name);
        const code = dom.pvpRoomCodeInput ? dom.pvpRoomCodeInput.value.trim().toUpperCase() : '';
        if (!code) {
          alert('Vui lòng nhập mã phòng 6 ký tự!');
          return;
        }

        connectWebSocket(() => {
          sendAction('JOIN_ROOM', { playerName: name, roomCode: code });
        });
      });
    }

    // Copy Room Code
    if (dom.btnCopyRoomCode) {
      dom.btnCopyRoomCode.addEventListener('click', () => {
        const code = dom.displayRoomCode ? dom.displayRoomCode.textContent : '';
        if (code && code !== '------') {
          navigator.clipboard.writeText(code).then(() => {
            dom.btnCopyRoomCode.textContent = '✓ Đã Copy';
            setTimeout(() => { dom.btnCopyRoomCode.textContent = '📋 Copy'; }, 2000);
          });
        }
      });
    }

    // Ready toggle
    if (dom.btnReadyPvP) {
      dom.btnReadyPvP.addEventListener('click', () => {
        sendAction('PLAYER_READY', { ready: true });
        dom.btnReadyPvP.classList.add('btn-disabled');
        dom.btnReadyPvP.textContent = '✓ ĐÃ SẴN SÀNG';
      });
    }

    // Cancel / Leave
    if (dom.btnCancelPvP) {
      dom.btnCancelPvP.addEventListener('click', () => {
        sendAction('LEAVE_ROOM', {});
        if (dom.pvpLobbyScreen) dom.pvpLobbyScreen.classList.add('hidden');
        dom.pvpPanes.forEach((p) => p.classList.remove('hidden'));
        closeWebSocket();
      });
    }

    // Result actions
    if (dom.btnPvPRematch) {
      dom.btnPvPRematch.addEventListener('click', () => {
        dom.btnPvPRematch.textContent = '⏳ Đang chờ đối thủ...';
        dom.btnPvPRematch.disabled = true;
        sendAction('REQUEST_REMATCH', {});
      });
    }

    if (dom.btnPvPLeaveGame) {
      dom.btnPvPLeaveGame.addEventListener('click', () => {
        exitPvPMode();
      });
    }
  }

  function openPvPModal() {
    if (dom.pvpModal) dom.pvpModal.classList.remove('hidden');
    const name = getPlayerName();
    if (dom.pvpMyNickname) dom.pvpMyNickname.value = name;
    if (dom.pvpHostNickname) dom.pvpHostNickname.value = name;
    if (dom.pvpJoinNickname) dom.pvpJoinNickname.value = name;
  }

  function closePvPModal() {
    if (dom.pvpModal) dom.pvpModal.classList.add('hidden');
  }

  function connectWebSocket(onConnected) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (onConnected) onConnected();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/killer-sudoku`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[PvP] WebSocket connected successfully');
      if (onConnected) onConnected();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('[PvP] Message parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('[PvP] WebSocket closed');
    };

    ws.onerror = (err) => {
      console.error('[PvP] WebSocket error:', err);
      alert('Không thể kết nối đến máy chủ Đấu Solo. Vui lòng kiểm tra lại đường truyền!');
    };
  }

  function sendAction(action, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, payload }));
    }
  }

  function closeWebSocket() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
  }

  function handleServerMessage(msg) {
    console.log('[PvP Event]', msg.type, msg);

    switch (msg.type) {
      case 'ROOM_CREATED':
      case 'ROOM_UPDATED':
        renderLobby(msg.room);
        break;
      case 'COUNTDOWN':
        showCountdown(msg.count);
        break;
      case 'MATCH_STARTED':
        startPvPMatch(msg);
        break;
      case 'OPPONENT_PROGRESS':
        updateOpponentProgress(msg);
        break;
      case 'OPPONENT_MISTAKE':
        updateOpponentMistake(msg);
        break;
      case 'MATCH_END':
        showMatchResult(msg);
        break;
      case 'REMATCH_OFFERED':
        if (confirm(msg.message || 'Đối thủ muốn tái đấu! Bạn có muốn đấu tiếp không?')) {
          sendAction('REQUEST_REMATCH', {});
        }
        break;
      case 'OPPONENT_LEFT':
        alert(msg.message || 'Đối thủ đã thoát phòng đấu!');
        if (isInPvP) {
          exitPvPMode();
        } else if (currentRoom) {
          currentRoom.opponent = null;
          renderLobby(currentRoom);
        }
        break;
      case 'ERROR':
        alert(msg.message);
        break;
      default:
        break;
    }
  }

  function renderLobby(room) {
    if (!room) return;
    currentRoom = room;

    if (dom.pvpLobbyScreen) dom.pvpLobbyScreen.classList.remove('hidden');
    dom.pvpPanes.forEach((p) => p.classList.add('hidden'));

    if (dom.displayRoomCode) dom.displayRoomCode.textContent = room.code;

    if (dom.lobbyPlayer1Name && room.me) {
      dom.lobbyPlayer1Name.textContent = room.me.name;
    }

    if (room.opponent) {
      if (dom.lobbyPlayer2Name) dom.lobbyPlayer2Name.textContent = room.opponent.name;
      if (dom.lobbyPlayer2Status) {
        dom.lobbyPlayer2Status.textContent = room.opponent.ready ? 'Đã sẵn sàng' : 'Chưa sẵn sàng';
        dom.lobbyPlayer2Status.className = `player-status ${room.opponent.ready ? 'ready' : 'waiting'}`;
      }
    } else {
      if (dom.lobbyPlayer2Name) dom.lobbyPlayer2Name.textContent = 'Đang đợi đối thủ...';
      if (dom.lobbyPlayer2Status) {
        dom.lobbyPlayer2Status.textContent = 'Chờ...';
        dom.lobbyPlayer2Status.className = 'player-status waiting';
      }
    }

    if (dom.btnReadyPvP) {
      if (room.me && room.me.ready) {
        dom.btnReadyPvP.textContent = '✓ ĐÃ SẴN SÀNG';
        dom.btnReadyPvP.classList.add('btn-disabled');
      } else {
        dom.btnReadyPvP.textContent = 'SẴN SÀNG';
        dom.btnReadyPvP.classList.remove('btn-disabled');
      }
    }
  }

  function showCountdown(count) {
    if (dom.pvpCountdownOverlay) {
      dom.pvpCountdownOverlay.classList.remove('hidden');
      if (dom.pvpCountdownNumber) dom.pvpCountdownNumber.textContent = count;
      if (window.SoundManager && window.SoundManager.playNote) {
        window.SoundManager.playNote();
      }
    }
  }

  function startPvPMatch(msg) {
    isInPvP = true;
    closePvPModal();
    if (dom.pvpCountdownOverlay) dom.pvpCountdownOverlay.classList.add('hidden');

    // Show Match HUD
    if (dom.pvpHudBar) dom.pvpHudBar.classList.remove('hidden');

    if (currentRoom) {
      if (dom.pvpMyName && currentRoom.me) dom.pvpMyName.textContent = currentRoom.me.name;
      if (dom.pvpOppName && currentRoom.opponent) dom.pvpOppName.textContent = currentRoom.opponent.name;
    }

    resetPvPStats();

    // Load puzzle into game
    if (currentRoom && currentRoom.me && currentRoom.me.puzzleRaw) {
      if (window.KillerEngine && window.KillerSudokuApp && typeof window.KillerSudokuApp.loadPuzzleRaw === 'function') {
        window.KillerSudokuApp.loadPuzzleRaw(currentRoom.me.puzzleRaw, currentRoom.difficulty);
      }
    }

    if (window.SoundManager && window.SoundManager.playFanfare) {
      window.SoundManager.playFanfare();
    }
  }

  function resetPvPStats() {
    if (dom.pvpMyProgress) dom.pvpMyProgress.style.width = '0%';
    if (dom.pvpMyCells) dom.pvpMyCells.textContent = '0';
    if (dom.pvpMyPercent) dom.pvpMyPercent.textContent = '0%';
    if (dom.pvpMyMistakes) dom.pvpMyMistakes.textContent = 'Lỗi: 0/3';

    if (dom.pvpOppProgress) dom.pvpOppProgress.style.width = '0%';
    if (dom.pvpOppCells) dom.pvpOppCells.textContent = '0';
    if (dom.pvpOppPercent) dom.pvpOppPercent.textContent = '0%';
    if (dom.pvpOppMistakes) dom.pvpOppMistakes.textContent = 'Lỗi: 0/3';
  }

  function updateOpponentProgress(data) {
    const { solvedCount = 0, percent = 0, mistakes = 0 } = data;
    if (dom.pvpOppProgress) dom.pvpOppProgress.style.width = `${percent}%`;
    if (dom.pvpOppCells) dom.pvpOppCells.textContent = solvedCount;
    if (dom.pvpOppPercent) dom.pvpOppPercent.textContent = `${percent}%`;
    if (dom.pvpOppMistakes) dom.pvpOppMistakes.textContent = `Lỗi: ${mistakes}/3`;

    // Highlight opponent card flash
    const oppCard = document.querySelector('.pvp-player-card.pvp-opp');
    if (oppCard) {
      oppCard.classList.add('flash');
      setTimeout(() => oppCard.classList.remove('flash'), 300);
    }
  }

  function updateOpponentMistake(data) {
    const { mistakes = 0 } = data;
    if (dom.pvpOppMistakes) dom.pvpOppMistakes.textContent = `Lỗi: ${mistakes}/3`;
  }

  function showMatchResult(data) {
    const { result, message } = data;
    if (dom.pvpResultModal) dom.pvpResultModal.classList.remove('hidden');

    if (result === 'victory') {
      if (dom.pvpResultIcon) dom.pvpResultIcon.textContent = '🏆';
      if (dom.pvpResultTitle) {
        dom.pvpResultTitle.textContent = 'CHIẾN THẮNG!';
        dom.pvpResultTitle.style.color = '#16a34a';
      }
      if (dom.pvpResultDesc) dom.pvpResultDesc.textContent = message || 'Bạn đã giải nhanh hơn đối thủ!';
      if (window.SoundManager && window.SoundManager.playFanfare) {
        window.SoundManager.playFanfare();
      }
    } else {
      if (dom.pvpResultIcon) dom.pvpResultIcon.textContent = '😢';
      if (dom.pvpResultTitle) {
        dom.pvpResultTitle.textContent = 'THẤT BẠI!';
        dom.pvpResultTitle.style.color = '#ef4444';
      }
      if (dom.pvpResultDesc) dom.pvpResultDesc.textContent = message || 'Đối thủ đã hoàn thành trước bạn!';
      if (window.SoundManager && window.SoundManager.playError) {
        window.SoundManager.playError();
      }
    }

    if (dom.btnPvPRematch) {
      dom.btnPvPRematch.disabled = false;
      dom.btnPvPRematch.textContent = 'Tái Đấu Ngay ➔';
    }
  }

  function exitPvPMode() {
    isInPvP = false;
    currentRoom = null;
    if (dom.pvpResultModal) dom.pvpResultModal.classList.add('hidden');
    if (dom.pvpHudBar) dom.pvpHudBar.classList.add('hidden');
    closeWebSocket();

    // Reload singleplayer default puzzle
    if (window.KillerSudokuApp && typeof window.KillerSudokuApp.loadDefaultLevel === 'function') {
      window.KillerSudokuApp.loadDefaultLevel();
    }
  }

  // Public API exposed to Game Engine
  window.KillerSudokuPvP = {
    isInMatch() {
      return isInPvP;
    },
    reportProgress(solvedCount, percent) {
      if (!isInPvP) return;
      if (dom.pvpMyProgress) dom.pvpMyProgress.style.width = `${percent}%`;
      if (dom.pvpMyCells) dom.pvpMyCells.textContent = solvedCount;
      if (dom.pvpMyPercent) dom.pvpMyPercent.textContent = `${percent}%`;

      sendAction('UPDATE_PROGRESS', { solvedCount, percent });
    },
    reportMistake(mistakesCount) {
      if (!isInPvP) return;
      if (dom.pvpMyMistakes) dom.pvpMyMistakes.textContent = `Lỗi: ${mistakesCount}/3`;
      sendAction('PLAYER_MISTAKE', { mistakes: mistakesCount });
    },
    reportFinished(timeSpent) {
      if (!isInPvP) return;
      sendAction('PLAYER_FINISHED', { timeSpent });
    }
  };

  document.addEventListener('DOMContentLoaded', initPvP);
})();
